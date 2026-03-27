"""Alert Grouper – bundles alerts with matching properties into grouped notifications.

Sits BETWEEN alert detection (worker) and notification dispatch (dispatcher).
Uses Redis for group state and timers to survive restarts.

Flow:
  Alert comes in → compute group_key → group exists?
    NO  → create group, start group_wait timer
    YES → add to group, check group_interval

Redis keys:
  overseer:alert_group:{tenant_id}:{group_key}  → HASH with group state
  overseer:alert_group_timer:{tenant_id}:{group_key} → SET with TTL (group_wait timer)
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import redis.asyncio as redis

from shared.notifications.base import Notification
from shared.notifications.dispatcher import Dispatcher

logger = logging.getLogger("overseer.notifications.grouper")

# Default grouping settings
DEFAULT_GROUPING = {
    "enabled": True,
    "group_by": "host",
    "group_wait_seconds": 30,
    "group_interval_seconds": 300,
    "repeat_interval_seconds": 14400,
}

GROUP_KEY_PREFIX = "overseer:alert_group"
TIMER_KEY_PREFIX = "overseer:alert_group_timer"
LOCK_PREFIX = "overseer:alert_group_lock"


def compute_group_key(event: dict, group_by: str) -> str:
    """Compute group key based on grouping strategy."""
    host = event.get("host", "unknown")
    if group_by == "host":
        return f"host:{host}"
    elif group_by == "host_severity":
        status = event.get("status", "UNKNOWN")
        return f"host:{host}:{status}"
    elif group_by == "service_template":
        service = event.get("service", "unknown")
        # Group by check type across all hosts
        return f"svc:{service}"
    return f"host:{host}"


class AlertGrouper:
    """Manages alert grouping with Redis-backed state and timers.

    Usage:
        grouper = AlertGrouper(redis_client, db_session_factory)
        await grouper.handle_event(tenant_id, event, tenant_settings)
        # Grouper will call dispatcher when appropriate (after group_wait, etc.)
    """

    def __init__(
        self,
        redis_client: redis.Redis,
        db_session_factory,
    ):
        self.redis = redis_client
        self.db_session_factory = db_session_factory
        self._flush_tasks: dict[str, asyncio.Task] = {}

    async def handle_events(
        self,
        tenant_id: UUID,
        events: list[dict],
        tenant_settings: dict | None = None,
    ) -> None:
        """Process a batch of alert/recovery events through the grouper."""
        settings = {**DEFAULT_GROUPING, **(tenant_settings or {}).get("alert_grouping", {})}

        if not settings.get("enabled", True):
            # Grouping disabled — send immediately via dispatcher
            await self._dispatch_ungrouped(tenant_id, events)
            return

        group_by = settings.get("group_by", "host")
        group_wait = int(settings.get("group_wait_seconds", 30))
        group_interval = int(settings.get("group_interval_seconds", 300))

        for event in events:
            is_recovery = event.get("event") == "recovery"
            group_key = compute_group_key(event, group_by)
            redis_key = f"{GROUP_KEY_PREFIX}:{tenant_id}:{group_key}"
            lock_key = f"{LOCK_PREFIX}:{tenant_id}:{group_key}"
            timer_key = f"{TIMER_KEY_PREFIX}:{tenant_id}:{group_key}"

            # Use Redis lock to prevent race conditions (two alerts same group)
            lock = self.redis.lock(lock_key, timeout=5, blocking_timeout=2)
            try:
                await lock.acquire()

                group_data = await self.redis.hgetall(redis_key)
                now_ts = time.time()

                if is_recovery:
                    await self._handle_recovery(
                        tenant_id, event, group_key, redis_key, group_data, settings
                    )
                elif not group_data:
                    # New group — create and start group_wait timer
                    alert_entry = self._event_to_alert(event)
                    new_group = {
                        "tenant_id": str(tenant_id),
                        "group_key": group_key,
                        "group_by": group_by,
                        "alerts": json.dumps([alert_entry]),
                        "alert_count": "1",
                        "status": "pending",
                        "created_at": str(now_ts),
                        "first_alert_at": str(now_ts),
                        "last_alert_at": str(now_ts),
                        "last_notified_at": "0",
                    }
                    await self.redis.hset(redis_key, mapping=new_group)
                    # Set TTL on the group key as a safety net (2x repeat_interval)
                    repeat = int(settings.get("repeat_interval_seconds", 14400))
                    await self.redis.expire(redis_key, repeat * 2 + 3600)

                    # Set timer flag with TTL = group_wait
                    await self.redis.set(timer_key, "1", ex=group_wait)

                    # Start async flush task after group_wait
                    task_key = f"{tenant_id}:{group_key}"
                    self._schedule_flush(task_key, group_wait, tenant_id, group_key, redis_key, settings)

                    logger.info("New alert group %s for tenant %s (wait=%ds)", group_key, tenant_id, group_wait)
                else:
                    # Existing group — add alert
                    existing_alerts = json.loads(group_data.get("alerts", "[]"))
                    alert_entry = self._event_to_alert(event)

                    # Deduplicate: don't add if same host+service already in group
                    dup = any(
                        a.get("host") == alert_entry["host"] and a.get("service") == alert_entry["service"]
                        for a in existing_alerts
                    )
                    if dup:
                        # Update existing alert in group
                        existing_alerts = [
                            alert_entry if (a.get("host") == alert_entry["host"] and a.get("service") == alert_entry["service"]) else a
                            for a in existing_alerts
                        ]
                    else:
                        existing_alerts.append(alert_entry)

                    await self.redis.hset(redis_key, mapping={
                        "alerts": json.dumps(existing_alerts),
                        "alert_count": str(len(existing_alerts)),
                        "last_alert_at": str(now_ts),
                        "status": group_data.get("status", "pending"),
                    })

                    # If group is already active (past group_wait), check group_interval
                    status = group_data.get("status", "pending")
                    last_notified = float(group_data.get("last_notified_at", "0"))

                    if status == "active" and (now_ts - last_notified) >= group_interval:
                        # Enough time passed — send update notification
                        await self._flush_group(tenant_id, group_key, redis_key, settings, is_update=True)
                    elif status == "pending":
                        # Still in group_wait — alert will be included when timer fires
                        logger.debug("Alert added to pending group %s (total: %d)", group_key, len(existing_alerts))

            except redis.exceptions.LockError:
                logger.warning("Could not acquire lock for group %s — sending directly", group_key)
                await self._dispatch_single(tenant_id, event)
            finally:
                try:
                    await lock.release()
                except redis.exceptions.LockNotOwnedError:
                    pass

    async def _handle_recovery(
        self,
        tenant_id: UUID,
        event: dict,
        group_key: str,
        redis_key: str,
        group_data: dict,
        settings: dict,
    ) -> None:
        """Handle recovery events within groups."""
        if not group_data:
            # No active group — send recovery directly
            await self._dispatch_single(tenant_id, event)
            return

        existing_alerts = json.loads(group_data.get("alerts", "[]"))
        host = event.get("host", "")
        service = event.get("service", "")

        # Remove the recovered alert from the group
        remaining = [
            a for a in existing_alerts
            if not (a.get("host") == host and a.get("service") == service)
        ]

        if not remaining:
            # All alerts resolved — send group recovery notification
            await self._send_group_notification(
                tenant_id, group_key, existing_alerts, settings,
                notification_type="recovery",
                message=f"All problems resolved ({len(existing_alerts)} alerts)",
            )
            # Clean up group
            await self.redis.delete(redis_key)
            timer_key = f"{TIMER_KEY_PREFIX}:{tenant_id}:{group_key}"
            await self.redis.delete(timer_key)
            logger.info("Group %s fully resolved (tenant %s)", group_key, tenant_id)
        else:
            # Partial recovery — update group, send update if interval allows
            now_ts = time.time()
            await self.redis.hset(redis_key, mapping={
                "alerts": json.dumps(remaining),
                "alert_count": str(len(remaining)),
                "last_alert_at": str(now_ts),
            })

            group_interval = int(settings.get("group_interval_seconds", 300))
            last_notified = float(group_data.get("last_notified_at", "0"))

            if (now_ts - last_notified) >= group_interval:
                recovered_count = len(existing_alerts) - len(remaining)
                total_count = len(existing_alerts)
                await self._send_group_notification(
                    tenant_id, group_key, remaining, settings,
                    notification_type="alert",
                    message=f"{recovered_count} of {total_count} problems resolved. {len(remaining)} still active.",
                    extra={"recovered_service": service, "recovered_host": host},
                )
                await self.redis.hset(redis_key, "last_notified_at", str(now_ts))

    def _schedule_flush(
        self,
        task_key: str,
        delay: int,
        tenant_id: UUID,
        group_key: str,
        redis_key: str,
        settings: dict,
    ) -> None:
        """Schedule a flush after group_wait delay."""
        # Cancel existing flush task if any
        if task_key in self._flush_tasks:
            self._flush_tasks[task_key].cancel()

        async def _delayed_flush():
            await asyncio.sleep(delay)
            try:
                await self._flush_group(tenant_id, group_key, redis_key, settings, is_update=False)
            except Exception as e:
                logger.error("Flush error for group %s: %s", group_key, e, exc_info=True)
            finally:
                self._flush_tasks.pop(task_key, None)

        self._flush_tasks[task_key] = asyncio.create_task(_delayed_flush())

    async def _flush_group(
        self,
        tenant_id: UUID,
        group_key: str,
        redis_key: str,
        settings: dict,
        is_update: bool = False,
    ) -> None:
        """Flush a group — send the grouped notification."""
        group_data = await self.redis.hgetall(redis_key)
        if not group_data:
            return

        alerts = json.loads(group_data.get("alerts", "[]"))
        if not alerts:
            return

        now_ts = time.time()
        msg_prefix = "Update: " if is_update else ""
        await self._send_group_notification(
            tenant_id, group_key, alerts, settings,
            notification_type="alert",
            message=f"{msg_prefix}{len(alerts)} problems in group {group_key}",
        )

        # Mark group as active and update last_notified_at
        await self.redis.hset(redis_key, mapping={
            "status": "active",
            "last_notified_at": str(now_ts),
        })

        # Schedule repeat notification
        repeat_interval = int(settings.get("repeat_interval_seconds", 14400))
        task_key = f"{tenant_id}:{group_key}"
        self._schedule_flush(task_key, repeat_interval, tenant_id, group_key, redis_key, settings)

        logger.info(
            "Flushed group %s: %d alerts, update=%s (tenant %s)",
            group_key, len(alerts), is_update, tenant_id,
        )

    async def _send_group_notification(
        self,
        tenant_id: UUID,
        group_key: str,
        alerts: list[dict],
        settings: dict,
        notification_type: str = "alert",
        message: str = "",
        extra: dict | None = None,
    ) -> None:
        """Build and dispatch a grouped notification."""
        # Load notification channels for tenant
        async with self.db_session_factory() as db:
            from sqlalchemy import text
            result = await db.execute(
                text("""SELECT id, channel_type, config, name FROM notification_channels
                        WHERE tenant_id = :tid AND active = true"""),
                {"tid": tenant_id},
            )
            channels = [
                {
                    "id": row.id, "channel_type": row.channel_type,
                    "config": row.config if isinstance(row.config, dict) else json.loads(row.config),
                    "name": row.name,
                }
                for row in result.fetchall()
            ]
            if not channels:
                return

        # Sort alerts by severity
        severity_order = {"CRITICAL": 0, "WARNING": 1, "NO_DATA": 2, "UNKNOWN": 3, "OK": 4}
        sorted_alerts = sorted(alerts, key=lambda a: severity_order.get(a.get("status", "UNKNOWN"), 3))

        # Build summary
        host_set = set(a.get("host", "") for a in sorted_alerts)
        primary_host = sorted_alerts[0].get("host", "") if sorted_alerts else ""
        worst_status = sorted_alerts[0].get("status", "UNKNOWN") if sorted_alerts else "UNKNOWN"

        # Truncate to 10 alerts for display, note remainder
        display_alerts = sorted_alerts[:10]
        overflow = len(sorted_alerts) - 10 if len(sorted_alerts) > 10 else 0

        notification = Notification(
            type=notification_type,
            host_name=primary_host if len(host_set) == 1 else f"{len(host_set)} hosts",
            host_ip="",
            service_name=f"{len(sorted_alerts)} alerts",
            status=worst_status,
            previous_status="",
            message=message,
            triggered_at=datetime.now(timezone.utc),
            extra_data={
                "grouped": True,
                "group_key": group_key,
                "alerts": display_alerts,
                "total_alert_count": len(sorted_alerts),
                "overflow_count": overflow,
                "hosts": list(host_set),
                **(extra or {}),
            },
        )

        dispatcher = Dispatcher(self.db_session_factory)
        await dispatcher.dispatch(notification, channels, tenant_id)

    async def _dispatch_ungrouped(self, tenant_id: UUID, events: list[dict]) -> None:
        """Send events directly without grouping (fallback)."""
        async with self.db_session_factory() as db:
            from sqlalchemy import text
            result = await db.execute(
                text("""SELECT id, channel_type, config, name FROM notification_channels
                        WHERE tenant_id = :tid AND active = true"""),
                {"tid": tenant_id},
            )
            channels = [
                {
                    "id": row.id, "channel_type": row.channel_type,
                    "config": row.config if isinstance(row.config, dict) else json.loads(row.config),
                    "name": row.name,
                }
                for row in result.fetchall()
            ]
            if not channels:
                return

        dispatcher = Dispatcher(self.db_session_factory)
        for event in events:
            notification = Notification(
                type="recovery" if event.get("event") == "recovery" else "alert",
                host_name=event.get("host", ""),
                host_ip="",
                service_name=event.get("service", ""),
                status=event.get("status", "UNKNOWN"),
                previous_status=event.get("previous_status", ""),
                message=event.get("message", ""),
                triggered_at=datetime.now(timezone.utc),
                extra_data=event,
            )
            await dispatcher.dispatch(notification, channels, tenant_id)

    async def _dispatch_single(self, tenant_id: UUID, event: dict) -> None:
        """Send a single event directly."""
        await self._dispatch_ungrouped(tenant_id, [event])

    @staticmethod
    def _event_to_alert(event: dict) -> dict:
        """Convert a webhook event dict to a stored alert entry."""
        return {
            "host": event.get("host", ""),
            "service": event.get("service", ""),
            "status": event.get("status", "UNKNOWN"),
            "previous_status": event.get("previous_status", ""),
            "message": event.get("message", ""),
            "timestamp": event.get("timestamp", datetime.now(timezone.utc).isoformat()),
        }

    async def recover_groups(self) -> None:
        """Recover active groups from Redis after restart.

        Scans for existing group keys and re-schedules flush timers
        for any groups that are still pending or active.
        """
        cursor = 0
        pattern = f"{GROUP_KEY_PREFIX}:*"
        recovered = 0

        while True:
            cursor, keys = await self.redis.scan(cursor=cursor, match=pattern, count=100)
            for key in keys:
                try:
                    group_data = await self.redis.hgetall(key)
                    if not group_data:
                        continue

                    status = group_data.get("status", "pending")
                    if status == "resolved":
                        continue

                    tenant_id_str = group_data.get("tenant_id", "")
                    group_key = group_data.get("group_key", "")
                    if not tenant_id_str or not group_key:
                        continue

                    tenant_id = UUID(tenant_id_str)

                    # Load tenant settings for group_wait/repeat
                    async with self.db_session_factory() as db:
                        from sqlalchemy import text
                        result = await db.execute(
                            text("SELECT settings FROM tenants WHERE id = :tid"),
                            {"tid": tenant_id},
                        )
                        row = result.fetchone()
                        tenant_settings = (row.settings if row else None) or {}

                    settings = {**DEFAULT_GROUPING, **tenant_settings.get("alert_grouping", {})}
                    redis_key = key

                    if status == "pending":
                        # Re-schedule group_wait (use remaining time or full wait)
                        created_ts = float(group_data.get("created_at", "0"))
                        elapsed = time.time() - created_ts
                        group_wait = max(1, int(settings.get("group_wait_seconds", 30)) - int(elapsed))
                        task_key = f"{tenant_id}:{group_key}"
                        self._schedule_flush(task_key, group_wait, tenant_id, group_key, redis_key, settings)
                    elif status == "active":
                        # Re-schedule repeat interval
                        last_notified = float(group_data.get("last_notified_at", "0"))
                        repeat = int(settings.get("repeat_interval_seconds", 14400))
                        remaining = max(1, repeat - int(time.time() - last_notified))
                        task_key = f"{tenant_id}:{group_key}"
                        self._schedule_flush(task_key, remaining, tenant_id, group_key, redis_key, settings)

                    recovered += 1
                except Exception as e:
                    logger.warning("Failed to recover group from key %s: %s", key, e)

            if cursor == 0:
                break

        if recovered:
            logger.info("Recovered %d alert groups from Redis", recovered)
