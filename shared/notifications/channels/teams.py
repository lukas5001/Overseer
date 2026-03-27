"""Microsoft Teams notification channel – Adaptive Cards via Workflow Webhook."""
from __future__ import annotations

import logging

from shared.notifications.base import NotificationChannel, Notification, SendResult

logger = logging.getLogger("overseer.notifications.channels.teams")

STATUS_EMOJI = {
    "OK": "\u2705",
    "WARNING": "\U0001f7e0",
    "CRITICAL": "\U0001f534",
    "NO_DATA": "\U0001f535",
    "UNKNOWN": "\u2753",
}


def _build_adaptive_card(notification: Notification, title_prefix: str = "") -> dict:
    """Build a Teams Adaptive Card payload."""
    extra = notification.extra_data or {}
    if extra.get("grouped"):
        return _build_grouped_adaptive_card(notification, extra, title_prefix)

    emoji = STATUS_EMOJI.get(notification.status, "\u2753")
    is_recovery = notification.status == "OK"
    is_test = notification.type == "test"

    if is_test:
        title = f"{emoji} TEST: {notification.service_name} on {notification.host_name}"
    elif is_recovery:
        title = f"{emoji} RECOVERED: {notification.service_name} on {notification.host_name}"
    else:
        title = f"{emoji} {notification.status}: {notification.service_name} on {notification.host_name}"

    if title_prefix:
        title = f"{title_prefix} {title}"

    # Facts
    facts = [
        {"title": "Service", "value": notification.service_name},
        {"title": "Status", "value": notification.status},
    ]
    if notification.host_ip:
        facts.append({"title": "Host", "value": f"{notification.host_name} ({notification.host_ip})"})
    else:
        facts.append({"title": "Host", "value": notification.host_name})
    if notification.message:
        facts.append({"title": "Message", "value": notification.message})
    if notification.duration:
        minutes = int(notification.duration.total_seconds() / 60)
        facts.append({"title": "Duration", "value": f"{minutes} minutes"})
    if notification.tenant_name:
        facts.append({"title": "Tenant", "value": notification.tenant_name})

    body: list[dict] = [
        {"type": "TextBlock", "text": title, "size": "medium", "weight": "bolder", "wrap": True},
        {"type": "FactSet", "facts": facts},
    ]

    if notification.triggered_at:
        body.append({
            "type": "TextBlock",
            "text": f"Since: {notification.triggered_at.strftime('%Y-%m-%d %H:%M UTC')}",
            "isSubtle": True,
            "wrap": True,
        })

    actions = []
    if notification.dashboard_url:
        actions.append({
            "type": "Action.OpenUrl",
            "title": "View in Overseer",
            "url": notification.dashboard_url,
        })

    card_content: dict = {
        "type": "AdaptiveCard",
        "version": "1.4",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "body": body,
    }
    if actions:
        card_content["actions"] = actions

    return {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": card_content,
        }],
    }


def _build_grouped_adaptive_card(notification: Notification, extra: dict, title_prefix: str = "") -> dict:
    """Build a Teams Adaptive Card for a grouped notification."""
    alerts = extra.get("alerts", [])
    total = extra.get("total_alert_count", len(alerts))
    overflow = extra.get("overflow_count", 0)
    is_recovery = notification.type == "recovery"

    if is_recovery:
        emoji = STATUS_EMOJI.get("OK", "\u2705")
        title = f"{emoji} All problems resolved on {notification.host_name}"
    else:
        emoji = STATUS_EMOJI.get(notification.status, "\u2753")
        title = f"{emoji} {total} problems on {notification.host_name}"

    if title_prefix:
        title = f"{title_prefix} {title}"

    body: list[dict] = [
        {"type": "TextBlock", "text": title, "size": "medium", "weight": "bolder", "wrap": True},
    ]

    if notification.message:
        body.append({"type": "TextBlock", "text": notification.message, "isSubtle": True, "wrap": True})

    # Alert table as facts
    for a in alerts:
        s = a.get("status", "UNKNOWN")
        s_emoji = STATUS_EMOJI.get(s, "\u2753")
        facts = [
            {"title": "Status", "value": f"{s_emoji} {s}"},
            {"title": "Service", "value": a.get("service", "?")},
            {"title": "Message", "value": a.get("message", "")[:80]},
        ]
        body.append({"type": "FactSet", "facts": facts})

    if overflow > 0:
        body.append({"type": "TextBlock", "text": f"... and {overflow} more alerts.", "isSubtle": True})

    actions = []
    if notification.dashboard_url:
        actions.append({"type": "Action.OpenUrl", "title": "View in Overseer", "url": notification.dashboard_url})

    card_content: dict = {
        "type": "AdaptiveCard", "version": "1.4",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "body": body,
    }
    if actions:
        card_content["actions"] = actions

    return {
        "type": "message",
        "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive", "content": card_content}],
    }


class TeamsChannel(NotificationChannel):
    """Send notifications to Microsoft Teams via Workflow Webhook."""

    @property
    def channel_type(self) -> str:
        return "teams"

    @property
    def display_name(self) -> str:
        return "Microsoft Teams"

    @property
    def config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "webhook_url": {
                    "type": "string",
                    "title": "Webhook URL",
                    "description": "Teams Workflow/Webhook URL",
                    "format": "uri",
                },
                "title_prefix": {
                    "type": "string",
                    "title": "Title Prefix",
                    "description": "Prefix for notification title (e.g. [Production]). Optional.",
                },
            },
            "required": ["webhook_url"],
        }

    async def validate_config(self, config: dict) -> list[str]:
        errors = []
        url = config.get("webhook_url", "").strip()
        if not url:
            errors.append("Webhook URL is required.")
        elif not url.startswith("https://"):
            errors.append("Webhook URL must use HTTPS.")
        return errors

    async def send(self, notification: Notification, channel_config: dict) -> SendResult:
        import httpx

        url = channel_config.get("webhook_url")
        if not url:
            return SendResult(success=False, error="No webhook URL configured")

        title_prefix = channel_config.get("title_prefix", "")
        payload = _build_adaptive_card(notification, title_prefix)

        try:
            async with httpx.AsyncClient(timeout=15) as client:
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
