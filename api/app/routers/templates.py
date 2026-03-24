"""Overseer API – Service Templates router."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, text, func
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, require_role, tenant_scope
from api.app.models.models import ServiceTemplate, Service, Host
from api.app.routers.audit import write_audit
from shared.schemas import ServiceTemplateOut, ServiceTemplateCreate, ServiceTemplateUpdate

router = APIRouter()


@router.get("/vendors")
async def list_vendors(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    result = await db.execute(
        select(ServiceTemplate.vendor).distinct().order_by(ServiceTemplate.vendor)
    )
    return {"vendors": [row[0] for row in result.all()]}


@router.get("/categories")
async def list_categories(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    result = await db.execute(
        select(ServiceTemplate.category).distinct().order_by(ServiceTemplate.category)
    )
    return {"categories": [row[0] for row in result.all()]}


@router.get("/", response_model=list[ServiceTemplateOut])
async def list_templates(
    vendor: str | None = Query(None),
    category: str | None = Query(None),
    built_in: bool | None = Query(None),
    tag: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    query = select(ServiceTemplate)
    if vendor is not None:
        query = query.where(ServiceTemplate.vendor == vendor)
    if category is not None:
        query = query.where(ServiceTemplate.category == category)
    if built_in is not None:
        query = query.where(ServiceTemplate.built_in == built_in)
    if tag is not None:
        query = query.where(ServiceTemplate.tags.contains([tag]))
    query = query.order_by(ServiceTemplate.vendor, ServiceTemplate.name)
    result = await db.execute(query)
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
        vendor=body.vendor,
        category=body.category,
        built_in=False,  # Users cannot create built-in templates
        tags=body.tags,
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
    if tpl.built_in:
        raise HTTPException(status_code=403, detail="Built-in templates cannot be modified")
    if body.name is not None:
        tpl.name = body.name
    if body.description is not None:
        tpl.description = body.description
    if body.checks is not None:
        tpl.checks = [c.model_dump() for c in body.checks]
    if body.vendor is not None:
        tpl.vendor = body.vendor
    if body.category is not None:
        tpl.category = body.category
    if body.tags is not None:
        tpl.tags = body.tags
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
    if tpl.built_in:
        raise HTTPException(status_code=403, detail="Built-in templates cannot be deleted")
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

    await write_audit(db, user=_user, action="template_applied",
                      target_type="service_template", target_id=template_id,
                      detail={
                          "template_id": str(template_id),
                          "host_id": str(body.host_id),
                          "created_count": created,
                          "skipped_count": skipped,
                      })

    return {"created": created, "skipped": skipped}
