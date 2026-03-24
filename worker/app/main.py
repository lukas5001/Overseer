"""
Overseer Worker – Processes check results from Redis Stream.

Optimized for high throughput:
- In-memory cache for tenant/host/service lookups (eliminates 3 DB queries per check)
- Batch DB operations per collector message (3 queries per message, not 7 per check)
- Configurable concurrent consumers via WORKER_CONCURRENCY
- Per-message logging instead of per-check
"""
import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone

import redis.asyncio as redis
from sqlalchemy import select, text, Boolean, Column, DateTime, Float, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID, insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Enum as SAEnum
import uuid as uuid_mod

from shared.schemas import SingleCheckResult

# ==================== Config ====================

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://overseer:overseer_dev_password@localhost:5432/overseer")
STREAM_NAME = "overseer:check_results"
DEAD_LETTER_STREAM = "overseer:dead-letters"
GROUP_NAME = "overseer-workers"
CONSUMER_PREFIX = "worker"
BATCH_SIZE = int(os.getenv("WORKER_BATCH_SIZE", "100"))
BLOCK_MS = 5000
MAX_RETRIES = 3
NUM_WORKERS = int(os.getenv("WORKER_CONCURRENCY", "4"))
CACHE_TTL = int(os.getenv("WORKER_CACHE_TTL", "300"))

logger = logging.getLogger("overseer.worker")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

# ==================== DB Setup ====================

engine = create_async_engine(
    DATABASE_URL, echo=False, pool_pre_ping=True,
    pool_size=NUM_WORKERS * 3, max_overflow=NUM_WORKERS * 4,
)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

CheckStatusEnum = SAEnum("OK", "WARNING", "CRITICAL", "UNKNOWN", name="check_status", create_type=False)
StateTypeEnum = SAEnum("SOFT", "HARD", name="state_type", create_type=False)


class Base(DeclarativeBase):
    pass


class CurrentStatus(Base):
    __tablename__ = "current_status"
    service_id = Column(UUID(as_uuid=True), primary_key=True)
    host_id = Column(UUID(as_uuid=True))
    tenant_id = Column(UUID(as_uuid=True))
    status = Column(CheckStatusEnum)
    state_type = Column(StateTypeEnum)
    current_attempt = Column(Integer)
    status_message = Column(Text)
    value = Column(Float)
    unit = Column(String(50))
    last_check_at = Column(DateTime(timezone=True))
    last_state_change_at = Column(DateTime(timezone=True))
    acknowledged = Column(Boolean)
    in_downtime = Column(Boolean)


# ==================== Lookup Cache ====================

class LookupCache:
    """In-memory cache for tenant/host/service resolution.
    Eliminates 3 DB queries per check (tenant, host, service lookups).
    """

    def __init__(self, ttl: int = CACHE_TTL):
        self.ttl = ttl
        self.tenants: dict[str, object] = {}       # slug → uuid
        self.hosts: dict[tuple, object] = {}        # (tenant_uuid, hostname) → uuid
        self.services: dict[tuple, tuple] = {}      # (host_uuid, name) → (service_id, max_attempts)
        self._loaded_at: float = 0
        self._lock = asyncio.Lock()

    @property
    def stale(self) -> bool:
        return time.time() - self._loaded_at > self.ttl

    async def refresh(self):
        async with self._lock:
            if not self.stale and self.tenants:
                return

            async with AsyncSessionLocal() as db:
                result = await db.execute(text("SELECT id, slug FROM tenants WHERE active = true"))
                self.tenants = {row.slug: row.id for row in result}

                result = await db.execute(text("SELECT id, tenant_id, hostname FROM hosts WHERE active = true"))
                self.hosts = {(row.tenant_id, row.hostname): row.id for row in result}

                result = await db.execute(text(
                    "SELECT id, host_id, name, max_check_attempts FROM services WHERE active = true"
                ))
                self.services = {
                    (row.host_id, row.name): (row.id, row.max_check_attempts or 3)
                    for row in result
                }

            self._loaded_at = time.time()
            logger.info("Cache refreshed: %d tenants, %d hosts, %d services",
                        len(self.tenants), len(self.hosts), len(self.services))

    def resolve(self, tenant_slug, hostname, check_name):
        """Resolve → (tenant_id, host_id, service_id, max_attempts) or None."""
        tenant_id = self.tenants.get(tenant_slug)
        if not tenant_id:
            return None
        host_id = self.hosts.get((tenant_id, hostname))
        if not host_id:
            return None
        svc = self.services.get((host_id, check_name))
        if not svc:
            return None
        return tenant_id, host_id, svc[0], svc[1]


