"""Overseer API – SSO (OIDC, SAML, LDAP) router."""
import json
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

import httpx
import redis.asyncio as aioredis
from authlib.integrations.httpx_client import AsyncOAuth2Client
from authlib.jose import jwt as authlib_jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db, AsyncSessionLocal
from api.app.core.auth import get_current_user, require_role, tenant_scope
from api.app.routers.auth import create_access_token, ACCESS_TOKEN_EXPIRE_MINUTES, _build_full_token
from api.app.routers.audit import write_audit
from api.app.models.models import User, user_tenant_access
from shared.encryption import encrypt_field, decrypt_field

router = APIRouter()
logger = logging.getLogger("overseer.sso")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://overseer.dailycrust.it")


async def _get_redis():
    return aioredis.from_url(REDIS_URL, decode_responses=True)


# ── Schemas ──────────────────────────────────────────────────────────────────

class DiscoverRequest(BaseModel):
    email: str


class DiscoverResponse(BaseModel):
    auth_type: str  # 'local', 'oidc', 'saml', 'ldap'
    idp_id: str | None = None
    idp_name: str | None = None
    redirect_url: str | None = None


class IdpConfigCreate(BaseModel):
    tenant_id: str
    name: str = "SSO"
    auth_type: str  # 'oidc', 'saml', 'ldap'
    email_domains: list[str] = []
    oidc_discovery_url: str | None = None
    oidc_client_id: str | None = None
    oidc_client_secret: str | None = None  # plaintext, will be encrypted
    saml_metadata_url: str | None = None
    saml_entity_id: str | None = None
    saml_certificate: str | None = None
    saml_attribute_mapping: dict | None = None
    ldap_url: str | None = None
    ldap_base_dn: str | None = None
    ldap_bind_dn: str | None = None
    ldap_bind_password: str | None = None  # plaintext, will be encrypted
    ldap_user_filter: str | None = None
    ldap_group_attribute: str | None = None
    role_mapping: dict | None = None
    jit_provisioning: bool = True
    allow_password_fallback: bool = False


class IdpConfigUpdate(BaseModel):
    name: str | None = None
    email_domains: list[str] | None = None
    oidc_discovery_url: str | None = None
    oidc_client_id: str | None = None
    oidc_client_secret: str | None = None
    saml_metadata_url: str | None = None
    saml_entity_id: str | None = None
    saml_certificate: str | None = None
    saml_attribute_mapping: dict | None = None
    ldap_url: str | None = None
    ldap_base_dn: str | None = None
    ldap_bind_dn: str | None = None
    ldap_bind_password: str | None = None
    ldap_user_filter: str | None = None
    ldap_group_attribute: str | None = None
    role_mapping: dict | None = None
    jit_provisioning: bool | None = None
    allow_password_fallback: bool | None = None
    is_active: bool | None = None


# ── Home Realm Discovery ─────────────────────────────────────────────────────

@router.post("/discover", response_model=DiscoverResponse)
async def discover(body: DiscoverRequest, db: AsyncSession = Depends(get_db)):
    """Discover auth method by email domain."""
    email = body.email.strip().lower()
    if "@" not in email:
        return DiscoverResponse(auth_type="local")

    domain = email.split("@", 1)[1]

    result = await db.execute(
        text("""
            SELECT id, auth_type, name
            FROM tenant_idp_config
            WHERE :domain = ANY(email_domains) AND is_active = true
            LIMIT 1
        """),
        {"domain": domain},
    )
    row = result.fetchone()
    if not row:
        return DiscoverResponse(auth_type="local")

    idp_id = str(row.id)
    auth_type = row.auth_type

    redirect_url = None
    if auth_type == "oidc":
        redirect_url = f"/api/v1/sso/oidc/start?idp={idp_id}"
    elif auth_type == "saml":
        redirect_url = f"/api/v1/sso/saml/start?idp={idp_id}"

    return DiscoverResponse(
        auth_type=auth_type,
        idp_id=idp_id,
        idp_name=row.name,
        redirect_url=redirect_url,
    )


