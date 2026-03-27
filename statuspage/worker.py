"""Status Page background worker — component status calculation, auto-incidents, daily uptime."""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import AsyncSessionLocal

logger = logging.getLogger("overseer.statuspage")

# Status priority (higher index = worse)
_STATUS_RANK = {
    "OK": 0,
    "WARNING": 1,
    "NO_DATA": 2,
    "UNKNOWN": 3,
    "CRITICAL": 4,
}

# Map check status → component status
_COMPONENT_STATUS = {
    "operational": "operational",
    "degraded_performance": "degraded_performance",
    "partial_outage": "partial_outage",
    "major_outage": "major_outage",
}


def _compute_component_status(check_statuses: list[str]) -> str:
    """Compute component status from its mapped check statuses.

    - All OK → operational
    - Any WARNING, none CRITICAL → degraded_performance
    - Any CRITICAL but not all → partial_outage
    - All CRITICAL/UNKNOWN/NO_DATA → major_outage
    """
    if not check_statuses:
        return "operational"

    has_critical = any(s in ("CRITICAL",) for s in check_statuses)
    has_warning = any(s in ("WARNING",) for s in check_statuses)
    all_bad = all(s in ("CRITICAL", "UNKNOWN", "NO_DATA") for s in check_statuses)

    if all_bad:
        return "major_outage"
    if has_critical:
        return "partial_outage"
    if has_warning:
        return "degraded_performance"
    return "operational"


async def _update_component_statuses(db: AsyncSession) -> None:
    """Recalculate status for all non-overridden components."""
    # Get all components with their mapped check statuses
    rows = await db.execute(text("""
        SELECT
            c.id AS component_id,
            c.current_status,
            c.status_override,
            c.status_page_id,
            COALESCE(array_agg(cs.status) FILTER (WHERE cs.status IS NOT NULL), '{}') AS check_statuses
        FROM status_page_components c
        LEFT JOIN component_check_mappings m ON m.component_id = c.id
        LEFT JOIN current_status cs ON cs.service_id = m.service_id
        GROUP BY c.id
    """))
    components = rows.fetchall()

    for comp in components:
        if comp.status_override:
            continue

        check_statuses = list(comp.check_statuses) if comp.check_statuses else []
        new_status = _compute_component_status(check_statuses)

        if new_status != comp.current_status:
            old_status = comp.current_status
            await db.execute(text("""
                UPDATE status_page_components
                SET current_status = :new_status
                WHERE id = :cid
            """), {"new_status": new_status, "cid": comp.component_id})

            # Auto-incident logic
            await _handle_auto_incident(db, comp.component_id, comp.status_page_id, old_status, new_status)

    await db.commit()


async def _handle_auto_incident(
    db: AsyncSession,
    component_id: UUID,
    status_page_id: UUID,
    old_status: str,
    new_status: str,
) -> None:
    """Create or resolve auto-incidents on component status changes."""
    # Transition TO outage → create incident
    if old_status == "operational" and new_status in ("partial_outage", "major_outage"):
        # Get component name
        name_row = await db.execute(text(
            "SELECT name FROM status_page_components WHERE id = :cid"
        ), {"cid": component_id})
        comp_name = name_row.scalar_one()

        label = "Partial Outage" if new_status == "partial_outage" else "Major Outage"
        impact = "major" if new_status == "major_outage" else "minor"

        # Create incident
        result = await db.execute(text("""
            INSERT INTO status_page_incidents (status_page_id, title, status, impact, is_auto_created)
            VALUES (:page_id, :title, 'investigating', :impact, true)
            RETURNING id
        """), {
            "page_id": status_page_id,
            "title": f"{comp_name} — {label}",
            "impact": impact,
        })
        incident_id = result.scalar_one()

        # Link component
        await db.execute(text("""
            INSERT INTO incident_component_links (incident_id, component_id) VALUES (:iid, :cid)
        """), {"iid": incident_id, "cid": component_id})

        # Initial update
        await db.execute(text("""
            INSERT INTO incident_updates (incident_id, status, body)
            VALUES (:iid, 'investigating', :body)
        """), {
            "iid": incident_id,
            "body": f"We are currently investigating an issue with {comp_name}.",
        })

        logger.info("[StatusPage] Auto-incident created for %s: %s", comp_name, label)

    # Transition FROM outage TO operational → resolve auto-incidents
    elif new_status == "operational" and old_status in ("partial_outage", "major_outage"):
        # Find open auto-incidents for this component
        open_incidents = await db.execute(text("""
            SELECT i.id FROM status_page_incidents i
            JOIN incident_component_links l ON l.incident_id = i.id
            WHERE l.component_id = :cid
              AND i.is_auto_created = true
              AND i.status != 'resolved'
        """), {"cid": component_id})

        for row in open_incidents.fetchall():
            await db.execute(text("""
                UPDATE status_page_incidents
                SET status = 'resolved', resolved_at = NOW()
                WHERE id = :iid
            """), {"iid": row.id})

            await db.execute(text("""
                INSERT INTO incident_updates (incident_id, status, body)
                VALUES (:iid, 'resolved', 'This incident has been resolved. All systems are operating normally.')
            """), {"iid": row.id})

        logger.info("[StatusPage] Auto-resolved incidents for component %s", component_id)


