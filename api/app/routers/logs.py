"""Overseer API – Log Search (TimescaleDB full-text search)."""
import asyncio
import json
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db, AsyncSessionLocal
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


# ==================== Log Stream (SSE) ====================

@router.get("/stream")
async def stream_logs(
    request: Request,
    token: str | None = None,
    host_ids: str | None = None,
    severity_min: int | None = None,
    query: str | None = None,
):
    """Server-Sent Events stream for live log tail. Token via query param (EventSource can't set headers)."""
    import os
    from jose import jwt, JWTError
    secret = os.getenv("SECRET_KEY", "dev_secret_key_change_in_production")
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        user = jwt.decode(token, secret, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    tenant_id = user.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant context")

    host_id_list = host_ids.split(",") if host_ids else None

    async def event_generator():
        last_time = datetime.now(timezone.utc)
        while True:
            if await request.is_disconnected():
                break

            conditions = ["l.tenant_id = :tenant_id", "l.time > :since"]
            params: dict = {"tenant_id": tenant_id, "since": last_time}

            if host_id_list:
                conditions.append("l.host_id = ANY(:host_ids)")
                params["host_ids"] = host_id_list

            if severity_min is not None:
                conditions.append("l.severity <= :severity_min")
                params["severity_min"] = severity_min

            if query:
                conditions.append("l.search_vector @@ websearch_to_tsquery('english', :query)")
                params["query"] = query

            where = " AND ".join(conditions)
            sql = f"""
                SELECT l.time, l.host_id, h.hostname, l.source, l.source_path,
                       l.service, l.severity, l.message, l.fields
                FROM logs l
                LEFT JOIN hosts h ON h.id = l.host_id
                WHERE {where}
                ORDER BY l.time ASC
                LIMIT 100
            """

            try:
                async with AsyncSessionLocal() as db:
                    result = await db.execute(text(sql), params)
                    rows = result.fetchall()

                if rows:
                    last_time = rows[-1].time
                    logs = [
                        {
                            "time": row.time.isoformat(),
                            "host_id": str(row.host_id),
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
                    yield f"data: {json.dumps(logs)}\n\n"
            except Exception:
                pass

            await asyncio.sleep(2)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


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


# ==================== Log Alert Rules CRUD ====================

class LogAlertRuleCreate(BaseModel):
    name: str
    pattern: str
    is_regex: bool = False
    host_ids: list[str] = []
    services: list[str] = []
    severity_min: int | None = None
    condition_type: str = "any_match"
    threshold_count: int = 1
    time_window_seconds: int = 300
    alert_severity: str = "CRITICAL"
    notification_channels: list[str] = []
    enabled: bool = True


class LogAlertRuleUpdate(BaseModel):
    name: str | None = None
    pattern: str | None = None
    is_regex: bool | None = None
    host_ids: list[str] | None = None
    services: list[str] | None = None
    severity_min: int | None = None
    condition_type: str | None = None
    threshold_count: int | None = None
    time_window_seconds: int | None = None
    alert_severity: str | None = None
    notification_channels: list[str] | None = None
    enabled: bool | None = None


@router.get("/alert-rules")
async def list_log_alert_rules(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """List all log alert rules for the tenant."""
    tenant_id = user.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant context")

    result = await db.execute(
        text("""
            SELECT id, tenant_id, name, enabled, pattern, is_regex,
                   host_ids, services, severity_min, condition_type,
                   threshold_count, time_window_seconds, alert_severity,
                   notification_channels, created_at, updated_at
            FROM log_alert_rules
            WHERE tenant_id = :tenant_id
            ORDER BY name
        """),
        {"tenant_id": tenant_id},
    )
    return [dict(row._mapping) for row in result.fetchall()]


@router.post("/alert-rules", status_code=201)
async def create_log_alert_rule(
    body: LogAlertRuleCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Create a new log alert rule."""
    tenant_id = user.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant context")

    if body.condition_type not in ("any_match", "threshold", "absence"):
        raise HTTPException(status_code=400, detail="Invalid condition_type")
    if body.alert_severity not in ("WARNING", "CRITICAL"):
        raise HTTPException(status_code=400, detail="alert_severity must be WARNING or CRITICAL")

    # Validate regex if is_regex
    if body.is_regex:
        import re
        try:
            re.compile(body.pattern)
        except re.error as e:
            raise HTTPException(status_code=400, detail=f"Invalid regex: {e}")

    result = await db.execute(
        text("""
            INSERT INTO log_alert_rules
                (tenant_id, name, pattern, is_regex, host_ids, services, severity_min,
                 condition_type, threshold_count, time_window_seconds, alert_severity,
                 notification_channels, enabled)
            VALUES
                (:tenant_id, :name, :pattern, :is_regex, :host_ids, :services, :severity_min,
                 :condition_type, :threshold_count, :time_window_seconds, :alert_severity,
                 :notification_channels, :enabled)
            RETURNING id, tenant_id, name, enabled, pattern, is_regex,
                      host_ids, services, severity_min, condition_type,
                      threshold_count, time_window_seconds, alert_severity,
                      notification_channels, created_at, updated_at
        """),
        {
            "tenant_id": tenant_id,
            "name": body.name,
            "pattern": body.pattern,
            "is_regex": body.is_regex,
            "host_ids": body.host_ids or [],
            "services": body.services or [],
            "severity_min": body.severity_min,
            "condition_type": body.condition_type,
            "threshold_count": body.threshold_count,
            "time_window_seconds": body.time_window_seconds,
            "alert_severity": body.alert_severity,
            "notification_channels": body.notification_channels or [],
            "enabled": body.enabled,
        },
    )
    await db.commit()
    return dict(result.fetchone()._mapping)


@router.patch("/alert-rules/{rule_id}")
async def update_log_alert_rule(
    rule_id: str,
    body: LogAlertRuleUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Update a log alert rule."""
    tenant_id = user.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant context")

    updates = []
    params: dict = {"id": rule_id, "tenant_id": tenant_id}

    if body.name is not None:
        updates.append("name = :name")
        params["name"] = body.name
    if body.pattern is not None:
        updates.append("pattern = :pattern")
        params["pattern"] = body.pattern
    if body.is_regex is not None:
        updates.append("is_regex = :is_regex")
        params["is_regex"] = body.is_regex
        if body.is_regex and body.pattern:
            import re
            try:
                re.compile(body.pattern)
            except re.error as e:
                raise HTTPException(status_code=400, detail=f"Invalid regex: {e}")
    if body.host_ids is not None:
        updates.append("host_ids = :host_ids")
        params["host_ids"] = body.host_ids
    if body.services is not None:
        updates.append("services = :services")
        params["services"] = body.services
    if body.severity_min is not None:
        updates.append("severity_min = :severity_min")
        params["severity_min"] = body.severity_min
    if body.condition_type is not None:
        if body.condition_type not in ("any_match", "threshold", "absence"):
            raise HTTPException(status_code=400, detail="Invalid condition_type")
        updates.append("condition_type = :condition_type")
        params["condition_type"] = body.condition_type
    if body.threshold_count is not None:
        updates.append("threshold_count = :threshold_count")
        params["threshold_count"] = body.threshold_count
    if body.time_window_seconds is not None:
        updates.append("time_window_seconds = :time_window_seconds")
        params["time_window_seconds"] = body.time_window_seconds
    if body.alert_severity is not None:
        if body.alert_severity not in ("WARNING", "CRITICAL"):
            raise HTTPException(status_code=400, detail="alert_severity must be WARNING or CRITICAL")
        updates.append("alert_severity = :alert_severity")
        params["alert_severity"] = body.alert_severity
    if body.notification_channels is not None:
        updates.append("notification_channels = :notification_channels")
        params["notification_channels"] = body.notification_channels
    if body.enabled is not None:
        updates.append("enabled = :enabled")
        params["enabled"] = body.enabled

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates.append("updated_at = now()")
    set_clause = ", ".join(updates)

    result = await db.execute(
        text(f"""
            UPDATE log_alert_rules SET {set_clause}
            WHERE id = CAST(:id AS uuid) AND tenant_id = :tenant_id
            RETURNING id, tenant_id, name, enabled, pattern, is_regex,
                      host_ids, services, severity_min, condition_type,
                      threshold_count, time_window_seconds, alert_severity,
                      notification_channels, created_at, updated_at
        """),
        params,
    )
    await db.commit()
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Log alert rule not found")
    return dict(row._mapping)


@router.delete("/alert-rules/{rule_id}", status_code=204)
async def delete_log_alert_rule(
    rule_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Delete a log alert rule."""
    tenant_id = user.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant context")

    result = await db.execute(
        text("DELETE FROM log_alert_rules WHERE id = CAST(:id AS uuid) AND tenant_id = :tenant_id RETURNING id"),
        {"id": rule_id, "tenant_id": tenant_id},
    )
    await db.commit()
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Log alert rule not found")
