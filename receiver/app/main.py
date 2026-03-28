"""
Overseer Receiver – Accepts check results from Collectors and log data from Agents.

Responsibilities:
- Validate API key / Agent token → identify tenant (real DB lookup)
- Validate payload schema
- Write check results to Redis Stream
- Bulk-insert log data into TimescaleDB
- Evaluate log alert rules (any_match, threshold, absence)
- Return 202 Accepted immediately
"""
import asyncio
import hashlib
import json
import logging
import os
import re
from datetime import datetime, timezone

import redis.asyncio as redis
import zstandard as zstd
from fastapi import FastAPI, HTTPException, Header, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from shared.schemas import CollectorPayload

# ==================== Config ====================

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://overseer:overseer_dev_password@localhost:5432/overseer")
STREAM_NAME = "overseer:check_results"

# Rate limiting: max requests per key per window
RATE_LIMIT_MAX = int(os.getenv("RATE_LIMIT_MAX", "120"))   # requests
RATE_LIMIT_WINDOW = int(os.getenv("RATE_LIMIT_WINDOW", "60"))  # seconds

# ==================== App ====================

app = FastAPI(title="Overseer Receiver", version="0.1.0")
logger = logging.getLogger("overseer.receiver")
logging.basicConfig(level=logging.INFO)

redis_pool: redis.Redis | None = None
engine = create_async_engine(DATABASE_URL, echo=False, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@app.on_event("startup")
async def startup():
    global redis_pool
    redis_pool = redis.from_url(REDIS_URL, decode_responses=True)
    logger.info("Receiver started, connected to Redis at %s", REDIS_URL)
    # Start absence rule watcher
    asyncio.create_task(_absence_watcher())


@app.on_event("shutdown")
async def shutdown():
    if redis_pool:
        await redis_pool.close()
    await engine.dispose()


# ==================== Rate Limiting ====================

async def check_rate_limit(key_prefix: str) -> None:
    """Sliding-window rate limit via Redis INCR + EXPIRE.

    Uses the key prefix (first 12 chars) as the rate-limit bucket so that
    even if the full key is rotated the prefix-based bucket is consistent.
    Raises HTTP 429 if the limit is exceeded.
    """
    if redis_pool is None:
        return
    bucket = f"ratelimit:{key_prefix}:{int(datetime.now(timezone.utc).timestamp()) // RATE_LIMIT_WINDOW}"
    count = await redis_pool.incr(bucket)
    if count == 1:
        await redis_pool.expire(bucket, RATE_LIMIT_WINDOW * 2)
    if count > RATE_LIMIT_MAX:
        logger.warning("Rate limit exceeded for key prefix %s (%d req/window)", key_prefix, count)
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded: max {RATE_LIMIT_MAX} requests per {RATE_LIMIT_WINDOW}s",
            headers={"Retry-After": str(RATE_LIMIT_WINDOW)},
        )


# ==================== API Key Validation ====================

async def validate_api_key(api_key: str) -> dict:
    """Validate API key via DB lookup. Returns {tenant_slug, tenant_id}."""
    key_hash = hashlib.sha256(api_key.encode()).hexdigest()
    key_prefix = api_key[:12]

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT ak.id, ak.tenant_id, t.slug AS tenant_slug
                FROM api_keys ak
                JOIN tenants t ON t.id = ak.tenant_id
                WHERE ak.key_prefix = :prefix
                  AND ak.key_hash = :hash
                  AND ak.active = true
                  AND t.active = true
            """),
            {"prefix": key_prefix, "hash": key_hash},
        )
        row = result.fetchone()

    if not row:
        raise HTTPException(status_code=401, detail="Invalid API key")

    # Update last_used_at in background (fire and forget, non-blocking)
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE api_keys SET last_used_at = :now WHERE id = :id"),
            {"now": datetime.now(timezone.utc), "id": row.id},
        )
        await db.commit()

    return {"tenant_slug": row.tenant_slug, "tenant_id": str(row.tenant_id), "key_prefix": key_prefix, "source": "api_key"}


# ==================== Agent Token Validation ====================

async def validate_agent_token(agent_token: str) -> dict:
    """Validate agent token via DB lookup. Returns {tenant_slug, tenant_id, host_id}."""
    token_hash = hashlib.sha256(agent_token.encode()).hexdigest()
    token_prefix = agent_token[:16]

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT at.id AS token_id, at.host_id, at.tenant_id, t.slug AS tenant_slug
                FROM agent_tokens at
                JOIN tenants t ON t.id = at.tenant_id
                WHERE at.token_hash = :hash
                  AND at.active = true
                  AND t.active = true
            """),
            {"hash": token_hash},
        )
        row = result.fetchone()

    if not row:
        raise HTTPException(status_code=401, detail="Invalid agent token")

    # Update last_seen_at on agent_tokens
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE agent_tokens SET last_seen_at = :now WHERE id = :id"),
            {"now": datetime.now(timezone.utc), "id": row.token_id},
        )
        await db.commit()

    return {
        "tenant_slug": row.tenant_slug,
        "tenant_id": str(row.tenant_id),
        "key_prefix": token_prefix,
        "source": "agent_token",
        "host_id": str(row.host_id),
    }


