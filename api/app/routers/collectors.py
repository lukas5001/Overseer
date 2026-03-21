"""Overseer API – Collectors router."""
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user
from api.app.models.models import Collector
from shared.schemas import CollectorOut

router = APIRouter()


@router.get("/", response_model=list[CollectorOut])
async def list_collectors(
    tenant_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    q = select(Collector).where(Collector.active == True).order_by(Collector.name)
    if tenant_id:
        q = q.where(Collector.tenant_id == tenant_id)
    result = await db.execute(q)
    return result.scalars().all()
