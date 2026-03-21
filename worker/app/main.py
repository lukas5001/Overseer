"""
Overseer Worker – Processes check results from Redis Stream.

Responsibilities:
- Read check results from Redis Stream (consumer group)
- Resolve host/service IDs from tenant + hostname + check name
- Evaluate thresholds → determine status
- Manage soft/hard state transitions
- Write current_status + check_results + state_history to PostgreSQL
"""
import asyncio
import json
import logging
import os
from datetime import datetime, timezone

import redis.asyncio as redis
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Integer,
    String, Text, UniqueConstraint, Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB, INET
import uuid as uuid_mod

from shared.schemas import CheckStatus, SingleCheckResult

# ==================== Config ====================

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://overseer:overseer_dev_password@localhost:5432/overseer")
STREAM_NAME = "overseer:check_results"
GROUP_NAME = "overseer-workers"
CONSUMER_PREFIX = "worker"
BATCH_SIZE = 50
BLOCK_MS = 5000  # Wait up to 5s for new messages

logger = logging.getLogger("overseer.worker")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

# ==================== Inline DB models (worker is standalone) ====================

engine = create_async_engine(DATABASE_URL, echo=False, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

CheckStatusEnum = SAEnum("OK", "WARNING", "CRITICAL", "UNKNOWN", name="check_status", create_type=False)
StateTypeEnum = SAEnum("SOFT", "HARD", name="state_type", create_type=False)
HostTypeEnum = SAEnum("server", "switch", "router", "printer", "firewall", "access_point", "other", name="host_type", create_type=False)


class Base(DeclarativeBase):
    pass


class Tenant(Base):
    __tablename__ = "tenants"
    id = Column(UUID(as_uuid=True), primary_key=True)
    slug = Column(String(100))


class Host(Base):
    __tablename__ = "hosts"
    id = Column(UUID(as_uuid=True), primary_key=True)
    tenant_id = Column(UUID(as_uuid=True))
    hostname = Column(String(255))


class Service(Base):
    __tablename__ = "services"
    id = Column(UUID(as_uuid=True), primary_key=True)
    host_id = Column(UUID(as_uuid=True))
    tenant_id = Column(UUID(as_uuid=True))
    name = Column(String(255))
    check_type = Column(String(100))
    max_check_attempts = Column(Integer)
    threshold_warn = Column(Float)
    threshold_crit = Column(Float)


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


# ==================== Worker ====================

class Worker:
    def __init__(self, worker_id: str):
        self.worker_id = worker_id
        self.consumer_name = f"{CONSUMER_PREFIX}-{worker_id}"
        self.redis: redis.Redis | None = None
        self.running = False

    async def start(self):
        """Initialize connections and start processing."""
        self.redis = redis.from_url(REDIS_URL, decode_responses=True)
        self.running = True

        # Ensure consumer group exists
        try:
            await self.redis.xgroup_create(STREAM_NAME, GROUP_NAME, id="0", mkstream=True)
            logger.info("Created consumer group %s", GROUP_NAME)
        except redis.ResponseError as e:
            if "BUSYGROUP" not in str(e):
                raise
            # Group already exists, that's fine

        logger.info("Worker %s started, listening on stream %s", self.consumer_name, STREAM_NAME)

        while self.running:
            try:
                await self._process_batch()
            except Exception as e:
                logger.error("Error processing batch: %s", e, exc_info=True)
                await asyncio.sleep(1)

    async def _process_batch(self):
        """Read and process a batch of messages from the stream."""
        messages = await self.redis.xreadgroup(
            GROUP_NAME,
            self.consumer_name,
            {STREAM_NAME: ">"},
            count=BATCH_SIZE,
            block=BLOCK_MS,
        )

        if not messages:
            return

        for stream_name, stream_messages in messages:
            for msg_id, msg_data in stream_messages:
                try:
                    await self._process_message(msg_data)
                    await self.redis.xack(STREAM_NAME, GROUP_NAME, msg_id)
                except Exception as e:
                    logger.error("Failed to process message %s: %s", msg_id, e, exc_info=True)

    async def _process_message(self, msg_data: dict):
        """Process a single message from the stream."""
        data = json.loads(msg_data["data"])
        tenant_slug = data["tenant_slug"]
        collector_id = data["collector_id"]
        checks_raw = data["checks"]

        for check_json in checks_raw:
            check = SingleCheckResult.model_validate_json(check_json)
            await self._process_check(tenant_slug, collector_id, check)

    async def _process_check(self, tenant_slug: str, collector_id: str, check: SingleCheckResult):
        """Process a single check result with full soft/hard state logic."""
        now = datetime.now(timezone.utc)

        async with AsyncSessionLocal() as db:
            # 1. Resolve tenant_slug → tenant_id
            t_result = await db.execute(
                select(Tenant).where(Tenant.slug == tenant_slug)
            )
            tenant = t_result.scalar_one_or_none()
            if not tenant:
                logger.warning("Unknown tenant slug: %s", tenant_slug)
                return
            tenant_id = tenant.id

            # 2. Resolve host (hostname + tenant_id) → host_id
            h_result = await db.execute(
                select(Host).where(Host.tenant_id == tenant_id, Host.hostname == check.host)
            )
            host = h_result.scalar_one_or_none()
            if not host:
                logger.warning("Unknown host: %s for tenant %s", check.host, tenant_slug)
                return
            host_id = host.id

            # 3. Resolve service (host_id + check.name) → service + thresholds
            s_result = await db.execute(
                select(Service).where(Service.host_id == host_id, Service.name == check.name)
            )
            service = s_result.scalar_one_or_none()
            if not service:
                logger.warning("Unknown service: %s on host %s", check.name, check.host)
                return
            service_id = service.id
            max_attempts = service.max_check_attempts or 3

            # 4. Get current status
            cs_result = await db.execute(
                select(CurrentStatus).where(CurrentStatus.service_id == service_id)
            )
            current = cs_result.scalar_one_or_none()

            new_status = check.status.value  # "OK", "WARNING", etc.

            if current is None:
                # First time seeing this service
                state_type = "HARD" if new_status == "OK" else "SOFT"
                current_attempt = 0 if new_status == "OK" else 1

                await db.execute(
                    text("""
                        INSERT INTO current_status
                            (service_id, host_id, tenant_id, status, state_type,
                             current_attempt, status_message, value, unit,
                             last_check_at, last_state_change_at, acknowledged, in_downtime)
                        VALUES
                            (:service_id, :host_id, :tenant_id, :status, :state_type,
                             :current_attempt, :status_message, :value, :unit,
                             :last_check_at, :last_state_change_at, false, false)
                    """),
                    {
                        "service_id": service_id,
                        "host_id": host_id,
                        "tenant_id": tenant_id,
                        "status": new_status,
                        "state_type": state_type,
                        "current_attempt": current_attempt,
                        "status_message": check.message,
                        "value": check.value,
                        "unit": check.unit,
                        "last_check_at": now,
                        "last_state_change_at": now,
                    },
                )
                previous_status = None
                previous_state_type = None
                new_state_type = state_type

            else:
                previous_status = current.status
                previous_state_type = current.state_type

                # 5. Soft/Hard state transition logic
                if new_status == "OK":
                    # OK is always hard state, reset counter
                    new_state_type = "HARD"
                    new_attempt = 0
                else:
                    # Non-OK: increment attempt counter
                    if current.state_type == "HARD" and current.status != "OK":
                        # Already in hard non-OK state, keep counting
                        new_attempt = current.current_attempt + 1
                        new_state_type = "HARD"
                    else:
                        new_attempt = current.current_attempt + 1
                        # Transition to hard state after max_attempts
                        new_state_type = "HARD" if new_attempt >= max_attempts else "SOFT"

                state_changed = (new_status != previous_status) or (new_state_type != previous_state_type)
                state_change_at = now if state_changed else current.last_state_change_at

                await db.execute(
                    text("""
                        UPDATE current_status
                        SET status = :status,
                            state_type = :state_type,
                            current_attempt = :current_attempt,
                            status_message = :status_message,
                            value = :value,
                            unit = :unit,
                            last_check_at = :last_check_at,
                            last_state_change_at = :last_state_change_at
                        WHERE service_id = :service_id
                    """),
                    {
                        "service_id": service_id,
                        "status": new_status,
                        "state_type": new_state_type,
                        "current_attempt": new_attempt,
                        "status_message": check.message,
                        "value": check.value,
                        "unit": check.unit,
                        "last_check_at": now,
                        "last_state_change_at": state_change_at,
                    },
                )

            # 6. Insert into check_results timeseries
            await db.execute(
                text("""
                    INSERT INTO check_results
                        (time, service_id, tenant_id, status, value, unit,
                         message, perfdata, check_duration_ms)
                    VALUES
                        (:time, :service_id, :tenant_id, :status, :value, :unit,
                         :message, :perfdata, :check_duration_ms)
                """),
                {
                    "time": now,
                    "service_id": service_id,
                    "tenant_id": tenant_id,
                    "status": new_status,
                    "value": check.value,
                    "unit": check.unit,
                    "message": check.message,
                    "perfdata": json.dumps(check.perfdata) if check.perfdata else None,
                    "check_duration_ms": check.check_duration_ms,
                },
            )

            # 7. Insert state_history if status or state type changed
            if current is None or new_status != previous_status:
                await db.execute(
                    text("""
                        INSERT INTO state_history
                            (id, service_id, tenant_id, previous_status,
                             new_status, state_type, message, created_at)
                        VALUES
                            (:id, :service_id, :tenant_id, :previous_status,
                             :new_status, :state_type, :message, :created_at)
                    """),
                    {
                        "id": str(uuid_mod.uuid4()),
                        "service_id": service_id,
                        "tenant_id": tenant_id,
                        "previous_status": previous_status,
                        "new_status": new_status,
                        "state_type": new_state_type if current is None else (
                            new_state_type if "new_state_type" in dir() else "SOFT"
                        ),
                        "message": check.message,
                        "created_at": now,
                    },
                )

            await db.commit()

        logger.info(
            "CHECK ✓ tenant=%s host=%s check=%s status=%s value=%s%s",
            tenant_slug, check.host, check.name, new_status,
            check.value or "", check.unit or "",
        )

    async def stop(self):
        self.running = False
        if self.redis:
            await self.redis.close()
        logger.info("Worker %s stopped", self.consumer_name)


async def main():
    import sys
    worker_id = sys.argv[1] if len(sys.argv) > 1 else "0"
    worker = Worker(worker_id)

    try:
        await worker.start()
    except KeyboardInterrupt:
        await worker.stop()


if __name__ == "__main__":
    asyncio.run(main())