# ==================== Endpoints ====================

@app.post("/api/v1/results", status_code=202)
async def receive_check_results(
    request: Request,
    payload: CollectorPayload,
):
    """Receive check results from a Collector or Agent."""
    # Accept either X-API-Key or X-Agent-Token
    api_key = request.headers.get("X-API-Key")
    agent_token = request.headers.get("X-Agent-Token")

    if agent_token:
        await check_rate_limit(agent_token[:16])
        tenant_info = await validate_agent_token(agent_token)
    elif api_key:
        await check_rate_limit(api_key[:12])
        tenant_info = await validate_api_key(api_key)
    else:
        raise HTTPException(status_code=401, detail="Missing X-API-Key or X-Agent-Token header")

    message = {
        "tenant_slug": tenant_info["tenant_slug"],
        "collector_id": payload.collector_id,
        "timestamp": payload.timestamp.isoformat(),
        "checks": [check.model_dump_json() for check in payload.checks],
        "received_at": datetime.now(timezone.utc).isoformat(),
    }

    await redis_pool.xadd(STREAM_NAME, {"data": json.dumps(message)})

    # Update collector last_seen_at only for API key auth (collectors)
    if tenant_info.get("source") == "api_key":
        async with AsyncSessionLocal() as db:
            await db.execute(
                text("UPDATE collectors SET last_seen_at = :now WHERE id = CAST(:cid AS uuid)"),
                {"now": datetime.now(timezone.utc), "cid": payload.collector_id},
            )
            await db.commit()

    logger.info(
        "Received %d checks from %s=%s tenant=%s",
        len(payload.checks),
        "agent" if tenant_info.get("source") == "agent_token" else "collector",
        payload.collector_id,
        tenant_info["tenant_slug"],
    )

    return {"status": "accepted", "checks_received": len(payload.checks)}


@app.get("/health")
async def health():
    """Health check endpoint."""
    try:
        await redis_pool.ping()
        return {"status": "healthy", "redis": "connected"}
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"status": "unhealthy", "redis": str(e)},
        )


# ==================== Log Ingestion ====================

ZSTD_DECOMPRESSOR = zstd.ZstdDecompressor()
LOG_BATCH_MAX = 5000  # max log entries per request


class LogEntry(BaseModel):
    timestamp: datetime
    source: str           # 'file', 'journald', 'windows_eventlog'
    source_path: str | None = None
    service: str | None = None
    severity: int = 6     # syslog level: 0=emergency..7=debug
    message: str
    fields: dict | None = None

    @field_validator("severity")
    @classmethod
    def validate_severity(cls, v: int) -> int:
        if not 0 <= v <= 7:
            raise ValueError("severity must be 0-7 (syslog levels)")
        return v

    @field_validator("source")
    @classmethod
    def validate_source(cls, v: str) -> str:
        if v not in ("file", "journald", "windows_eventlog"):
            raise ValueError("source must be file, journald, or windows_eventlog")
        return v


