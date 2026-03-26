"""Overseer API – SLA calculation endpoints (Phase 2.4)."""
from datetime import datetime, timezone, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, tenant_scope
from api.app.models.models import Service, Tenant

router = APIRouter()


async def _calculate_sla(db, service_id: UUID, tenant_id: UUID, start: datetime, end: datetime) -> dict:
    """Compute SLA% for a service, excluding downtime periods."""
    row = (await db.execute(text("""
        WITH downtime_excluded AS (
            SELECT cr.time
            FROM check_results cr
            WHERE cr.service_id = :service_id
              AND cr.tenant_id = :tenant_id
              AND cr.time BETWEEN :start AND :end
              AND NOT EXISTS (
                  SELECT 1 FROM downtimes d
                  WHERE (d.service_id = cr.service_id
                         OR d.host_id = (SELECT host_id FROM services WHERE id = cr.service_id))
                    AND cr.time BETWEEN d.start_at AND d.end_at
                    AND d.active = TRUE
              )
        )
        SELECT
            COUNT(*) FILTER (WHERE cr.status = 'OK')::FLOAT / NULLIF(COUNT(*), 0) * 100 AS sla_pct,
            COUNT(*) AS total_checks,
            COUNT(*) FILTER (WHERE cr.status = 'OK') AS ok_checks
        FROM check_results cr
        WHERE cr.service_id = :service_id
          AND cr.tenant_id = :tenant_id
          AND cr.time BETWEEN :start AND :end
          AND cr.time IN (SELECT time FROM downtime_excluded)
    """), {"service_id": service_id, "tenant_id": tenant_id, "start": start, "end": end})).fetchone()

    total = row.total_checks or 0
    ok = row.ok_checks or 0
    sla_pct = round(row.sla_pct, 4) if row.sla_pct is not None else (100.0 if total == 0 else 0.0)
    duration_seconds = (end - start).total_seconds()
    uptime_seconds = (ok / total * duration_seconds) if total > 0 else duration_seconds
    downtime_seconds = duration_seconds - uptime_seconds

    return {
        "sla_pct": sla_pct,
        "total_checks": total,
        "ok_checks": ok,
        "uptime_minutes": round(uptime_seconds / 60, 1),
        "downtime_minutes": round(downtime_seconds / 60, 1),
    }


@router.get("/services/{service_id}/sla")
async def get_service_sla(
    service_id: UUID,
    start: datetime | None = None,
    end: datetime | None = None,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    svc = await db.get(Service, service_id)
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    if _scope is not None and svc.tenant_id not in _scope:
        raise HTTPException(status_code=403, detail="Access denied")

    now = datetime.now(timezone.utc)
    ts_end = end or now
    ts_start = start or (ts_end - timedelta(days=30))

    result = await _calculate_sla(db, service_id, svc.tenant_id, ts_start, ts_end)
    return {"service_id": str(service_id), "start": ts_start.isoformat(), "end": ts_end.isoformat(), **result}


@router.get("/tenants/{tenant_id}/sla-report")
async def get_tenant_sla_report(
    tenant_id: UUID,
    start: datetime | None = None,
    end: datetime | None = None,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    if _scope is not None and tenant_id not in _scope:
        raise HTTPException(status_code=403, detail="Access denied")
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    now = datetime.now(timezone.utc)
    ts_end = end or now
    ts_start = start or (ts_end - timedelta(days=30))

    rows = (await db.execute(text("""
        SELECT s.id AS service_id, s.name AS service_name, h.hostname AS host_name
        FROM services s
        JOIN hosts h ON s.host_id = h.id
        WHERE s.tenant_id = :tid AND s.active = TRUE
        ORDER BY h.hostname, s.name
    """), {"tid": tenant_id})).fetchall()

    services_sla = []
    for row in rows:
        sla = await _calculate_sla(db, row.service_id, tenant_id, ts_start, ts_end)
        services_sla.append({
            "service_id": str(row.service_id),
            "service_name": row.service_name,
            "host_name": row.host_name,
            **sla,
        })

    return {
        "tenant_id": str(tenant_id),
        "period": {"start": ts_start.isoformat(), "end": ts_end.isoformat()},
        "services": services_sla,
    }
