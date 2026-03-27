"""Email notification channel – wraps existing shared/email.py sender."""
from __future__ import annotations

import logging

from shared.notifications.base import NotificationChannel, Notification, SendResult

logger = logging.getLogger("overseer.notifications.channels.email")


def _render_notification_html(notification: Notification) -> str:
    """Render an HTML email body for a notification."""
    status = notification.status
    color_map = {
        "OK": "#16a34a", "WARNING": "#d97706", "CRITICAL": "#dc2626",
        "NO_DATA": "#ea580c", "UNKNOWN": "#6b7280",
    }
    color = color_map.get(status, "#6b7280")
    is_recovery = status == "OK"
    is_test = notification.type == "test"

    title = "TEST: " if is_test else ""
    title += "Recovery" if is_recovery else "Alert"

    # Build info rows
    rows = [
        ("Service", notification.service_name),
        ("Host", f"{notification.host_name} ({notification.host_ip})" if notification.host_ip else notification.host_name),
        ("Status", f'<span style="color:{color};font-weight:700;">{status}</span>'),
        ("Message", notification.message),
    ]
    if notification.duration:
        minutes = int(notification.duration.total_seconds() / 60)
        rows.append(("Duration", f"{minutes} minutes"))
    if notification.triggered_at:
        rows.append(("Triggered", notification.triggered_at.strftime("%Y-%m-%d %H:%M UTC")))
    if notification.tenant_name:
        rows.append(("Tenant", notification.tenant_name))

    rows_html = "".join(
        f'<tr><td style="padding:6px 0;font-weight:600;width:35%;">{label}</td><td>{value}</td></tr>'
        for label, value in rows
    )

    return (
        '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
        '<body style="margin:0;padding:0;background:#f0f4f8;font-family:\'Segoe UI\',Arial,sans-serif;">'
        '<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;'
        'overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">'
        '<div style="background:#1e293b;padding:24px 32px;text-align:center;">'
        '<div style="color:#fff;font-size:22px;font-weight:700;">Overseer</div>'
        '<div style="color:#94a3b8;font-size:13px;margin-top:4px;">Monitoring Alert</div>'
        '</div>'
        f'<div style="background:{color};padding:12px 32px;text-align:center;">'
        f'<span style="color:#fff;font-size:16px;font-weight:700;">{title.upper()}: {status}</span>'
        '</div>'
        f'<div style="padding:28px 32px;">'
        f'<table style="width:100%;border-collapse:collapse;font-size:14px;color:#334155;">'
        f'{rows_html}'
        '</table>'
        '</div>'
        '<div style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">'
        '<p style="color:#94a3b8;font-size:12px;margin:0;">This is an automated message from Overseer Monitoring.</p>'
        '</div>'
        '</div></body></html>'
    )


class EmailChannel(NotificationChannel):
    """Send notifications via SMTP email."""

    @property
    def channel_type(self) -> str:
        return "email"

    @property
    def display_name(self) -> str:
        return "Email"

    @property
    def config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "email": {
                    "type": "string",
                    "title": "Empfänger-Email",
                    "description": "E-Mail-Adresse des Empfängers",
                    "format": "email",
                },
                "subject_prefix": {
                    "type": "string",
                    "title": "Betreff-Prefix",
                    "description": "Prefix für den E-Mail-Betreff (optional)",
                    "default": "[Overseer]",
                },
            },
            "required": ["email"],
        }

    async def validate_config(self, config: dict) -> list[str]:
        errors = []
        email = config.get("email", "").strip()
        if not email:
            errors.append("Email address is required.")
        elif "@" not in email:
            errors.append("Invalid email address.")
        return errors

    async def send(self, notification: Notification, channel_config: dict) -> SendResult:
        from shared.email import send_email

        email_to = channel_config.get("email") or channel_config.get("to")
        if not email_to:
            return SendResult(success=False, error="No email address configured")

        prefix = channel_config.get("subject_prefix", "[Overseer]")
        type_label = notification.type.replace("_", " ").title()
        subject = f"{prefix} {type_label}: {notification.service_name} on {notification.host_name} is {notification.status}"

        body_plain = (
            f"Status: {notification.status}\n"
            f"Host: {notification.host_name} ({notification.host_ip})\n"
            f"Service: {notification.service_name}\n"
            f"Message: {notification.message}\n"
        )
        if notification.triggered_at:
            body_plain += f"Triggered: {notification.triggered_at.strftime('%Y-%m-%d %H:%M UTC')}\n"

        # Use extra_data HTML if provided (e.g. SSL notifications with custom template)
        if notification.extra_data and notification.extra_data.get("html_body"):
            body_html = notification.extra_data["html_body"]
        else:
            body_html = _render_notification_html(notification)

        try:
            await send_email(email_to, subject, body_plain, body_html)
            return SendResult(success=True)
        except Exception as e:
            return SendResult(success=False, error=str(e))
