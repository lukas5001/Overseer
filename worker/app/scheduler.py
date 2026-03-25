"""
Active Check Scheduler – Runs server-side checks at configured intervals.

Runs as a background task alongside the main worker loop.
Queries services with check_mode='active', executes checks, and writes
results through the same pipeline as passive checks.
"""
import asyncio
import json
import logging
import time
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from shared.checker import run_check
from shared.check_policies import apply_global_policies, LOAD_POLICIES_SQL
from shared.encryption import decrypt_field
from shared.status import compute_new_state, inject_host_credentials

logger = logging.getLogger("overseer.scheduler")

# How often to scan for due checks (seconds)
SCAN_INTERVAL = 10


class ActiveCheckScheduler:
    def __init__(self, session_factory: async_sessionmaker):
        self.session_factory = session_factory
        self.running = False
        # Track last check time per service_id to respect intervals
        self._last_run: dict[str, float] = {}
        # Track last check status per service_id for retry interval logic
        self._last_status: dict[str, str] = {}

    async def start(self):
        """Main scheduler loop."""
        self.running = True
        logger.info("Active Check Scheduler started (scan every %ds)", SCAN_INTERVAL)

        while self.running:
            try:
                await self._scan_and_run()
            except Exception as e:
                logger.error("Scheduler error: %s", e, exc_info=True)
            await asyncio.sleep(SCAN_INTERVAL)

    async def _scan_and_run(self):
        """Find active checks that are due and execute them."""
        async with self.session_factory() as db:
            # Get all active checks with their host IP
            result = await db.execute(text("""
                SELECT s.id, s.name, s.check_type, s.check_config,
                       s.interval_seconds, s.max_check_attempts,
                       s.retry_interval_seconds,
                       s.host_id, s.tenant_id,
                       h.ip_address, h.hostname,
                       h.snmp_community, h.snmp_version
                FROM services s
                JOIN hosts h ON h.id = s.host_id
                JOIN tenants t ON t.id = s.tenant_id
                WHERE s.check_mode = 'active'
                  AND s.active = true
                  AND h.active = true
                  AND t.active = true
                  AND h.ip_address IS NOT NULL
            """))
            services = result.fetchall()

            # Load global check policies once per scan cycle
            policy_result = await db.execute(text(LOAD_POLICIES_SQL))
            policies = [dict(row._mapping) for row in policy_result.fetchall()]

        now = time.time()
        tasks = []
        for svc in services:
            sid = str(svc.id)
            interval = svc.interval_seconds or 60

            # Use shorter retry interval when last check was non-OK
            last_status = self._last_status.get(sid)
            if last_status and last_status != "OK":
                retry = svc.retry_interval_seconds or 15
                if retry < interval:
                    interval = retry

            last = self._last_run.get(sid, 0)

            if now - last >= interval:
                self._last_run[sid] = now
                tasks.append(self._execute_check(svc, policies))

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _execute_check(self, svc, policies: list[dict] | None = None):
        """Run a single active check and write results to DB."""
        ip = str(svc.ip_address)
        config = svc.check_config if isinstance(svc.check_config, dict) else json.loads(svc.check_config or "{}")
        config = dict(config)  # copy to avoid mutating cached data

        # Apply global check policies
        if policies:
            config = apply_global_policies(svc.check_type, config, str(svc.tenant_id), policies)

        # Inject host-level credentials (SNMP) then decrypt
        inject_host_credentials(svc.check_type, config, svc)
        if "community" in config and config["community"]:
            config["community"] = decrypt_field(config["community"])

        # Run the check in a thread (blocking I/O)
        check_result = await asyncio.to_thread(
            run_check, svc.check_type, ip, config
        )

        now = datetime.now(timezone.utc)
        new_status = check_result["status"]
        max_attempts = svc.max_check_attempts or 3

        # Track status for retry interval logic
        self._last_status[str(svc.id)] = new_status

        async with self.session_factory() as db:
            # Get current status
            cs_result = await db.execute(text(
                "SELECT status, state_type, current_attempt, last_state_change_at "
                "FROM current_status WHERE service_id = :sid FOR UPDATE"
            ), {"sid": svc.id})
            current = cs_result.fetchone()

            if current is None:
                sr = compute_new_state(new_status, None, None, 0, max_attempts)
                await db.execute(text("""
                    INSERT INTO current_status
                        (service_id, host_id, tenant_id, status, state_type,
                         current_attempt, status_message, value, unit,
                         last_check_at, last_state_change_at, acknowledged, in_downtime)
                    VALUES (:sid, :hid, :tid, :status, :state_type,
                            :attempt, :msg, :val, :unit, :now, :now, false, false)
                """), {
                    "sid": svc.id, "hid": svc.host_id, "tid": svc.tenant_id,
                    "status": new_status, "state_type": sr.state_type, "attempt": sr.attempt,
                    "msg": check_result["message"], "val": check_result["value"],
                    "unit": check_result["unit"], "now": now,
                })
            else:
                prev_status = current.status
                sr = compute_new_state(
                    new_status, current.status, current.state_type,
                    current.current_attempt, max_attempts,
                )
                state_change_at = now if sr.state_changed else current.last_state_change_at

                await db.execute(text("""
                    UPDATE current_status
                    SET status = :status, state_type = :state_type,
                        current_attempt = :attempt, status_message = :msg,
                        value = :val, unit = :unit, last_check_at = :now,
                        last_state_change_at = :sca
                    WHERE service_id = :sid
                """), {
                    "sid": svc.id, "status": new_status, "state_type": sr.state_type,
                    "attempt": sr.attempt, "msg": check_result["message"],
                    "val": check_result["value"], "unit": check_result["unit"],
                    "now": now, "sca": state_change_at,
                })

                # State history on status change
                if new_status != prev_status:
                    import uuid as uuid_mod
                    await db.execute(text("""
                        INSERT INTO state_history
                            (id, service_id, tenant_id, previous_status,
                             new_status, state_type, message, created_at)
                        VALUES (:id, :sid, :tid, :prev, :new, :st, :msg, :now)
                    """), {
                        "id": str(uuid_mod.uuid4()), "sid": svc.id, "tid": svc.tenant_id,
                        "prev": prev_status, "new": new_status,
                        "st": sr.state_type, "msg": check_result["message"], "now": now,
                    })

            # Insert check_results timeseries
            await db.execute(text("""
                INSERT INTO check_results
                    (time, service_id, tenant_id, status, value, unit, message, check_duration_ms)
                VALUES (:time, :sid, :tid, :status, :val, :unit, :msg, :dur)
            """), {
                "time": now, "sid": svc.id, "tid": svc.tenant_id,
                "status": new_status, "val": check_result["value"],
                "unit": check_result["unit"], "msg": check_result["message"],
                "dur": check_result["check_duration_ms"],
            })

            await db.commit()

        logger.info(
            "ACTIVE ✓ host=%s check=%s status=%s value=%s%s (%dms)",
            svc.hostname, svc.name, new_status,
            check_result["value"] or "–", check_result["unit"] or "",
            check_result["check_duration_ms"],
        )

    def stop(self):
        self.running = False
