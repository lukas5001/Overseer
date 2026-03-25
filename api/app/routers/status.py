"""
Status & Error Overview endpoints.

This is the most important router – it powers the Fehlerübersicht
that employees watch continuously.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import select, func, case
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, tenant_scope, apply_tenant_filter
from api.app.routers.audit import write_audit
from api.app.models.models import CurrentStatus, Service, Host, HostType, Tenant, User
from shared.schemas import ErrorOverviewItem, CurrentStatusOut, CheckStatus

router = APIRouter()


@router.get("/errors", response_model=list[ErrorOverviewItem])
async def get_error_overview(
    response: Response,
    tenant_id: UUID | None = None,
    statuses: str | None = None,
    status: CheckStatus | None = None,
    acknowledged: bool | None = None,
    include_downtime: bool = False,
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope = Depends(tenant_scope),
):
    """Get hard-state checks – the main Fehlerübersicht.

    statuses: comma-separated list e.g. "CRITICAL,WARNING,UNKNOWN" (new)
    status: single status filter (legacy, kept for backward compat)
    """
    q = (
        select(
            CurrentStatus,
            Service.name.label("service_name"),
            Service.check_type.label("check_type"),
            Host.hostname.label("host_hostname"),
            Host.display_name.label("host_display_name"),
            HostType.name.label("host_type_name"),
            HostType.icon.label("host_type_icon"),
            Tenant.name.label("tenant_name"),
            User.email.label("ack_email"),
        )
        .join(Service, CurrentStatus.service_id == Service.id)
        .join(Host, CurrentStatus.host_id == Host.id)
        .join(HostType, Host.host_type_id == HostType.id)
        .join(Tenant, CurrentStatus.tenant_id == Tenant.id)
        .outerjoin(User, CurrentStatus.acknowledged_by == User.id)
        .where(CurrentStatus.state_type == "HARD")
    )

    # Status filtering: new multi-select takes precedence over legacy single
    if statuses:
        status_list = [s.strip().upper() for s in statuses.split(",") if s.strip()]
        q = q.where(CurrentStatus.status.in_(status_list))
    else:
        q = q.where(CurrentStatus.status != "OK")
        if status:
            q = q.where(CurrentStatus.status == status.value)

    if not include_downtime:
        q = q.where(CurrentStatus.in_downtime == False)
    q = apply_tenant_filter(q, CurrentStatus.tenant_id, _scope, tenant_id)
    if acknowledged is not None:
        q = q.where(CurrentStatus.acknowledged == acknowledged)

    # CRITICAL first, then WARNING, NO_DATA, UNKNOWN; within each: longest duration first
    q = q.order_by(
        case(
            (CurrentStatus.status == "CRITICAL", 0),
            (CurrentStatus.status == "WARNING", 1),
            (CurrentStatus.status == "NO_DATA", 2),
            (CurrentStatus.status == "UNKNOWN", 3),
            else_=4,
        ),
        CurrentStatus.last_state_change_at.asc().nulls_last(),
    )

    # Total count before pagination
    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar_one()
    response.headers["X-Total-Count"] = str(total)

    result = await db.execute(q.offset(offset).limit(limit))
    rows = result.all()

    items = []
    now = datetime.now(timezone.utc)
    for row in rows:
        cs = row.CurrentStatus
        duration_seconds = None
        if cs.last_state_change_at:
            lsc = cs.last_state_change_at
            if lsc.tzinfo is None:
                from datetime import timezone as tz
                lsc = lsc.replace(tzinfo=tz.utc)
            duration_seconds = int((now - lsc).total_seconds())

        items.append(ErrorOverviewItem(
            service_id=cs.service_id,
            host_id=cs.host_id,
            tenant_id=cs.tenant_id,
            tenant_name=row.tenant_name,
            host_hostname=row.host_hostname,
            host_display_name=row.host_display_name,
            host_type_name=row.host_type_name,
            host_type_icon=row.host_type_icon,
            service_name=row.service_name,
            check_type=row.check_type,
            status=cs.status,
            state_type=cs.state_type,
            status_message=cs.status_message,
            value=cs.value,
            unit=cs.unit,
            last_check_at=cs.last_check_at,
            last_state_change_at=cs.last_state_change_at,
            duration_seconds=duration_seconds,
            acknowledged=cs.acknowledged,
            acknowledged_by=row.ack_email,
            acknowledged_at=cs.acknowledged_at,
            acknowledge_comment=cs.acknowledge_comment,
            in_downtime=cs.in_downtime,
        ))

    return items


@router.get("/summary")
async def get_status_summary(
    tenant_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope = Depends(tenant_scope),
):
    """Count of checks by status for the dashboard cards."""
    q = select(
        CurrentStatus.status,
        func.count(CurrentStatus.service_id).label("cnt"),
    ).group_by(CurrentStatus.status)

    q = apply_tenant_filter(q, CurrentStatus.tenant_id, _scope, tenant_id)

    result = await db.execute(q)
    rows = result.all()

    counts = {"ok": 0, "warning": 0, "critical": 0, "unknown": 0, "no_data": 0}
    for row in rows:
        key = row.status.lower()
        if key in counts:
            counts[key] = row.cnt

    return {**counts, "total": sum(counts.values())}


@router.get("/summary/by-tenant")
async def get_summary_by_tenant(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Per-tenant breakdown: count of checks by status."""
    q = (
        select(
            Tenant.id.label("tenant_id"),
            Tenant.name.label("tenant_name"),
            func.count(CurrentStatus.service_id).label("total"),
            func.sum(case((CurrentStatus.status == "OK", 1), else_=0)).label("ok"),
            func.sum(case((CurrentStatus.status == "WARNING", 1), else_=0)).label("warning"),
            func.sum(case((CurrentStatus.status == "CRITICAL", 1), else_=0)).label("critical"),
            func.sum(case((CurrentStatus.status == "UNKNOWN", 1), else_=0)).label("unknown"),
            func.sum(case((CurrentStatus.status == "NO_DATA", 1), else_=0)).label("no_data"),
        )
        .join(CurrentStatus, CurrentStatus.tenant_id == Tenant.id)
        .where(Tenant.active == True)
        .group_by(Tenant.id, Tenant.name)
        .order_by(
            func.sum(case((CurrentStatus.status == "CRITICAL", 1), else_=0)).desc(),
            Tenant.name,
        )
    )
    result = await db.execute(q)
    return [
        {
            "tenant_id": str(row.tenant_id),
            "tenant_name": row.tenant_name,
            "total": row.total,
            "ok": row.ok,
            "warning": row.warning,
            "critical": row.critical,
            "unknown": row.unknown,
            "no_data": row.no_data,
        }
        for row in result.all()
    ]


