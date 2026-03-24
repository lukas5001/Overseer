"""Tenant resource quota enforcement (Phase 2.8)."""
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.models.models import Tenant, Host, Service, Collector

DEFAULT_QUOTAS = {
    "max_hosts": 100,
    "max_services": 1000,
    "max_collectors": 5,
    "retention_days": 90,
}


async def check_quota(db: AsyncSession, tenant_id: UUID, resource_type: str) -> None:
    """Raise HTTP 429 if the tenant has reached the quota for resource_type."""
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    settings = tenant.settings or {}
    quotas = {**DEFAULT_QUOTAS, **settings.get("quotas", {})}
    limit_key = f"max_{resource_type}"
    limit = quotas.get(limit_key)
    if limit is None:
        return  # No quota defined for this type

    model_map = {"hosts": Host, "services": Service, "collectors": Collector}
    model = model_map.get(resource_type)
    if model is None:
        return

    count_q = select(func.count()).select_from(model).where(
        model.tenant_id == tenant_id,
        model.active == True,
    )
    current = (await db.execute(count_q)).scalar() or 0

    if current >= limit:
        raise HTTPException(
            status_code=429,
            detail=f"Quota für {resource_type} erreicht ({limit}). Aktuell: {current}.",
        )
