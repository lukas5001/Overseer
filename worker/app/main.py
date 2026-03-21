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
        """Process a single check result.
        
        TODO: Full implementation with DB queries:
        1. Resolve tenant_slug → tenant_id
        2. Resolve host (hostname + tenant_id) → host_id
        3. Resolve service (host_id + check.name) → service_id + thresholds
        4. Evaluate status based on thresholds (or use status from collector)
        5. Manage soft/hard state transition
        6. Write to current_status, check_results, and state_history
        """
        logger.info(
            "CHECK tenant=%s host=%s check=%s status=%s value=%s%s msg=%s",
            tenant_slug,
            check.host,
            check.name,
            check.status.value,
            check.value,
            check.unit or "",
            check.message or "",
        )

        # TODO: Replace with actual DB operations
        # This is where the core logic lives:
        #
        # current = await db.get_current_status(service_id)
        # if check.status != CheckStatus.OK:
        #     if current.state_type == StateType.SOFT:
        #         current.current_attempt += 1
        #         if current.current_attempt >= service.max_check_attempts:
        #             current.state_type = StateType.HARD
        #             # → appears in error overview
        #     elif current.state_type == StateType.HARD:
        #         pass  # already hard, update timestamp
        # else:
        #     current.state_type = StateType.HARD  # OK is always hard
        #     current.current_attempt = 0
        #
        # await db.upsert_current_status(current)
        # await db.insert_check_result(...)
        # if state_changed:
        #     await db.insert_state_history(...)

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
