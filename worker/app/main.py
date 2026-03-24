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

    # Only the first instance runs the active check scheduler
    scheduler = None
    if worker_id == "0":
        try:
            from worker.app.scheduler import ActiveCheckScheduler
            scheduler = ActiveCheckScheduler(AsyncSessionLocal)
            tasks.append(scheduler.start())
            logger.info("Active Check Scheduler enabled")
        except Exception as e:
            logger.warning("Could not start scheduler: %s", e)

    try:
        await asyncio.gather(*tasks)
    except KeyboardInterrupt:
        if scheduler:
            scheduler.stop()


if __name__ == "__main__":
    asyncio.run(main())
