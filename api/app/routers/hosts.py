"""Overseer API – Hosts router."""
import asyncio
from datetime import datetime, timezone, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import select, func, text
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, require_role, tenant_scope, apply_tenant_filter
from api.app.routers.audit import write_audit
from api.app.models.models import Host, Tenant, Collector, Service, CurrentStatus
from shared.schemas import HostOut, HostCreate, HostUpdate

router = APIRouter()

OFFLINE_THRESHOLD = timedelta(minutes=3)


def _is_offline(last_seen_at) -> bool:
    if last_seen_at is None:
        return False
    if last_seen_at.tzinfo is None:
        last_seen_at = last_seen_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - last_seen_at > OFFLINE_THRESHOLD


@router.get("/", response_model=list[HostOut])
async def list_hosts(
    response: Response,
    tenant_id: UUID | None = None,
    include_inactive: bool = False,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope = Depends(tenant_scope),
):
    base = (
        select(Host, Tenant.name.label("tenant_name"), Tenant.active.label("tenant_active"), Collector.last_seen_at.label("collector_last_seen"))
        .join(Tenant, Host.tenant_id == Tenant.id)
        .outerjoin(Collector, Host.collector_id == Collector.id)
        .order_by(Tenant.name, Host.hostname)
    )
    if not include_inactive:
        base = base.where(Host.active == True, Tenant.active == True)
    base = apply_tenant_filter(base, Host.tenant_id, _scope, tenant_id)

    # Total count for pagination header
    count_base = select(func.count()).select_from(Host).join(Tenant, Host.tenant_id == Tenant.id)
    if not include_inactive:
        count_base = count_base.where(Host.active == True, Tenant.active == True)
    count_base = apply_tenant_filter(count_base, Host.tenant_id, _scope, tenant_id)
    total = (await db.execute(count_base)).scalar_one()
    response.headers["X-Total-Count"] = str(total)

    result = await db.execute(base.offset(offset).limit(limit))
    rows = result.all()

    # Check which hosts have passive services (only those need collector online)
    host_ids = [row.Host.id for row in rows]
    if host_ids:
        passive_result = await db.execute(
            select(Service.host_id)
            .where(Service.host_id.in_(host_ids), Service.active == True, Service.check_mode == "passive")
        )
        hosts_with_passive = {row[0] for row in passive_result.all()}
    else:
        hosts_with_passive = set()

    out = []
    for row in rows:
        data = HostOut.model_validate(row.Host)
        data.tenant_name = row.tenant_name
        data.tenant_active = row.tenant_active
        # Only show collector offline if host has passive checks
        data.collector_offline = _is_offline(row.collector_last_seen) if row.Host.id in hosts_with_passive else False
        out.append(data)
    return out