# ── JIT Provisioning ─────────────────────────────────────────────────────────

async def _jit_provision(
    db: AsyncSession,
    idp_config: dict,
    email: str,
    display_name: str | None,
    external_id: str,
    groups: list[str] | None = None,
) -> User:
    """Create or update user via JIT provisioning."""
    # Determine role from mapping
    role_mapping = idp_config.get("role_mapping") or {"*": "tenant_viewer"}
    role = role_mapping.get("*", "tenant_viewer")
    if groups:
        for group in groups:
            if group in role_mapping:
                role = role_mapping[group]
                break

    # Map role names to Overseer roles
    role_map = {
        "admin": "tenant_admin",
        "operator": "tenant_operator",
        "viewer": "tenant_viewer",
    }
    role = role_map.get(role, role)
    if role not in ("super_admin", "tenant_admin", "tenant_operator", "tenant_viewer"):
        role = "tenant_viewer"

    tenant_id = idp_config["tenant_id"]
    idp_config_id = idp_config["id"]
    auth_type = idp_config["auth_type"]

    # Check if user exists
    result = await db.execute(
        select(User).where(User.email == email)
    )
    user = result.scalar_one_or_none()

    if user:
        # Update existing user
        user.display_name = display_name or user.display_name
        user.external_id = external_id
        user.auth_source = auth_type
        user.idp_config_id = idp_config_id
        user.role = role
        user.last_login_at = datetime.now(timezone.utc)
        user.active = True
    else:
        # Create new user
        user = User(
            email=email,
            display_name=display_name or email.split("@")[0],
            password_hash=None,  # SSO users have no local password
            tenant_id=tenant_id,
            role=role,
            auth_source=auth_type,
            external_id=external_id,
            idp_config_id=idp_config_id,
            last_login_at=datetime.now(timezone.utc),
            active=True,
        )
        db.add(user)

    await db.commit()
    await db.refresh(user)

    # Ensure user has tenant access
    existing = await db.execute(
        text("SELECT 1 FROM user_tenant_access WHERE user_id = :uid AND tenant_id = :tid"),
        {"uid": user.id, "tid": tenant_id},
    )
    if not existing.fetchone():
        await db.execute(
            text("INSERT INTO user_tenant_access (user_id, tenant_id) VALUES (:uid, :tid)"),
            {"uid": user.id, "tid": tenant_id},
        )
        await db.commit()

    return user


async def _build_sso_token(user: User, db: AsyncSession) -> str:
    """Build JWT token for an SSO-authenticated user."""
    return await _build_full_token(user, db)


# ── OIDC Flow ────────────────────────────────────────────────────────────────

@router.get("/oidc/start")
async def oidc_start(idp: str, db: AsyncSession = Depends(get_db)):
    """Start OIDC authorization code flow."""
    result = await db.execute(
        text("SELECT * FROM tenant_idp_config WHERE id = CAST(:id AS uuid) AND is_active = true AND auth_type = 'oidc'"),
        {"id": idp},
    )
    idp_config = result.fetchone()
    if not idp_config:
        raise HTTPException(status_code=404, detail="IdP not found")

    config = dict(idp_config._mapping)
    discovery_url = config["oidc_discovery_url"]
    client_id = config["oidc_client_id"]

    if not discovery_url or not client_id:
        raise HTTPException(status_code=400, detail="OIDC not fully configured")

    # Fetch OIDC discovery document
    async with httpx.AsyncClient() as http:
        disc_resp = await http.get(discovery_url)
        disc_resp.raise_for_status()
        disc = disc_resp.json()

    authorization_endpoint = disc["authorization_endpoint"]

    # Generate state and nonce
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(16)

    # Store in Redis
    r = await _get_redis()
    state_data = json.dumps({"idp_id": idp, "nonce": nonce})
    await r.set(f"overseer:oidc_state:{state}", state_data, ex=600)
    await r.aclose()

    # Build redirect URL
    callback_url = f"{FRONTEND_URL}/api/v1/sso/oidc/callback"
    params = {
        "client_id": client_id,
        "response_type": "code",
        "scope": "openid email profile",
        "redirect_uri": callback_url,
        "state": state,
        "nonce": nonce,
    }
    query = "&".join(f"{k}={httpx.URL('', params={k: v}).params[k]}" for k, v in params.items())
    redirect_url = f"{authorization_endpoint}?{query}"

    return RedirectResponse(url=redirect_url, status_code=302)


