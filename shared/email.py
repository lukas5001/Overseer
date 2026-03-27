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
