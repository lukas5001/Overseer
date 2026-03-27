"""Inhibition Engine – suppresses alerts when a parent dependency is in CRITICAL state.

Sits BEFORE the grouper in the alert processing pipeline.
When a parent host/service is CRITICAL (HARD), all alerts for dependent
children are suppressed (not sent, but logged).

Flow:
  Alert event → InhibitionEngine.filter_events()
    → For each event: find the host → walk ancestors via dependencies table
    → If any ancestor has CRITICAL HARD status → suppress this event
    → Return only non-suppressed events
"""
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("overseer.notifications.inhibition")


async def get_ancestors(db: AsyncSession, entity_type: str, entity_id: str) -> list[tuple[str, str]]:
    """Walk the dependency DAG upward to find all ancestor entities.
    Returns list of (type, id) tuples."""
    visited: set[tuple[str, str]] = set()
    queue: list[tuple[str, str]] = [(entity_type, entity_id)]
    ancestors: list[tuple[str, str]] = []

    while queue:
        etype, eid = queue.pop(0)
        key = (etype, eid)
        if key in visited:
            continue
        visited.add(key)

        result = await db.execute(
            text("""
                SELECT depends_on_type, depends_on_id::text
                FROM dependencies
                WHERE source_type = :st AND source_id = :sid
            """),
            {"st": etype, "sid": eid},
        )
        for row in result.fetchall():
            parent = (row.depends_on_type, row.depends_on_id)
            if parent not in visited:
                ancestors.append(parent)
                queue.append(parent)

    return ancestors


async def is_entity_critical(db: AsyncSession, entity_type: str, entity_id: str) -> bool:
    """Check if an entity (host or service) currently has a CRITICAL HARD state."""
    if entity_type == "host":
        # Host is critical if any of its services is CRITICAL + HARD
        result = await db.execute(
            text("""
                SELECT 1 FROM current_status cs
                JOIN services s ON cs.service_id = s.id
                WHERE s.host_id = CAST(:id AS uuid)
                  AND s.active = true
                  AND cs.status = 'CRITICAL'
                  AND cs.state_type = 'HARD'
                LIMIT 1
            """),
            {"id": entity_id},
        )
        return result.fetchone() is not None
    else:
        # Service is critical if its own status is CRITICAL + HARD
        result = await db.execute(
            text("""
                SELECT 1 FROM current_status
                WHERE service_id = CAST(:id AS uuid)
                  AND status = 'CRITICAL'
                  AND state_type = 'HARD'
                LIMIT 1
            """),
            {"id": entity_id},
        )
        return result.fetchone() is not None


async def should_suppress(db: AsyncSession, host_name: str, tenant_id: str) -> str | None:
    """Check if alerts for the given host should be suppressed.
    Returns the name of the critical parent if suppressed, None otherwise."""
    # Resolve host_id from hostname + tenant
    result = await db.execute(
        text("SELECT id FROM hosts WHERE hostname = :hostname AND tenant_id = CAST(:tid AS uuid) AND active = true LIMIT 1"),
        {"hostname": host_name, "tid": tenant_id},
    )
    row = result.fetchone()
    if not row:
        return None

    host_id = str(row.id)
    ancestors = await get_ancestors(db, "host", host_id)

    for ancestor_type, ancestor_id in ancestors:
        if await is_entity_critical(db, ancestor_type, ancestor_id):
            # Resolve name for the suppression message
            if ancestor_type == "host":
                name_result = await db.execute(
                    text("SELECT hostname FROM hosts WHERE id = CAST(:id AS uuid)"),
                    {"id": ancestor_id},
                )
            else:
                name_result = await db.execute(
                    text("SELECT name FROM services WHERE id = CAST(:id AS uuid)"),
                    {"id": ancestor_id},
                )
            name_row = name_result.fetchone()
            return name_row[0] if name_row else f"{ancestor_type}:{ancestor_id}"

    return None


async def filter_events(db: AsyncSession, tenant_id: str, events: list[dict]) -> tuple[list[dict], int]:
    """Filter a list of webhook events, removing suppressed ones.
    Returns (filtered_events, suppressed_count)."""
    # Quick check: if no dependencies exist for this tenant, skip entirely
    dep_check = await db.execute(
        text("SELECT 1 FROM dependencies WHERE tenant_id = CAST(:tid AS uuid) LIMIT 1"),
        {"tid": tenant_id},
    )
    if not dep_check.fetchone():
        return events, 0

    filtered = []
    suppressed = 0

    for event in events:
        host_name = event.get("host")
        if not host_name:
            filtered.append(event)
            continue

        critical_parent = await should_suppress(db, host_name, tenant_id)
        if critical_parent:
            suppressed += 1
            logger.info(
                "Alert suppressed: %s/%s (parent %s is CRITICAL)",
                host_name, event.get("service", "?"), critical_parent,
            )
        else:
            filtered.append(event)

    if suppressed > 0:
        logger.info("Suppressed %d of %d alerts for tenant %s", suppressed, len(events), tenant_id)

    return filtered, suppressed
