"""Overseer API – Check history (TimescaleDB)."""
from datetime import datetime, timezone, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user

router = APIRouter()


@router.get("/{service_id}")
async def get_history(
    service_id: UUID,
    hours: int = Query(default=24, ge=1, le=720),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Return time-series data for one service over the last N hours."""
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    rows = await db.execute(
        text("""
            SELECT time, status, value, unit, message
            FROM check_results
            WHERE service_id = :sid AND time >= :since
            ORDER BY time ASC
        """),
        {"sid": service_id, "since": since},
    )
    data = [
        {
            "time": row.time.isoformat(),
            "status": row.status,
            "value": row.value,
            "unit": row.unit,
            "message": row.message,
        }
        for row in rows.fetchall()
    ]
    return data


@router.get("/{service_id}/summary")
async def get_history_summary(
    service_id: UUID,
    hours: int = Query(default=24, ge=1, le=720),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Min/Max/Avg/last value + status distribution for the last N hours."""
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    stats = await db.execute(
        text("""
            SELECT
                MIN(value) AS min_val,
                MAX(value) AS max_val,
                AVG(value) AS avg_val,
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'OK' THEN 1 ELSE 0 END) AS ok_count,
                SUM(CASE WHEN status = 'WARNING' THEN 1 ELSE 0 END) AS warning_count,
                SUM(CASE WHEN status = 'CRITICAL' THEN 1 ELSE 0 END) AS critical_count,
                SUM(CASE WHEN status = 'UNKNOWN' THEN 1 ELSE 0 END) AS unknown_count,
                SUM(CASE WHEN status = 'NO_DATA' THEN 1 ELSE 0 END) AS no_data_count
            FROM check_results
            WHERE service_id = :sid AND time >= :since
        """),
        {"sid": service_id, "since": since},
    )
    row = stats.fetchone()
    if not row or row.total == 0:
        return {"total": 0}

    return {
        "total": row.total,
        "min": round(row.min_val, 3) if row.min_val is not None else None,
        "max": round(row.max_val, 3) if row.max_val is not None else None,
        "avg": round(row.avg_val, 3) if row.avg_val is not None else None,
        "ok_count": row.ok_count,
        "warning_count": row.warning_count,
        "critical_count": row.critical_count,
        "unknown_count": row.unknown_count,
        "no_data_count": row.no_data_count,
    }


@router.get("/{service_id}/transitions")
async def get_status_transitions(
    service_id: UUID,
    limit: int = Query(default=10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Return recent status transitions from state_history."""
    result = await db.execute(
        text("""
            SELECT created_at, previous_status, new_status, state_type, message
            FROM state_history
            WHERE service_id = :sid
            ORDER BY created_at DESC
            LIMIT :lim
        """),
        {"sid": service_id, "lim": limit},
    )
    return [
        {
            "time": row.created_at.isoformat(),
            "status": row.new_status,
            "previous_status": row.previous_status,
            "state_type": row.state_type,
            "message": row.message,
        }
        for row in result.fetchall()
    ]