@app.post("/api/v1/logs/ingest", status_code=200)
async def ingest_logs(request: Request):
    """Receive log entries from Agents. Body is zstd-compressed JSON array or plain JSON."""
    # Auth: agent token only
    agent_token = request.headers.get("X-Agent-Token")
    if not agent_token:
        raise HTTPException(status_code=401, detail="Missing X-Agent-Token header")

    await check_rate_limit(agent_token[:16])
    tenant_info = await validate_agent_token(agent_token)

    # Read body and decompress if needed
    raw_body = await request.body()
    if not raw_body:
        raise HTTPException(status_code=400, detail="Empty request body")

    content_encoding = request.headers.get("Content-Encoding", "")
    if content_encoding == "zstd":
        try:
            body_bytes = ZSTD_DECOMPRESSOR.decompress(raw_body)
        except Exception:
            raise HTTPException(status_code=400, detail="Failed to decompress zstd body")
    else:
        body_bytes = raw_body

    # Parse JSON array
    try:
        entries_raw = json.loads(body_bytes)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    if not isinstance(entries_raw, list):
        raise HTTPException(status_code=400, detail="Expected JSON array")

    if len(entries_raw) > LOG_BATCH_MAX:
        raise HTTPException(status_code=400, detail=f"Max {LOG_BATCH_MAX} entries per batch")

    if not entries_raw:
        return {"status": "ok", "logs_ingested": 0}

    # Validate entries
    entries: list[LogEntry] = []
    for i, raw in enumerate(entries_raw):
        try:
            entries.append(LogEntry(**raw))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid log entry at index {i}: {e}")

    # Bulk insert into TimescaleDB
    tenant_id = tenant_info["tenant_id"]
    host_id = tenant_info["host_id"]  # UUID string

    values_parts = []
    params = {}
    for i, entry in enumerate(entries):
        values_parts.append(
            f"(:time_{i}, :tenant_{i}, :host_{i}, :source_{i}, :spath_{i}, "
            f":service_{i}, :severity_{i}, :message_{i}, :fields_{i})"
        )
        params[f"time_{i}"] = entry.timestamp
        params[f"tenant_{i}"] = tenant_id
        params[f"host_{i}"] = host_id
        params[f"source_{i}"] = entry.source
        params[f"spath_{i}"] = entry.source_path
        params[f"service_{i}"] = entry.service
        params[f"severity_{i}"] = entry.severity
        params[f"message_{i}"] = entry.message
        params[f"fields_{i}"] = json.dumps(entry.fields) if entry.fields else None

    sql = f"""
        INSERT INTO logs (time, tenant_id, host_id, source, source_path,
                          service, severity, message, fields)
        VALUES {', '.join(values_parts)}
    """

    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text(sql), params)
            await db.commit()
    except Exception as e:
        logger.error("Failed to insert logs: %s", e)
        raise HTTPException(status_code=500, detail="Failed to store logs")

    logger.info(
        "Ingested %d logs from agent host_id=%s tenant=%s",
        len(entries), host_id, tenant_info["tenant_slug"],
    )

    # Evaluate log alert rules in background (non-blocking)
    asyncio.create_task(
        evaluate_log_alerts(tenant_id, host_id, entries, tenant_info.get("tenant_slug", ""))
    )

    return {"status": "ok", "logs_ingested": len(entries)}


# ==================== Log Alert Rule Evaluation ====================

# Cache of log alert rules per tenant (refreshed every 60s)
_log_alert_rules_cache: dict[str, tuple[float, list[dict]]] = {}
LOG_RULES_CACHE_TTL = 60  # seconds


async def _get_log_alert_rules(tenant_id: str) -> list[dict]:
    """Get active log alert rules for tenant, with 60s cache."""
    now = datetime.now(timezone.utc).timestamp()
    cached = _log_alert_rules_cache.get(tenant_id)
    if cached and (now - cached[0]) < LOG_RULES_CACHE_TTL:
        return cached[1]

    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                text("""
                    SELECT id, pattern, is_regex, host_ids, services, severity_min,
                           condition_type, threshold_count, time_window_seconds,
                           alert_severity, notification_channels
                    FROM log_alert_rules
                    WHERE tenant_id = :tid AND enabled = true
                """),
                {"tid": tenant_id},
            )
            rules = []
            for row in result.fetchall():
                rule = dict(row._mapping)
                # Pre-compile regex
                if rule["is_regex"]:
                    try:
                        rule["_compiled"] = re.compile(rule["pattern"], re.IGNORECASE)
                    except re.error:
                        continue
                else:
                    rule["_pattern_lower"] = rule["pattern"].lower()
                rules.append(rule)

            _log_alert_rules_cache[tenant_id] = (now, rules)
            return rules
    except Exception as e:
        logger.error("Failed to load log alert rules: %s", e)
        return []