@router.get("/oidc/callback")
async def oidc_callback(
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db),
):
    """OIDC authorization code callback."""
    # Validate state
    r = await _get_redis()
    state_data = await r.get(f"overseer:oidc_state:{state}")
    await r.aclose()

    if not state_data:
        raise HTTPException(status_code=400, detail="Invalid or expired state")

    state_info = json.loads(state_data)
    idp_id = state_info["idp_id"]
    nonce = state_info["nonce"]

    # Delete state (one-time use)
    r = await _get_redis()
    await r.delete(f"overseer:oidc_state:{state}")
    await r.aclose()

    # Load IdP config
    result = await db.execute(
        text("SELECT * FROM tenant_idp_config WHERE id = CAST(:id AS uuid)"),
        {"id": idp_id},
    )
    idp_config = result.fetchone()
    if not idp_config:
        raise HTTPException(status_code=400, detail="IdP not found")

    config = dict(idp_config._mapping)
    client_secret = decrypt_field(config.get("oidc_client_secret_enc") or "")

    # Fetch discovery doc for token endpoint
    async with httpx.AsyncClient() as http:
        disc_resp = await http.get(config["oidc_discovery_url"])
        disc = disc_resp.json()
        token_endpoint = disc["token_endpoint"]
        userinfo_endpoint = disc.get("userinfo_endpoint")

        # Exchange code for tokens
        callback_url = f"{FRONTEND_URL}/api/v1/sso/oidc/callback"
        token_resp = await http.post(token_endpoint, data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": callback_url,
            "client_id": config["oidc_client_id"],
            "client_secret": client_secret,
        })

        if token_resp.status_code != 200:
            logger.error("OIDC token exchange failed: %s", token_resp.text)
            raise HTTPException(status_code=400, detail="Token exchange failed")

        token_data = token_resp.json()
        id_token = token_data.get("id_token")
        access_token = token_data.get("access_token")

        # Extract claims from id_token (decode without signature verification for claims)
        # In production, you'd verify the signature
        claims = {}
        if id_token:
            import base64
            parts = id_token.split(".")
            if len(parts) == 3:
                padded = parts[1] + "=" * (4 - len(parts[1]) % 4)
                claims = json.loads(base64.urlsafe_b64decode(padded))

        # Also try userinfo endpoint
        if userinfo_endpoint and access_token:
            try:
                ui_resp = await http.get(userinfo_endpoint, headers={"Authorization": f"Bearer {access_token}"})
                if ui_resp.status_code == 200:
                    ui_claims = ui_resp.json()
                    claims.update(ui_claims)
            except Exception:
                pass

    email = claims.get("email", "")
    name = claims.get("name") or claims.get("preferred_username") or email.split("@")[0]
    sub = claims.get("sub", "")
    groups = claims.get("groups", [])

    if not email:
        raise HTTPException(status_code=400, detail="No email in OIDC claims")

    # JIT provisioning
    if not config.get("jit_provisioning", True):
        # Check if user exists
        existing = await db.execute(select(User).where(User.email == email))
        if not existing.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="User not provisioned. Contact your administrator.")

    user = await _jit_provision(db, config, email, name, sub, groups)

    await write_audit(db, user={"sub": str(user.id), "email": email}, action="login",
                      detail={"method": "oidc", "idp": config.get("name", "")})
    await db.commit()

    # Build JWT
    token = await _build_sso_token(user, db)

    # Redirect to frontend with token
    return RedirectResponse(
        url=f"{FRONTEND_URL}/login?sso_token={token}",
        status_code=302,
    )