async def _compute_daily_uptime(db: AsyncSession) -> None:
    """Compute daily uptime for yesterday for all components.

    Uses state_history to figure out how long each component's checks were in bad states.
    Simplified: checks the component's current worst_status distribution over the day.
    """
    yesterday = date.today() - timedelta(days=1)

    # Get all components with their mapped services
    components = await db.execute(text("""
        SELECT c.id, array_agg(m.service_id) AS service_ids
        FROM status_page_components c
        JOIN component_check_mappings m ON m.component_id = c.id
        GROUP BY c.id
    """))

    for comp in components.fetchall():
        service_ids = list(comp.service_ids) if comp.service_ids else []
        if not service_ids:
            continue

        # Count outage minutes from state_history for yesterday
        outage_row = await db.execute(text("""
            WITH transitions AS (
                SELECT
                    new_status,
                    created_at,
                    LEAD(created_at) OVER (PARTITION BY service_id ORDER BY created_at) AS next_at
                FROM state_history
                WHERE service_id = ANY(:sids)
                  AND created_at >= :day_start
                  AND created_at < :day_end
            )
            SELECT COALESCE(SUM(
                EXTRACT(EPOCH FROM (COALESCE(next_at, :day_end) - created_at)) / 60.0
            ), 0) AS outage_minutes
            FROM transitions
            WHERE new_status IN ('CRITICAL', 'UNKNOWN', 'NO_DATA')
        """), {
            "sids": service_ids,
            "day_start": datetime(yesterday.year, yesterday.month, yesterday.day, tzinfo=timezone.utc),
            "day_end": datetime(yesterday.year, yesterday.month, yesterday.day, tzinfo=timezone.utc) + timedelta(days=1),
        })
        outage_minutes = int(outage_row.scalar() or 0)
        uptime_pct = max(0.0, round(100.0 * (1440 - outage_minutes) / 1440, 4))

        # Determine worst status of the day
        worst_row = await db.execute(text("""
            SELECT new_status FROM state_history
            WHERE service_id = ANY(:sids)
              AND created_at >= :day_start
              AND created_at < :day_end
            ORDER BY CASE new_status
                WHEN 'CRITICAL' THEN 5
                WHEN 'UNKNOWN' THEN 4
                WHEN 'NO_DATA' THEN 3
                WHEN 'WARNING' THEN 2
                WHEN 'OK' THEN 1
            END DESC
            LIMIT 1
        """), {
            "sids": service_ids,
            "day_start": datetime(yesterday.year, yesterday.month, yesterday.day, tzinfo=timezone.utc),
            "day_end": datetime(yesterday.year, yesterday.month, yesterday.day, tzinfo=timezone.utc) + timedelta(days=1),
        })
        worst_status = worst_row.scalar() or "OK"

        # Map check status to component status for worst_status
        comp_worst = "operational"
        if worst_status == "CRITICAL":
            comp_worst = "major_outage"
        elif worst_status in ("UNKNOWN", "NO_DATA"):
            comp_worst = "partial_outage"
        elif worst_status == "WARNING":
            comp_worst = "degraded_performance"

        await db.execute(text("""
            INSERT INTO component_daily_uptime (component_id, date, uptime_percentage, worst_status, outage_minutes)
            VALUES (:cid, :dt, :pct, :ws, :om)
            ON CONFLICT (component_id, date)
            DO UPDATE SET uptime_percentage = :pct, worst_status = :ws, outage_minutes = :om
        """), {
            "cid": comp.id,
            "dt": yesterday,
            "pct": uptime_pct,
            "ws": comp_worst,
            "om": outage_minutes,
        })

    await db.commit()
    logger.info("[StatusPage] Daily uptime computed for %s", yesterday)


async def status_page_worker() -> None:
    """Every 60s: recalculate component statuses from mapped checks."""
    await asyncio.sleep(25)  # Initial delay
    while True:
        try:
            async with AsyncSessionLocal() as db:
                await _update_component_statuses(db)
        except Exception as e:
            logger.error("[StatusPage] Worker error: %s", e)
        await asyncio.sleep(60)


async def daily_uptime_worker() -> None:
    """Once daily: compute uptime for yesterday."""
    await asyncio.sleep(120)  # 2min initial delay
    while True:
        try:
            async with AsyncSessionLocal() as db:
                await _compute_daily_uptime(db)
        except Exception as e:
            logger.error("[StatusPage] Daily uptime error: %s", e)
        await asyncio.sleep(86400)  # 24 hours