def _matches_rule(rule: dict, entry: LogEntry, host_id: str) -> bool:
    """Check if a log entry matches a rule's scope and pattern."""
    # Check host scope
    if rule["host_ids"] and host_id not in [str(h) for h in rule["host_ids"]]:
        return False

    # Check service scope
    if rule["services"] and (entry.service or "") not in rule["services"]:
        return False

    # Check severity
    if rule["severity_min"] is not None and entry.severity > rule["severity_min"]:
        return False

    # Check pattern
    if rule["is_regex"]:
        compiled = rule.get("_compiled")
        if compiled and compiled.search(entry.message):
            return True
    else:
        if rule["_pattern_lower"] in entry.message.lower():
            return True

    return False


async def _fire_log_alert(rule: dict, tenant_id: str, host_id: str, tenant_slug: str, message: str):
    """Send notification for a log alert rule match."""
    channel_ids = rule.get("notification_channels", [])
    if not channel_ids:
        return

    try:
        # Resolve host name
        hostname = "unknown"
        async with AsyncSessionLocal() as db:
            h_result = await db.execute(
                text("SELECT hostname FROM hosts WHERE id = CAST(:hid AS uuid)"),
                {"hid": host_id},
            )
            h_row = h_result.fetchone()
            if h_row:
                hostname = h_row.hostname

            # Get channels
            channel_rows = []
            for ch_id in channel_ids:
                ch_result = await db.execute(
                    text("""SELECT id, channel_type, config, name
                            FROM notification_channels
                            WHERE id = CAST(:cid AS uuid) AND active = true"""),
                    {"cid": str(ch_id)},
                )
                ch_row = ch_result.fetchone()
                if ch_row:
                    channel_rows.append(dict(ch_row._mapping))

        if not channel_rows:
            return

        from shared.notifications.base import Notification
        from shared.notifications.dispatcher import Dispatcher

        notification = Notification(
            type="alert",
            host_name=hostname,
            host_ip="",
            service_name=f"Log Alert: {rule['pattern'][:80]}",
            status=rule["alert_severity"],
            previous_status="OK",
            message=f"[Log Alert] {rule.get('condition_type', 'any_match').upper()}: {message[:500]}",
            triggered_at=datetime.now(timezone.utc),
            tenant_name=tenant_slug,
            extra_data={
                "log_alert_rule_id": str(rule["id"]),
                "condition_type": rule["condition_type"],
                "pattern": rule["pattern"],
            },
        )

        dispatcher = Dispatcher(AsyncSessionLocal)
        await dispatcher.dispatch(notification, channel_rows, tenant_id)
        logger.info("Log alert fired: rule=%s tenant=%s host=%s", rule["id"], tenant_slug, hostname)

    except Exception as e:
        logger.error("Failed to fire log alert: %s", e)


