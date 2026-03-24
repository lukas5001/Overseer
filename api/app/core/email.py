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