@router.get("/{host_id}", response_model=HostOut)
async def get_host(
    host_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    result = await db.execute(
        select(Host, Tenant.name.label("tenant_name"), Collector.last_seen_at.label("collector_last_seen"))
        .join(Tenant, Host.tenant_id == Tenant.id)
        .outerjoin(Collector, Host.collector_id == Collector.id)
        .where(Host.id == host_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Host not found")
    data = HostOut.model_validate(row.Host)
    data.tenant_name = row.tenant_name
    # Only show collector offline if host has passive checks
    passive_count = await db.execute(
        select(func.count()).select_from(Service)
        .where(Service.host_id == host_id, Service.active == True, Service.check_mode == "passive")
    )
    has_passive = passive_count.scalar_one() > 0
    data.collector_offline = _is_offline(row.collector_last_seen) if has_passive else False
    return data


@router.post("/", response_model=HostOut, status_code=201)
async def create_host(
    body: HostCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    host = Host(
        tenant_id=body.tenant_id,
        collector_id=body.collector_id,
        hostname=body.hostname,
        display_name=body.display_name,
        ip_address=body.ip_address,
        host_type=body.host_type.value,
        snmp_community=body.snmp_community,
        snmp_version=body.snmp_version,
        winrm_username=body.winrm_username,
        winrm_password=body.winrm_password,
        winrm_transport=body.winrm_transport,
        winrm_port=body.winrm_port,
        winrm_ssl=body.winrm_ssl,
        tags=body.tags,
    )
    db.add(host)
    await db.flush()
    await write_audit(db, user=_user, action="host_create",
                      target_type="host", target_id=host.id,
                      tenant_id=host.tenant_id,
                      detail={"hostname": host.hostname, "host_type": body.host_type.value})
    await db.commit()
    await db.refresh(host)
    data = HostOut.model_validate(host)
    data.collector_offline = False
    return data


@router.patch("/{host_id}", response_model=HostOut)
async def update_host(
    host_id: UUID,
    body: HostUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    result = await db.execute(select(Host).where(Host.id == host_id))
    host = result.scalar_one_or_none()
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")
    for field, value in body.model_dump(exclude_none=True).items():
        if field == "host_type":
            setattr(host, field, value.value if hasattr(value, "value") else value)
        else:
            setattr(host, field, value)
    host.updated_at = datetime.now(timezone.utc)
    changes = body.model_dump(exclude_none=True)
    await write_audit(db, user=_user, action="host_update",
                      target_type="host", target_id=host.id,
                      tenant_id=host.tenant_id,
                      detail={"changed_fields": list(changes.keys())})
    await db.commit()
    await db.refresh(host)
    data = HostOut.model_validate(host)
    data.collector_offline = False
    return data


@router.delete("/{host_id}", status_code=204)
async def delete_host(
    host_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    """Hard-delete a host and ALL related data (services, checks, downtimes)."""
    result = await db.execute(select(Host).where(Host.id == host_id))
    host = result.scalar_one_or_none()
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")

    # check_results has no FK – delete manually
    await db.execute(text("DELETE FROM check_results WHERE service_id IN (SELECT id FROM services WHERE host_id = :hid)"),
                     {"hid": host_id})
    # Downtimes with author_id FK could block – delete first
    await db.execute(text("DELETE FROM downtimes WHERE host_id = :hid"), {"hid": host_id})

    await write_audit(db, user=_user, action="host_delete",
                      target_type="host", target_id=host.id,
                      tenant_id=host.tenant_id,
                      detail={"hostname": host.hostname})

    # CASCADE handles: services, current_status, state_history
    await db.delete(host)
    await db.commit()


class HostCopyRequest(BaseModel):
    target_tenant_id: UUID | None = None
    hostname: str | None = None


@router.post("/{host_id}/copy", response_model=HostOut, status_code=201)
async def copy_host(
    host_id: UUID,
    body: HostCopyRequest = HostCopyRequest(),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    """Deep-copy a host with all services. Optionally assign to a different tenant."""
    result = await db.execute(select(Host).where(Host.id == host_id))
    src = result.scalar_one_or_none()
    if not src:
        raise HTTPException(status_code=404, detail="Host not found")

    target_tid = body.target_tenant_id or src.tenant_id

    # Verify target tenant exists
    if target_tid != src.tenant_id:
        t_result = await db.execute(select(Tenant).where(Tenant.id == target_tid))
        if not t_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Ziel-Tenant nicht gefunden")

    new_hostname = body.hostname or f"{src.hostname}-copy"

    # Check for duplicate hostname in target tenant
    dup = await db.execute(
        select(Host).where(Host.tenant_id == target_tid, Host.hostname == new_hostname)
    )
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Hostname '{new_hostname}' existiert bereits bei diesem Tenant")

    new_host = Host(
        tenant_id=target_tid,
        collector_id=src.collector_id if target_tid == src.tenant_id else None,
        hostname=new_hostname,
        display_name=src.display_name,
        ip_address=src.ip_address,
        host_type=src.host_type,
        snmp_community=src.snmp_community,
        snmp_version=src.snmp_version,
        winrm_username=src.winrm_username,
        winrm_password=src.winrm_password,
        winrm_transport=src.winrm_transport,
        winrm_port=src.winrm_port,
        winrm_ssl=src.winrm_ssl,
        tags=list(src.tags or []),
    )
    db.add(new_host)
    await db.flush()

    # Copy all active services
    svcs_result = await db.execute(
        select(Service).where(Service.host_id == src.id, Service.active == True)
    )
    for svc in svcs_result.scalars().all():
        new_svc = Service(
            host_id=new_host.id,
            tenant_id=target_tid,
            name=svc.name,
            check_type=svc.check_type,
            check_config=dict(svc.check_config or {}),
            interval_seconds=svc.interval_seconds,
            threshold_warn=svc.threshold_warn,
            threshold_crit=svc.threshold_crit,
            max_check_attempts=svc.max_check_attempts,
            check_mode=svc.check_mode,
        )
        db.add(new_svc)
        await db.flush()

        cs = CurrentStatus(
            service_id=new_svc.id,
            host_id=new_host.id,
            tenant_id=target_tid,
            status="UNKNOWN",
            state_type="SOFT",
            current_attempt=0,
        )
        db.add(cs)

    await write_audit(db, user=_user, action="host_copy",
                      target_type="host", target_id=new_host.id,
                      tenant_id=target_tid,
                      detail={"source_id": str(host_id), "source_hostname": src.hostname,
                              "new_hostname": new_hostname,
                              "target_tenant_id": str(target_tid)})
    await db.commit()
    await db.refresh(new_host)
    data = HostOut.model_validate(new_host)
    data.collector_offline = False
    return data


class SnmpWalkRequest(BaseModel):
    base_oid: str = "1.3.6.1.2.1"
    max_results: int = 500


@router.post("/{host_id}/snmp-walk")
async def snmp_walk_host(
    host_id: UUID,
    body: SnmpWalkRequest = SnmpWalkRequest(),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    """Perform an SNMP walk on a host to discover available OIDs."""
    result = await db.execute(select(Host).where(Host.id == host_id))
    host = result.scalar_one_or_none()
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")
    if not host.ip_address:
        raise HTTPException(status_code=400, detail="Host hat keine IP-Adresse")
    if not host.snmp_community:
        raise HTTPException(status_code=400, detail="Keine SNMP-Community konfiguriert. Bitte im Host bearbeiten.")

    from shared.snmp_utils import snmp_walk_async

    ip = str(host.ip_address)
    community = host.snmp_community
    version = host.snmp_version or "2c"
    max_results = min(body.max_results, 2000)

    try:
        results = await snmp_walk_async(
            ip, community, version, body.base_oid,
            timeout=10, max_results=max_results,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SNMP Walk fehlgeschlagen: {e}")

    return {
        "host_id": str(host_id),
        "ip": ip,
        "community": community,
        "results": results,
        "truncated": len(results) >= max_results,
    }
