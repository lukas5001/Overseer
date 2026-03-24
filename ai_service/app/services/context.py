"""Build context data for AI analysis from database."""
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def get_service_context(db: AsyncSession, service_id: UUID) -> dict | None:
    """Load service info including host, current status, and thresholds."""
    result = await db.execute(text("""
        SELECT s.id, s.name AS service_name, s.check_type,
               s.warning_threshold, s.critical_threshold,
               h.name AS host_name, h.address AS host_address,
               cs.status, cs.state_type, cs.status_message, cs.last_check_at
        FROM services s
        JOIN hosts h ON s.host_id = h.id
        LEFT JOIN current_status cs ON cs.service_id = s.id
        WHERE s.id = :service_id
    """), {"service_id": service_id})
    row = result.fetchone()
    if not row:
        return None
    return {
        "service_id": row.id,
        "service_name": row.service_name,
        "check_type": row.check_type,
        "warning_threshold": row.warning_threshold,
        "critical_threshold": row.critical_threshold,
        "host_name": row.host_name,
        "host_address": row.host_address,
        "current_status": row.status or "UNKNOWN",
        "state_type": row.state_type,
        "status_message": row.status_message or "",
        "last_check_at": str(row.last_check_at) if row.last_check_at else "N/A",
    }


async def get_check_history(db: AsyncSession, service_id: UUID, limit: int = 100) -> list[dict]:
    """Load recent check results for a service."""
    result = await db.execute(text("""
        SELECT time, status, value, message
        FROM check_results
        WHERE service_id = :service_id
        ORDER BY time DESC
        LIMIT :limit
    """), {"service_id": service_id, "limit": limit})
    return [
        {"time": str(r.time), "status": r.status, "value": r.value, "message": r.message}
        for r in result.fetchall()
    ]


async def get_state_history(db: AsyncSession, service_id: UUID, limit: int = 20) -> list[dict]:
    """Load recent state transitions for a service."""
    result = await db.execute(text("""
        SELECT old_status, new_status, state_type, changed_at, message
        FROM state_history
        WHERE service_id = :service_id
        ORDER BY changed_at DESC
        LIMIT :limit
    """), {"service_id": service_id, "limit": limit})
    return [
        {
            "old_status": r.old_status,
            "new_status": r.new_status,
            "state_type": r.state_type,
            "changed_at": str(r.changed_at),
            "message": r.message,
        }
        for r in result.fetchall()
    ]


async def get_tenant_id_for_service(db: AsyncSession, service_id: UUID) -> UUID | None:
    """Get the tenant_id for a service (via host)."""
    result = await db.execute(text("""
        SELECT h.tenant_id
        FROM services s
        JOIN hosts h ON s.host_id = h.id
        WHERE s.id = :service_id
    """), {"service_id": service_id})
    row = result.fetchone()
    return row.tenant_id if row else None