# ==================== Worker ====================

class Worker:
    def __init__(self, worker_id: str, cache: LookupCache):
        self.worker_id = worker_id
        self.consumer_name = f"{CONSUMER_PREFIX}-{worker_id}"
        self.redis: redis.Redis | None = None
        self.running = False
        self.cache = cache
        self.checks_total = 0

    async def start(self):
        self.redis = redis.from_url(REDIS_URL, decode_responses=True)
        self.running = True

        try:
            await self.redis.xgroup_create(STREAM_NAME, GROUP_NAME, id="0", mkstream=True)
        except redis.ResponseError as e:
            if "BUSYGROUP" not in str(e):
                raise

        logger.info("Worker %s started (batch mode, cache enabled)", self.consumer_name)

        while self.running:
            try:
                if self.cache.stale:
                    await self.cache.refresh()
                await self._read_and_process()
            except Exception as e:
                logger.error("Worker %s error: %s", self.consumer_name, e, exc_info=True)
                await asyncio.sleep(1)

    async def _read_and_process(self):
        messages = await self.redis.xreadgroup(
            GROUP_NAME, self.consumer_name,
            {STREAM_NAME: ">"}, count=BATCH_SIZE, block=BLOCK_MS,
        )
        if not messages:
            return

        for _, stream_messages in messages:
            for msg_id, msg_data in stream_messages:
                try:
                    count = await self._process_message(msg_data)
                    await self.redis.xack(STREAM_NAME, GROUP_NAME, msg_id)
                    self.checks_total += count
                except Exception as e:
                    logger.error("Failed message %s: %s", msg_id, e, exc_info=True)
                    await self._handle_failed(msg_id, msg_data, str(e))

    async def _process_message(self, msg_data: dict) -> int:
        """Process all checks in one collector message with batch DB ops."""
        data = json.loads(msg_data["data"])
        tenant_slug = data["tenant_slug"]
        checks_raw = data["checks"]
        now = datetime.now(timezone.utc)

        # ── Resolve all checks from cache (0 DB queries) ──
        resolved = []
        for check_json in checks_raw:
            check = SingleCheckResult.model_validate_json(check_json)
            info = self.cache.resolve(tenant_slug, check.host, check.name)
            if info:
                resolved.append((check, *info))  # check, tenant_id, host_id, service_id, max_attempts

        if not resolved:
            return 0

        tenant_id = resolved[0][1]
        service_ids = [r[3] for r in resolved]

        async with AsyncSessionLocal() as db:
            # ── 1 query: load all current statuses ──
            cs_result = await db.execute(
                select(CurrentStatus).where(CurrentStatus.service_id.in_(service_ids))
            )
            current_map = {cs.service_id: cs for cs in cs_result.scalars()}

            # ── Process state logic in-memory ──
            upserts = []
            check_inserts = []
            history_inserts = []
            webhook_events = []

            for check, tid, hid, sid, max_attempts in resolved:
                new_status = check.status.value
                current = current_map.get(sid)

                if current is None:
                    state_type = "HARD" if new_status == "OK" else "SOFT"
                    attempt = 0 if new_status == "OK" else 1
                    state_change_at = now
                    prev_status = None
                    prev_state_type = None
                else:
                    prev_status = current.status
                    prev_state_type = current.state_type

                    if new_status == "OK":
                        state_type = "HARD"
                        attempt = 0
                    elif current.state_type == "HARD" and current.status != "OK":
                        attempt = current.current_attempt + 1
                        state_type = "HARD"
                    else:
                        attempt = current.current_attempt + 1
                        state_type = "HARD" if attempt >= max_attempts else "SOFT"

                    changed = (new_status != prev_status) or (state_type != prev_state_type)
                    state_change_at = now if changed else current.last_state_change_at

                upserts.append({
                    "service_id": sid, "host_id": hid, "tenant_id": tid,
                    "status": new_status, "state_type": state_type,
                    "current_attempt": attempt, "status_message": check.message,
                    "value": check.value, "unit": check.unit,
                    "last_check_at": now, "last_state_change_at": state_change_at,
                })

                check_inserts.append({
                    "time": now, "service_id": sid, "tenant_id": tid,
                    "status": new_status, "value": check.value, "unit": check.unit,
                    "message": check.message,
                    "perfdata": json.dumps(check.perfdata) if check.perfdata else None,
                    "check_duration_ms": check.check_duration_ms,
                })

                if current is None or new_status != prev_status:
                    history_inserts.append({
                        "id": uuid_mod.uuid4(), "service_id": sid, "tenant_id": tid,
                        "previous_status": prev_status, "new_status": new_status,
                        "state_type": state_type, "message": check.message,
                        "created_at": now,
                    })

                # Webhook triggers
                is_new_hard = (
                    state_type == "HARD" and new_status != "OK"
                    and (prev_state_type != "HARD" or prev_status != new_status or prev_status is None)
                )
                is_recovery = (
                    new_status == "OK" and prev_status is not None
                    and prev_status != "OK" and prev_state_type == "HARD"
                )
                if is_new_hard or is_recovery:
                    webhook_events.append({
                        "event": "recovery" if is_recovery else "state_change",
                        "tenant": tenant_slug, "host": check.host, "service": check.name,
                        "status": new_status, "previous_status": prev_status,
                        "state_type": state_type, "message": check.message,
                        "value": check.value, "unit": check.unit,
                        "timestamp": now.isoformat(),
                    })

            # ── Batch UPSERT current_status (1 query) ──
            if upserts:
                stmt = pg_insert(CurrentStatus).values(upserts)
                stmt = stmt.on_conflict_do_update(
                    index_elements=["service_id"],
                    set_={
                        "status": stmt.excluded.status,
                        "state_type": stmt.excluded.state_type,
                        "current_attempt": stmt.excluded.current_attempt,
                        "status_message": stmt.excluded.status_message,
                        "value": stmt.excluded.value,
                        "unit": stmt.excluded.unit,
                        "last_check_at": stmt.excluded.last_check_at,
                        "last_state_change_at": stmt.excluded.last_state_change_at,
                    },
                )
                await db.execute(stmt)

            # ── Batch INSERT check_results (1 query) ──
            if check_inserts:
                await db.execute(
                    text("""INSERT INTO check_results
                            (time, service_id, tenant_id, status, value, unit, message, perfdata, check_duration_ms)
                            VALUES (:time, :service_id, :tenant_id, :status, :value, :unit, :message, :perfdata, :check_duration_ms)"""),
                    check_inserts,
                )

            # ── Batch INSERT state_history (1 query, only if changes) ──
            if history_inserts:
                await db.execute(
                    text("""INSERT INTO state_history
                            (id, service_id, tenant_id, previous_status, new_status, state_type, message, created_at)
                            VALUES (:id, :service_id, :tenant_id, :previous_status, :new_status, :state_type, :message, :created_at)"""),
                    history_inserts,
                )

            await db.commit()

        # Fire webhooks after commit (non-blocking)
        if webhook_events:
            asyncio.create_task(self._fire_webhooks(tenant_id, webhook_events))

        n_changes = len(history_inserts)
        if n_changes > 0:
            logger.info("%s: %d checks, %d state changes", tenant_slug, len(resolved), n_changes)
        else:
            logger.debug("%s: %d checks (no changes)", tenant_slug, len(resolved))

        return len(resolved)

    async def _fire_webhooks(self, tenant_id, events: list[dict]):
        """Fire webhook notifications (best-effort, non-blocking)."""
        try:
            import httpx
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    text("""SELECT config FROM notification_channels
                            WHERE tenant_id = :tid AND active = true AND channel_type = 'webhook'"""),
                    {"tid": tenant_id},
                )
                channels = result.fetchall()
                if not channels:
                    return

            async with httpx.AsyncClient(timeout=5) as client:
                for row in channels:
                    config = row.config if isinstance(row.config, dict) else json.loads(row.config)
                    url = config.get("url")
                    if not url:
                        continue
                    headers = config.get("headers", {})
                    for event in events:
                        try:
                            await client.post(url, json=event, headers=headers)
                        except Exception as e:
                            logger.warning("Webhook to %s failed: %s", url, e)
        except Exception as e:
            logger.warning("Webhook error: %s", e)

    async def _handle_failed(self, msg_id: str, msg_data: dict, error: str):
        try:
            info = await self.redis.xpending_range(STREAM_NAME, GROUP_NAME, msg_id, msg_id, count=1)
            if not info:
                return
            delivery_count = info[0]["times_delivered"]
            if delivery_count >= MAX_RETRIES:
                logger.warning("Message %s failed %d times → dead-letters", msg_id, delivery_count)
                await self.redis.xadd(DEAD_LETTER_STREAM, {
                    "original_id": msg_id, "error": error,
                    "delivery_count": str(delivery_count),
                    "data": msg_data.get("data", ""),
                    "failed_at": datetime.now(timezone.utc).isoformat(),
                })
                await self.redis.xack(STREAM_NAME, GROUP_NAME, msg_id)
        except Exception as e:
            logger.error("Dead-letter handler error: %s", e)

    async def stop(self):
        self.running = False
        if self.redis:
            await self.redis.close()


