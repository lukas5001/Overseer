"""Overseer API – 2FA setup and management router."""
import asyncio
import io
import base64
import random
from datetime import datetime, timedelta, timezone

import pyotp
import qrcode
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.auth import get_current_user
from api.app.core.database import get_db
from api.app.core.email import send_email, render_2fa_code_html
from api.app.models.models import User
from api.app.routers.audit import write_audit

router = APIRouter()


def _mask_email(email: str) -> str:
    local, domain = email.rsplit("@", 1)
    if len(local) <= 2:
        masked = local[0] + "***"
    else:
        masked = local[0] + "***" + local[-1]
    return f"{masked}@{domain}"


def _generate_qr_data_url(uri: str) -> str:
    img = qrcode.make(uri, box_size=6, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


@router.get("/status")
async def get_2fa_status(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    result = await db.execute(select(User).where(User.id == user["sub"]))
    u = result.scalar_one_or_none()
    if not u:
        return {"method": "none"}
    return {"method": u.two_fa_method or "none"}


@router.post("/setup/totp/init")
async def totp_init(
    user: dict = Depends(get_current_user),
):
    secret = pyotp.random_base32()
    uri = pyotp.TOTP(secret).provisioning_uri(
        name=user["email"], issuer_name="Overseer",
    )
    return {
        "secret": secret,
        "qr_uri": _generate_qr_data_url(uri),
    }


@router.post("/setup/totp/confirm")
async def totp_confirm(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    secret = body.get("secret", "")
    code = body.get("code", "").replace(" ", "")
    if not secret or not code:
        raise HTTPException(status_code=400, detail="secret und code erforderlich")

    if not pyotp.TOTP(secret).verify(code, valid_window=1):
        raise HTTPException(status_code=400, detail="Ung\u00fcltiger Code")

    result = await db.execute(select(User).where(User.id == user["sub"]))
    u = result.scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    u.two_fa_method = "totp"
    u.two_fa_secret = secret
    u.two_fa_email_code = None
    u.two_fa_email_code_expires_at = None
    await write_audit(db, user=user, action="2fa_enable",
                      target_type="user", target_id=u.id,
                      detail={"method": "totp"})
    await db.commit()
    return {"success": True}


@router.post("/setup/email/init")
async def email_init(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    result = await db.execute(select(User).where(User.id == user["sub"]))
    u = result.scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    if not u.email:
        raise HTTPException(status_code=400, detail="Keine E-Mail-Adresse hinterlegt")

    code = str(random.randint(100000, 999999))
    u.two_fa_email_code = code
    u.two_fa_email_code_expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    await db.commit()

    asyncio.create_task(
        send_email(
            u.email,
            "Overseer \u2013 2FA Einrichtungscode",
            f"Ihr Einrichtungscode: {code}\n\nG\u00fcltig f\u00fcr 10 Minuten.",
            render_2fa_code_html(code),
        )
    )
    return {"sent_to": _mask_email(u.email)}


@router.post("/setup/email/confirm")
async def email_confirm(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    code = body.get("code", "").replace(" ", "")
    if not code:
        raise HTTPException(status_code=400, detail="Code erforderlich")

    result = await db.execute(select(User).where(User.id == user["sub"]))
    u = result.scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    if not u.two_fa_email_code:
        raise HTTPException(status_code=400, detail="Kein Code vorhanden")
    if datetime.now(timezone.utc) > u.two_fa_email_code_expires_at:
        u.two_fa_email_code = None
        u.two_fa_email_code_expires_at = None
        await db.commit()
        raise HTTPException(status_code=400, detail="Code abgelaufen")
    if u.two_fa_email_code != code:
        raise HTTPException(status_code=400, detail="Ung\u00fcltiger Code")

    u.two_fa_method = "email"
    u.two_fa_secret = None
    u.two_fa_email_code = None
    u.two_fa_email_code_expires_at = None
    await write_audit(db, user=user, action="2fa_enable",
                      target_type="user", target_id=u.id,
                      detail={"method": "email"})
    await db.commit()
    return {"success": True}


@router.post("/disable")
async def disable_2fa(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    result = await db.execute(select(User).where(User.id == user["sub"]))
    u = result.scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    u.two_fa_method = "none"
    u.two_fa_secret = None
    u.two_fa_email_code = None
    u.two_fa_email_code_expires_at = None
    await write_audit(db, user=user, action="2fa_disable",
                      target_type="user", target_id=u.id)
    await db.commit()
    return {"success": True}
