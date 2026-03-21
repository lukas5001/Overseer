"""
Status & Error Overview endpoints.

This is the most important router – it powers the Fehlerübersicht
that employees watch continuously.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, case
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from api.app.core.database import get_db
from api.app.core.auth import get_current_user
from api.app.models.models import CurrentStatus, Service, Host, Tenant
from shared.schemas import ErrorOverviewItem, CurrentStatusOut, CheckStatus

router = APIRouter()


@router.get("/errors", response_model=list[ErrorOverviewItem])
async def get_error_overview(
    tenant_id: UUID | None = None,
    status: CheckStatus | None = None,
    acknowledged: bool | None = None,
    include_downtime: bool = False,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Get all non-OK hard-state checks – the main Fehlerübersicht."""
    q = (
        select(
            CurrentStatus,
            Service.name.label("service_name"),
            Service.check_type.label("check_type"),
            Host.hostname.label("host_hostname"),
            Host.display_name.label("host_display_name"),
            Host.host_type.label("host_type"),
            Tenant.name.label("tenant_name"),
        )
        .join(Service, CurrentStatus.service_id == Service.id)
        .join(Host, CurrentStatus.host_id == Host.id)
        .join(Tenant, CurrentStatus.tenant_id == Tenant.id)
        .where(CurrentStatus.status != "OK")
        .where(CurrentStatus.state_type == "HARD")
    )

    if not include_downtime:
        q = q.where(CurrentStatus.in_downtime == False)
    if tenant_id:
        q = q.where(CurrentStatus.tenant_id == tenant_id)
    if status:
        q = q.where(CurrentStatus.status == status.value)
    if acknowledged is not None:
        q = q.where(CurrentStatus.acknowledged == acknowledged)

    # CRITICAL first, then WARNING, then UNKNOWN; within each: longest duration first
    q = q.order_by(
        case(
            (CurrentStatus.status == "CRITICAL", 0),
            (CurrentStatus.status == "WARNING", 1),
            else_=2,
        ),
        CurrentStatus.last_state_change_at.asc().nulls_last(),
    )

    result = await db.execute(q)
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
            host_type=row.host_type,
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
            acknowledged_by=None,
            in_downtime=cs.in_downtime,
        ))

    return items


@router.get("/summary")
async def get_status_summary(
    tenant_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Count of checks by status for the dashboard cards."""
    q = select(
        CurrentStatus.status,
        func.count(CurrentStatus.service_id).label("cnt"),
    ).group_by(CurrentStatus.status)

    if tenant_id:
        q = q.where(CurrentStatus.tenant_id == tenant_id)

    result = await db.execute(q)
    rows = result.all()

    counts = {"ok": 0, "warning": 0, "critical": 0, "unknown": 0}
    for row in rows:
        counts[row.status.lower()] = row.cnt

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
        }
        for row in result.all()
    ]


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


@router.post("/acknowledge/{service_id}")
async def acknowledge_problem(
    service_id: UUID,
    comment: str = "",
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Acknowledge a problem."""
    result = await db.execute(
        select(CurrentStatus).where(CurrentStatus.service_id == service_id)
    )
    cs = result.scalar_one_or_none()
    if not cs:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Service not found")

    cs.acknowledged = True
    cs.acknowledged_at = datetime.now(timezone.utc)
    cs.acknowledge_comment = comment
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
        await db.commit()
    return {"status": "removed"}
