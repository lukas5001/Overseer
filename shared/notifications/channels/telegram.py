"""Telegram notification channel – sends via Bot API."""
from __future__ import annotations

import logging
import re

from shared.notifications.base import NotificationChannel, Notification, SendResult

logger = logging.getLogger("overseer.notifications.channels.telegram")

STATUS_EMOJI = {
    "OK": "\u2705",
    "WARNING": "\U0001f7e0",
    "CRITICAL": "\U0001f534",
    "NO_DATA": "\U0001f535",
    "UNKNOWN": "\u2753",
}

# Characters that must be escaped in MarkdownV2
_ESCAPE_CHARS = re.compile(r'([_*\[\]()~`>#+\-=|{}.!\\])')


def escape_markdown_v2(text: str) -> str:
    """Escape special characters for Telegram MarkdownV2."""
    return _ESCAPE_CHARS.sub(r'\\\1', text)


def _build_message(notification: Notification) -> str:
    """Build a MarkdownV2-formatted message."""
    extra = notification.extra_data or {}
    if extra.get("grouped"):
        return _build_grouped_message(notification, extra)

    emoji = STATUS_EMOJI.get(notification.status, "\u2753")
    is_recovery = notification.status == "OK"
    is_test = notification.type == "test"

    svc = escape_markdown_v2(notification.service_name)
    host = escape_markdown_v2(notification.host_name)
    status = escape_markdown_v2(notification.status)

    if is_test:
        header = f"{emoji} *TEST: {svc} on {host}*"
    elif is_recovery:
        duration_text = ""
        if notification.duration:
            minutes = int(notification.duration.total_seconds() / 60)
            duration_text = escape_markdown_v2(f" — Was {notification.previous_status.lower()} for {minutes} minutes.")
        header = f"{emoji} *RECOVERED: {svc} on {host}*{duration_text}"
    else:
        header = f"{emoji} *{status}: {svc} on {host}*"

    lines = [header, ""]

    lines.append(f"*Service:* {svc}")
    lines.append(f"*Status:* {status}")

    if notification.host_ip:
        ip = escape_markdown_v2(notification.host_ip)
        lines.append(f"*Host:* {host} \\({ip}\\)")
    else:
        lines.append(f"*Host:* {host}")

    if notification.message:
        lines.append(f"*Message:* {escape_markdown_v2(notification.message)}")

    if notification.duration:
        minutes = int(notification.duration.total_seconds() / 60)
        lines.append(f"*Duration:* {escape_markdown_v2(str(minutes))} minutes")

    if notification.triggered_at:
        ts = escape_markdown_v2(notification.triggered_at.strftime("%Y-%m-%d %H:%M UTC"))
        lines.append(f"*Since:* {ts}")

    if notification.tenant_name:
        lines.append(f"*Tenant:* {escape_markdown_v2(notification.tenant_name)}")

    if notification.dashboard_url:
        url = notification.dashboard_url
        lines.append("")
        lines.append(f"[View in Overseer]({url})")

    return "\n".join(lines)


def _build_grouped_message(notification: Notification, extra: dict) -> str:
    """Build a MarkdownV2-formatted grouped notification message."""
    alerts = extra.get("alerts", [])
    total = extra.get("total_alert_count", len(alerts))
    overflow = extra.get("overflow_count", 0)
    is_recovery = notification.type == "recovery"

    host = escape_markdown_v2(notification.host_name)

    if is_recovery:
        header = f"\u2705 *All problems resolved on {host}*"
    else:
        worst_emoji = STATUS_EMOJI.get(notification.status, "\u2753")
        header = f"{worst_emoji} *{escape_markdown_v2(str(total))} problems on {host}*"

    lines = [header, ""]

    if notification.message:
        lines.append(f"_{escape_markdown_v2(notification.message)}_")
        lines.append("")

    for a in alerts:
        s = a.get("status", "UNKNOWN")
        s_emoji = STATUS_EMOJI.get(s, "\u2753")
        svc = escape_markdown_v2(a.get("service", "?"))
        msg = escape_markdown_v2(a.get("message", "")[:60])
        ts = a.get("timestamp", "")
        if ts and "T" in ts:
            ts = escape_markdown_v2(ts.split("T")[1][:5])
        lines.append(f"{s_emoji} `{s}` *{svc}*  {msg}  _{ts}_")

    if overflow > 0:
        lines.append(f"\n_\\.\\.\\. and {escape_markdown_v2(str(overflow))} more alerts\\._")

    if notification.dashboard_url:
        lines.append("")
        lines.append(f"[View in Overseer]({notification.dashboard_url})")

    return "\n".join(lines)


class TelegramChannel(NotificationChannel):
    """Send notifications via Telegram Bot API."""

    @property
    def channel_type(self) -> str:
        return "telegram"

    @property
    def display_name(self) -> str:
        return "Telegram"

    @property
    def config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "bot_token": {
                    "type": "string",
                    "title": "Bot Token",
                    "description": "Telegram Bot Token from @BotFather",
                    "format": "password",
                },
                "chat_id": {
                    "type": "string",
                    "title": "Chat ID",
                    "description": "Chat ID (user, group, or channel)",
                },
            },
            "required": ["bot_token", "chat_id"],
        }

    async def validate_config(self, config: dict) -> list[str]:
        errors = []
        token = config.get("bot_token", "").strip()
        chat_id = config.get("chat_id", "").strip()

        if not token:
            errors.append("Bot token is required.")
        elif not re.match(r'^\d+:[A-Za-z0-9_-]+$', token):
            errors.append("Bot token format is invalid. Expected format: 123456:ABC-DEF...")

        if not chat_id:
            errors.append("Chat ID is required.")

        return errors

    async def send(self, notification: Notification, channel_config: dict) -> SendResult:
        import httpx

        token = channel_config.get("bot_token")
        chat_id = channel_config.get("chat_id")

        if not token or not chat_id:
            return SendResult(success=False, error="Bot token and chat ID are required")

        text = _build_message(notification)
        api_url = f"https://api.telegram.org/bot{token}/sendMessage"

        payload = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "MarkdownV2",
            "disable_web_page_preview": True,
        }

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(api_url, json=payload)
            data = resp.json()
            if resp.status_code == 200 and data.get("ok"):
                return SendResult(success=True, http_status=200)
            error_desc = data.get("description", resp.text[:200])
            return SendResult(
                success=False,
                error=f"Telegram API error: {error_desc}",
                http_status=resp.status_code,
            )
        except httpx.TimeoutException:
            return SendResult(success=False, error="Request timed out")
        except Exception as e:
            return SendResult(success=False, error=str(e))