async def evaluate_log_alerts(tenant_id: str, host_id: str, entries: list[LogEntry], tenant_slug: str):
    """Evaluate log entries against active log alert rules."""
    try:
        rules = await _get_log_alert_rules(tenant_id)
        if not rules:
            return

        for rule in rules:
            rule_id = str(rule["id"])
            condition = rule["condition_type"]

            if condition == "any_match":
                for entry in entries:
                    if _matches_rule(rule, entry, host_id):
                        # Deduplicate: only fire once per rule per 60s
                        dedup_key = f"overseer:log_alert_dedup:{rule_id}:{host_id}"
                        if redis_pool:
                            already = await redis_pool.get(dedup_key)
                            if already:
                                continue
                            await redis_pool.set(dedup_key, "1", ex=60)
                        await _fire_log_alert(rule, tenant_id, host_id, tenant_slug, entry.message)
                        break  # One alert per rule per batch

            elif condition == "threshold":
                # Count matches and add to Redis sliding window
                match_count = sum(1 for e in entries if _matches_rule(rule, e, host_id))
                if match_count == 0:
                    continue

                window_key = f"overseer:log_alert_window:{rule_id}:{host_id}"
                now_ts = datetime.now(timezone.utc).timestamp()
                window_secs = rule["time_window_seconds"]

                if redis_pool:
                    # Add matches to sorted set (score = timestamp)
                    pipe = redis_pool.pipeline()
                    for _ in range(match_count):
                        pipe.zadd(window_key, {f"{now_ts}:{os.urandom(4).hex()}": now_ts})
                    # Remove entries outside the window
                    pipe.zremrangebyscore(window_key, "-inf", now_ts - window_secs)
                    # Count entries in window
                    pipe.zcard(window_key)
                    # Set TTL
                    pipe.expire(window_key, window_secs * 2)
                    results = await pipe.execute()
                    total_in_window = results[-2]  # zcard result

                    if total_in_window >= rule["threshold_count"]:
                        # Deduplicate
                        dedup_key = f"overseer:log_alert_dedup:{rule_id}:{host_id}"
                        already = await redis_pool.get(dedup_key)
                        if not already:
                            await redis_pool.set(dedup_key, "1", ex=window_secs)
                            sample = next((e.message for e in entries if _matches_rule(rule, e, host_id)), "")
                            await _fire_log_alert(
                                rule, tenant_id, host_id, tenant_slug,
                                f"{total_in_window} matches in {window_secs}s (threshold: {rule['threshold_count']}). Sample: {sample[:200]}"
                            )

            elif condition == "absence":
                # Reset absence timer when pattern is seen
                has_match = any(_matches_rule(rule, e, host_id) for e in entries)
                if has_match and redis_pool:
                    absence_key = f"overseer:log_alert_absence:{rule_id}:{host_id}"
                    await redis_pool.set(absence_key, "1", ex=rule["time_window_seconds"])

    except Exception as e:
        logger.error("Error evaluating log alerts: %s", e)


async def _absence_watcher():
    """Background task: checks absence-type log alert rules periodically.

    For each absence rule, we check if the Redis key has expired (meaning
    the expected pattern was NOT seen within the time window).
    """
    await asyncio.sleep(10)  # Wait for startup
    logger.info("Absence log alert watcher started")

    while True:
        try:
            # Load all tenants that have absence rules
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    text("""
                        SELECT DISTINCT r.id, r.tenant_id, r.pattern, r.is_regex,
                               r.host_ids, r.time_window_seconds, r.alert_severity,
                               r.notification_channels, t.slug AS tenant_slug
                        FROM log_alert_rules r
                        JOIN tenants t ON t.id = r.tenant_id
                        WHERE r.enabled = true AND r.condition_type = 'absence'
                    """)
                )
                absence_rules = [dict(row._mapping) for row in result.fetchall()]

            if redis_pool and absence_rules:
                for rule in absence_rules:
                    rule_id = str(rule["id"])
                    host_ids = rule["host_ids"] or []

                    # If no specific hosts, check globally for tenant
                    check_keys = []
                    if host_ids:
                        check_keys = [(str(h), f"overseer:log_alert_absence:{rule_id}:{h}") for h in host_ids]
                    else:
                        # Global absence: use tenant-level key
                        check_keys = [("global", f"overseer:log_alert_absence:{rule_id}:global")]

                    for host_id, absence_key in check_keys:
                        exists = await redis_pool.exists(absence_key)
                        if not exists:
                            # Key expired or never set → absence detected
                            dedup_key = f"overseer:log_alert_dedup:{rule_id}:{host_id}"
                            already = await redis_pool.get(dedup_key)
                            if not already:
                                await redis_pool.set(dedup_key, "1", ex=rule["time_window_seconds"])
                                await _fire_log_alert(
                                    rule,
                                    str(rule["tenant_id"]),
                                    host_id if host_id != "global" else "",
                                    rule.get("tenant_slug", ""),
                                    f"Pattern '{rule['pattern']}' not seen for {rule['time_window_seconds']}s",
                                )

        except Exception as e:
            logger.error("Absence watcher error: %s", e)

        await asyncio.sleep(30)  # Check every 30 seconds
