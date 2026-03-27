"""Overseer API – Custom Dashboards router."""
import secrets
from datetime import datetime, timezone, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, require_role, tenant_scope, apply_tenant_filter
from api.app.routers.audit import write_audit
from api.app.models.models import Dashboard, DashboardVersion

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
    dashboard.updated_at = datetime.now(timezone.utc)

    await write_audit(db, user=_user, action="dashboard_share",
                      target_type="dashboard", target_id=dashboard_id,
                      tenant_id=dashboard.tenant_id,
                      detail={"expires_in_days": body.expires_in_days})
    await db.commit()
    return {
        "share_token": token,
        "share_expires_at": dashboard.share_expires_at.isoformat(),
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


@public_router.get("/dashboards/{share_token}")
async def get_public_dashboard(
    share_token: str,
    db: AsyncSession = Depends(get_db),
):
    """Load a dashboard without auth via share token."""
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

    return _dashboard_full(dashboard)
