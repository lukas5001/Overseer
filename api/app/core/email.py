"""Reusable async email sender for Overseer (SMTP via IONOS)."""
import asyncio
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.ionos.it")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "overseer@dailycrust.it")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "overseer@dailycrust.it")


def _send_sync(to: str, subject: str, body_plain: str, body_html: str | None = None) -> None:
    msg = MIMEMultipart("alternative") if body_html else MIMEText(body_plain, "plain", "utf-8")
    if body_html:
        msg.attach(MIMEText(body_plain, "plain", "utf-8"))
        msg.attach(MIMEText(body_html, "html", "utf-8"))
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as s:
        s.starttls()
        s.login(SMTP_USER, SMTP_PASSWORD)
        s.send_message(msg)


async def send_email(to: str, subject: str, body_plain: str, body_html: str | None = None) -> None:
    await asyncio.to_thread(_send_sync, to, subject, body_plain, body_html)


def render_alert_html(ctx: dict) -> str:
    status = ctx.get("status", "UNKNOWN")
    color_map = {"OK": "#16a34a", "WARNING": "#d97706", "CRITICAL": "#dc2626", "UNKNOWN": "#6b7280"}
    color = color_map.get(status, "#6b7280")
    is_recovery = status == "OK"
    is_test = ctx.get("is_test", False)
    title = "TEST: " if is_test else ""
    title += "Recovery" if is_recovery else "Alert"
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
        '<div style="padding:28px 32px;">'
        f'<table style="width:100%;border-collapse:collapse;font-size:14px;color:#334155;">'
        f'<tr><td style="padding:6px 0;font-weight:600;width:40%;">Rule</td><td>{ctx.get("alert_rule_name","")}</td></tr>'
        f'<tr><td style="padding:6px 0;font-weight:600;">Service</td><td>{ctx.get("service_name","")}</td></tr>'
        f'<tr><td style="padding:6px 0;font-weight:600;">Host</td><td>{ctx.get("host_name","")}</td></tr>'
        f'<tr><td style="padding:6px 0;font-weight:600;">Status</td><td style="color:{color};font-weight:700;">{status}</td></tr>'
        f'<tr><td style="padding:6px 0;font-weight:600;">Duration</td><td>{ctx.get("duration_minutes",0)} minutes</td></tr>'
        f'<tr><td style="padding:6px 0;font-weight:600;">Message</td><td>{ctx.get("message","")}</td></tr>'
        f'<tr><td style="padding:6px 0;font-weight:600;">Fired at</td><td>{ctx.get("fired_at","")}</td></tr>'
        '</table>'
        '</div>'
        '<div style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">'
        '<p style="color:#94a3b8;font-size:12px;margin:0;">This is an automated message from Overseer Monitoring.</p>'
        '</div>'
        '</div></body></html>'
    )


def render_2fa_code_html(code: str) -> str:
    return (
        '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
        '<body style="margin:0;padding:0;background:#f0f4f8;font-family:\'Segoe UI\',Arial,sans-serif;">'
        '<div style="max-width:480px;margin:40px auto;background:#fff;border-radius:12px;'
        'overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">'
        '<div style="background:#1e293b;padding:24px 32px;text-align:center;">'
        '<div style="color:#fff;font-size:22px;font-weight:700;">Overseer</div>'
        '<div style="color:#94a3b8;font-size:13px;margin-top:4px;">Monitoring System</div>'
        '</div>'
        '<div style="padding:32px;">'
        '<p style="color:#334155;font-size:15px;margin:0 0 20px;">Ihr Anmeldecode:</p>'
        '<div style="background:#f1f5f9;border:2px dashed #cbd5e1;border-radius:10px;'
        'text-align:center;padding:20px;">'
        f'<div style="font-size:36px;font-weight:700;letter-spacing:.4em;color:#1e293b;">{code}</div>'
        '<div style="font-size:12px;color:#94a3b8;margin-top:8px;">G\u00fcltig f\u00fcr 10 Minuten</div>'
        '</div>'
        '<p style="color:#94a3b8;font-size:12px;margin-top:20px;">'
        'Falls Sie sich nicht anmelden wollten, ignorieren Sie diese E-Mail.'
        '</p>'
        '</div>'
        '</div></body></html>'
    )
