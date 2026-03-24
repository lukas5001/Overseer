"""Overseer API – User management (super_admin only)."""
import bcrypt as _bcrypt
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import require_role
from api.app.models.models import User, user_tenant_access
from api.app.routers.audit import write_audit

router = APIRouter()

_admin = require_role("super_admin")


class UserCreate(BaseModel):
    email: str
    password: str
    display_name: str
    role: str = "tenant_viewer"
    tenant_access: str = "selected"  # 'all' or 'selected'
    tenant_ids: list[UUID] = []


class UserUpdate(BaseModel):
    display_name: str | None = None
    role: str | None = None
    tenant_access: str | None = None
    tenant_ids: list[UUID] | None = None
    active: bool | None = None


class PasswordChange(BaseModel):
    password: str


@router.get("/")
async def list_users(
    response: Response,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(_admin),
):
    total = (await db.execute(select(func.count()).select_from(User))).scalar_one()
    response.headers["X-Total-Count"] = str(total)
    result = await db.execute(select(User).order_by(User.email).offset(offset).limit(limit))
    users = result.scalars().all()

    # Fetch tenant access mappings for all returned users
    user_ids = [u.id for u in users]
    if user_ids:
        ta_rows = await db.execute(
            select(user_tenant_access).where(user_tenant_access.c.user_id.in_(user_ids))
        )
        access_map: dict[str, list[str]] = {}
        for r in ta_rows.fetchall():
            uid = str(r.user_id)
            access_map.setdefault(uid, []).append(str(r.tenant_id))
    else:
        access_map = {}

    return [
        {
            "id": str(u.id),
            "email": u.email,
            "display_name": u.display_name,
            "role": u.role,
            "tenant_access": getattr(u, "tenant_access", "selected"),
            "tenant_ids": access_map.get(str(u.id), []),
            "active": u.active,
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
            "created_at": u.created_at.isoformat(),
        }
        for u in users
    ]


@router.post("/", status_code=201)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(_admin),
):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already exists")

    pw_hash = _bcrypt.hashpw(body.password.encode(), _bcrypt.gensalt()).decode()
    user = User(
        email=body.email,
        password_hash=pw_hash,
        display_name=body.display_name,
        role=body.role,
        tenant_access=body.tenant_access,
        tenant_id=body.tenant_ids[0] if body.tenant_ids else None,  # backwards compat
    )
    db.add(user)
    await db.flush()

    # Insert tenant access rows
    for tid in body.tenant_ids:
        await db.execute(
            user_tenant_access.insert().values(user_id=user.id, tenant_id=tid)
        )

    await write_audit(db, user=_user, action="user_create",
                      target_type="user", target_id=user.id,
                      detail={"email": body.email, "role": body.role})
    await db.commit()
    await db.refresh(user)
    return {"id": str(user.id), "email": user.email, "role": user.role}


@router.patch("/{user_id}")
async def update_user(
    user_id: UUID,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    update_data = body.model_dump(exclude_none=True)
    tenant_ids = update_data.pop("tenant_ids", None)

    for field, value in update_data.items():
        setattr(user, field, value)

    # Update tenant access rows if provided
    if tenant_ids is not None:
        await db.execute(
            user_tenant_access.delete().where(user_tenant_access.c.user_id == user_id)
        )
        for tid in tenant_ids:
            await db.execute(
                user_tenant_access.insert().values(user_id=user_id, tenant_id=tid)
            )
        # Keep backwards-compat tenant_id
        user.tenant_id = tenant_ids[0] if tenant_ids else None

    user.updated_at = datetime.now(timezone.utc)
    changes = body.model_dump(exclude_none=True)
    changes.pop("tenant_ids", None)  # don't log full list
    await write_audit(db, user=_user, action="user_update",
                      target_type="user", target_id=user.id,
                      detail={"changed_fields": list(changes.keys())})
    await db.commit()
    return {"id": str(user.id), "email": user.email, "role": user.role, "active": user.active}


@router.post("/{user_id}/password", status_code=204)
async def set_password(
    user_id: UUID,
    body: PasswordChange,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = _bcrypt.hashpw(body.password.encode(), _bcrypt.gensalt()).decode()
    user.updated_at = datetime.now(timezone.utc)
    await write_audit(db, user=_user, action="user_password_change",
                      target_type="user", target_id=user.id,
                      detail={"email": user.email})
    await db.commit()


@router.delete("/{user_id}", status_code=204)
async def deactivate_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.active = False
    user.updated_at = datetime.now(timezone.utc)
    await write_audit(db, user=_user, action="user_delete",
                      target_type="user", target_id=user.id,
                      detail={"email": user.email})
    await db.commit()
