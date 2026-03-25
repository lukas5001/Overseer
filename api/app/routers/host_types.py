"""Overseer API – Host Types CRUD router."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, require_role
from api.app.models.models import HostType, Host

router = APIRouter()


class HostTypeCreate(BaseModel):
    name: str
    icon: str = "server"
    category: str = "Sonstiges"
    agent_capable: bool = False
    snmp_enabled: bool = False
    ip_required: bool = False
    os_family: str | None = None
    sort_order: int = 100


class HostTypeUpdate(BaseModel):
    name: str | None = None
    icon: str | None = None
    category: str | None = None
    agent_capable: bool | None = None
    snmp_enabled: bool | None = None
    ip_required: bool | None = None
    os_family: str | None = None
    sort_order: int | None = None
    active: bool | None = None


@router.get("/")
async def list_host_types(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    result = await db.execute(
        select(HostType).where(HostType.active == True).order_by(HostType.sort_order, HostType.name)
    )
    return [
        {
            "id": str(ht.id),
            "name": ht.name,
            "icon": ht.icon,
            "category": ht.category,
            "agent_capable": ht.agent_capable,
            "snmp_enabled": ht.snmp_enabled,
            "ip_required": ht.ip_required,
            "os_family": ht.os_family,
            "sort_order": ht.sort_order,
            "is_system": ht.is_system,
            "active": ht.active,
            "created_at": ht.created_at.isoformat(),
        }
        for ht in result.scalars().all()
    ]


@router.post("/", status_code=201)
async def create_host_type(
    body: HostTypeCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_role("super_admin")),
):
    # Check unique name
    existing = await db.execute(select(HostType).where(HostType.name == body.name))
    if existing.scalars().first():
        raise HTTPException(400, f"Host-Typ '{body.name}' existiert bereits.")

    ht = HostType(
        name=body.name,
        icon=body.icon,
        category=body.category,
        agent_capable=body.agent_capable,
        snmp_enabled=body.snmp_enabled,
        ip_required=body.ip_required,
        os_family=body.os_family,
        sort_order=body.sort_order,
        is_system=False,
    )
    db.add(ht)
    await db.commit()
    await db.refresh(ht)
    return {"id": str(ht.id), "name": ht.name}


@router.patch("/{host_type_id}")
async def update_host_type(
    host_type_id: UUID,
    body: HostTypeUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_role("super_admin")),
):
    result = await db.execute(select(HostType).where(HostType.id == host_type_id))
    ht = result.scalars().first()
    if not ht:
        raise HTTPException(404, "Host-Typ nicht gefunden.")

    updates = body.model_dump(exclude_unset=True)

    # Check unique name if changed
    if "name" in updates and updates["name"] != ht.name:
        dup = await db.execute(select(HostType).where(HostType.name == updates["name"]))
        if dup.scalars().first():
            raise HTTPException(400, f"Host-Typ '{updates['name']}' existiert bereits.")

    for field, value in updates.items():
        setattr(ht, field, value)
    ht.updated_at = datetime.now(timezone.utc)

    await db.commit()
    return {"ok": True}


@router.delete("/{host_type_id}")
async def delete_host_type(
    host_type_id: UUID,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_role("super_admin")),
):
    result = await db.execute(select(HostType).where(HostType.id == host_type_id))
    ht = result.scalars().first()
    if not ht:
        raise HTTPException(404, "Host-Typ nicht gefunden.")

    if ht.is_system:
        raise HTTPException(400, "System-Typen können nicht gelöscht werden.")

    # Check if any hosts use this type
    usage = await db.execute(
        select(func.count()).select_from(Host).where(Host.host_type_id == host_type_id)
    )
    count = usage.scalar()
    if count > 0:
        raise HTTPException(400, f"Typ wird noch von {count} Host(s) verwendet.")

    await db.delete(ht)
    await db.commit()
    return {"ok": True}