# ==================== Main ====================

async def check_alert_rules(db_session_factory, redis_client) -> None:
    """
    Runs every 60s under Redis lock (only one worker instance).
    1. Load all enabled alert_rules with their conditions.
    2. For each rule find current_status entries matching conditions.
    3. UPSERT active_alerts — fire notification for new alerts.
    4. Mark resolved alerts where service is now OK.
    """
    import asyncio as _asyncio
    import json as _json

    async with db_session_factory() as db:
        now = datetime.now(timezone.utc)

        # Load enabled rules
        rules_result = await db.execute(text("""
            SELECT id, tenant_id, name, conditions, notification_channels
            FROM alert_rules
            WHERE enabled = TRUE
        """))
        rules = rules_result.fetchall()

        for rule in rules:
            rule_id = rule.id
            tenant_id = rule.tenant_id
            conditions = rule.conditions if isinstance(rule.conditions, dict) else _json.loads(rule.conditions)
            statuses = conditions.get("statuses", ["CRITICAL", "UNKNOWN"])
            min_duration = conditions.get("min_duration_minutes", 5)
            host_tags = conditions.get("host_tags", [])
            service_names = conditions.get("service_names", [])
            channel_ids = rule.notification_channels or []

            # Build dynamic SQL fragments (values are safe — they come from DB conditions)
            tag_filter = ""
            if host_tags:
                safe_tags = [t.replace("'", "''") for t in host_tags]
                tag_list = ", ".join(f"'{t}'" for t in safe_tags)
                tag_filter = f"AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(h.tags) AS tag WHERE tag IN ({tag_list}))"

            svc_filter = ""
            if service_names:
                safe_names = [n.replace("'", "''") for n in service_names]
                svc_filter = f"AND s.name IN ({', '.join(f'{chr(39)}{n}{chr(39)}' for n in safe_names)})"

            status_list = ", ".join(f"'{st}'" for st in statuses)

            matching = await db.execute(text(f"""
                SELECT
                    cs.service_id, cs.status, cs.status_message,
                    s.name AS service_name, h.hostname AS host_name,
                    EXTRACT(EPOCH FROM (NOW() - cs.last_state_change_at)) / 60 AS duration_minutes
                FROM current_status cs
                JOIN services s ON cs.service_id = s.id
                JOIN hosts h ON s.host_id = h.id
                WHERE cs.tenant_id = :tenant_id
                  AND cs.status IN ({status_list})
                  AND cs.state_type = 'HARD'
                  AND cs.acknowledged = FALSE
                  AND cs.in_downtime = FALSE
                  AND cs.last_state_change_at <= NOW() - INTERVAL '{min_duration} minutes'
                  {tag_filter}
                  {svc_filter}
            """), {"tenant_id": tenant_id})
            matching_rows = matching.fetchall()

            for row in matching_rows:
                service_id = row.service_id
                ctx = {
                    "service_name": row.service_name,
                    "host_name": row.host_name,
                    "status": row.status,
                    "duration_minutes": round(row.duration_minutes or 0),
                    "message": row.status_message or "",
                    "tenant_name": str(tenant_id),
                    "alert_rule_name": rule.name,
                    "fired_at": now.isoformat(),
                    "is_test": False,
                }

                # Check if alert already exists
                existing = await db.execute(text("""
                    SELECT id, last_notified_at FROM active_alerts
                    WHERE service_id = :sid AND rule_id = :rid AND resolved_at IS NULL
                """), {"sid": service_id, "rid": rule_id})
                existing_row = existing.fetchone()

                if existing_row is None:
                    # New alert — insert and notify
                    await db.execute(text("""
                        INSERT INTO active_alerts (service_id, rule_id, tenant_id, fired_at, last_notified_at)
                        VALUES (:sid, :rid, :tid, :now, :now)
                        ON CONFLICT (service_id, rule_id) DO NOTHING
                    """), {"sid": service_id, "rid": rule_id, "tid": tenant_id, "now": now})
                    await db.commit()
                    _asyncio.create_task(_fire_alert_notifications(db_session_factory, channel_ids, ctx))
                else:
                    # Re-notify if last notification was more than 1 hour ago
                    last_notified = existing_row.last_notified_at
                    if last_notified and (now - last_notified).total_seconds() > 3600:
                        await db.execute(text("""
                            UPDATE active_alerts SET last_notified_at = :now
                            WHERE service_id = :sid AND rule_id = :rid AND resolved_at IS NULL
                        """), {"sid": service_id, "rid": rule_id, "now": now})
                        await db.commit()
                        _asyncio.create_task(_fire_alert_notifications(db_session_factory, channel_ids, ctx))

            # Load escalation policy for this rule (if any)
            esc_result = await db.execute(text("""
                SELECT steps FROM escalation_policies WHERE rule_id = :rid
            """), {"rid": rule_id})
            esc_row = esc_result.fetchone()
            esc_steps = []
            if esc_row:
                esc_steps = esc_row.steps if isinstance(esc_row.steps, list) else _json.loads(esc_row.steps)
                esc_steps = sorted(esc_steps, key=lambda s: s.get("delay_minutes", 0))

            # Check for resolved alerts (service now OK) and handle escalation
            active_for_rule = await db.execute(text("""
                SELECT aa.id, aa.service_id, aa.fired_at, aa.escalation_step,
                       s.name AS service_name, h.hostname AS host_name,
                       cs.status, cs.status_message
                FROM active_alerts aa
                JOIN services s ON aa.service_id = s.id
                JOIN hosts h ON s.host_id = h.id
                JOIN current_status cs ON cs.service_id = aa.service_id
                WHERE aa.rule_id = :rid AND aa.resolved_at IS NULL
            """), {"rid": rule_id})
            active_rows = active_for_rule.fetchall()

            for ar in active_rows:
                if ar.status == "OK":
                    await db.execute(text("""
                        UPDATE active_alerts SET resolved_at = :now WHERE id = :id
                    """), {"id": ar.id, "now": now})
                    recovery_ctx = {
                        "service_name": ar.service_name,
                        "host_name": ar.host_name,
                        "status": "OK",
                        "duration_minutes": 0,
                        "message": "Service recovered.",
                        "tenant_name": str(tenant_id),
                        "alert_rule_name": rule.name,
                        "fired_at": now.isoformat(),
                        "is_test": False,
                    }
                    await db.commit()
                    _asyncio.create_task(_fire_alert_notifications(db_session_factory, channel_ids, recovery_ctx))
                elif esc_steps:
                    # Escalation: check if we need to advance to next step
                    fired_at = ar.fired_at
                    if fired_at and fired_at.tzinfo is None:
                        fired_at = fired_at.replace(tzinfo=timezone.utc)
                    minutes_since_fired = (now - fired_at).total_seconds() / 60
                    current_step = ar.escalation_step

                    for step_idx, step in enumerate(esc_steps):
                        if step_idx <= current_step:
                            continue
                        delay = step.get("delay_minutes", 0)
                        if minutes_since_fired >= delay:
                            # Advance escalation step
                            esc_channels = step.get("channels", [])
                            esc_ctx = {
                                "service_name": ar.service_name,
                                "host_name": ar.host_name,
                                "status": ar.status,
                                "duration_minutes": round(minutes_since_fired),
                                "message": ar.status_message or "",
                                "tenant_name": str(tenant_id),
                                "alert_rule_name": rule.name,
                                "fired_at": fired_at.isoformat(),
                                "is_test": False,
                                "escalation_step": step_idx,
                            }
                            await db.execute(text("""
                                UPDATE active_alerts SET escalation_step = :step WHERE id = :id
                            """), {"step": step_idx, "id": ar.id})
                            await db.commit()
                            _asyncio.create_task(_fire_alert_notifications(db_session_factory, esc_channels, esc_ctx))


