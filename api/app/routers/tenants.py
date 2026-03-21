"""Overseer API – Tenants router."""
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select, func, case
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user
from api.app.models.models import Tenant, Host, Service, CurrentStatus, ApiKey, Collector
from shared.schemas import TenantOut

router = APIRouter()


@router.get("/", response_model=list[TenantOut])
async def list_tenants(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    result = await db.execute(select(Tenant).where(Tenant.active == True).order_by(Tenant.name))
    return result.scalars().all()


@router.get("/stats")
async def list_tenant_stats(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Tenants with host count, service count, and problem counts."""
    # Host + service counts per tenant
    host_q = (
        select(
            Tenant.id.label("tenant_id"),
            Tenant.name.label("tenant_name"),
            Tenant.slug.label("slug"),
            func.count(Host.id.distinct()).label("host_count"),
        )
        .outerjoin(Host, (Host.tenant_id == Tenant.id) & (Host.active == True))
        .where(Tenant.active == True)
        .group_by(Tenant.id, Tenant.name, Tenant.slug)
        .order_by(Tenant.name)
    )
    host_rows = (await db.execute(host_q)).all()

    # Service counts per tenant
    svc_q = (
        select(
            Service.tenant_id,
            func.count(Service.id).label("service_count"),
        )
        .where(Service.active == True)
        .group_by(Service.tenant_id)
    )
    svc_counts = {str(r.tenant_id): r.service_count for r in (await db.execute(svc_q)).all()}

    # Problem counts per tenant (HARD state, not in downtime)
    prob_q = (
        select(
            CurrentStatus.tenant_id,
            func.sum(case((CurrentStatus.status == "CRITICAL", 1), else_=0)).label("critical"),
            func.sum(case((CurrentStatus.status == "WARNING", 1), else_=0)).label("warning"),
            func.sum(case((CurrentStatus.status == "UNKNOWN", 1), else_=0)).label("unknown"),
        )
        .where(
            CurrentStatus.status != "OK",
            CurrentStatus.state_type == "HARD",
            CurrentStatus.in_downtime == False,
        )
        .group_by(CurrentStatus.tenant_id)
    )
    prob_rows = {str(r.tenant_id): r for r in (await db.execute(prob_q)).all()}

    out = []
    for row in host_rows:
        tid = str(row.tenant_id)
        prob = prob_rows.get(tid)
        out.append({
            "tenant_id": tid,
            "tenant_name": row.tenant_name,
            "slug": row.slug,
            "host_count": row.host_count,
            "service_count": svc_counts.get(tid, 0),
            "critical": prob.critical if prob else 0,
            "warning": prob.warning if prob else 0,
            "unknown": prob.unknown if prob else 0,
        })
    return out


@router.get("/{tenant_id}/detail")
async def get_tenant_detail(
    tenant_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Collectors and API keys (prefix only) for a specific tenant."""
    collectors_q = select(Collector).where(
        Collector.tenant_id == tenant_id,
        Collector.active == True,
    ).order_by(Collector.name)
    collectors = (await db.execute(collectors_q)).scalars().all()

    keys_q = select(ApiKey).where(
        ApiKey.tenant_id == tenant_id,
        ApiKey.active == True,
    ).order_by(ApiKey.name)
    keys = (await db.execute(keys_q)).scalars().all()

    return {
        "collectors": [
            {
                "id": str(c.id),
                "name": c.name,
                "hostname": c.hostname,
                "last_seen_at": c.last_seen_at.isoformat() if c.last_seen_at else None,
            }
            for c in collectors
        ],
        "api_keys": [
            {
                "id": str(k.id),
                "name": k.name,
                "key_prefix": k.key_prefix,
                "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None,
            }
            for k in keys
        ],
    }
