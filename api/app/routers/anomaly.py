"""Overseer API – Anomaly Detection & Predictive Alerts router."""
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, tenant_scope

router = APIRouter()
logger = logging.getLogger("overseer.anomaly")


# ── Schemas ──────────────────────────────────────────────────────────────────

class AnomalyConfigUpdate(BaseModel):
    enabled: bool | None = None
    sensitivity: float | None = None  # Z-score threshold: 2.0 (high), 3.0 (normal), 4.0 (low)
    min_training_days: int | None = None


class FalsePositiveRequest(BaseModel):
    is_false_positive: bool = True


# ── Anomaly Config CRUD ─────────────────────────────────────────────────────

@router.get("/config")
async def list_anomaly_configs(
    tenant_id: str | None = None,
    host_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
    scope=Depends(tenant_scope),
):
    """List anomaly configs, optionally filtered by tenant or host."""
    params: dict = {}
    where_parts = ["1=1"]

    if tenant_id:
        where_parts.append("ac.tenant_id = :tenant_id")
        params["tenant_id"] = tenant_id
    elif scope is not None:
        placeholders = ", ".join(f":t{i}" for i in range(len(scope)))
        where_parts.append(f"ac.tenant_id IN ({placeholders})")
        for i, tid in enumerate(scope):
            params[f"t{i}"] = tid

    if host_id:
        where_parts.append("s.host_id = :host_id")
        params["host_id"] = host_id

    where = " AND ".join(where_parts)
    result = await db.execute(
        text(f"""
            SELECT ac.service_id, ac.tenant_id, ac.enabled, ac.sensitivity,
                   ac.min_training_days, ac.status, ac.learning_started_at,
                   ac.activated_at, ac.created_at, ac.updated_at,
                   s.name AS service_name, s.check_type, s.host_id,
                   h.hostname, h.display_name AS host_display_name
            FROM anomaly_config ac
            JOIN services s ON s.id = ac.service_id
            JOIN hosts h ON h.id = s.host_id
            WHERE {where}
            ORDER BY h.hostname, s.name
        """),
        params,
    )
    return [dict(row._mapping) for row in result.fetchall()]


@router.put("/config/{service_id}")
async def upsert_anomaly_config(
    service_id: str,
    body: AnomalyConfigUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
    scope=Depends(tenant_scope),
):
    """Enable/disable anomaly detection for a service."""
    # Verify service exists and user has access
    svc = await db.execute(
        text("SELECT id, tenant_id FROM services WHERE id = CAST(:id AS uuid)"),
        {"id": service_id},
    )
    svc_row = svc.fetchone()
    if not svc_row:
        raise HTTPException(status_code=404, detail="Service not found")

    if scope is not None and svc_row.tenant_id not in scope:
        raise HTTPException(status_code=403, detail="Access denied")

    tenant_id = svc_row.tenant_id

    # Check if config exists
    existing = await db.execute(
        text("SELECT service_id, status FROM anomaly_config WHERE service_id = CAST(:id AS uuid)"),
        {"id": service_id},
    )
    row = existing.fetchone()

    enabled = body.enabled if body.enabled is not None else (row.enabled if row else False) if hasattr(row, 'enabled') else False
    sensitivity = body.sensitivity if body.sensitivity is not None else 3.0
    min_training_days = body.min_training_days if body.min_training_days is not None else 7

    if row:
        # Update
        updates = ["updated_at = now()"]
        params: dict = {"id": service_id}
        if body.enabled is not None:
            updates.append("enabled = :enabled")
            params["enabled"] = body.enabled
            if body.enabled and row.status == "disabled":
                updates.append("status = 'learning'")
                updates.append("learning_started_at = now()")
            elif not body.enabled:
                updates.append("status = 'disabled'")
        if body.sensitivity is not None:
            updates.append("sensitivity = :sensitivity")
            params["sensitivity"] = body.sensitivity
        if body.min_training_days is not None:
            updates.append("min_training_days = :min_training_days")
            params["min_training_days"] = body.min_training_days

        set_clause = ", ".join(updates)
        result = await db.execute(
            text(f"UPDATE anomaly_config SET {set_clause} WHERE service_id = CAST(:id AS uuid) RETURNING *"),
            params,
        )
    else:
        # Insert
        status_val = "learning" if enabled else "disabled"
        result = await db.execute(
            text("""
                INSERT INTO anomaly_config
                    (service_id, tenant_id, enabled, sensitivity, min_training_days, status, learning_started_at)
                VALUES
                    (CAST(:id AS uuid), :tenant_id, :enabled, :sensitivity, :min_training_days, :status,
                     CASE WHEN :enabled THEN now() ELSE NULL END)
                RETURNING *
            """),
            {
                "id": service_id, "tenant_id": tenant_id, "enabled": enabled,
                "sensitivity": sensitivity, "min_training_days": min_training_days,
                "status": status_val,
            },
        )

    await db.commit()
    return dict(result.fetchone()._mapping)