async def _fire_alert_notifications(db_session_factory, channel_ids: list, ctx: dict) -> None:
    """Send notifications to all channels of an alert rule (best-effort)."""
    if not channel_ids:
        return
    import httpx as _httpx
    import smtplib
    import os as _os
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    try:
        async with db_session_factory() as db:
            for channel_id in channel_ids:
                result = await db.execute(text("""
                    SELECT channel_type, config FROM notification_channels
                    WHERE id = :cid AND active = TRUE
                """), {"cid": channel_id})
                row = result.fetchone()
                if not row:
                    continue

                import json as _json
                config = row.config if isinstance(row.config, dict) else _json.loads(row.config)
                channel_type = row.channel_type

                try:
                    if channel_type == "email":
                        email_to = config.get("email") or config.get("to")
                        if not email_to:
                            continue
                        is_recovery = ctx.get("status") == "OK"
                        is_test = ctx.get("is_test", False)
                        prefix = "TEST: " if is_test else ("Recovery: " if is_recovery else "Alert: ")
                        subject = f"[Overseer] {prefix}{ctx['alert_rule_name']}: {ctx['service_name']} is {ctx['status']}"
                        body_plain = (
                            f"Alert Rule: {ctx['alert_rule_name']}\n"
                            f"Service: {ctx['service_name']} on {ctx['host_name']}\n"
                            f"Status: {ctx['status']}\n"
                            f"Duration: {ctx['duration_minutes']} minutes\n"
                            f"Message: {ctx['message']}\n"
                            f"Fired at: {ctx['fired_at']}\n"
                        )
                        smtp_host = _os.getenv("SMTP_HOST", "smtp.ionos.it")
                        smtp_port = int(_os.getenv("SMTP_PORT", "587"))
                        smtp_user = _os.getenv("SMTP_USER", "")
                        smtp_pass = _os.getenv("SMTP_PASSWORD", "")
                        smtp_from = _os.getenv("SMTP_FROM", smtp_user)

                        msg = MIMEText(body_plain, "plain", "utf-8")
                        msg["Subject"] = subject
                        msg["From"] = smtp_from
                        msg["To"] = email_to
                        import asyncio as _asyncio

                        def _send():
                            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as s:
                                s.starttls()
                                s.login(smtp_user, smtp_pass)
                                s.send_message(msg)

                        await _asyncio.to_thread(_send)

                    elif channel_type == "webhook":
                        url = config.get("url")
                        if not url:
                            continue
                        headers = config.get("headers", {})
                        async with _httpx.AsyncClient(timeout=10) as client:
                            await client.post(url, json=ctx, headers=headers)
                except Exception as e:
                    logger.warning("Alert notification to channel %s failed: %s", channel_id, e)
    except Exception as e:
        logger.warning("_fire_alert_notifications error: %s", e)


