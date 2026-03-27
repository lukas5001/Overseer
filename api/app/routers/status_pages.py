"""Overseer API – Public Status Pages: admin CRUD + public endpoints."""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, require_role, tenant_scope, apply_tenant_filter
from api.app.models.models import (
    StatusPage, StatusPageComponent, ComponentCheckMapping,
    StatusPageIncident, IncidentUpdate, ComponentDailyUptime,
    StatusPageSubscriber, incident_component_links,
)
from api.app.routers.audit import write_audit

router = APIRouter()
public_router = APIRouter()

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]$")


# ── Pydantic Schemas ──────────────────────────────────────────────────────────

class ComponentCreate(BaseModel):
    name: str = Field(..., max_length=255)
    description: str | None = None
    position: int = 0
    group_name: str | None = None
    service_ids: list[str] = []
    show_uptime: bool = True

class ComponentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    position: int | None = None
    group_name: str | None = None
    service_ids: list[str] | None = None
    show_uptime: bool | None = None
    status_override: bool | None = None
    current_status: str | None = None

class ComponentOut(BaseModel):
    id: str
    name: str
    description: str | None
    position: int
    group_name: str | None
    current_status: str
    status_override: bool
    show_uptime: bool
    service_ids: list[str]

class StatusPageCreate(BaseModel):
    slug: str = Field(..., min_length=3, max_length=63)
    title: str = Field(..., max_length=255)
    description: str | None = None
    logo_url: str | None = None
    primary_color: str = "#22c55e"
    timezone: str = "UTC"
    is_public: bool = True
    components: list[ComponentCreate] = []

class StatusPageUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    logo_url: str | None = None
    primary_color: str | None = None
    timezone: str | None = None
    is_public: bool | None = None

class StatusPageOut(BaseModel):
    id: str
    tenant_id: str
    slug: str
    title: str
    description: str | None
    logo_url: str | None
    primary_color: str
    timezone: str
    is_public: bool
    created_at: datetime
    updated_at: datetime
    component_count: int = 0

class StatusPageDetail(BaseModel):
    id: str
    tenant_id: str
    slug: str
    title: str
    description: str | None
    logo_url: str | None
    primary_color: str
    timezone: str
    is_public: bool
    created_at: datetime
    updated_at: datetime
    components: list[ComponentOut]

class IncidentCreateReq(BaseModel):
    title: str = Field(..., max_length=255)
    status: str = "investigating"
    impact: str = "minor"
    component_ids: list[str] = []
    body: str = ""

class IncidentUpdateReq(BaseModel):
    status: str
    body: str

class IncidentOut(BaseModel):
    id: str
    status_page_id: str
    title: str
    status: str
    impact: str
    is_auto_created: bool
    created_at: datetime
    resolved_at: datetime | None
    updates: list[dict]
    affected_component_ids: list[str]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _page_out(page: StatusPage, count: int = 0) -> dict:
    return {
        "id": str(page.id),
        "tenant_id": str(page.tenant_id),
        "slug": page.slug,
        "title": page.title,
        "description": page.description,
        "logo_url": page.logo_url,
        "primary_color": page.primary_color,
        "timezone": page.timezone,
        "is_public": page.is_public,
        "created_at": page.created_at.isoformat() if page.created_at else None,
        "updated_at": page.updated_at.isoformat() if page.updated_at else None,
        "component_count": count,
    }


def _component_out(comp: StatusPageComponent, service_ids: list[str]) -> dict:
    return {
        "id": str(comp.id),
        "name": comp.name,
        "description": comp.description,
        "position": comp.position,
        "group_name": comp.group_name,
        "current_status": comp.current_status,
        "status_override": comp.status_override,
        "show_uptime": comp.show_uptime,
        "service_ids": service_ids,
    }


def _incident_out(inc: StatusPageIncident) -> dict:
    return {
        "id": str(inc.id),
        "status_page_id": str(inc.status_page_id),
        "title": inc.title,
        "status": inc.status,
        "impact": inc.impact,
        "is_auto_created": inc.is_auto_created,
        "created_at": inc.created_at.isoformat() if inc.created_at else None,
        "resolved_at": inc.resolved_at.isoformat() if inc.resolved_at else None,
        "updates": [
            {
                "id": str(u.id),
                "status": u.status,
                "body": u.body,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            }
            for u in (inc.updates or [])
        ],
        "affected_component_ids": [str(c.id) for c in (inc.affected_components or [])],
    }


