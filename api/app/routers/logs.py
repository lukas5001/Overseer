"""Overseer API – Log Search (TimescaleDB full-text search)."""
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user

router = APIRouter()


class LogSearchRequest(BaseModel):
    query: str | None = None
    host_ids: list[str] | None = None
    services: list[str] | None = None
    severity_min: int | None = None  # 0=emergency..7=debug — min means "at least this severe" (lower number = more severe)
    severity_max: int | None = None
    source: str | None = None  # 'file', 'journald', 'windows_eventlog'
    from_time: datetime | None = Field(None, alias="from")
    to_time: datetime | None = Field(None, alias="to")
    limit: int = Field(200, ge=1, le=2000)
    offset: int = Field(0, ge=0)

    model_config = {"populate_by_name": True}


class LogSearchResponse(BaseModel):
    total: int
    logs: list[dict]


@router.post("/search")
async def search_logs(
    req: LogSearchRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Search logs with full-text search, filters, and highlighting."""
    tenant_id = user.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant context")

    # Default time range: last 24 hours
    now = datetime.now(timezone.utc)
    from_time = req.from_time or (now - timedelta(hours=24))
    to_time = req.to_time or now

    # Build WHERE clauses
    conditions = ["l.tenant_id = :tenant_id", "l.time >= :from_time", "l.time <= :to_time"]
    params: dict = {
        "tenant_id": tenant_id,
        "from_time": from_time,
        "to_time": to_time,
    }

    if req.host_ids:
        conditions.append("l.host_id = ANY(:host_ids)")
        params["host_ids"] = req.host_ids

    if req.services:
        conditions.append("l.service = ANY(:services)")
        params["services"] = req.services

    if req.severity_min is not None:
        # Lower number = more severe. severity_min=3 means "error and worse" = severity <= 3
        conditions.append("l.severity <= :severity_min")
        params["severity_min"] = req.severity_min

    if req.severity_max is not None:
        conditions.append("l.severity >= :severity_max")
        params["severity_max"] = req.severity_max

    if req.source:
        conditions.append("l.source = :source")
        params["source"] = req.source

    # Full-text search
    select_message = "l.message"
    if req.query:
        conditions.append("l.search_vector @@ websearch_to_tsquery('english', :query)")
        params["query"] = req.query
        select_message = "ts_headline('english', l.message, websearch_to_tsquery('english', :query), 'MaxFragments=3, MaxWords=60, MinWords=20') AS message"

    where_clause = " AND ".join(conditions)

    # Count query
    count_sql = f"SELECT COUNT(*) FROM logs l WHERE {where_clause}"
    count_result = await db.execute(text(count_sql), params)
    total = count_result.scalar() or 0

    # Main query with host name join
    sql = f"""
        SELECT l.time, l.host_id, h.hostname, l.source, l.source_path,
               l.service, l.severity, {select_message}, l.fields
        FROM logs l
        LEFT JOIN hosts h ON h.id = l.host_id
        WHERE {where_clause}
        ORDER BY l.time DESC
        LIMIT :limit OFFSET :offset
    """
    params["limit"] = req.limit
    params["offset"] = req.offset

    result = await db.execute(text(sql), params)
    rows = result.fetchall()

    logs = [
        {
            "time": row.time.isoformat(),
            "host_id": row.host_id,
            "host": row.hostname,
            "source": row.source,
            "source_path": row.source_path,
            "service": row.service,
            "severity": row.severity,
            "message": row.message,
            "fields": row.fields,
        }
        for row in rows
    ]

    return LogSearchResponse(total=total, logs=logs)


@router.get("/stats")
async def log_stats(
    host_id: str | None = None,
    hours: int = 24,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Get log volume and severity distribution for the given time range."""
    tenant_id = user.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant context")

    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    params: dict = {"tenant_id": tenant_id, "since": since}

    host_filter = ""
    if host_id is not None:
        host_filter = "AND host_id = :host_id"
        params["host_id"] = host_id

    # Severity distribution
    sql = f"""
        SELECT severity, COUNT(*) AS cnt
        FROM logs
        WHERE tenant_id = :tenant_id AND time >= :since {host_filter}
        GROUP BY severity
        ORDER BY severity
    """
    result = await db.execute(text(sql), params)
    severity_dist = {row.severity: row.cnt for row in result.fetchall()}

    # Volume over time (hourly buckets)
    sql_volume = f"""
        SELECT time_bucket('1 hour', time) AS bucket, COUNT(*) AS cnt
        FROM logs
        WHERE tenant_id = :tenant_id AND time >= :since {host_filter}
        GROUP BY bucket
        ORDER BY bucket
    """
    result = await db.execute(text(sql_volume), params)
    volume = [
        {"time": row.bucket.isoformat(), "count": row.cnt}
        for row in result.fetchall()
    ]

    # Top services
    sql_services = f"""
        SELECT service, COUNT(*) AS cnt
        FROM logs
        WHERE tenant_id = :tenant_id AND time >= :since {host_filter}
          AND service IS NOT NULL
        GROUP BY service
        ORDER BY cnt DESC
        LIMIT 10
    """
    result = await db.execute(text(sql_services), params)
    top_services = [{"service": row.service, "count": row.cnt} for row in result.fetchall()]

    return {
        "severity_distribution": severity_dist,
        "volume": volume,
        "top_services": top_services,
    }


# ==================== Log Sources CRUD ====================

class LogSourceCreate(BaseModel):
    host_id: str           # UUID
    source_type: str       # 'file', 'journald', 'windows_eventlog'
    config: dict = {}
    enabled: bool = True


class LogSourceUpdate(BaseModel):
    config: dict | None = None
    enabled: bool | None = None


@router.get("/sources")
async def list_log_sources(
    host_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """List log sources, optionally filtered by host."""
    tenant_id = user.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant context")

    params: dict = {"tenant_id": tenant_id}
    host_filter = ""
    if host_id is not None:
        host_filter = "AND ls.host_id = :host_id"
        params["host_id"] = host_id

    result = await db.execute(
        text(f"""
            SELECT ls.id, ls.host_id, h.hostname, ls.source_type,
                   ls.config, ls.enabled, ls.created_at, ls.updated_at
            FROM log_sources ls
            LEFT JOIN hosts h ON h.id = ls.host_id
            WHERE ls.tenant_id = :tenant_id {host_filter}
            ORDER BY ls.host_id, ls.source_type
        """),
        params,
    )
    return [dict(row._mapping) for row in result.fetchall()]


@router.post("/sources", status_code=201)
async def create_log_source(
    body: LogSourceCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Create a new log source for a host."""
    tenant_id = user.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant context")

    if body.source_type not in ("file", "journald", "windows_eventlog"):
        raise HTTPException(status_code=400, detail="Invalid source_type")

    import json
    result = await db.execute(
        text("""
            INSERT INTO log_sources (tenant_id, host_id, source_type, config, enabled)
            VALUES (:tenant_id, :host_id, :source_type, :config::jsonb, :enabled)
            RETURNING id, host_id, source_type, config, enabled, created_at
        """),
        {
            "tenant_id": tenant_id,
            "host_id": body.host_id,
            "source_type": body.source_type,
            "config": json.dumps(body.config),
            "enabled": body.enabled,
        },
    )
    await db.commit()
    row = result.fetchone()
    return dict(row._mapping)


@router.patch("/sources/{source_id}")
async def update_log_source(
    source_id: int,
    body: LogSourceUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Update a log source."""
    tenant_id = user.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant context")

    updates = []
    params: dict = {"id": source_id, "tenant_id": tenant_id}

    if body.config is not None:
        import json
        updates.append("config = :config::jsonb")
        params["config"] = json.dumps(body.config)
    if body.enabled is not None:
        updates.append("enabled = :enabled")
        params["enabled"] = body.enabled

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates.append("updated_at = now()")
    set_clause = ", ".join(updates)

    result = await db.execute(
        text(f"""
            UPDATE log_sources SET {set_clause}
            WHERE id = :id AND tenant_id = :tenant_id
            RETURNING id, host_id, source_type, config, enabled, updated_at
        """),
        params,
    )
    await db.commit()
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Log source not found")
    return dict(row._mapping)


@router.delete("/sources/{source_id}", status_code=204)
async def delete_log_source(
    source_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Delete a log source."""
    tenant_id = user.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant context")

    result = await db.execute(
        text("DELETE FROM log_sources WHERE id = :id AND tenant_id = :tenant_id RETURNING id"),
        {"id": source_id, "tenant_id": tenant_id},
    )
    await db.commit()
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Log source not found")