# ── SAML Flow ────────────────────────────────────────────────────────────────

@router.get("/saml/start")
async def saml_start(idp: str, db: AsyncSession = Depends(get_db)):
    """Start SAML authentication flow."""
    result = await db.execute(
        text("SELECT * FROM tenant_idp_config WHERE id = CAST(:id AS uuid) AND is_active = true AND auth_type = 'saml'"),
        {"id": idp},
    )
    idp_config = result.fetchone()
    if not idp_config:
        raise HTTPException(status_code=404, detail="IdP not found")

    config = dict(idp_config._mapping)
    metadata_url = config.get("saml_metadata_url")

    if not metadata_url:
        raise HTTPException(status_code=400, detail="SAML not fully configured")

    # Fetch SAML metadata to find SSO URL
    async with httpx.AsyncClient() as http:
        meta_resp = await http.get(metadata_url)
        meta_resp.raise_for_status()
        metadata_xml = meta_resp.text

    # Parse SSO URL from metadata (simplified — look for SingleSignOnService)
    import xml.etree.ElementTree as ET
    root = ET.fromstring(metadata_xml)
    ns = {"md": "urn:oasis:names:tc:SAML:2.0:metadata"}
    sso_elements = root.findall(".//md:SingleSignOnService", ns)

    sso_url = None
    for elem in sso_elements:
        binding = elem.get("Binding", "")
        if "HTTP-Redirect" in binding:
            sso_url = elem.get("Location")
            break
    if not sso_url and sso_elements:
        sso_url = sso_elements[0].get("Location")

    if not sso_url:
        raise HTTPException(status_code=400, detail="No SSO URL found in SAML metadata")

    # Generate RelayState
    relay_state = secrets.token_urlsafe(32)
    r = await _get_redis()
    await r.set(f"overseer:saml_relay:{relay_state}", str(config["id"]), ex=600)
    await r.aclose()

    # Build simple SAML AuthnRequest (deflated + base64)
    import base64
    import zlib
    entity_id = config.get("saml_entity_id") or f"{FRONTEND_URL}/api/v1/sso/saml/acs"
    acs_url = f"{FRONTEND_URL}/api/v1/sso/saml/acs"
    request_id = f"_overseer_{secrets.token_hex(16)}"

    authn_request = f"""<samlp:AuthnRequest
        xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
        xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
        ID="{request_id}"
        Version="2.0"
        IssueInstant="{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}"
        AssertionConsumerServiceURL="{acs_url}"
        Destination="{sso_url}"
        ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
        <saml:Issuer>{entity_id}</saml:Issuer>
    </samlp:AuthnRequest>"""

    deflated = zlib.compress(authn_request.encode())[2:-4]  # raw deflate
    encoded = base64.b64encode(deflated).decode()

    from urllib.parse import quote
    redirect_url = f"{sso_url}?SAMLRequest={quote(encoded)}&RelayState={quote(relay_state)}"

    return RedirectResponse(url=redirect_url, status_code=302)