@router.get("/host-status")
async def get_host_status_summary(
    tenant_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope = Depends(tenant_scope),
):
    """Worst status per host (considers ALL current_status rows, not just HARD errors)."""
    q = (
        select(
            CurrentStatus.host_id,
            func.min(
                case(
                    (CurrentStatus.status == "CRITICAL", 0),
                    (CurrentStatus.status == "WARNING", 1),
                    (CurrentStatus.status == "NO_DATA", 2),
                    (CurrentStatus.status == "UNKNOWN", 3),
                    else_=4,
                )
            ).label("worst_rank"),
        )
        .join(Service, CurrentStatus.service_id == Service.id)
        .where(Service.active == True)
        .group_by(CurrentStatus.host_id)
    )
    q = apply_tenant_filter(q, CurrentStatus.tenant_id, _scope, tenant_id)
    result = await db.execute(q)

    rank_to_status = {0: "CRITICAL", 1: "WARNING", 2: "NO_DATA", 3: "UNKNOWN", 4: "OK"}
    return {
        str(row.host_id): rank_to_status[row.worst_rank]
        for row in result.all()
    }


@router.get("/host/{host_id}", response_model=list[CurrentStatusOut])
async def get_host_status(host_id: UUID, db: AsyncSession = Depends(get_db), _user: dict = Depends(get_current_user)):
    """Get all service statuses for a specific host."""
    q = (
        select(CurrentStatus)
        .where(CurrentStatus.host_id == host_id)
        .order_by(CurrentStatus.status)
    )
    result = await db.execute(q)
    return result.scalars().all()


class AcknowledgeBody(BaseModel):
    comment: str

    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v):
        if isinstance(v, cls) and not v.comment.strip():
            raise ValueError("Kommentar darf nicht leer sein")
        return v


@router.post("/acknowledge/{service_id}")
async def acknowledge_problem(
    service_id: UUID,
    body: AcknowledgeBody,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Acknowledge a problem. Comment is required."""
    if not body.comment.strip():
        raise HTTPException(status_code=400, detail="Kommentar darf nicht leer sein")

    result = await db.execute(
        select(CurrentStatus).where(CurrentStatus.service_id == service_id)
    )
    cs = result.scalar_one_or_none()
    if not cs:
        raise HTTPException(status_code=404, detail="Service not found")

    cs.acknowledged = True
    cs.acknowledged_at = datetime.now(timezone.utc)
    cs.acknowledged_by = UUID(_user["sub"])
    cs.acknowledge_comment = body.comment.strip()
    await write_audit(db, user=_user, action="acknowledge",
                      target_type="service", target_id=service_id,
                      tenant_id=cs.tenant_id,
                      detail={"comment": body.comment.strip(), "status": cs.status})
    await db.commit()
    return {"status": "acknowledged"}


@router.delete("/acknowledge/{service_id}")
async def remove_acknowledgement(service_id: UUID, db: AsyncSession = Depends(get_db), _user: dict = Depends(get_current_user)):
    """Remove acknowledgement from a problem."""
    result = await db.execute(
        select(CurrentStatus).where(CurrentStatus.service_id == service_id)
    )
    cs = result.scalar_one_or_none()
    if cs:
        cs.acknowledged = False
        cs.acknowledged_by = None
        cs.acknowledged_at = None
        cs.acknowledge_comment = None
        await write_audit(db, user=_user, action="unacknowledge",
                          target_type="service", target_id=service_id,
                          tenant_id=cs.tenant_id)
        await db.commit()
    return {"status": "removed"}


class BulkAcknowledgeBody(BaseModel):
    service_ids: list[UUID]
    comment: str


@router.post("/bulk-acknowledge")
async def bulk_acknowledge(
    body: BulkAcknowledgeBody,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Acknowledge multiple problems at once. Comment is required."""
    if not body.comment.strip():
        raise HTTPException(status_code=400, detail="Kommentar darf nicht leer sein")

    now = datetime.now(timezone.utc)
    user_id = UUID(_user["sub"])
    comment = body.comment.strip()
    result = await db.execute(
        select(CurrentStatus).where(CurrentStatus.service_id.in_(body.service_ids))
    )
    rows = result.scalars().all()
    count = 0
    for cs in rows:
        cs.acknowledged = True
        cs.acknowledged_at = now
        cs.acknowledged_by = user_id
        cs.acknowledge_comment = comment
        count += 1
    if count:
        await write_audit(db, user=_user, action="bulk_acknowledge",
                          target_type="service", detail={
                              "count": count,
                              "comment": comment,
                              "service_ids": [str(s) for s in body.service_ids],
                          })
        await db.commit()
    return {"acknowledged": count}
