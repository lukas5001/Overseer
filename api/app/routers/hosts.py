"""Overseer API – Hosts router."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user
from api.app.models.models import Host, Tenant
from shared.schemas import HostOut

router = APIRouter()


@router.get("/", response_model=list[HostOut])
async def list_hosts(
    tenant_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    q = (
        select(Host, Tenant.name.label("tenant_name"))
        .join(Tenant, Host.tenant_id == Tenant.id)
        .where(Host.active == True)
        .order_by(Tenant.name, Host.hostname)
    )
    if tenant_id:
        q = q.where(Host.tenant_id == tenant_id)
    result = await db.execute(q)
    rows = result.all()
    out = []
    for row in rows:
        h = row.Host
        data = HostOut.model_validate(h)
        data.tenant_name = row.tenant_name
        out.append(data)
    return out


@router.get("/{host_id}", response_model=HostOut)
async def get_host(
    host_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    result = await db.execute(
        select(Host, Tenant.name.label("tenant_name"))
        .join(Tenant, Host.tenant_id == Tenant.id)
        .where(Host.id == host_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Host not found")
    data = HostOut.model_validate(row.Host)
    data.tenant_name = row.tenant_name
    return data
