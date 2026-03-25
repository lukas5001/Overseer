"""Overseer API – Admin export/import router (Phase 2.9)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import require_role
from api.app.models.models import (
    Tenant, Host, Service, Collector, ServiceTemplate,
    AlertRule, NotificationChannel,
)

router = APIRouter()


@router.get("/export")
async def export_config(
    _user: dict = Depends(require_role("super_admin")),
    db: AsyncSession = Depends(get_db),
):
    """Export all configuration (without secrets and check_results) as JSON."""
    tenants = (await db.execute(select(Tenant))).scalars().all()
    hosts = (await db.execute(select(Host))).scalars().all()
    services = (await db.execute(select(Service))).scalars().all()
    collectors = (await db.execute(select(Collector))).scalars().all()
    templates = (await db.execute(select(ServiceTemplate))).scalars().all()
    alert_rules = (await db.execute(select(AlertRule))).scalars().all()
    channels = (await db.execute(select(NotificationChannel))).scalars().all()

    def _dt(v):
        return v.isoformat() if v else None

    export = {
        "version": "1",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "tenants": [
            {"id": str(t.id), "name": t.name, "slug": t.slug, "active": t.active, "settings": t.settings}
            for t in tenants
        ],
        "hosts": [
            {
                "id": str(h.id), "tenant_id": str(h.tenant_id),
                "collector_id": str(h.collector_id) if h.collector_id else None,
                "hostname": h.hostname, "display_name": h.display_name,
                "ip_address": str(h.ip_address) if h.ip_address else None,
                "host_type_id": str(h.host_type_id), "snmp_version": h.snmp_version,
                "tags": h.tags, "active": h.active,
                # snmp_community intentionally excluded
            }
            for h in hosts
        ],
        "services": [
            {
                "id": str(s.id), "host_id": str(s.host_id), "tenant_id": str(s.tenant_id),
                "name": s.name, "check_type": s.check_type, "check_config": s.check_config,
                "interval_seconds": s.interval_seconds,
                "threshold_warn": s.threshold_warn, "threshold_crit": s.threshold_crit,
                "max_check_attempts": s.max_check_attempts, "check_mode": s.check_mode,
                "active": s.active,
            }
            for s in services
        ],
        "collectors": [
            {
                "id": str(c.id), "tenant_id": str(c.tenant_id),
                "name": c.name, "hostname": c.hostname, "active": c.active,
            }
            for c in collectors
        ],
        "service_templates": [
            {"id": str(t.id), "name": t.name, "description": t.description, "checks": t.checks}
            for t in templates
        ],
        "alert_rules": [
            {
                "id": str(r.id), "tenant_id": str(r.tenant_id),
                "name": r.name, "conditions": r.conditions,
                "notification_channels": [str(c) for c in (r.notification_channels or [])],
                "enabled": r.enabled,
            }
            for r in alert_rules
        ],
        "notification_channels": [
            {
                "id": str(ch.id), "tenant_id": str(ch.tenant_id),
                "name": ch.name, "channel_type": ch.channel_type,
                # Exclude secrets from config (e.g. passwords, tokens)
                "config": {k: v for k, v in (ch.config or {}).items() if k not in ("password", "token", "secret")},
                "events": ch.events, "active": ch.active,
            }
            for ch in channels
        ],
    }

    date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    return JSONResponse(
        content=export,
        headers={"Content-Disposition": f'attachment; filename="overseer-export-{date_str}.json"'},
    )


@router.post("/import")
async def import_config(
    data: dict,
    _user: dict = Depends(require_role("super_admin")),
    db: AsyncSession = Depends(get_db),
):
    """Import configuration from a previously exported JSON. Uses UPSERT by ID."""
    from uuid import UUID
    import uuid as _uuid

    counts = {}

    # Tenants
    imported_tenants = 0
    for item in data.get("tenants", []):
        await db.execute(text("""
            INSERT INTO tenants (id, name, slug, active, settings, created_at, updated_at)
            VALUES (:id, :name, :slug, :active, :settings, now(), now())
            ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name, slug = EXCLUDED.slug,
                active = EXCLUDED.active, settings = EXCLUDED.settings,
                updated_at = now()
        """), {
            "id": item["id"], "name": item["name"], "slug": item["slug"],
            "active": item.get("active", True), "settings": str(item.get("settings", "{}")),
        })
        imported_tenants += 1
    counts["imported_tenants"] = imported_tenants

    # Collectors (before hosts — hosts reference collectors)
    imported_collectors = 0
    for item in data.get("collectors", []):
        await db.execute(text("""
            INSERT INTO collectors (id, tenant_id, name, hostname, active, config_version, created_at, updated_at)
            VALUES (:id, :tid, :name, :hostname, :active, 0, now(), now())
            ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name, hostname = EXCLUDED.hostname,
                active = EXCLUDED.active, updated_at = now()
        """), {
            "id": item["id"], "tid": item["tenant_id"],
            "name": item["name"], "hostname": item.get("hostname"),
            "active": item.get("active", True),
        })
        imported_collectors += 1
    counts["imported_collectors"] = imported_collectors

    # Hosts
    imported_hosts = 0
    for item in data.get("hosts", []):
        # Resolve host_type_id: use provided UUID or fall back to "Linux Server"
        ht_id = item.get("host_type_id")
        if not ht_id:
            ht_fallback = await db.execute(text(
                "SELECT id FROM host_types WHERE name = 'Linux Server' LIMIT 1"
            ))
            ht_row = ht_fallback.fetchone()
            ht_id = str(ht_row.id) if ht_row else None
        await db.execute(text("""
            INSERT INTO hosts (id, tenant_id, collector_id, hostname, display_name, ip_address,
                               host_type_id, snmp_version, tags, active, created_at, updated_at)
            VALUES (:id, :tid, :cid, :hostname, :display_name, :ip, :host_type_id, :snmp_version,
                    :tags, :active, now(), now())
            ON CONFLICT (id) DO UPDATE
            SET hostname = EXCLUDED.hostname, display_name = EXCLUDED.display_name,
                ip_address = EXCLUDED.ip_address, active = EXCLUDED.active, updated_at = now()
        """), {
            "id": item["id"], "tid": item["tenant_id"],
            "cid": item.get("collector_id"),
            "hostname": item["hostname"], "display_name": item.get("display_name"),
            "ip": item.get("ip_address"), "host_type_id": ht_id,
            "snmp_version": item.get("snmp_version", "2c"),
            "tags": str(item.get("tags", "[]")), "active": item.get("active", True),
        })
        imported_hosts += 1
    counts["imported_hosts"] = imported_hosts

    # Services
    imported_services = 0
    for item in data.get("services", []):
        await db.execute(text("""
            INSERT INTO services (id, host_id, tenant_id, name, check_type, check_config,
                                  interval_seconds, threshold_warn, threshold_crit,
                                  max_check_attempts, check_mode, active, created_at, updated_at)
            VALUES (:id, :host_id, :tid, :name, :check_type, :check_config,
                    :interval_seconds, :threshold_warn, :threshold_crit,
                    :max_check_attempts, :check_mode, :active, now(), now())
            ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name, check_type = EXCLUDED.check_type,
                check_config = EXCLUDED.check_config, active = EXCLUDED.active,
                updated_at = now()
        """), {
            "id": item["id"], "host_id": item["host_id"], "tid": item["tenant_id"],
            "name": item["name"], "check_type": item["check_type"],
            "check_config": str(item.get("check_config", "{}")),
            "interval_seconds": item.get("interval_seconds", 60),
            "threshold_warn": item.get("threshold_warn"),
            "threshold_crit": item.get("threshold_crit"),
            "max_check_attempts": item.get("max_check_attempts", 3),
            "check_mode": item.get("check_mode", "passive"),
            "active": item.get("active", True),
        })
        imported_services += 1
    counts["imported_services"] = imported_services

    # Service templates
    imported_templates = 0
    for item in data.get("service_templates", []):
        await db.execute(text("""
            INSERT INTO service_templates (id, name, description, checks, created_at, updated_at)
            VALUES (:id, :name, :description, :checks, now(), now())
            ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name, description = EXCLUDED.description,
                checks = EXCLUDED.checks, updated_at = now()
        """), {
            "id": item["id"], "name": item["name"],
            "description": item.get("description", ""),
            "checks": str(item.get("checks", "[]")),
        })
        imported_templates += 1
    counts["imported_service_templates"] = imported_templates

    await db.commit()
    return counts