async def _get_page_for_tenant(db: AsyncSession, page_id: UUID, scope) -> StatusPage:
    q = select(StatusPage).where(StatusPage.id == page_id)
    q = apply_tenant_filter(q, StatusPage.tenant_id, scope)
    result = await db.execute(q)
    page = result.scalar_one_or_none()
    if not page:
        raise HTTPException(404, "Status page not found")
    return page


# ── Admin: Status Pages CRUD ─────────────────────────────────────────────────

@router.get("/status-pages")
async def list_status_pages(
    db: AsyncSession = Depends(get_db),
    scope=Depends(tenant_scope),
    tenant_id: UUID | None = None,
):
    q = select(StatusPage)
    q = apply_tenant_filter(q, StatusPage.tenant_id, scope, tenant_id)
    result = await db.execute(q)
    pages = result.scalars().all()

    # Count components per page
    out = []
    for page in pages:
        cnt = await db.execute(
            select(func.count()).select_from(StatusPageComponent).where(StatusPageComponent.status_page_id == page.id)
        )
        out.append(_page_out(page, cnt.scalar() or 0))
    return out


@router.get("/status-pages/{page_id}")
async def get_status_page(
    page_id: UUID,
    db: AsyncSession = Depends(get_db),
    scope=Depends(tenant_scope),
):
    page = await _get_page_for_tenant(db, page_id, scope)

    # Load components with their service mappings
    comps_result = await db.execute(
        select(StatusPageComponent)
        .where(StatusPageComponent.status_page_id == page.id)
        .order_by(StatusPageComponent.position)
    )
    components = comps_result.scalars().all()

    comp_list = []
    for comp in components:
        mappings = await db.execute(
            select(ComponentCheckMapping.service_id).where(ComponentCheckMapping.component_id == comp.id)
        )
        sids = [str(r[0]) for r in mappings.fetchall()]
        comp_list.append(_component_out(comp, sids))

    return {
        **_page_out(page),
        "components": comp_list,
    }