async def check_recurring_downtimes(db_session_factory) -> None:
    """Generate downtime instances for recurring downtimes for the next 7 days."""
    try:
        from dateutil.rrule import rrulestr
    except ImportError:
        logger.warning("python-dateutil not installed — recurring downtimes disabled")
        return

    async with db_session_factory() as db:
        now = datetime.now(timezone.utc)
        lookahead = now + __import__("datetime").timedelta(days=7)

        templates = (await db.execute(text("""
            SELECT id, tenant_id, host_id, service_id, start_at, end_at, author_id, comment, recurrence
            FROM downtimes
            WHERE recurrence IS NOT NULL AND recurrence != ''
        """))).fetchall()

        for tmpl in templates:
            try:
                rule = rrulestr(tmpl.recurrence, dtstart=tmpl.start_at)
            except Exception as e:
                logger.warning("Invalid RRULE for downtime %s: %s", tmpl.id, e)
                continue

            duration = tmpl.end_at - tmpl.start_at
            occurrences = list(rule.between(now, lookahead, inc=True))

            for occ in occurrences:
                occ_end = occ + duration
                # Check if instance already exists
                existing = (await db.execute(text("""
                    SELECT id FROM downtimes
                    WHERE parent_downtime_id = :parent_id
                      AND start_at = :start_at
                """), {"parent_id": tmpl.id, "start_at": occ})).fetchone()

                if existing:
                    continue

                await db.execute(text("""
                    INSERT INTO downtimes
                        (tenant_id, host_id, service_id, start_at, end_at, author_id, comment, active, parent_downtime_id)
                    VALUES
                        (:tenant_id, :host_id, :service_id, :start_at, :end_at, :author_id, :comment, TRUE, :parent_id)
                """), {
                    "tenant_id": tmpl.tenant_id,
                    "host_id": tmpl.host_id,
                    "service_id": tmpl.service_id,
                    "start_at": occ,
                    "end_at": occ_end,
                    "author_id": tmpl.author_id,
                    "comment": tmpl.comment,
                    "parent_id": tmpl.id,
                })

        await db.commit()


