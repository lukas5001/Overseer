"""Overseer API – Service Templates router."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, require_role, tenant_scope
from api.app.models.models import ServiceTemplate, Service, Host
from api.app.routers.audit import write_audit
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


class TemplateApplyRequest(BaseModel):
    host_id: UUID
    overrides: dict = {}


@router.post("/{template_id}/apply")
async def apply_template(
    template_id: UUID,
    body: TemplateApplyRequest,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
    _scope=Depends(tenant_scope),
):
    # Load template
    result = await db.execute(select(ServiceTemplate).where(ServiceTemplate.id == template_id))
    tpl = result.scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")

    # Load host and verify tenant access
    host = await db.get(Host, body.host_id)
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")
    if _scope is not None and host.tenant_id not in _scope:
        raise HTTPException(status_code=403, detail="Access denied to this host")

    checks = tpl.checks or []
    created = 0
    skipped = 0

    for check_def in checks:
        merged = {**check_def, **body.overrides}
        name = merged.get("name")
        if not name:
            skipped += 1
            continue

        # Check if service already exists
        existing = await db.execute(
            select(Service).where(Service.host_id == body.host_id, Service.name == name)
        )
        if existing.scalar_one_or_none():
            skipped += 1
            continue

        svc = Service(
            host_id=body.host_id,
            tenant_id=host.tenant_id,
            name=name,
            check_type=merged.get("check_type", "ping"),
            check_config=merged.get("check_config", {}),
            interval_seconds=merged.get("interval_seconds", 60),
            threshold_warn=merged.get("threshold_warn"),
            threshold_crit=merged.get("threshold_crit"),
            max_check_attempts=merged.get("max_check_attempts", 3),
            check_mode=merged.get("check_mode", "passive"),
        )
        db.add(svc)
        created += 1

    await db.commit()

    await write_audit(db, _user, "template_applied", "service_template", template_id, {
        "template_id": str(template_id),
        "host_id": str(body.host_id),
        "created_count": created,
        "skipped_count": skipped,
    })

    return {"created": created, "skipped": skipped}