@router.delete("/config/{service_id}", status_code=204)
async def delete_anomaly_config(
    service_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Delete anomaly config and all related data for a service."""
    await db.execute(text("DELETE FROM metric_baselines WHERE service_id = CAST(:id AS uuid)"), {"id": service_id})
    await db.execute(text("DELETE FROM anomaly_events WHERE service_id = CAST(:id AS uuid)"), {"id": service_id})
    await db.execute(text("DELETE FROM anomaly_config WHERE service_id = CAST(:id AS uuid)"), {"id": service_id})
    await db.commit()


# ── Baselines ────────────────────────────────────────────────────────────────

@router.get("/baselines/{service_id}")
async def get_baselines(
    service_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Get baseline data for a service (168 buckets)."""
    result = await db.execute(
        text("""
            SELECT day_of_week, hour_of_day, mean, std_dev, median, sample_count, updated_at
            FROM metric_baselines
            WHERE service_id = CAST(:id AS uuid)
            ORDER BY day_of_week, hour_of_day
        """),
        {"id": service_id},
    )
    return [dict(row._mapping) for row in result.fetchall()]


# ── Anomaly Events ───────────────────────────────────────────────────────────

@router.get("/events")
async def list_anomaly_events(
    tenant_id: str | None = None,
    host_id: str | None = None,
    service_id: str | None = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
    scope=Depends(tenant_scope),
):
    """List anomaly events with optional filters."""
    params: dict = {"limit": limit, "offset": offset}
    where_parts = ["1=1"]

    if tenant_id:
        where_parts.append("ae.tenant_id = :tenant_id")
        params["tenant_id"] = tenant_id
    elif scope is not None:
        placeholders = ", ".join(f":t{i}" for i in range(len(scope)))
        where_parts.append(f"ae.tenant_id IN ({placeholders})")
        for i, tid in enumerate(scope):
            params[f"t{i}"] = tid

    if service_id:
        where_parts.append("ae.service_id = :service_id")
        params["service_id"] = service_id
    elif host_id:
        where_parts.append("s.host_id = :host_id")
        params["host_id"] = host_id

    where = " AND ".join(where_parts)
    result = await db.execute(
        text(f"""
            SELECT ae.id, ae.service_id, ae.tenant_id, ae.detected_at,
                   ae.value, ae.expected_mean, ae.expected_std, ae.z_score,
                   ae.is_false_positive, ae.feedback_by, ae.created_at,
                   s.name AS service_name, s.check_type, s.host_id,
                   h.hostname
            FROM anomaly_events ae
            JOIN services s ON s.id = ae.service_id
            JOIN hosts h ON h.id = s.host_id
            WHERE {where}
            ORDER BY ae.detected_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    return [dict(row._mapping) for row in result.fetchall()]


@router.patch("/events/{event_id}")
async def update_anomaly_event(
    event_id: str,
    body: FalsePositiveRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Mark an anomaly event as false positive."""
    result = await db.execute(
        text("""
            UPDATE anomaly_events
            SET is_false_positive = :fp, feedback_by = CAST(:uid AS uuid)
            WHERE id = CAST(:id AS uuid)
            RETURNING id
        """),
        {"id": event_id, "fp": body.is_false_positive, "uid": user["sub"]},
    )
    await db.commit()
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Event not found")
    return {"status": "ok"}


# ── Predictions ──────────────────────────────────────────────────────────────

@router.get("/predictions")
async def list_predictions(
    tenant_id: str | None = None,
    host_id: str | None = None,
    service_id: str | None = None,
    min_confidence: float = 0.7,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
    scope=Depends(tenant_scope),
):
    """List active predictions (most recent per service with confidence >= threshold)."""
    params: dict = {"min_confidence": min_confidence}
    where_parts = ["p.confidence >= :min_confidence", "p.days_until_full > 0"]

    if tenant_id:
        where_parts.append("p.tenant_id = :tenant_id")
        params["tenant_id"] = tenant_id
    elif scope is not None:
        placeholders = ", ".join(f":t{i}" for i in range(len(scope)))
        where_parts.append(f"p.tenant_id IN ({placeholders})")
        for i, tid in enumerate(scope):
            params[f"t{i}"] = tid

    if service_id:
        where_parts.append("p.service_id = :service_id")
        params["service_id"] = service_id
    elif host_id:
        where_parts.append("s.host_id = :host_id")
        params["host_id"] = host_id

    where = " AND ".join(where_parts)
    result = await db.execute(
        text(f"""
            SELECT DISTINCT ON (p.service_id)
                   p.id, p.service_id, p.tenant_id, p.current_value, p.capacity,
                   p.rate_per_day, p.days_until_full, p.predicted_date, p.confidence,
                   p.created_at,
                   s.name AS service_name, s.check_type, s.host_id,
                   h.hostname, h.display_name AS host_display_name
            FROM predictions p
            JOIN services s ON s.id = p.service_id
            JOIN hosts h ON h.id = s.host_id
            WHERE {where}
            ORDER BY p.service_id, p.created_at DESC
        """),
        params,
    )
    rows = [dict(row._mapping) for row in result.fetchall()]
    # Sort by urgency
    rows.sort(key=lambda r: r.get("days_until_full") or 9999)
    return rows
