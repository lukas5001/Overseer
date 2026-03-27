"""Overseer API – Custom Dashboards router."""
import secrets
from datetime import datetime, timezone, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, require_role, tenant_scope, apply_tenant_filter
from api.app.routers.audit import write_audit
from api.app.models.models import Dashboard, DashboardVersion, Service, Host, CurrentStatus

router = APIRouter()

MAX_VERSIONS = 50


# ── Schemas ──────────────────────────────────────────────────────────────────

class DashboardCreate(BaseModel):
    tenant_id: UUID
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    config: dict = {}


class DashboardUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    config: dict | None = None


class ShareCreate(BaseModel):
    expires_in_days: int = Field(default=30, ge=1, le=365)
    fixed_variables: list[str] = []
    fixed_variable_values: dict[str, str | list[str]] = {}


class DashboardQuery(BaseModel):
    service_ids: list[UUID] | None = None
    host_ids: list[UUID] | None = None
    check_types: list[str] | None = None
    time_from: str = Field(alias="from")
    time_to: str = Field(default="now", alias="to")
    aggregation: str = "avg"
    interval: str | None = None

    model_config = {"populate_by_name": True}


# ── Default Dashboard Config ─────────────────────────────────────────────────

DEFAULT_DASHBOARD_CONFIG = {
    "schemaVersion": 1,
    "timeSettings": {
        "from": "now-1h",
        "to": "now",
        "refreshInterval": 30,
    },
    "widgets": {
        "widget-stat-total": {
            "type": "stat",
            "title": "Hosts Total",
            "dataSource": {"type": "summary", "field": "total_hosts"},
            "options": {},
        },
        "widget-stat-ok": {
            "type": "stat",
            "title": "OK",
            "dataSource": {"type": "summary", "field": "ok"},
            "options": {"color": "#10b981"},
        },
        "widget-stat-warning": {
            "type": "stat",
            "title": "Warning",
            "dataSource": {"type": "summary", "field": "warning"},
            "options": {"color": "#f59e0b"},
        },
        "widget-stat-critical": {
            "type": "stat",
            "title": "Critical",
            "dataSource": {"type": "summary", "field": "critical"},
            "options": {"color": "#ef4444"},
        },
    },
    "layout": {
        "lg": [
            {"i": "widget-stat-total", "x": 0, "y": 0, "w": 6, "h": 4, "minW": 3, "minH": 3},
            {"i": "widget-stat-ok", "x": 6, "y": 0, "w": 6, "h": 4, "minW": 3, "minH": 3},
            {"i": "widget-stat-warning", "x": 12, "y": 0, "w": 6, "h": 4, "minW": 3, "minH": 3},
            {"i": "widget-stat-critical", "x": 18, "y": 0, "w": 6, "h": 4, "minW": 3, "minH": 3},
        ],
    },
}


# ── Helpers ──────────────────────────────────────────────────────────────────

