"""Webhook notification channel."""
from __future__ import annotations

import logging
from datetime import timezone

from shared.notifications.base import NotificationChannel, Notification, SendResult

logger = logging.getLogger("overseer.notifications.channels.webhook")


class WebhookChannel(NotificationChannel):
    """Send notifications via HTTP webhook (POST JSON)."""

    @property
    def channel_type(self) -> str:
        return "webhook"

    @property
    def display_name(self) -> str:
        return "Webhook"

    @property
    def config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "title": "Webhook URL",
                    "description": "HTTP(S) endpoint to POST notifications to",
                    "format": "uri",
                },
                "headers": {
                    "type": "object",
                    "title": "Custom Headers",
                    "description": "Additional HTTP headers (optional)",
                    "additionalProperties": {"type": "string"},
                    "default": {},
                },
            },
            "required": ["url"],
        }

    async def validate_config(self, config: dict) -> list[str]:
        errors = []
        url = config.get("url", "").strip()
        if not url:
            errors.append("Webhook URL is required.")
        elif not url.startswith(("http://", "https://")):
            errors.append("Webhook URL must start with http:// or https://")
        return errors

    async def send(self, notification: Notification, channel_config: dict) -> SendResult:
        import httpx

        url = channel_config.get("url")
        if not url:
            return SendResult(success=False, error="No URL configured")

        headers = channel_config.get("headers", {})

        payload = {
            "type": notification.type,
            "host_name": notification.host_name,
            "host_ip": notification.host_ip,
            "service_name": notification.service_name,
            "status": notification.status,
            "previous_status": notification.previous_status,
            "message": notification.message,
            "triggered_at": notification.triggered_at.isoformat() if notification.triggered_at else None,
            "tenant_name": notification.tenant_name,
            "dashboard_url": notification.dashboard_url,
        }
        if notification.duration:
            payload["duration_seconds"] = int(notification.duration.total_seconds())
        if notification.extra_data:
            payload["extra_data"] = notification.extra_data

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code < 400:
                return SendResult(success=True, http_status=resp.status_code)
            return SendResult(
                success=False,
                error=f"HTTP {resp.status_code}: {resp.text[:200]}",
                http_status=resp.status_code,
            )
        except httpx.TimeoutException:
            return SendResult(success=False, error="Request timed out")
        except Exception as e:
            return SendResult(success=False, error=str(e))
