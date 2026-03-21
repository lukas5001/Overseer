"""Overseer API – Services router."""
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user
from api.app.models.models import Service
from shared.schemas import ServiceOut

router = APIRouter()


@router.get("/", response_model=list[ServiceOut])
async def list_services(
    host_id: UUID | None = None,
    tenant_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    q = select(Service).where(Service.active == True).order_by(Service.name)
    if host_id:
        q = q.where(Service.host_id == host_id)
    if tenant_id:
        q = q.where(Service.tenant_id == tenant_id)
    result = await db.execute(q)
    return result.scalars().all()
