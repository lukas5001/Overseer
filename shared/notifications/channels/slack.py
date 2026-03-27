"""Slack notification channel – sends via Incoming Webhook (Block Kit)."""
from __future__ import annotations

import logging

from shared.notifications.base import NotificationChannel, Notification, SendResult

logger = logging.getLogger("overseer.notifications.channels.slack")

STATUS_EMOJI = {
    "OK": "\u2705",        # ✅
    "WARNING": "\U0001f7e0",  # 🟠
    "CRITICAL": "\U0001f534",  # 🔴
    "NO_DATA": "\U0001f535",   # 🔵
    "UNKNOWN": "\u2753",       # ❓
}


def _build_blocks(notification: Notification) -> list[dict]:
    """Build Slack Block Kit blocks for a notification."""
    extra = notification.extra_data or {}
    if extra.get("grouped"):
        return _build_grouped_blocks(notification, extra)

    emoji = STATUS_EMOJI.get(notification.status, "\u2753")
    is_recovery = notification.status == "OK"
    is_test = notification.type == "test"

    # Header line
    if is_test:
        header = f"{emoji} TEST: {notification.service_name} on {notification.host_name}"
    elif is_recovery:
        duration_text = ""
        if notification.duration:
            minutes = int(notification.duration.total_seconds() / 60)
            duration_text = f" — Was {notification.previous_status.lower()} for {minutes} minutes."
        header = f"{emoji} RECOVERED: {notification.service_name} on {notification.host_name}{duration_text}"
    else:
        header = f"{emoji} {notification.status}: {notification.service_name} on {notification.host_name}"

    blocks: list[dict] = [
        {"type": "header", "text": {"type": "plain_text", "text": header[:150], "emoji": True}},
    ]

    # Detail fields
    fields = [
        f"*Service:*  {notification.service_name}",
        f"*Status:*  {notification.status}",
    ]
    if notification.host_ip:
        fields.append(f"*Host:*  {notification.host_name} ({notification.host_ip})")
    else:
        fields.append(f"*Host:*  {notification.host_name}")
    if notification.message:
        fields.append(f"*Message:*  {notification.message}")
    if notification.duration:
        minutes = int(notification.duration.total_seconds() / 60)
        fields.append(f"*Duration:*  {minutes} minutes")
    if notification.triggered_at:
        fields.append(f"*Since:*  {notification.triggered_at.strftime('%Y-%m-%d %H:%M UTC')}")
    if notification.tenant_name:
        fields.append(f"*Tenant:*  {notification.tenant_name}")

    blocks.append({
        "type": "section",
        "text": {"type": "mrkdwn", "text": "\n".join(fields)},
    })

    # Dashboard link button
    if notification.dashboard_url:
        blocks.append({
            "type": "actions",
            "elements": [{
                "type": "button",
                "text": {"type": "plain_text", "text": "View in Overseer", "emoji": True},
                "url": notification.dashboard_url,
            }],
        })

    return blocks


def _build_grouped_blocks(notification: Notification, extra: dict) -> list[dict]:
    """Build Slack Block Kit blocks for a grouped notification."""
    alerts = extra.get("alerts", [])
    total = extra.get("total_alert_count", len(alerts))
    overflow = extra.get("overflow_count", 0)
    is_recovery = notification.type == "recovery"

    worst_emoji = STATUS_EMOJI.get(notification.status, "\u2753")
    if is_recovery:
        header = f"\u2705 All problems resolved on {notification.host_name}"
    else:
        header = f"{worst_emoji} {total} problems on {notification.host_name}"

    blocks: list[dict] = [
        {"type": "header", "text": {"type": "plain_text", "text": header[:150], "emoji": True}},
    ]

    # Alert table
    lines = []
    for a in alerts:
        emoji = STATUS_EMOJI.get(a.get("status", ""), "\u2753")
        svc = a.get("service", "?")
        msg = a.get("message", "")[:80]
        ts = a.get("timestamp", "")
        if ts and "T" in ts:
            ts = ts.split("T")[1][:5]
        lines.append(f"{emoji} `{a.get('status', '?'):8s}` *{svc}*  {msg}  _{ts}_")

    if overflow > 0:
        lines.append(f"_... and {overflow} more alerts._")

    if notification.message:
        lines.insert(0, f"_{notification.message}_\n")

    blocks.append({
        "type": "section",
        "text": {"type": "mrkdwn", "text": "\n".join(lines)},
    })

    if notification.dashboard_url:
        blocks.append({
            "type": "actions",
            "elements": [{
                "type": "button",
                "text": {"type": "plain_text", "text": "View in Overseer", "emoji": True},
                "url": notification.dashboard_url,
            }],
        })

    return blocks


class SlackChannel(NotificationChannel):
    """Send notifications to Slack via Incoming Webhook."""

    @property
    def channel_type(self) -> str:
        return "slack"

    @property
    def display_name(self) -> str:
        return "Slack"

    @property
    def config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "webhook_url": {
                    "type": "string",
                    "title": "Webhook URL",
                    "description": "Slack Incoming Webhook URL",
                    "format": "uri",
                },
                "channel": {
                    "type": "string",
                    "title": "Channel Override",
                    "description": "Override channel (e.g. #alerts). Optional.",
                },
                "username": {
                    "type": "string",
                    "title": "Bot Name",
                    "description": "Display name for the bot",
                    "default": "Overseer",
                },
                "icon_emoji": {
                    "type": "string",
                    "title": "Bot Icon",
                    "description": "Emoji icon for the bot (e.g. :warning:)",
                    "default": ":warning:",
                },
            },
            "required": ["webhook_url"],
        }

    async def validate_config(self, config: dict) -> list[str]:
        errors = []
        url = config.get("webhook_url", "").strip()
        if not url:
            errors.append("Webhook URL is required.")
        elif not url.startswith(("https://hooks.slack.com/", "https://discord.com/api/webhooks/")):
            errors.append("Webhook URL must start with https://hooks.slack.com/ or https://discord.com/api/webhooks/")
        return errors

    async def send(self, notification: Notification, channel_config: dict) -> SendResult:
        import httpx

        url = channel_config.get("webhook_url")
        if not url:
            return SendResult(success=False, error="No webhook URL configured")

        payload: dict = {"blocks": _build_blocks(notification)}

        # Optional overrides
        channel = channel_config.get("channel")
        if channel:
            payload["channel"] = channel
        username = channel_config.get("username", "Overseer")
        if username:
            payload["username"] = username
        icon_emoji = channel_config.get("icon_emoji", ":warning:")
        if icon_emoji:
            payload["icon_emoji"] = icon_emoji

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(url, json=payload)
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
