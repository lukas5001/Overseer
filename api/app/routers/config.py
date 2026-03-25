"""Overseer API – Collector config distribution."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_collector_auth
from api.app.models.models import Collector, Host, HostType, Service

router = APIRouter()


@router.get("/collector/{collector_id}")
async def get_collector_config(
    collector_id: str,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_collector_auth),
):
    """Return full host+service list for a collector so it knows what to check."""
    # Verify collector exists
    result = await db.execute(
        select(Collector).where(Collector.id == collector_id, Collector.active == True)
    )
    collector = result.scalar_one_or_none()
    if not collector:
        raise HTTPException(status_code=404, detail="Collector not found")

    # Load all active hosts for this collector (with host type name)
    hosts_result = await db.execute(
        select(Host, HostType.name.label("ht_name"))
        .join(HostType, Host.host_type_id == HostType.id)
        .where(Host.collector_id == collector_id, Host.active == True)
    )
    host_rows = hosts_result.all()
    hosts = [row.Host for row in host_rows]
    host_type_names = {row.Host.id: row.ht_name for row in host_rows}

    # Load all active services for those hosts in one query
    host_ids = [h.id for h in hosts]
    services_by_host: dict = {h.id: [] for h in hosts}

    if host_ids:
        svc_result = await db.execute(
            select(Service).where(Service.host_id.in_(host_ids), Service.active == True)
        )
        for svc in svc_result.scalars().all():
            services_by_host[svc.host_id].append({
                "name": svc.name,
                "type": svc.check_type,
                "config": svc.check_config,
                "interval_seconds": svc.interval_seconds,
                "threshold_warn": svc.threshold_warn,
                "threshold_crit": svc.threshold_crit,
            })

    return {
        "collector_id": str(collector.id),
        "tenant_id": str(collector.tenant_id),
        "interval_seconds": 60,
        "hosts": [
            {
                "hostname": h.hostname,
                "display_name": h.display_name,
                "ip_address": str(h.ip_address) if h.ip_address else None,
                "host_type": host_type_names.get(h.id, ""),
                "snmp_community": h.snmp_community or "public",
                "snmp_version": h.snmp_version or "2c",
                "checks": services_by_host[h.id],
            }
            for h in hosts
        ],
    }