@router.post("/status-pages", status_code=201)
async def create_status_page(
    body: StatusPageCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    scope=Depends(tenant_scope),
):
    if not _SLUG_RE.match(body.slug):
        raise HTTPException(400, "Slug must be 3-63 chars, lowercase alphanumeric + hyphens, no leading/trailing hyphens")

    # Check slug uniqueness
    existing = await db.execute(select(StatusPage).where(StatusPage.slug == body.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Slug already in use")

    # Determine tenant_id
    tenant_ids = scope
    if tenant_ids and len(tenant_ids) == 1:
        tid = tenant_ids[0]
    elif scope is None:
        # super_admin: require explicit tenant from first component or default
        tid = UUID(user["tenant_ids"][0]) if user.get("tenant_ids") else None
        if not tid:
            raise HTTPException(400, "Cannot determine tenant_id for super_admin. Use tenant-specific token.")
    else:
        tid = tenant_ids[0] if tenant_ids else None
        if not tid:
            raise HTTPException(400, "No tenant assigned")

    page = StatusPage(
        tenant_id=tid,
        slug=body.slug,
        title=body.title,
        description=body.description,
        logo_url=body.logo_url,
        primary_color=body.primary_color,
        timezone=body.timezone,
        is_public=body.is_public,
    )
    db.add(page)
    await db.flush()

    # Create components
    for i, comp_data in enumerate(body.components):
        comp = StatusPageComponent(
            status_page_id=page.id,
            name=comp_data.name,
            description=comp_data.description,
            position=comp_data.position or i,
            group_name=comp_data.group_name,
            show_uptime=comp_data.show_uptime,
        )
        db.add(comp)
        await db.flush()

        for sid in comp_data.service_ids:
            db.add(ComponentCheckMapping(component_id=comp.id, service_id=UUID(sid)))

    await db.commit()
    await write_audit(db, user, "status_page.create", {"slug": body.slug, "title": body.title})
    return _page_out(page, len(body.components))


@router.patch("/status-pages/{page_id}")
async def update_status_page(
    page_id: UUID,
    body: StatusPageUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    scope=Depends(tenant_scope),
):
    page = await _get_page_for_tenant(db, page_id, scope)
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(page, k, v)
    page.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await write_audit(db, user, "status_page.update", {"id": str(page_id), "changes": list(changes.keys())})
    return _page_out(page)


@router.delete("/status-pages/{page_id}", status_code=204)
async def delete_status_page(
    page_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    scope=Depends(tenant_scope),
):
    page = await _get_page_for_tenant(db, page_id, scope)
    await db.delete(page)
    await db.commit()
    await write_audit(db, user, "status_page.delete", {"slug": page.slug})


# ── Admin: Components ─────────────────────────────────────────────────────────

@router.post("/status-pages/{page_id}/components", status_code=201)
async def add_component(
    page_id: UUID,
    body: ComponentCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    scope=Depends(tenant_scope),
):
    page = await _get_page_for_tenant(db, page_id, scope)
    comp = StatusPageComponent(
        status_page_id=page.id,
        name=body.name,
        description=body.description,
        position=body.position,
        group_name=body.group_name,
        show_uptime=body.show_uptime,
    )
    db.add(comp)
    await db.flush()

    for sid in body.service_ids:
        db.add(ComponentCheckMapping(component_id=comp.id, service_id=UUID(sid)))

    await db.commit()
    return _component_out(comp, body.service_ids)


@router.patch("/status-pages/{page_id}/components/{comp_id}")
async def update_component(
    page_id: UUID,
    comp_id: UUID,
    body: ComponentUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    scope=Depends(tenant_scope),
):
    await _get_page_for_tenant(db, page_id, scope)
    comp = await db.get(StatusPageComponent, comp_id)
    if not comp or comp.status_page_id != page_id:
        raise HTTPException(404, "Component not found")

    changes = body.model_dump(exclude_unset=True)
    service_ids = changes.pop("service_ids", None)

    for k, v in changes.items():
        setattr(comp, k, v)

    if service_ids is not None:
        # Replace check mappings
        await db.execute(
            delete(ComponentCheckMapping).where(ComponentCheckMapping.component_id == comp.id)
        )
        for sid in service_ids:
            db.add(ComponentCheckMapping(component_id=comp.id, service_id=UUID(sid)))

    await db.commit()

    # Get current service_ids
    mappings = await db.execute(
        select(ComponentCheckMapping.service_id).where(ComponentCheckMapping.component_id == comp.id)
    )
    sids = [str(r[0]) for r in mappings.fetchall()]
    return _component_out(comp, sids)


@router.delete("/status-pages/{page_id}/components/{comp_id}", status_code=204)
async def delete_component(
    page_id: UUID,
    comp_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    scope=Depends(tenant_scope),
):
    await _get_page_for_tenant(db, page_id, scope)
    comp = await db.get(StatusPageComponent, comp_id)
    if not comp or comp.status_page_id != page_id:
        raise HTTPException(404, "Component not found")
    await db.delete(comp)
    await db.commit()


@router.put("/status-pages/{page_id}/components/reorder")
async def reorder_components(
    page_id: UUID,
    order: list[str],
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    scope=Depends(tenant_scope),
):
    await _get_page_for_tenant(db, page_id, scope)
    for i, cid in enumerate(order):
        comp = await db.get(StatusPageComponent, UUID(cid))
        if comp and comp.status_page_id == page_id:
            comp.position = i
    await db.commit()
    return {"ok": True}


# ── Admin: Incidents ──────────────────────────────────────────────────────────

@router.get("/status-pages/{page_id}/incidents")
async def list_incidents(
    page_id: UUID,
    status_filter: str | None = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    scope=Depends(tenant_scope),
):
    await _get_page_for_tenant(db, page_id, scope)
    q = select(StatusPageIncident).where(StatusPageIncident.status_page_id == page_id)
    if status_filter:
        q = q.where(StatusPageIncident.status == status_filter)
    q = q.order_by(StatusPageIncident.created_at.desc())
    result = await db.execute(q)
    incidents = result.scalars().unique().all()

    # Eagerly load updates and components for each incident
    out = []
    for inc in incidents:
        await db.refresh(inc, ["updates", "affected_components"])
        out.append(_incident_out(inc))
    return out


@router.post("/status-pages/{page_id}/incidents", status_code=201)
async def create_incident(
    page_id: UUID,
    body: IncidentCreateReq,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    scope=Depends(tenant_scope),
):
    await _get_page_for_tenant(db, page_id, scope)

    inc = StatusPageIncident(
        status_page_id=page_id,
        title=body.title,
        status=body.status,
        impact=body.impact,
        created_by=UUID(user["sub"]) if user.get("sub") else None,
    )
    db.add(inc)
    await db.flush()

    # Link components
    for cid in body.component_ids:
        await db.execute(
            incident_component_links.insert().values(incident_id=inc.id, component_id=UUID(cid))
        )

    # Initial update
    if body.body:
        db.add(IncidentUpdate(
            incident_id=inc.id,
            status=body.status,
            body=body.body,
            created_by=UUID(user["sub"]) if user.get("sub") else None,
        ))

    await db.commit()
    await db.refresh(inc, ["updates", "affected_components"])
    await write_audit(db, user, "incident.create", {"title": body.title, "page_id": str(page_id)})
    return _incident_out(inc)


@router.post("/status-pages/{page_id}/incidents/{incident_id}/updates", status_code=201)
async def add_incident_update(
    page_id: UUID,
    incident_id: UUID,
    body: IncidentUpdateReq,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    scope=Depends(tenant_scope),
):
    await _get_page_for_tenant(db, page_id, scope)
    inc = await db.get(StatusPageIncident, incident_id)
    if not inc or inc.status_page_id != page_id:
        raise HTTPException(404, "Incident not found")

    inc.status = body.status
    if body.status == "resolved":
        inc.resolved_at = datetime.now(timezone.utc)

    db.add(IncidentUpdate(
        incident_id=incident_id,
        status=body.status,
        body=body.body,
        created_by=UUID(user["sub"]) if user.get("sub") else None,
    ))
    await db.commit()
    await db.refresh(inc, ["updates", "affected_components"])
    return _incident_out(inc)


# ── Public API (no auth) ─────────────────────────────────────────────────────

@public_router.get("/status/{slug}")
async def public_status_page(
    slug: str,
    db: AsyncSession = Depends(get_db),
):
    """Public endpoint: returns status page data for public display."""
    result = await db.execute(
        select(StatusPage).where(StatusPage.slug == slug, StatusPage.is_public == True)
    )
    page = result.scalar_one_or_none()
    if not page:
        raise HTTPException(404, "Status page not found")

    # Components
    comps_result = await db.execute(
        select(StatusPageComponent)
        .where(StatusPageComponent.status_page_id == page.id)
        .order_by(StatusPageComponent.position)
    )
    components = comps_result.scalars().all()

    # 90-day uptime for each component
    ninety_days_ago = date.today() - timedelta(days=90)
    comp_list = []
    for comp in components:
        uptime_result = await db.execute(
            select(ComponentDailyUptime)
            .where(
                ComponentDailyUptime.component_id == comp.id,
                ComponentDailyUptime.date >= ninety_days_ago,
            )
            .order_by(ComponentDailyUptime.date)
        )
        uptime_rows = uptime_result.scalars().all()
        uptime_data = [
            {
                "date": str(u.date),
                "uptime": u.uptime_percentage,
                "worst_status": u.worst_status,
                "outage_minutes": u.outage_minutes,
            }
            for u in uptime_rows
        ]

        # Calculate overall uptime (average of last 90 days with data)
        pcts = [u.uptime_percentage for u in uptime_rows if u.uptime_percentage is not None]
        overall_uptime = round(sum(pcts) / len(pcts), 2) if pcts else 100.0

        comp_list.append({
            "id": str(comp.id),
            "name": comp.name,
            "description": comp.description,
            "group_name": comp.group_name,
            "current_status": comp.current_status,
            "show_uptime": comp.show_uptime,
            "uptime_90d": uptime_data,
            "overall_uptime": overall_uptime,
        })

    # Active incidents
    active_result = await db.execute(
        select(StatusPageIncident)
        .where(
            StatusPageIncident.status_page_id == page.id,
            StatusPageIncident.status != "resolved",
        )
        .order_by(StatusPageIncident.created_at.desc())
    )
    active_incidents = active_result.scalars().unique().all()

    active_out = []
    for inc in active_incidents:
        await db.refresh(inc, ["updates", "affected_components"])
        active_out.append(_incident_out(inc))

    # Past incidents (last 14 days, resolved)
    fourteen_days_ago = datetime.now(timezone.utc) - timedelta(days=14)
    past_result = await db.execute(
        select(StatusPageIncident)
        .where(
            StatusPageIncident.status_page_id == page.id,
            StatusPageIncident.status == "resolved",
            StatusPageIncident.resolved_at >= fourteen_days_ago,
        )
        .order_by(StatusPageIncident.resolved_at.desc())
    )
    past_incidents = past_result.scalars().unique().all()

    past_out = []
    for inc in past_incidents:
        await db.refresh(inc, ["updates", "affected_components"])
        past_out.append(_incident_out(inc))

    # Overall status
    statuses = [c["current_status"] for c in comp_list]
    if any(s == "major_outage" for s in statuses):
        overall = "major_outage"
    elif any(s == "partial_outage" for s in statuses):
        overall = "partial_outage"
    elif any(s == "degraded_performance" for s in statuses):
        overall = "degraded_performance"
    else:
        overall = "operational"

    return {
        "title": page.title,
        "description": page.description,
        "logo_url": page.logo_url,
        "primary_color": page.primary_color,
        "timezone": page.timezone,
        "overall_status": overall,
        "components": comp_list,
        "active_incidents": active_out,
        "past_incidents": past_out,
    }
