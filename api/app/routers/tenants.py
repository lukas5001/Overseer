"""Overseer API – Tenants router."""
import hashlib
import re
import secrets
import uuid as uuid_mod
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, case, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, require_role, tenant_scope, apply_tenant_filter
from api.app.models.models import Tenant, Host, Service, CurrentStatus, ApiKey, Collector
from api.app.routers.audit import write_audit
from shared.schemas import TenantOut, TenantCreate, TenantUpdate

router = APIRouter()


@router.get("/", response_model=list[TenantOut])
async def list_tenants(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope = Depends(tenant_scope),
):
    q = select(Tenant).where(Tenant.active == True).order_by(Tenant.name)
    q = apply_tenant_filter(q, Tenant.id, _scope)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/", response_model=TenantOut, status_code=201)
async def create_tenant(
    body: TenantCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin")),
):
    slug = re.sub(r"[^a-z0-9-]", "-", body.slug.lower()).strip("-")
    existing = await db.execute(select(Tenant).where(Tenant.slug == slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Slug already exists")
    tenant = Tenant(name=body.name, slug=slug)
    db.add(tenant)
    await db.flush()
    await write_audit(db, user=_user, action="tenant_create",
                      target_type="tenant", target_id=tenant.id,
                      detail={"name": body.name, "slug": slug})
    await db.commit()
    await db.refresh(tenant)
    return tenant


@router.patch("/{tenant_id}", response_model=TenantOut)
async def update_tenant(
    tenant_id: UUID,
    body: TenantUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin")),
):
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(tenant, field, value)
    tenant.updated_at = datetime.now(timezone.utc)
    changes = body.model_dump(exclude_none=True)
    await write_audit(db, user=_user, action="tenant_update",
                      target_type="tenant", target_id=tenant.id,
                      detail={"changed_fields": list(changes.keys())})
    await db.commit()
    await db.refresh(tenant)
    return tenant


@router.delete("/{tenant_id}", status_code=204)
async def delete_tenant(
    tenant_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin")),
):
    """Hard-delete a tenant and ALL related data (hosts, services, checks, etc.)."""
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # check_results is a TimescaleDB hypertable without FK – delete manually
    await db.execute(text("DELETE FROM check_results WHERE tenant_id = :tid"), {"tid": tenant_id})
    # Downtimes have author_id FK to users which could block cascade – delete first
    await db.execute(text("DELETE FROM downtimes WHERE tenant_id = :tid"), {"tid": tenant_id})

    await write_audit(db, user=_user, action="tenant_delete",
                      target_type="tenant", target_id=tenant_id,
                      detail={"name": tenant.name, "slug": tenant.slug})

    # CASCADE handles: api_keys, collectors, hosts, services,
    # current_status, state_history, notification_channels, user_tenant_access
    await db.delete(tenant)
    await db.commit()


class TenantCopyRequest(BaseModel):
    name: str
    slug: str


@router.post("/{tenant_id}/copy", response_model=TenantOut, status_code=201)
async def copy_tenant(
    tenant_id: UUID,
    body: TenantCopyRequest,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin")),
):
    """Deep-copy a tenant: all hosts + services. No check_results/history."""
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Tenant not found")

    slug = re.sub(r"[^a-z0-9-]", "-", body.slug.lower()).strip("-")
    existing = await db.execute(select(Tenant).where(Tenant.slug == slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Slug existiert bereits")

    new_tenant = Tenant(name=body.name, slug=slug, settings=dict(source.settings or {}))
    db.add(new_tenant)
    await db.flush()

    # Copy all hosts + services
    hosts_result = await db.execute(select(Host).where(Host.tenant_id == tenant_id, Host.active == True))
    for src_host in hosts_result.scalars().all():
        new_host = Host(
            tenant_id=new_tenant.id,
            collector_id=None,
            hostname=src_host.hostname,
            display_name=src_host.display_name,
            ip_address=src_host.ip_address,
            host_type=src_host.host_type,
            snmp_community=src_host.snmp_community,
            snmp_version=src_host.snmp_version,
            winrm_username=src_host.winrm_username,
            winrm_password=src_host.winrm_password,
            winrm_transport=src_host.winrm_transport,
            winrm_port=src_host.winrm_port,
            winrm_ssl=src_host.winrm_ssl,
            tags=list(src_host.tags or []),
        )
        db.add(new_host)
        await db.flush()

        svcs_result = await db.execute(
            select(Service).where(Service.host_id == src_host.id, Service.active == True)
        )
        for src_svc in svcs_result.scalars().all():
            new_svc = Service(
                host_id=new_host.id,
                tenant_id=new_tenant.id,
                name=src_svc.name,
                check_type=src_svc.check_type,
                check_config=dict(src_svc.check_config or {}),
                interval_seconds=src_svc.interval_seconds,
                threshold_warn=src_svc.threshold_warn,
                threshold_crit=src_svc.threshold_crit,
                max_check_attempts=src_svc.max_check_attempts,
                check_mode=src_svc.check_mode,
            )
            db.add(new_svc)
            await db.flush()

            cs = CurrentStatus(
                service_id=new_svc.id,
                host_id=new_host.id,
                tenant_id=new_tenant.id,
                status="UNKNOWN",
                state_type="SOFT",
                current_attempt=0,
            )
            db.add(cs)

    await write_audit(db, user=_user, action="tenant_copy",
                      target_type="tenant", target_id=new_tenant.id,
                      detail={"source_id": str(tenant_id), "source_name": source.name,
                              "new_name": body.name})
    await db.commit()
    await db.refresh(new_tenant)
    return new_tenant


@router.post("/{tenant_id}/api-keys")
async def generate_api_key(
    tenant_id: UUID,
    name: str = "default",
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin")),
):
    """Generate a new API key for the tenant. Returns key ONCE in plaintext."""
    raw_key = "overseer_" + secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    api_key = ApiKey(
        tenant_id=tenant_id,
        key_hash=key_hash,
        key_prefix="",
        name=name,
    )
    db.add(api_key)
    await db.commit()
    return {"id": str(api_key.id), "key": raw_key, "name": name}


@router.get("/stats")
async def list_tenant_stats(
    include_inactive: bool = False,
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
            Tenant.active.label("tenant_active"),
            func.count(Host.id.distinct()).label("host_count"),
        )
        .outerjoin(Host, (Host.tenant_id == Tenant.id) & (Host.active == True))
        .group_by(Tenant.id, Tenant.name, Tenant.slug, Tenant.active)
        .order_by(Tenant.name)
    )
    if not include_inactive:
        host_q = host_q.where(Tenant.active == True)
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
            "active": row.tenant_active,
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
                "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None,
            }
            for k in keys
        ],
    }
