"""Overseer API – Services router."""
import asyncio
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, text, func
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, require_role, tenant_scope, apply_tenant_filter
from api.app.models.models import Service, CurrentStatus, StateHistory, Host
from api.app.routers.audit import write_audit
from shared.schemas import ServiceOut, ServiceCreate, ServiceUpdate
from shared.checker import run_check
from shared.status import compute_new_state, inject_host_credentials

router = APIRouter()


@router.get("/", response_model=list[ServiceOut])
async def list_services(
    response: Response,
    host_id: UUID | None = None,
    tenant_id: UUID | None = None,
    include_inactive: bool = False,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope = Depends(tenant_scope),
):
    q = select(Service).order_by(Service.name)
    if not include_inactive:
        q = q.where(Service.active == True)
    if host_id:
        q = q.where(Service.host_id == host_id)
    q = apply_tenant_filter(q, Service.tenant_id, _scope, tenant_id)

    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar_one()
    response.headers["X-Total-Count"] = str(total)

    result = await db.execute(q.offset(offset).limit(limit))
    return result.scalars().all()


@router.get("/{service_id}", response_model=ServiceOut)
async def get_service(
    service_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    result = await db.execute(select(Service).where(Service.id == service_id))
    svc = result.scalar_one_or_none()
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    return svc


@router.post("/", response_model=ServiceOut, status_code=201)
async def create_service(
    body: ServiceCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    # Check for duplicate (host_id + name has unique DB constraint)
    existing = await db.execute(
        select(Service).where(
            Service.host_id == body.host_id,
            Service.name == body.name,
        )
    )
    old = existing.scalar_one_or_none()
    if old:
        if old.active:
            raise HTTPException(status_code=409, detail=f"Check '{body.name}' existiert bereits für diesen Host")
        # Reactivate previously soft-deleted service
        old.active = True
        old.check_type = body.check_type
        old.check_config = body.check_config
        old.interval_seconds = body.interval_seconds
        old.threshold_warn = body.threshold_warn
        old.threshold_crit = body.threshold_crit
        old.max_check_attempts = body.max_check_attempts
        old.updated_at = datetime.now(timezone.utc)
        # Ensure current_status row exists
        cs_result = await db.execute(
            select(CurrentStatus).where(CurrentStatus.service_id == old.id)
        )
        if not cs_result.scalar_one_or_none():
            cs = CurrentStatus(
                service_id=old.id,
                host_id=body.host_id,
                tenant_id=body.tenant_id,
                status="UNKNOWN",
                state_type="SOFT",
                current_attempt=0,
            )
            db.add(cs)
        await db.commit()
        await db.refresh(old)
        return old

    svc = Service(
        host_id=body.host_id,
        tenant_id=body.tenant_id,
        name=body.name,
        check_type=body.check_type,
        check_config=body.check_config,
        interval_seconds=body.interval_seconds,
        threshold_warn=body.threshold_warn,
        threshold_crit=body.threshold_crit,
        max_check_attempts=body.max_check_attempts,
        check_mode=body.check_mode,
    )
    db.add(svc)
    await db.flush()  # get svc.id before creating CurrentStatus

    # Create initial current_status row
    cs = CurrentStatus(
        service_id=svc.id,
        host_id=body.host_id,
        tenant_id=body.tenant_id,
        status="UNKNOWN",
        state_type="SOFT",
        current_attempt=0,
    )
    db.add(cs)
    await write_audit(db, user=_user, action="service_create",
                      target_type="service", target_id=svc.id,
                      tenant_id=svc.tenant_id,
                      detail={"name": body.name, "check_type": body.check_type})
    await db.commit()
    await db.refresh(svc)
    return svc


@router.patch("/{service_id}", response_model=ServiceOut)
async def update_service(
    service_id: UUID,
    body: ServiceUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    result = await db.execute(select(Service).where(Service.id == service_id))
    svc = result.scalar_one_or_none()
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(svc, field, value)
    svc.updated_at = datetime.now(timezone.utc)
    changes = body.model_dump(exclude_none=True)
    await write_audit(db, user=_user, action="service_update",
                      target_type="service", target_id=svc.id,
                      tenant_id=svc.tenant_id,
                      detail={"changed_fields": list(changes.keys())})
    await db.commit()
    await db.refresh(svc)
    return svc


@router.delete("/{service_id}", status_code=204)
async def delete_service(
    service_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    result = await db.execute(select(Service).where(Service.id == service_id))
    svc = result.scalar_one_or_none()
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    await write_audit(db, user=_user, action="service_delete",
                      target_type="service", target_id=svc.id,
                      tenant_id=svc.tenant_id,
                      detail={"name": svc.name})
    # Delete dependent rows first (PK-based FK can't be blanked by ORM)
    from sqlalchemy import delete as sa_delete
    await db.execute(sa_delete(StateHistory).where(StateHistory.service_id == service_id))
    await db.execute(sa_delete(CurrentStatus).where(CurrentStatus.service_id == service_id))
    await db.delete(svc)
    await db.commit()


@router.post("/{service_id}/check-now")
async def check_now(
    service_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Execute a check immediately and process the result."""
    result = await db.execute(
        select(Service).where(Service.id == service_id)
    )
    svc = result.scalar_one_or_none()
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")

    # Get host IP
    h_result = await db.execute(select(Host).where(Host.id == svc.host_id))
    host = h_result.scalar_one_or_none()
    if not host or not host.ip_address:
        raise HTTPException(status_code=400, detail="Host hat keine IP-Adresse")

    ip = str(host.ip_address)
    config = dict(svc.check_config or {})

    # Inject host-level credentials (SNMP)
    inject_host_credentials(svc.check_type, config, host)

    # Run the check in a thread (blocking I/O)
    check_result = await asyncio.to_thread(
        run_check, svc.check_type, ip, config
    )

    now = datetime.now(timezone.utc)
    new_status = check_result["status"]

    # Update current_status directly
    cs_result = await db.execute(
        select(CurrentStatus).where(CurrentStatus.service_id == svc.id)
    )
    current = cs_result.scalar_one_or_none()
    max_attempts = svc.max_check_attempts or 3

    if current is None:
        sr = compute_new_state(new_status, None, None, 0, max_attempts)
        cs = CurrentStatus(
            service_id=svc.id,
            host_id=svc.host_id,
            tenant_id=svc.tenant_id,
            status=new_status,
            state_type=sr.state_type,
            current_attempt=sr.attempt,
            status_message=check_result["message"],
            value=check_result["value"],
            unit=check_result["unit"],
            last_check_at=now,
            last_state_change_at=now,
        )
        db.add(cs)
    else:
        sr = compute_new_state(
            new_status, current.status, current.state_type,
            current.current_attempt, max_attempts,
        )
        current.status = new_status
        current.state_type = sr.state_type
        current.current_attempt = sr.attempt
        current.status_message = check_result["message"]
        current.value = check_result["value"]
        current.unit = check_result["unit"]
        current.last_check_at = now
        if sr.state_changed:
            current.last_state_change_at = now

    # Insert into check_results timeseries
    await db.execute(text("""
        INSERT INTO check_results (time, service_id, tenant_id, status, value, unit, message, check_duration_ms)
        VALUES (:time, :service_id, :tenant_id, :status, :value, :unit, :message, :duration)
    """), {
        "time": now, "service_id": svc.id, "tenant_id": svc.tenant_id,
        "status": new_status, "value": check_result["value"], "unit": check_result["unit"],
        "message": check_result["message"], "duration": check_result["check_duration_ms"],
    })

    await db.commit()

    return {
        "service_id": str(svc.id),
        "status": new_status,
        "value": check_result["value"],
        "unit": check_result["unit"],
        "message": check_result["message"],
        "check_duration_ms": check_result["check_duration_ms"],
    }