async def recurring_downtime_watcher(db_session_factory, redis_client) -> None:
    """Every 6 hours: generate upcoming recurring downtime instances."""
    await asyncio.sleep(60)
    while True:
        try:
            async with redis_client.lock("overseer:lock:recurring_downtime_watcher", timeout=300, blocking_timeout=1):
                try:
                    await check_recurring_downtimes(db_session_factory)
                except Exception as e:
                    logger.error("check_recurring_downtimes error: %s", e)
        except Exception:
            pass
        await asyncio.sleep(6 * 3600)


async def alert_rules_watcher(db_session_factory, redis_client) -> None:
    """Every 60s: check alert rules and fire notifications under Redis lock."""
    await asyncio.sleep(30)
    while True:
        try:
            async with redis_client.lock("overseer:lock:alert_rules_watcher", timeout=55, blocking_timeout=1):
                try:
                    await check_alert_rules(db_session_factory, redis_client)
                except Exception as e:
                    logger.error("check_alert_rules error: %s", e)
        except Exception:
            pass  # Could not acquire lock – another instance is running
        await asyncio.sleep(60)


async def main():
    import sys
    worker_id = sys.argv[1] if len(sys.argv) > 1 else "0"
    num_workers = int(os.getenv("WORKER_CONCURRENCY", "4"))

    cache = LookupCache()
    await cache.refresh()

    tasks = []

    # Spawn N concurrent worker consumers
    for i in range(num_workers):
        w = Worker(f"{worker_id}-{i}", cache)
        tasks.append(w.start())

    logger.info("Starting %d worker consumers (group=%s)", num_workers, GROUP_NAME)

    # Only the first instance runs the active check scheduler and alert watcher
    scheduler = None
    if worker_id == "0":
        try:
            from worker.app.scheduler import ActiveCheckScheduler
            scheduler = ActiveCheckScheduler(AsyncSessionLocal)
            tasks.append(scheduler.start())
            logger.info("Active Check Scheduler enabled")
        except Exception as e:
            logger.warning("Could not start scheduler: %s", e)

        # Alert rules watcher + recurring downtime watcher
        _redis = redis.from_url(REDIS_URL)
        tasks.append(alert_rules_watcher(AsyncSessionLocal, _redis))
        tasks.append(recurring_downtime_watcher(AsyncSessionLocal, _redis))
        logger.info("Alert Rules Watcher + Recurring Downtime Watcher enabled")

    try:
        await asyncio.gather(*tasks)
    except KeyboardInterrupt:
        if scheduler:
            scheduler.stop()


if __name__ == "__main__":
    asyncio.run(main())
