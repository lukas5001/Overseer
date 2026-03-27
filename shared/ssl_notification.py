"""SSL certificate notification staffelung (staged escalation) logic.

Implements staged notifications for SSL certificate expiry:
- 30 days: first warning (one-time)
- 14 days: escalated notification (one-time)
- 7 days: daily notifications
- 3 days: every 12 hours
- expired: every 6 hours until resolved

Also detects certificate renewals (days_until_expiry jumps up).
"""
from datetime import datetime

STAGE_ORDER = {"30d": 1, "14d": 2, "7d": 3, "3d": 4, "expired": 5}

# Re-notification intervals in seconds per stage
RENOTIFY_INTERVALS = {
    "7d": 24 * 3600,       # daily
    "3d": 12 * 3600,       # every 12 hours
    "expired": 6 * 3600,   # every 6 hours
}


def compute_ssl_stage(days_until_expiry: int) -> str | None:
    """Compute the notification stage from days until expiry.

    Returns None if no notification is needed (cert is healthy, >30 days).
    """
    if days_until_expiry <= 0:
        return "expired"
    if days_until_expiry <= 3:
        return "3d"
    if days_until_expiry <= 7:
        return "7d"
    if days_until_expiry <= 14:
        return "14d"
    if days_until_expiry <= 30:
        return "30d"
    return None


def should_notify(
    current_stage: str | None,
    last_stage: str | None,
    last_notified_at: datetime | None,
    now: datetime,
) -> bool:
    """Determine if a notification should be sent based on stage progression.

    Rules:
    - First time reaching any stage: always notify
    - Stage worsened (e.g. 30d -> 14d): always notify
    - Same stage, re-notification interval reached (7d=24h, 3d=12h, expired=6h): notify
    - Otherwise: don't notify
    """
    if current_stage is None:
        return False

    if last_stage is None:
        # First time reaching any stage
        return True

    current_sev = STAGE_ORDER.get(current_stage, 0)
    last_sev = STAGE_ORDER.get(last_stage, 0)

    if current_sev > last_sev:
        # Stage worsened
        return True

    if last_notified_at is None:
        return True

    # Check re-notification interval for sustained stages
    renotify = RENOTIFY_INTERVALS.get(current_stage)
    if renotify is not None:
        elapsed = (now - last_notified_at).total_seconds()
        if elapsed >= renotify:
            return True

    return False


def is_renewal(current_days: int, previous_days: int | None) -> bool:
    """Detect certificate renewal (days_until_expiry jumps significantly up).

    Uses a threshold of 10 days to avoid false positives from minor fluctuations
    (e.g. a check running at slightly different times).
    """
    if previous_days is None:
        return False
    return current_days > previous_days + 10


def render_ssl_notification_html(ctx: dict) -> str:
    """Render HTML email for SSL certificate notification."""
    status = ctx.get("status", "WARNING")
    color_map = {
        "OK": "#16a34a",
        "WARNING": "#d97706",
        "CRITICAL": "#dc2626",
    }
    color = color_map.get(status, "#d97706")
    is_recovery = ctx.get("is_recovery", False)
    title = "RECOVERY" if is_recovery else f"SSL CERTIFICATE {status}"

    rows = ""
    fields = [
        ("Host", "host"),
        ("Service", "service_name"),
        ("Days until expiry", "days_until_expiry"),
        ("Expiry date", "not_after"),
        ("Issuer", "issuer"),
        ("Subject", "subject"),
    ]
    for label, key in fields:
        val = ctx.get(key, "")
        if val != "" and val is not None:
            rows += (
                f'<tr><td style="padding:6px 0;font-weight:600;width:40%;">{label}</td>'
                f'<td>{val}</td></tr>'
            )

    message = ctx.get("message", "")

    return (
        '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
        '<body style="margin:0;padding:0;background:#f0f4f8;font-family:\'Segoe UI\',Arial,sans-serif;">'
        '<div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;'
        'overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">'
        '<div style="background:#1e293b;padding:24px 32px;text-align:center;">'
        '<div style="color:#fff;font-size:22px;font-weight:700;">Overseer</div>'
        '<div style="color:#94a3b8;font-size:13px;margin-top:4px;">SSL Certificate Monitor</div>'
        '</div>'
        f'<div style="background:{color};padding:12px 32px;text-align:center;">'
        f'<span style="color:#fff;font-size:16px;font-weight:700;">{title}</span>'
        '</div>'
        '<div style="padding:28px 32px;">'
        f'<p style="color:#334155;font-size:14px;margin:0 0 16px;">{message}</p>'
        f'<table style="width:100%;border-collapse:collapse;font-size:14px;color:#334155;">'
        f'{rows}'
        '</table>'
        '</div>'
        '<div style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">'
        '<p style="color:#94a3b8;font-size:12px;margin:0;">This is an automated message from Overseer Monitoring.</p>'
        '</div>'
        '</div></body></html>'
    )


def build_ssl_notification_context(
    host: str,
    service_name: str,
    check_message: str,
    metadata: dict | None,
    stage: str,
    is_recovery: bool = False,
) -> dict:
    """Build a notification context dict for SSL certificate notifications."""
    ctx = {
        "host": host,
        "service_name": service_name,
        "message": check_message,
        "stage": stage,
        "is_recovery": is_recovery,
    }
    if is_recovery:
        ctx["status"] = "OK"
        ctx["message"] = f"Certificate for {host} has been renewed. {check_message}"
    elif stage == "expired":
        ctx["status"] = "CRITICAL"
    elif stage in ("3d", "7d"):
        ctx["status"] = "CRITICAL"
    else:
        ctx["status"] = "WARNING"

    if metadata:
        ctx["days_until_expiry"] = metadata.get("days_until_expiry", "")
        ctx["not_after"] = metadata.get("not_after", "")
        ctx["issuer"] = metadata.get("issuer", "")
        ctx["subject"] = metadata.get("subject", "")

    return ctx