def _dashboard_summary(d: Dashboard) -> dict:
    """Return a dashboard without config (for list views)."""
    return {
        "id": str(d.id),
        "tenant_id": str(d.tenant_id),
        "title": d.title,
        "description": d.description,
        "is_default": d.is_default,
        "is_shared": d.is_shared,
        "created_by": str(d.created_by) if d.created_by else None,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


def _dashboard_full(d: Dashboard) -> dict:
    """Return full dashboard including config."""
    out = _dashboard_summary(d)
    out["config"] = d.config or {}
    out["share_token"] = d.share_token
    out["share_expires_at"] = d.share_expires_at.isoformat() if d.share_expires_at else None
    out["share_config"] = d.share_config or {}
    return out


async def _save_version(db: AsyncSession, dashboard: Dashboard, user_id: UUID | None):
    """Create a new version entry and prune old ones."""
    # Get next version number
    result = await db.execute(
        select(func.coalesce(func.max(DashboardVersion.version), 0))
        .where(DashboardVersion.dashboard_id == dashboard.id)
    )
    next_version = result.scalar() + 1

    version = DashboardVersion(
        dashboard_id=dashboard.id,
        version=next_version,
        config=dashboard.config,
        changed_by=user_id,
    )
    db.add(version)

    # Prune: keep only MAX_VERSIONS most recent
    count_result = await db.execute(
        select(func.count()).where(DashboardVersion.dashboard_id == dashboard.id)
    )
    total = count_result.scalar() or 0
    if total >= MAX_VERSIONS:
        # Delete oldest versions beyond limit
        oldest = await db.execute(
            select(DashboardVersion.id)
            .where(DashboardVersion.dashboard_id == dashboard.id)
            .order_by(DashboardVersion.version.asc())
            .limit(total - MAX_VERSIONS + 1)
        )
        old_ids = [row[0] for row in oldest.all()]
        if old_ids:
            await db.execute(
                delete(DashboardVersion).where(DashboardVersion.id.in_(old_ids))
            )


async def _ensure_default_dashboard(db: AsyncSession, tenant_id: UUID, user_id: UUID | None) -> Dashboard:
    """Create the default dashboard for a tenant if it doesn't exist yet."""
    result = await db.execute(
        select(Dashboard).where(
            Dashboard.tenant_id == tenant_id,
            Dashboard.is_default == True,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        return existing

    dashboard = Dashboard(
        tenant_id=tenant_id,
        title="Overview",
        description="Default dashboard with status overview",
        config=DEFAULT_DASHBOARD_CONFIG,
        is_default=True,
        created_by=user_id,
    )
    db.add(dashboard)
    await db.flush()
    await _save_version(db, dashboard, user_id)
    return dashboard


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/")
async def list_dashboards(
    tenant_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    """List all dashboards (without config). Auto-creates default if needed."""
    q = select(Dashboard).order_by(Dashboard.is_default.desc(), Dashboard.title)
    q = apply_tenant_filter(q, Dashboard.tenant_id, _scope, tenant_id)
    result = await db.execute(q)
    dashboards = result.scalars().all()

    # Auto-create default dashboard for each accessible tenant that has none
    if not dashboards or not any(d.is_default for d in dashboards):
        # Determine target tenant
        target_tenant = tenant_id
        if not target_tenant and _scope and len(_scope) == 1:
            target_tenant = _scope[0]
        if target_tenant:
            user_id = UUID(_user["sub"]) if _user.get("sub") else None
            await _ensure_default_dashboard(db, target_tenant, user_id)
            await db.commit()
            # Re-fetch
            result = await db.execute(
                select(Dashboard).order_by(Dashboard.is_default.desc(), Dashboard.title)
                .where(Dashboard.tenant_id == target_tenant)
            )
            dashboards = result.scalars().all()

    return [_dashboard_summary(d) for d in dashboards]


@router.get("/{dashboard_id}")
async def get_dashboard(
    dashboard_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    result = await db.execute(
        select(Dashboard).where(Dashboard.id == dashboard_id)
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    # Check tenant access
    if _scope is not None and dashboard.tenant_id not in _scope:
        raise HTTPException(status_code=403, detail="Access denied")
    return _dashboard_full(dashboard)


@router.post("/", status_code=201)
async def create_dashboard(
    body: DashboardCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin", "tenant_operator")),
):
    user_id = UUID(_user["sub"]) if _user.get("sub") else None
    dashboard = Dashboard(
        tenant_id=body.tenant_id,
        title=body.title,
        description=body.description,
        config=body.config or DEFAULT_DASHBOARD_CONFIG,
        created_by=user_id,
    )
    db.add(dashboard)
    await db.flush()
    await _save_version(db, dashboard, user_id)
    await write_audit(db, user=_user, action="dashboard_create",
                      target_type="dashboard", target_id=dashboard.id,
                      tenant_id=body.tenant_id,
                      detail={"title": body.title})
    await db.commit()
    await db.refresh(dashboard)
    return _dashboard_full(dashboard)


@router.put("/{dashboard_id}")
async def update_dashboard_full(
    dashboard_id: UUID,
    body: DashboardUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin", "tenant_operator")),
):
    """Full update — replaces config entirely."""
    result = await db.execute(
        select(Dashboard).where(Dashboard.id == dashboard_id)
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    if body.title is not None:
        dashboard.title = body.title
    if body.description is not None:
        dashboard.description = body.description
    if body.config is not None:
        dashboard.config = body.config
    dashboard.updated_at = datetime.now(timezone.utc)

    user_id = UUID(_user["sub"]) if _user.get("sub") else None
    await _save_version(db, dashboard, user_id)
    await write_audit(db, user=_user, action="dashboard_update",
                      target_type="dashboard", target_id=dashboard_id,
                      tenant_id=dashboard.tenant_id,
                      detail={"title": dashboard.title})
    await db.commit()
    return _dashboard_full(dashboard)


@router.patch("/{dashboard_id}")
async def update_dashboard_partial(
    dashboard_id: UUID,
    body: DashboardUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin", "tenant_operator")),
):
    """Partial update — only changes provided fields."""
    result = await db.execute(
        select(Dashboard).where(Dashboard.id == dashboard_id)
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    updates = body.model_dump(exclude_none=True)
    needs_version = "config" in updates

    for field, value in updates.items():
        setattr(dashboard, field, value)
    dashboard.updated_at = datetime.now(timezone.utc)

    if needs_version:
        user_id = UUID(_user["sub"]) if _user.get("sub") else None
        await _save_version(db, dashboard, user_id)

    await write_audit(db, user=_user, action="dashboard_update",
                      target_type="dashboard", target_id=dashboard_id,
                      tenant_id=dashboard.tenant_id,
                      detail={"changed_fields": list(updates.keys())})
    await db.commit()
    return _dashboard_full(dashboard)


@router.delete("/{dashboard_id}", status_code=204)
async def delete_dashboard(
    dashboard_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin", "tenant_operator")),
):
    result = await db.execute(
        select(Dashboard).where(Dashboard.id == dashboard_id)
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    if dashboard.is_default:
        raise HTTPException(status_code=400, detail="Cannot delete the default dashboard")

    await db.delete(dashboard)
    await write_audit(db, user=_user, action="dashboard_delete",
                      target_type="dashboard", target_id=dashboard_id,
                      tenant_id=dashboard.tenant_id)
    await db.commit()


# ── Sharing ──────────────────────────────────────────────────────────────────

@router.post("/{dashboard_id}/share")
async def share_dashboard(
    dashboard_id: UUID,
    body: ShareCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    result = await db.execute(
        select(Dashboard).where(Dashboard.id == dashboard_id)
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    token = secrets.token_urlsafe(48)
    dashboard.share_token = token
    dashboard.is_shared = True
    dashboard.share_expires_at = datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)
    dashboard.share_config = {
        "fixed_variables": body.fixed_variables,
        "fixed_variable_values": body.fixed_variable_values,
    }
    dashboard.updated_at = datetime.now(timezone.utc)

    await write_audit(db, user=_user, action="dashboard_share",
                      target_type="dashboard", target_id=dashboard_id,
                      tenant_id=dashboard.tenant_id,
                      detail={"expires_in_days": body.expires_in_days})
    await db.commit()
    return {
        "share_token": token,
        "share_expires_at": dashboard.share_expires_at.isoformat(),
        "share_config": dashboard.share_config,
    }


@router.delete("/{dashboard_id}/share", status_code=204)
async def revoke_share(
    dashboard_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    result = await db.execute(
        select(Dashboard).where(Dashboard.id == dashboard_id)
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    dashboard.share_token = None
    dashboard.is_shared = False
    dashboard.share_expires_at = None
    dashboard.updated_at = datetime.now(timezone.utc)

    await write_audit(db, user=_user, action="dashboard_unshare",
                      target_type="dashboard", target_id=dashboard_id,
                      tenant_id=dashboard.tenant_id)
    await db.commit()


# ── Versions ─────────────────────────────────────────────────────────────────

@router.get("/{dashboard_id}/versions")
async def list_versions(
    dashboard_id: UUID,
    limit: int = Query(default=20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    result = await db.execute(
        select(DashboardVersion)
        .where(DashboardVersion.dashboard_id == dashboard_id)
        .order_by(DashboardVersion.version.desc())
        .limit(limit)
    )
    versions = result.scalars().all()
    return [
        {
            "id": v.id,
            "version": v.version,
            "changed_by": str(v.changed_by) if v.changed_by else None,
            "created_at": v.created_at.isoformat() if v.created_at else None,
        }
        for v in versions
    ]


@router.post("/{dashboard_id}/restore/{version}")
async def restore_version(
    dashboard_id: UUID,
    version: int,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin", "tenant_operator")),
):
    # Find the version
    result = await db.execute(
        select(DashboardVersion).where(
            DashboardVersion.dashboard_id == dashboard_id,
            DashboardVersion.version == version,
        )
    )
    ver = result.scalar_one_or_none()
    if not ver:
        raise HTTPException(status_code=404, detail="Version not found")

    # Find dashboard
    result = await db.execute(
        select(Dashboard).where(Dashboard.id == dashboard_id)
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    dashboard.config = ver.config
    dashboard.updated_at = datetime.now(timezone.utc)

    user_id = UUID(_user["sub"]) if _user.get("sub") else None
    await _save_version(db, dashboard, user_id)
    await write_audit(db, user=_user, action="dashboard_restore",
                      target_type="dashboard", target_id=dashboard_id,
                      tenant_id=dashboard.tenant_id,
                      detail={"restored_version": version})
    await db.commit()
    return _dashboard_full(dashboard)


# ── Public (no auth) ─────────────────────────────────────────────────────────

public_router = APIRouter()


async def _validate_share_token(share_token: str, db: AsyncSession) -> Dashboard:
    """Validate share token and return dashboard. Raises HTTPException on failure."""
    result = await db.execute(
        select(Dashboard).where(
            Dashboard.share_token == share_token,
            Dashboard.is_shared == True,
        )
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found or share link expired")
    if dashboard.share_expires_at and dashboard.share_expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Share link has expired")
    return dashboard


def _extract_widget_service_ids(config: dict) -> set[str]:
    """Extract all service_ids referenced in dashboard widgets."""
    sids: set[str] = set()
    widgets = config.get("widgets", {})
    for widget in widgets.values():
        ds = widget.get("dataSource", {})
        for sid in ds.get("service_ids", []):
            if not sid.startswith("$"):  # Skip variable references
                sids.add(sid)
    return sids


@public_router.get("/dashboards/{share_token}")
async def get_public_dashboard(
    share_token: str,
    db: AsyncSession = Depends(get_db),
):
    """Load a dashboard without auth via share token."""
    dashboard = await _validate_share_token(share_token, db)
    return _dashboard_full(dashboard)


@public_router.post("/dashboards/{share_token}/query")
async def public_dashboard_query(
    share_token: str,
    body: DashboardQuery,
    db: AsyncSession = Depends(get_db),
):
    """Query metrics for a public dashboard. Only allows service_ids in the dashboard's widgets."""
    dashboard = await _validate_share_token(share_token, db)

    if body.aggregation not in VALID_AGGREGATIONS:
        raise HTTPException(400, f"Invalid aggregation. Must be one of: {VALID_AGGREGATIONS}")
    if body.interval and body.interval not in VALID_INTERVALS:
        raise HTTPException(400, f"Invalid interval. Must be one of: {VALID_INTERVALS}")

    time_from = _parse_relative_time(body.time_from)
    time_to = _parse_relative_time(body.time_to)

    # Security: only allow service_ids that are in the dashboard's widgets
    allowed_sids = _extract_widget_service_ids(dashboard.config or {})
    service_ids = body.service_ids or []

    if body.host_ids or body.check_types:
        # Resolve from filters but restrict to dashboard's tenant
        sq = select(Service.id).where(
            Service.active == True,
            Service.tenant_id == dashboard.tenant_id,
        )
        if body.host_ids:
            sq = sq.where(Service.host_id.in_(body.host_ids))
        if body.check_types:
            sq = sq.where(Service.check_type.in_(body.check_types))
        result = await db.execute(sq)
        service_ids = [row[0] for row in result.all()]

    # Filter to only allowed services
    if allowed_sids:
        service_ids = [sid for sid in service_ids if str(sid) in allowed_sids]

    if not service_ids:
        return {"series": []}

    # Fetch service metadata
    svc_q = (
        select(Service.id, Service.name, Service.check_type, Host.hostname, Host.display_name)
        .join(Host, Service.host_id == Host.id)
        .where(Service.id.in_(service_ids))
    )
    svc_result = await db.execute(svc_q)
    svc_meta = {
        row.id: {
            "service_name": row.name,
            "check_type": row.check_type,
            "host": row.display_name or row.hostname,
        }
        for row in svc_result.all()
    }

    agg_source = _pick_aggregate_source(time_from, time_to)
    AGG_COL = {"avg": "avg_val", "min": "min_val", "max": "max_val", "sum": "avg_val"}
    pg_agg_raw = {"avg": "AVG(cr.value)", "min": "MIN(cr.value)", "max": "MAX(cr.value)", "sum": "SUM(cr.value)"}
    series = []

    if body.interval:
        pg_interval = INTERVAL_TO_PG[body.interval]
        if agg_source and body.aggregation != "last":
            col = AGG_COL[body.aggregation]
            sql = text(f"""
                SELECT time_bucket(:interval, a.bucket) AS time, a.service_id, AVG(a.{col}) AS value
                FROM {agg_source} a
                WHERE a.service_id = ANY(:sids) AND a.bucket >= :t_from AND a.bucket <= :t_to
                GROUP BY time_bucket(:interval, a.bucket), a.service_id ORDER BY a.service_id, time
            """)
            rows = await db.execute(sql, {"interval": pg_interval, "sids": service_ids, "t_from": time_from, "t_to": time_to})
        elif body.aggregation == "last":
            sql = text("""
                WITH buckets AS (
                    SELECT time_bucket(:interval, cr.time) AS bucket, cr.service_id, cr.value, cr.unit,
                           ROW_NUMBER() OVER (PARTITION BY cr.service_id, time_bucket(:interval, cr.time) ORDER BY cr.time DESC) AS rn
                    FROM check_results cr
                    WHERE cr.service_id = ANY(:sids) AND cr.time >= :t_from AND cr.time <= :t_to AND cr.value IS NOT NULL
                )
                SELECT bucket AS time, service_id, value, unit FROM buckets WHERE rn = 1 ORDER BY service_id, bucket
            """)
            rows = await db.execute(sql, {"interval": pg_interval, "sids": service_ids, "t_from": time_from, "t_to": time_to})
        else:
            agg_expr = pg_agg_raw[body.aggregation]
            sql = text(f"""
                SELECT time_bucket(:interval, cr.time) AS time, cr.service_id, {agg_expr} AS value, MAX(cr.unit) AS unit
                FROM check_results cr
                WHERE cr.service_id = ANY(:sids) AND cr.time >= :t_from AND cr.time <= :t_to AND cr.value IS NOT NULL
                GROUP BY time_bucket(:interval, cr.time), cr.service_id ORDER BY cr.service_id, time
            """)
            rows = await db.execute(sql, {"interval": pg_interval, "sids": service_ids, "t_from": time_from, "t_to": time_to})

        by_service: dict = {}
        unit_by_service: dict = {}
        for row in rows.fetchall():
            sid = row.service_id
            if sid not in by_service:
                by_service[sid] = []
                unit_by_service[sid] = getattr(row, "unit", "") or ""
            by_service[sid].append({"time": row.time.isoformat(), "value": round(row.value, 3) if row.value is not None else None})
        for sid, data in by_service.items():
            meta = svc_meta.get(sid, {})
            series.append({"service_id": str(sid), "metric": meta.get("service_name", "Unknown"), "check_type": meta.get("check_type", ""), "host": meta.get("host", ""), "unit": unit_by_service.get(sid, ""), "data": data})
    else:
        if body.aggregation == "last":
            sql = text("""
                SELECT DISTINCT ON (cr.service_id) cr.service_id, cr.value, cr.unit, cr.status, cr.time
                FROM check_results cr WHERE cr.service_id = ANY(:sids) AND cr.time >= :t_from AND cr.time <= :t_to AND cr.value IS NOT NULL
                ORDER BY cr.service_id, cr.time DESC
            """)
        elif agg_source:
            col = AGG_COL[body.aggregation]
            sql = text(f"""
                SELECT a.service_id, AVG(a.{col}) AS value
                FROM {agg_source} a WHERE a.service_id = ANY(:sids) AND a.bucket >= :t_from AND a.bucket <= :t_to
                GROUP BY a.service_id
            """)
        else:
            agg_expr = pg_agg_raw[body.aggregation]
            sql = text(f"""
                SELECT cr.service_id, {agg_expr} AS value, MAX(cr.unit) AS unit
                FROM check_results cr WHERE cr.service_id = ANY(:sids) AND cr.time >= :t_from AND cr.time <= :t_to AND cr.value IS NOT NULL
                GROUP BY cr.service_id
            """)
        rows = await db.execute(sql, {"sids": service_ids, "t_from": time_from, "t_to": time_to})
        for row in rows.fetchall():
            meta = svc_meta.get(row.service_id, {})
            series.append({"service_id": str(row.service_id), "metric": meta.get("service_name", "Unknown"), "check_type": meta.get("check_type", ""), "host": meta.get("host", ""), "unit": getattr(row, "unit", "") or "", "value": round(row.value, 3) if row.value is not None else None})

    return {"series": series}


@public_router.get("/dashboards/{share_token}/summary")
async def public_dashboard_summary(
    share_token: str,
    db: AsyncSession = Depends(get_db),
):
    """Status summary for public dashboard widgets."""
    dashboard = await _validate_share_token(share_token, db)

    result = await db.execute(
        select(
            func.count().label("total"),
            func.count().filter(CurrentStatus.status == "OK").label("ok"),
            func.count().filter(CurrentStatus.status == "WARNING").label("warning"),
            func.count().filter(CurrentStatus.status == "CRITICAL").label("critical"),
            func.count().filter(CurrentStatus.status == "UNKNOWN").label("unknown"),
            func.count().filter(CurrentStatus.status == "NO_DATA").label("no_data"),
        )
        .join(Service, CurrentStatus.service_id == Service.id)
        .where(Service.tenant_id == dashboard.tenant_id, Service.active == True)
    )
    row = result.one()
    return {
        "total": row.total,
        "ok": row.ok,
        "warning": row.warning,
        "critical": row.critical,
        "unknown": row.unknown,
        "no_data": row.no_data,
    }


@public_router.get("/dashboards/{share_token}/meta/hosts")
async def public_dashboard_meta_hosts(
    share_token: str,
    db: AsyncSession = Depends(get_db),
):
    """List hosts for public dashboard variable dropdowns."""
    dashboard = await _validate_share_token(share_token, db)
    q = (
        select(Host.id, Host.hostname, Host.display_name)
        .where(Host.active == True, Host.tenant_id == dashboard.tenant_id)
        .order_by(Host.hostname)
    )
    result = await db.execute(q)
    return [{"id": str(r.id), "hostname": r.hostname, "display_name": r.display_name or r.hostname} for r in result.all()]


@public_router.get("/dashboards/{share_token}/meta/services")
async def public_dashboard_meta_services(
    share_token: str,
    host_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
):
    """List services for public dashboard variable dropdowns."""
    dashboard = await _validate_share_token(share_token, db)
    q = (
        select(Service.id, Service.name, Service.check_type, Host.hostname, Host.display_name, Host.id.label("host_id"))
        .join(Host, Service.host_id == Host.id)
        .where(Service.active == True, Service.tenant_id == dashboard.tenant_id)
        .order_by(Host.hostname, Service.name)
    )
    if host_id:
        q = q.where(Service.host_id == host_id)
    result = await db.execute(q)
    return [{"id": str(r.id), "name": r.name, "check_type": r.check_type, "host_id": str(r.host_id), "host": r.display_name or r.hostname} for r in result.all()]


# ── Dashboard Query API ─────────────────────────────────────────────────────

VALID_AGGREGATIONS = {"avg", "min", "max", "last", "sum"}
VALID_INTERVALS = {"1m", "5m", "10m", "15m", "30m", "1h", "3h", "6h", "12h", "1d"}

INTERVAL_TO_PG = {
    "1m": "1 minute", "5m": "5 minutes", "10m": "10 minutes",
    "15m": "15 minutes", "30m": "30 minutes", "1h": "1 hour",
    "3h": "3 hours", "6h": "6 hours", "12h": "12 hours", "1d": "1 day",
}


def _parse_relative_time(value: str) -> datetime:
    """Parse 'now-1h', 'now-30m', 'now-7d', 'now' or ISO datetime."""
    if value == "now":
        return datetime.now(timezone.utc)
    if value.startswith("now-"):
        suffix = value[4:]
        amount = int(suffix[:-1])
        unit = suffix[-1]
        if unit == "m":
            return datetime.now(timezone.utc) - timedelta(minutes=amount)
        elif unit == "h":
            return datetime.now(timezone.utc) - timedelta(hours=amount)
        elif unit == "d":
            return datetime.now(timezone.utc) - timedelta(days=amount)
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _pick_aggregate_source(time_from: datetime, time_to: datetime) -> str | None:
    """Pick the best aggregate view based on query time range.

    Returns the view name or None for raw check_results.
    >30d → metrics_daily, >3d → metrics_hourly, >6h → metrics_5m
    """
    span = (time_to - time_from).total_seconds()
    if span > 30 * 86400:
        return "metrics_daily"
    if span > 3 * 86400:
        return "metrics_hourly"
    if span > 6 * 3600:
        return "metrics_5m"
    return None


@router.post("/query")
async def dashboard_query(
    body: DashboardQuery,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    """Query metrics data for dashboard widgets."""
    if body.aggregation not in VALID_AGGREGATIONS:
        raise HTTPException(400, f"Invalid aggregation. Must be one of: {VALID_AGGREGATIONS}")
    if body.interval and body.interval not in VALID_INTERVALS:
        raise HTTPException(400, f"Invalid interval. Must be one of: {VALID_INTERVALS}")

    time_from = _parse_relative_time(body.time_from)
    time_to = _parse_relative_time(body.time_to)

    # Resolve service_ids from filters
    service_ids = body.service_ids or []

    if not service_ids and (body.host_ids or body.check_types):
        sq = select(Service.id).where(Service.active == True)
        sq = apply_tenant_filter(sq, Service.tenant_id, _scope)
        if body.host_ids:
            sq = sq.where(Service.host_id.in_(body.host_ids))
        if body.check_types:
            sq = sq.where(Service.check_type.in_(body.check_types))
        result = await db.execute(sq)
        service_ids = [row[0] for row in result.all()]

    if not service_ids:
        return {"series": []}

    # Tenant security: verify all service_ids belong to accessible tenants
    if _scope is not None:
        check_q = select(Service.id).where(
            Service.id.in_(service_ids),
            Service.tenant_id.in_(_scope),
        )
        result = await db.execute(check_q)
        allowed = {row[0] for row in result.all()}
        service_ids = [sid for sid in service_ids if sid in allowed]
        if not service_ids:
            return {"series": []}

    # Fetch service metadata for labels
    svc_q = (
        select(Service.id, Service.name, Service.check_type, Host.hostname, Host.display_name)
        .join(Host, Service.host_id == Host.id)
        .where(Service.id.in_(service_ids))
    )
    svc_result = await db.execute(svc_q)
    svc_meta = {
        row.id: {
            "service_name": row.name,
            "check_type": row.check_type,
            "host": row.display_name or row.hostname,
        }
        for row in svc_result.all()
    }

    # Pick aggregate view based on time range for performance
    agg_source = _pick_aggregate_source(time_from, time_to)

    # Aggregate column mappings per aggregation type
    AGG_COL = {"avg": "avg_val", "min": "min_val", "max": "max_val", "sum": "avg_val"}
    pg_agg_raw = {
        "avg": "AVG(cr.value)",
        "min": "MIN(cr.value)",
        "max": "MAX(cr.value)",
        "sum": "SUM(cr.value)",
    }

    series = []

    if body.interval:
        pg_interval = INTERVAL_TO_PG[body.interval]

        if agg_source and body.aggregation != "last":
            # Use pre-aggregated data
            col = AGG_COL[body.aggregation]
            sql = text(f"""
                SELECT
                    time_bucket(:interval, a.bucket) AS time,
                    a.service_id,
                    AVG(a.{col}) AS value
                FROM {agg_source} a
                WHERE a.service_id = ANY(:sids)
                  AND a.bucket >= :t_from AND a.bucket <= :t_to
                GROUP BY time_bucket(:interval, a.bucket), a.service_id
                ORDER BY a.service_id, time
            """)
            rows = await db.execute(sql, {
                "interval": pg_interval,
                "sids": service_ids,
                "t_from": time_from,
                "t_to": time_to,
            })
        elif body.aggregation == "last":
            sql = text("""
                WITH buckets AS (
                    SELECT
                        time_bucket(:interval, cr.time) AS bucket,
                        cr.service_id,
                        cr.value,
                        cr.unit,
                        ROW_NUMBER() OVER (
                            PARTITION BY cr.service_id, time_bucket(:interval, cr.time)
                            ORDER BY cr.time DESC
                        ) AS rn
                    FROM check_results cr
                    WHERE cr.service_id = ANY(:sids)
                      AND cr.time >= :t_from AND cr.time <= :t_to
                      AND cr.value IS NOT NULL
                )
                SELECT bucket AS time, service_id, value, unit
                FROM buckets WHERE rn = 1
                ORDER BY service_id, bucket
            """)
            rows = await db.execute(sql, {
                "interval": pg_interval,
                "sids": service_ids,
                "t_from": time_from,
                "t_to": time_to,
            })
        else:
            agg_expr = pg_agg_raw[body.aggregation]
            sql = text(f"""
                SELECT
                    time_bucket(:interval, cr.time) AS time,
                    cr.service_id,
                    {agg_expr} AS value,
                    MAX(cr.unit) AS unit
                FROM check_results cr
                WHERE cr.service_id = ANY(:sids)
                  AND cr.time >= :t_from AND cr.time <= :t_to
                  AND cr.value IS NOT NULL
                GROUP BY time_bucket(:interval, cr.time), cr.service_id
                ORDER BY cr.service_id, time
            """)
            rows = await db.execute(sql, {
                "interval": pg_interval,
                "sids": service_ids,
                "t_from": time_from,
                "t_to": time_to,
            })

        by_service: dict = {}
        unit_by_service: dict = {}
        for row in rows.fetchall():
            sid = row.service_id
            if sid not in by_service:
                by_service[sid] = []
                unit_by_service[sid] = getattr(row, "unit", "") or ""
            by_service[sid].append({
                "time": row.time.isoformat(),
                "value": round(row.value, 3) if row.value is not None else None,
            })

        for sid, data in by_service.items():
            meta = svc_meta.get(sid, {})
            series.append({
                "service_id": str(sid),
                "metric": meta.get("service_name", "Unknown"),
                "check_type": meta.get("check_type", ""),
                "host": meta.get("host", ""),
                "unit": unit_by_service.get(sid, ""),
                "data": data,
            })
    else:
        if body.aggregation == "last":
            sql = text("""
                SELECT DISTINCT ON (cr.service_id)
                    cr.service_id, cr.value, cr.unit, cr.status, cr.time
                FROM check_results cr
                WHERE cr.service_id = ANY(:sids)
                  AND cr.time >= :t_from AND cr.time <= :t_to
                  AND cr.value IS NOT NULL
                ORDER BY cr.service_id, cr.time DESC
            """)
        elif agg_source:
            col = AGG_COL[body.aggregation]
            sql = text(f"""
                SELECT
                    a.service_id,
                    AVG(a.{col}) AS value
                FROM {agg_source} a
                WHERE a.service_id = ANY(:sids)
                  AND a.bucket >= :t_from AND a.bucket <= :t_to
                GROUP BY a.service_id
            """)
        else:
            agg_expr = pg_agg_raw[body.aggregation]
            sql = text(f"""
                SELECT
                    cr.service_id,
                    {agg_expr} AS value,
                    MAX(cr.unit) AS unit
                FROM check_results cr
                WHERE cr.service_id = ANY(:sids)
                  AND cr.time >= :t_from AND cr.time <= :t_to
                  AND cr.value IS NOT NULL
                GROUP BY cr.service_id
            """)

        rows = await db.execute(sql, {
            "sids": service_ids,
            "t_from": time_from,
            "t_to": time_to,
        })

        for row in rows.fetchall():
            meta = svc_meta.get(row.service_id, {})
            series.append({
                "service_id": str(row.service_id),
                "metric": meta.get("service_name", "Unknown"),
                "check_type": meta.get("check_type", ""),
                "host": meta.get("host", ""),
                "unit": getattr(row, "unit", "") or "",
                "value": round(row.value, 3) if row.value is not None else None,
            })

    return {"series": series}


# ── Dashboard Meta (for widget config dropdowns) ────────────────────────────

@router.get("/meta/services")
async def list_available_services(
    host_id: UUID | None = None,
    check_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    """List services available for widget data sources."""
    q = (
        select(
            Service.id,
            Service.name,
            Service.check_type,
            Host.hostname,
            Host.display_name,
            Host.id.label("host_id"),
        )
        .join(Host, Service.host_id == Host.id)
        .where(Service.active == True)
        .order_by(Host.hostname, Service.name)
    )
    q = apply_tenant_filter(q, Service.tenant_id, _scope)
    if host_id:
        q = q.where(Service.host_id == host_id)
    if check_type:
        q = q.where(Service.check_type == check_type)

    result = await db.execute(q)
    return [
        {
            "id": str(row.id),
            "name": row.name,
            "check_type": row.check_type,
            "host_id": str(row.host_id),
            "host": row.display_name or row.hostname,
        }
        for row in result.all()
    ]


@router.get("/meta/hosts")
async def list_available_hosts(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    """List hosts available for widget filtering."""
    q = (
        select(Host.id, Host.hostname, Host.display_name)
        .where(Host.active == True)
        .order_by(Host.hostname)
    )
    q = apply_tenant_filter(q, Host.tenant_id, _scope)

    result = await db.execute(q)
    return [
        {
            "id": str(row.id),
            "hostname": row.hostname,
            "display_name": row.display_name or row.hostname,
        }
        for row in result.all()
    ]


@router.get("/meta/check-types")
async def list_check_types(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    """List distinct check types in use."""
    q = select(Service.check_type).distinct().where(Service.active == True)
    q = apply_tenant_filter(q, Service.tenant_id, _scope)
    result = await db.execute(q)
    return sorted([row[0] for row in result.all()])
