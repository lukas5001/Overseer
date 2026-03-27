"""Notification dispatcher – sends notifications with retry, auto-disable, and logging."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from uuid import UUID

from shared.notifications.base import Notification, SendResult
from shared.notifications.registry import ChannelRegistry

logger = logging.getLogger("overseer.notifications.dispatcher")

# Retry backoff delays (seconds)
RETRY_DELAYS = [5, 30, 60]
# Consecutive failures before auto-disable
AUTO_DISABLE_THRESHOLD = 5


class Dispatcher:
    """Central dispatcher that sends notifications to configured channels.

    Responsibilities:
    - Resolve channel_type → channel implementation via ChannelRegistry
    - Retry on failure (3 attempts with backoff)
    - Track consecutive failures and auto-disable broken channels
    - Log every send attempt to notification_log
    """

    def __init__(self, db_session_factory):
        """Initialize with an async session factory (e.g. AsyncSessionLocal)."""
        self.db_session_factory = db_session_factory

    async def dispatch(
        self,
        notification: Notification,
        channel_rows: list[dict],
        tenant_id: UUID,
    ) -> list[SendResult]:
        """Send a notification to multiple channels concurrently.

        Args:
            notification: The notification payload.
            channel_rows: List of dicts with keys: id, channel_type, config, name.
            tenant_id: Tenant UUID for logging.

        Returns:
            List of SendResult, one per channel.
        """
        tasks = [
            self._send_to_channel(notification, ch, tenant_id)
            for ch in channel_rows
        ]
        return await asyncio.gather(*tasks)

    async def _send_to_channel(
        self,
        notification: Notification,
        channel_row: dict,
        tenant_id: UUID,
    ) -> SendResult:
        """Send to a single channel with retry logic."""
        registry = ChannelRegistry.get()
        channel_type = channel_row["channel_type"]
        channel_impl = registry.get_channel(channel_type)

        if channel_impl is None:
            result = SendResult(success=False, error=f"Unknown channel type: {channel_type}")
            await self._log_send(tenant_id, channel_row, notification, result)
            return result

        config = channel_row["config"]
        last_error = None

        for attempt in range(len(RETRY_DELAYS) + 1):
            try:
                result = await channel_impl.send(notification, config)
                if result.success:
                    await self._on_success(channel_row)
                    await self._log_send(tenant_id, channel_row, notification, result)
                    return result
                last_error = result.error
            except Exception as e:
                last_error = str(e)
                result = SendResult(success=False, error=last_error)

            # Retry with backoff (skip delay after last attempt)
            if attempt < len(RETRY_DELAYS):
                delay = RETRY_DELAYS[attempt]
                logger.warning(
                    "Channel %s (%s) attempt %d failed: %s — retrying in %ds",
                    channel_row.get("name", "?"), channel_type, attempt + 1, last_error, delay,
                )
                await asyncio.sleep(delay)

        # All retries exhausted
        final_result = SendResult(success=False, error=last_error)
        await self._on_failure(channel_row, last_error or "Unknown error")
        await self._log_send(tenant_id, channel_row, notification, final_result)
        return final_result

    async def _on_success(self, channel_row: dict) -> None:
        """Reset consecutive failures on success."""
        channel_id = channel_row.get("id")
        if not channel_id:
            return
        try:
            async with self.db_session_factory() as db:
                from sqlalchemy import text
                await db.execute(
                    text("""UPDATE notification_channels
                            SET consecutive_failures = 0
                            WHERE id = :cid AND consecutive_failures > 0"""),
                    {"cid": channel_id},
                )
                await db.commit()
        except Exception as e:
            logger.warning("Failed to reset consecutive_failures for %s: %s", channel_id, e)

    async def _on_failure(self, channel_row: dict, error: str) -> None:
        """Increment consecutive failures and auto-disable if threshold reached."""
        channel_id = channel_row.get("id")
        if not channel_id:
            return
        try:
            async with self.db_session_factory() as db:
                from sqlalchemy import text
                now = datetime.now(timezone.utc)
                await db.execute(
                    text("""UPDATE notification_channels
                            SET consecutive_failures = consecutive_failures + 1,
                                last_failure_at = :now,
                                last_failure_reason = :reason
                            WHERE id = :cid"""),
                    {"cid": channel_id, "now": now, "reason": error[:500]},
                )
                # Check if threshold reached → auto-disable
                result = await db.execute(
                    text("SELECT consecutive_failures FROM notification_channels WHERE id = :cid"),
                    {"cid": channel_id},
                )
                row = result.fetchone()
                if row and row.consecutive_failures >= AUTO_DISABLE_THRESHOLD:
                    await db.execute(
                        text("UPDATE notification_channels SET active = false WHERE id = :cid"),
                        {"cid": channel_id},
                    )
                    logger.error(
                        "Channel %s (%s) auto-disabled after %d consecutive failures",
                        channel_row.get("name", "?"), channel_row["channel_type"],
                        row.consecutive_failures,
                    )
                await db.commit()
        except Exception as e:
            logger.warning("Failed to update failure tracking for %s: %s", channel_id, e)

    async def _log_send(
        self,
        tenant_id: UUID,
        channel_row: dict,
        notification: Notification,
        result: SendResult,
    ) -> None:
        """Write a row to notification_log."""
        try:
            async with self.db_session_factory() as db:
                from sqlalchemy import text
                await db.execute(
                    text("""INSERT INTO notification_log
                            (id, tenant_id, channel_id, channel_type, notification_type,
                             host_name, service_name, status, success, error_message, sent_at)
                            VALUES (gen_random_uuid(), :tid, :cid, :ctype, :ntype,
                                    :host, :svc, :status, :success, :error, :sent_at)"""),
                    {
                        "tid": tenant_id,
                        "cid": channel_row.get("id"),
                        "ctype": channel_row["channel_type"],
                        "ntype": notification.type,
                        "host": notification.host_name[:255] if notification.host_name else None,
                        "svc": notification.service_name[:255] if notification.service_name else None,
                        "status": notification.status,
                        "success": result.success,
                        "error": result.error[:500] if result.error else None,
                        "sent_at": datetime.now(timezone.utc),
                    },
                )
                await db.commit()
        except Exception as e:
            logger.warning("Failed to log notification: %s", e)