@router.post("/saml/acs")
async def saml_acs(request: Request, db: AsyncSession = Depends(get_db)):
    """SAML Assertion Consumer Service (ACS) — receives SAML Response via POST."""
    form_data = await request.form()
    saml_response_b64 = form_data.get("SAMLResponse", "")
    relay_state = form_data.get("RelayState", "")

    if not saml_response_b64 or not relay_state:
        raise HTTPException(status_code=400, detail="Missing SAMLResponse or RelayState")

    # Validate relay state
    r = await _get_redis()
    idp_id = await r.get(f"overseer:saml_relay:{relay_state}")
    await r.delete(f"overseer:saml_relay:{relay_state}")
    await r.aclose()

    if not idp_id:
        raise HTTPException(status_code=400, detail="Invalid or expired RelayState")

    # Load IdP config
    result = await db.execute(
        text("SELECT * FROM tenant_idp_config WHERE id = CAST(:id AS uuid)"),
        {"id": idp_id},
    )
    idp_config = result.fetchone()
    if not idp_config:
        raise HTTPException(status_code=400, detail="IdP not found")
    config = dict(idp_config._mapping)

    # Decode SAML Response
    import base64
    import xml.etree.ElementTree as ET

    try:
        saml_xml = base64.b64decode(saml_response_b64)
        root = ET.fromstring(saml_xml)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid SAML Response: {e}")

    # Extract assertions (simplified — production should verify signature)
    ns = {
        "samlp": "urn:oasis:names:tc:SAML:2.0:protocol",
        "saml": "urn:oasis:names:tc:SAML:2.0:assertion",
    }

    # Check status
    status_elem = root.find(".//samlp:Status/samlp:StatusCode", ns)
    if status_elem is not None:
        status_val = status_elem.get("Value", "")
        if "Success" not in status_val:
            raise HTTPException(status_code=400, detail=f"SAML authentication failed: {status_val}")

    # Extract NameID
    name_id_elem = root.find(".//saml:NameID", ns)
    name_id = name_id_elem.text if name_id_elem is not None else None

    # Extract attributes
    attributes: dict[str, list[str]] = {}
    for attr_stmt in root.findall(".//saml:AttributeStatement/saml:Attribute", ns):
        attr_name = attr_stmt.get("Name", "")
        values = [v.text for v in attr_stmt.findall("saml:AttributeValue", ns) if v.text]
        if attr_name and values:
            attributes[attr_name] = values

    # Get email (from NameID or attributes)
    attr_mapping = config.get("saml_attribute_mapping") or {}
    email_attr = attr_mapping.get("email", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress")
    email = (attributes.get(email_attr, [None])[0]) or name_id or ""

    name_attr = attr_mapping.get("name", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name")
    display_name = attributes.get(name_attr, [None])[0]

    groups_attr = attr_mapping.get("groups", "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups")
    groups = attributes.get(groups_attr, [])

    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="No valid email in SAML assertion")

    # JIT provisioning
    user = await _jit_provision(db, config, email, display_name, name_id or email, groups)

    await write_audit(db, user={"sub": str(user.id), "email": email}, action="login",
                      detail={"method": "saml", "idp": config.get("name", "")})
    await db.commit()

    token = await _build_sso_token(user, db)

    return RedirectResponse(
        url=f"{FRONTEND_URL}/login?sso_token={token}",
        status_code=302,
    )


# ── LDAP Authentication ──────────────────────────────────────────────────────

async def ldap_authenticate(email: str, password: str, idp_config: dict, db: AsyncSession) -> User | None:
    """Authenticate user via LDAP bind. Returns User on success, None on failure."""
    import ldap3
    from ldap3 import Server, Connection, SUBTREE

    ldap_url = idp_config.get("ldap_url", "")
    base_dn = idp_config.get("ldap_base_dn", "")
    bind_dn = idp_config.get("ldap_bind_dn", "")
    bind_password = decrypt_field(idp_config.get("ldap_bind_password_enc") or "")
    user_filter = (idp_config.get("ldap_user_filter") or "(&(objectClass=user)(mail={email}))").replace("{email}", email)
    group_attr = idp_config.get("ldap_group_attribute") or "memberOf"

    if not ldap_url or not base_dn:
        return None

    use_ssl = ldap_url.startswith("ldaps://")
    server = Server(ldap_url, use_ssl=use_ssl, get_info=ldap3.NONE)

    try:
        # Service account bind to find user DN
        conn = Connection(server, user=bind_dn, password=bind_password, auto_bind=True)
        conn.search(base_dn, user_filter, search_scope=SUBTREE, attributes=["dn", "cn", "mail", "displayName", group_attr])

        if not conn.entries:
            conn.unbind()
            return None

        user_entry = conn.entries[0]
        user_dn = str(user_entry.entry_dn)
        display_name = str(user_entry.displayName) if hasattr(user_entry, "displayName") else str(user_entry.cn) if hasattr(user_entry, "cn") else None
        groups = [str(g) for g in getattr(user_entry, group_attr, [])] if hasattr(user_entry, group_attr) else []
        conn.unbind()

        # User bind to verify password
        user_conn = Connection(server, user=user_dn, password=password, auto_bind=True)
        user_conn.unbind()

        # JIT provisioning
        user = await _jit_provision(db, idp_config, email, display_name, user_dn, groups)
        return user

    except ldap3.core.exceptions.LDAPBindError:
        return None
    except Exception as e:
        logger.error("LDAP error for %s: %s", email, e)
        return None


# ── IdP Config CRUD (Admin) ──────────────────────────────────────────────────

@router.get("/idp-configs")
async def list_idp_configs(
    tenant_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    scope=Depends(tenant_scope),
):
    """List IdP configurations."""
    params: dict = {}
    where = "1=1"
    if tenant_id:
        where = "tenant_id = :tenant_id"
        params["tenant_id"] = tenant_id
    elif scope is not None:
        placeholders = ", ".join(f":t{i}" for i in range(len(scope)))
        where = f"tenant_id IN ({placeholders})"
        for i, tid in enumerate(scope):
            params[f"t{i}"] = tid

    result = await db.execute(
        text(f"""
            SELECT id, tenant_id, name, auth_type, email_domains,
                   oidc_discovery_url, oidc_client_id,
                   saml_metadata_url, saml_entity_id,
                   ldap_url, ldap_base_dn, ldap_bind_dn, ldap_user_filter, ldap_group_attribute,
                   role_mapping, jit_provisioning, allow_password_fallback, is_active,
                   created_at, updated_at
            FROM tenant_idp_config
            WHERE {where}
            ORDER BY name
        """),
        params,
    )
    return [dict(row._mapping) for row in result.fetchall()]


@router.post("/idp-configs", status_code=201)
async def create_idp_config(
    body: IdpConfigCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    scope=Depends(tenant_scope),
):
    """Create a new IdP configuration."""
    if body.auth_type not in ("oidc", "saml", "ldap"):
        raise HTTPException(status_code=400, detail="auth_type must be oidc, saml, or ldap")

    if scope is not None:
        from uuid import UUID as _UUID
        if _UUID(body.tenant_id) not in scope:
            raise HTTPException(status_code=403, detail="Access denied")

    # Encrypt secrets
    client_secret_enc = encrypt_field(body.oidc_client_secret) if body.oidc_client_secret else None
    bind_password_enc = encrypt_field(body.ldap_bind_password) if body.ldap_bind_password else None

    result = await db.execute(
        text("""
            INSERT INTO tenant_idp_config
                (tenant_id, name, auth_type, email_domains,
                 oidc_discovery_url, oidc_client_id, oidc_client_secret_enc,
                 saml_metadata_url, saml_entity_id, saml_certificate, saml_attribute_mapping,
                 ldap_url, ldap_base_dn, ldap_bind_dn, ldap_bind_password_enc,
                 ldap_user_filter, ldap_group_attribute,
                 role_mapping, jit_provisioning, allow_password_fallback)
            VALUES
                (:tenant_id, :name, :auth_type, :email_domains,
                 :oidc_discovery_url, :oidc_client_id, :oidc_client_secret_enc,
                 :saml_metadata_url, :saml_entity_id, :saml_certificate, :saml_attribute_mapping,
                 :ldap_url, :ldap_base_dn, :ldap_bind_dn, :ldap_bind_password_enc,
                 :ldap_user_filter, :ldap_group_attribute,
                 :role_mapping, :jit_provisioning, :allow_password_fallback)
            RETURNING id, tenant_id, name, auth_type, email_domains, is_active, created_at
        """),
        {
            "tenant_id": body.tenant_id,
            "name": body.name,
            "auth_type": body.auth_type,
            "email_domains": body.email_domains,
            "oidc_discovery_url": body.oidc_discovery_url,
            "oidc_client_id": body.oidc_client_id,
            "oidc_client_secret_enc": client_secret_enc,
            "saml_metadata_url": body.saml_metadata_url,
            "saml_entity_id": body.saml_entity_id,
            "saml_certificate": body.saml_certificate,
            "saml_attribute_mapping": json.dumps(body.saml_attribute_mapping or {}),
            "ldap_url": body.ldap_url,
            "ldap_base_dn": body.ldap_base_dn,
            "ldap_bind_dn": body.ldap_bind_dn,
            "ldap_bind_password_enc": bind_password_enc,
            "ldap_user_filter": body.ldap_user_filter,
            "ldap_group_attribute": body.ldap_group_attribute,
            "role_mapping": json.dumps(body.role_mapping or {"*": "tenant_viewer"}),
            "jit_provisioning": body.jit_provisioning,
            "allow_password_fallback": body.allow_password_fallback,
        },
    )
    await db.commit()
    return dict(result.fetchone()._mapping)


@router.patch("/idp-configs/{config_id}")
async def update_idp_config(
    config_id: str,
    body: IdpConfigUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    """Update an IdP configuration."""
    updates = []
    params: dict = {"id": config_id}

    for field in ["name", "email_domains", "oidc_discovery_url", "oidc_client_id",
                  "saml_metadata_url", "saml_entity_id", "saml_certificate",
                  "ldap_url", "ldap_base_dn", "ldap_bind_dn", "ldap_user_filter",
                  "ldap_group_attribute", "jit_provisioning", "allow_password_fallback", "is_active"]:
        val = getattr(body, field, None)
        if val is not None:
            updates.append(f"{field} = :{field}")
            params[field] = val

    if body.oidc_client_secret is not None:
        updates.append("oidc_client_secret_enc = :oidc_client_secret_enc")
        params["oidc_client_secret_enc"] = encrypt_field(body.oidc_client_secret)

    if body.ldap_bind_password is not None:
        updates.append("ldap_bind_password_enc = :ldap_bind_password_enc")
        params["ldap_bind_password_enc"] = encrypt_field(body.ldap_bind_password)

    if body.saml_attribute_mapping is not None:
        updates.append("saml_attribute_mapping = :saml_attribute_mapping")
        params["saml_attribute_mapping"] = json.dumps(body.saml_attribute_mapping)

    if body.role_mapping is not None:
        updates.append("role_mapping = :role_mapping")
        params["role_mapping"] = json.dumps(body.role_mapping)

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates.append("updated_at = now()")
    set_clause = ", ".join(updates)

    result = await db.execute(
        text(f"""
            UPDATE tenant_idp_config SET {set_clause}
            WHERE id = CAST(:id AS uuid)
            RETURNING id, tenant_id, name, auth_type, email_domains, is_active, updated_at
        """),
        params,
    )
    await db.commit()
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="IdP config not found")
    return dict(row._mapping)


@router.delete("/idp-configs/{config_id}", status_code=204)
async def delete_idp_config(
    config_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    """Delete an IdP configuration."""
    result = await db.execute(
        text("DELETE FROM tenant_idp_config WHERE id = CAST(:id AS uuid) RETURNING id"),
        {"id": config_id},
    )
    await db.commit()
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="IdP config not found")
