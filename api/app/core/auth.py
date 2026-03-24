"""JWT Auth dependency – use as Depends(get_current_user) in routers."""
import hashlib
import os
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db

SECRET_KEY = os.getenv("SECRET_KEY", "dev_secret_key_change_in_production")
ALGORITHM = "HS256"

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if payload.get("2fa_pending"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="2FA verification required",
        )
    return payload


def get_2fa_pending_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    """Extract user from a 2FA-pending token. Rejects normal tokens."""
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not payload.get("2fa_pending"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not a 2FA pending token")
    return payload


def require_role(*allowed_roles: str):
    """Dependency factory that restricts an endpoint to specific roles."""
    def _check(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Required role: {', '.join(allowed_roles)}",
            )
        return user
    return _check


def tenant_scope(user: dict = Depends(get_current_user)):
    """Return None (all tenants) or list[UUID] (allowed tenants).

    - super_admin or tenant_access='all' → None (no filter)
    - tenant_access='selected' → list of tenant UUIDs from JWT
    - Empty list means user has no tenants assigned → 403
    """
    from uuid import UUID as _UUID
    if user.get("role") == "super_admin":
        return None
    if user.get("tenant_access") == "all":
        return None
    tenant_ids = user.get("tenant_ids", [])
    if not tenant_ids:
        # Backwards compat: old tokens with single tenant_id
        tid = user.get("tenant_id")
        if tid:
            try:
                return [_UUID(tid)]
            except ValueError:
                pass
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is not assigned to any tenant",
        )
    try:
        return [_UUID(t) for t in tenant_ids]
    except ValueError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid tenant_id in token")


def apply_tenant_filter(query, column, scope, explicit_tenant_id=None):
    """Apply tenant filtering to a SQLAlchemy query.

    Args:
        query: SQLAlchemy select query
        column: The tenant_id column to filter on (e.g. Host.tenant_id)
        scope: Result of tenant_scope() — None (all) or list[UUID] (selected)
        explicit_tenant_id: Optional explicit filter from query param
    """
    if explicit_tenant_id:
        # Explicit filter always takes priority (but must be within scope)
        if scope is not None and explicit_tenant_id not in scope:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this tenant")
        return query.where(column == explicit_tenant_id)
    if scope is not None:
        return query.where(column.in_(scope))
    return query


async def get_collector_auth(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Accept either JWT Bearer OR X-API-Key (for collector config requests)."""
    # Try JWT first
    if credentials:
        try:
            payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
            return payload
        except JWTError:
            pass

    # Fall back to X-API-Key header
    api_key = request.headers.get("X-API-Key")
    if api_key:
        key_hash = hashlib.sha256(api_key.encode()).hexdigest()
        key_prefix = api_key[:12]
        result = await db.execute(
            text("""
                SELECT ak.tenant_id, t.slug AS tenant_slug
                FROM api_keys ak
                JOIN tenants t ON t.id = ak.tenant_id
                WHERE ak.key_prefix = :prefix AND ak.key_hash = :hash
                  AND ak.active = true AND t.active = true
            """),
            {"prefix": key_prefix, "hash": key_hash},
        )
        row = result.fetchone()
        if row:
            return {"tenant_id": str(row.tenant_id), "tenant_slug": row.tenant_slug, "role": "collector"}

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
