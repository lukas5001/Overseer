"""Overseer API – Service Templates router."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, require_role
from api.app.models.models import ServiceTemplate
from shared.schemas import ServiceTemplateOut, ServiceTemplateCreate, ServiceTemplateUpdate

router = APIRouter()


@router.get("/", response_model=list[ServiceTemplateOut])
async def list_templates(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    result = await db.execute(select(ServiceTemplate).order_by(ServiceTemplate.name))
    return result.scalars().all()


@router.get("/{template_id}", response_model=ServiceTemplateOut)
async def get_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    result = await db.execute(select(ServiceTemplate).where(ServiceTemplate.id == template_id))
    tpl = result.scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    return tpl


@router.post("/", response_model=ServiceTemplateOut, status_code=201)
async def create_template(
    body: ServiceTemplateCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    tpl = ServiceTemplate(
        name=body.name,
        description=body.description,
        checks=[c.model_dump() for c in body.checks],
    )
    db.add(tpl)
    await db.commit()
    await db.refresh(tpl)
    return tpl


@router.put("/{template_id}", response_model=ServiceTemplateOut)
async def update_template(
    template_id: UUID,
    body: ServiceTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    result = await db.execute(select(ServiceTemplate).where(ServiceTemplate.id == template_id))
    tpl = result.scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    if body.name is not None:
        tpl.name = body.name
    if body.description is not None:
        tpl.description = body.description
    if body.checks is not None:
        tpl.checks = [c.model_dump() for c in body.checks]
    tpl.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(tpl)
    return tpl


@router.delete("/{template_id}", status_code=204)
async def delete_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    result = await db.execute(select(ServiceTemplate).where(ServiceTemplate.id == template_id))
    tpl = result.scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    await db.delete(tpl)
    await db.commit()
