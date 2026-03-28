"""Overseer API – Authentication router."""
import asyncio
import os
import random
from datetime import datetime, timedelta, timezone

import bcrypt as _bcrypt
import pyotp
from fastapi import APIRouter, Depends, HTTPException, status
from jose import jwt
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, get_2fa_pending_user
from api.app.core.email import send_email, render_2fa_code_html
from api.app.models.models import User, user_tenant_access
from api.app.routers.audit import write_audit
from shared.schemas import LoginRequest, LoginResponse, TokenResponse, TwoFAVerifyRequest

router = APIRouter()

SECRET_KEY = os.getenv("SECRET_KEY", "dev_secret_key_change_in_production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480  # 8 hours


def _verify_password(plain: str, hashed: str) -> bool:
    return _bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(data: dict, expires_delta: timedelta) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + expires_delta
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


async def _build_full_token(user: User, db: AsyncSession) -> str:
    """Build a full access token with tenant claims for the given user."""
    tenant_ids: list[str] = []
    ta = getattr(user, "tenant_access", "selected")
    if ta != "all" and user.role != "super_admin":
        rows = await db.execute(
            select(user_tenant_access.c.tenant_id).where(
                user_tenant_access.c.user_id == user.id
            )
        )
        tenant_ids = [str(r.tenant_id) for r in rows.fetchall()]

    return create_access_token(
        data={
            "sub": str(user.id),
            "email": user.email,
            "role": user.role,
            "tenant_id": str(user.tenant_id) if user.tenant_id else None,
            "tenant_access": ta,
            "tenant_ids": tenant_ids,
        },
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    # Check if email domain has an LDAP IdP configured
    email = req.email.strip().lower()
    if "@" in email:
        domain = email.split("@", 1)[1]
        idp_result = await db.execute(
            text("""
                SELECT * FROM tenant_idp_config
                WHERE :domain = ANY(email_domains) AND is_active = true AND auth_type = 'ldap'
                LIMIT 1
            """),
            {"domain": domain},
        )
        ldap_idp = idp_result.fetchone()
        if ldap_idp:
            config = dict(ldap_idp._mapping)
            from api.app.routers.sso import ldap_authenticate
            ldap_user = await ldap_authenticate(email, req.password, config, db)
            if ldap_user:
                token = await _build_full_token(ldap_user, db)
                await write_audit(db, user={"sub": str(ldap_user.id), "email": email}, action="login",
                                  detail={"method": "ldap", "idp": config.get("name", "")})
                await db.commit()
                return LoginResponse(
                    access_token=token,
                    token_type="bearer",
                    expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
                )
            # LDAP auth failed — check if password fallback is allowed
            if not config.get("allow_password_fallback", False):
                await write_audit(db, user={"sub": None, "email": email}, action="login_failed",
                                  detail={"reason": "ldap_auth_failed"})
                await db.commit()
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    result = await db.execute(select(User).where(User.email == req.email, User.active == True))
    user = result.scalar_one_or_none()

    if not user:
        await write_audit(db, user={"sub": None, "email": req.email}, action="login_failed",
                          detail={"reason": "unknown_email", "email": req.email})
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # SSO-only users (no local password) cannot log in with password
    if not user.password_hash:
        await write_audit(db, user={"sub": str(user.id), "email": user.email}, action="login_failed",
                          detail={"reason": "sso_only_user"})
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not _verify_password(req.password, user.password_hash):
        await write_audit(db, user={"sub": str(user.id), "email": user.email}, action="login_failed",
                          detail={"reason": "wrong_password"})
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # 2FA enabled?
    if user.two_fa_method and user.two_fa_method != "none":
        pending_token = create_access_token(
            data={"sub": str(user.id), "email": user.email, "2fa_pending": True},
            expires_delta=timedelta(minutes=5),
        )

        if user.two_fa_method == "email":
            code = str(random.randint(100000, 999999))
            user.two_fa_email_code = code
            user.two_fa_email_code_expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
            await db.commit()
            asyncio.create_task(
                send_email(
                    user.email,
                    "Overseer \u2013 Anmeldecode",
                    f"Ihr Anmeldecode: {code}\n\nG\u00fcltig f\u00fcr 10 Minuten.",
                    render_2fa_code_html(code),
                )
            )

        return LoginResponse(
            requires_2fa=True,
            two_fa_method=user.two_fa_method,
            pending_token=pending_token,
        )

    # No 2FA – issue full token
    token = await _build_full_token(user, db)
    user.last_login_at = datetime.now(timezone.utc)
    await write_audit(db, user={"sub": str(user.id), "email": user.email}, action="login",
                      detail={"method": "password"})
    await db.commit()

    return LoginResponse(
        access_token=token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/2fa/verify", response_model=TokenResponse)
async def verify_2fa(
    req: TwoFAVerifyRequest,
    db: AsyncSession = Depends(get_db),
    pending_user: dict = Depends(get_2fa_pending_user),
):
    """Verify 2FA code and issue a full access token."""
    result = await db.execute(
        select(User).where(User.id == pending_user["sub"], User.active == True)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    code = req.code.replace(" ", "")

    if user.two_fa_method == "totp":
        if not user.two_fa_secret:
            raise HTTPException(status_code=500, detail="TOTP not configured")
        if not pyotp.TOTP(user.two_fa_secret).verify(code, valid_window=1):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Ung\u00fcltiger Code")
    elif user.two_fa_method == "email":
        if not user.two_fa_email_code:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Kein Code vorhanden")
        if datetime.now(timezone.utc) > user.two_fa_email_code_expires_at:
            user.two_fa_email_code = None
            user.two_fa_email_code_expires_at = None
            await db.commit()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Code abgelaufen")
        if user.two_fa_email_code != code:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Ung\u00fcltiger Code")
        user.two_fa_email_code = None
        user.two_fa_email_code_expires_at = None
    else:
        raise HTTPException(status_code=400, detail="Unknown 2FA method")

    token = await _build_full_token(user, db)
    user.last_login_at = datetime.now(timezone.utc)
    await write_audit(db, user={"sub": str(user.id), "email": user.email}, action="login",
                      detail={"method": f"password+{user.two_fa_method}"})
    await db.commit()

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/2fa/resend")
async def resend_2fa_code(
    db: AsyncSession = Depends(get_db),
    pending_user: dict = Depends(get_2fa_pending_user),
):
    """Resend the email 2FA code."""
    result = await db.execute(
        select(User).where(User.id == pending_user["sub"], User.active == True)
    )
    user = result.scalar_one_or_none()
    if not user or user.two_fa_method != "email":
        raise HTTPException(status_code=400, detail="Not an email 2FA user")

    code = str(random.randint(100000, 999999))
    user.two_fa_email_code = code
    user.two_fa_email_code_expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    await db.commit()

    asyncio.create_task(
        send_email(
            user.email,
            "Overseer \u2013 Neuer Anmeldecode",
            f"Ihr neuer Anmeldecode: {code}\n\nG\u00fcltig f\u00fcr 10 Minuten.",
            render_2fa_code_html(code),
        )
    )
    return {"detail": "Code wurde erneut gesendet"}


@router.get("/me")
async def me(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    # Load default_filter_id from user_preferences (independent of users table)
    pref_result = await db.execute(
        text("SELECT default_filter_id, show_inactive FROM user_preferences WHERE user_id = :uid"),
        {"uid": user["sub"]},
    )
    pref_row = pref_result.fetchone()
    default_filter_id = str(pref_row.default_filter_id) if pref_row and pref_row.default_filter_id else None
    show_inactive = pref_row.show_inactive if pref_row and pref_row.show_inactive is not None else True

    result = await db.execute(select(User).where(User.id == user["sub"], User.active == True))
    u = result.scalar_one_or_none()
    if not u:
        # User not in DB (e.g. after re-seed) — fall back to JWT claims
        return {
            "id": user["sub"],
            "email": user.get("email", ""),
            "display_name": user.get("email", "Unknown"),
            "role": user.get("role", "tenant_viewer"),
            "tenant_id": user.get("tenant_id"),
            "tenant_access": user.get("tenant_access", "selected"),
            "two_fa_method": "none",
            "default_filter_id": default_filter_id,
            "show_inactive": show_inactive,
        }
    return {
        "id": str(u.id),
        "email": u.email,
        "display_name": u.display_name,
        "role": u.role,
        "tenant_id": str(u.tenant_id) if u.tenant_id else None,
        "tenant_access": getattr(u, "tenant_access", "selected"),
        "two_fa_method": u.two_fa_method or "none",
        "auth_source": getattr(u, "auth_source", "local"),
        "default_filter_id": default_filter_id,
        "show_inactive": show_inactive,
    }


@router.put("/preferences")
async def update_preferences(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Update user preferences (show_inactive, etc.)."""
    sets = []
    params: dict = {"uid": user["sub"]}
    if "show_inactive" in body:
        sets.append("show_inactive = :show_inactive")
        params["show_inactive"] = body["show_inactive"]
    if not sets:
        return {"status": "ok"}
    set_clause = ", ".join(sets) + ", updated_at = now()"
    await db.execute(
        text(
            f"INSERT INTO user_preferences (user_id, {', '.join(k for k in params if k != 'uid')}, updated_at) "
            f"VALUES (:uid, {', '.join(':' + k for k in params if k != 'uid')}, now()) "
            f"ON CONFLICT (user_id) DO UPDATE SET {set_clause}"
        ),
        params,
    )
    await write_audit(db, user=user, action="preference_update",
                      detail={k: v for k, v in body.items() if k != "uid"})
    await db.commit()
    return {"status": "ok"}


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(user: dict = Depends(get_current_user)):
    """Issue a new token for an already-authenticated user."""
    token = create_access_token(
        data={
            "sub": user["sub"],
            "email": user["email"],
            "role": user["role"],
            "tenant_id": user.get("tenant_id"),
            "tenant_access": user.get("tenant_access", "selected"),
            "tenant_ids": user.get("tenant_ids", []),
        },
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
