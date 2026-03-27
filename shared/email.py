"""Reusable async email sender for Overseer (SMTP via IONOS)."""
import asyncio
import os
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.ionos.it")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "overseer@dailycrust.it")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "overseer@dailycrust.it")


def _send_sync(
    to: str | list[str],
    subject: str,
    body_plain: str,
    body_html: str | None = None,
    attachments: list[tuple[str, bytes]] | None = None,
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
) -> None:
    if attachments:
        msg = MIMEMultipart("mixed")
        alt = MIMEMultipart("alternative")
        alt.attach(MIMEText(body_plain, "plain", "utf-8"))
        if body_html:
            alt.attach(MIMEText(body_html, "html", "utf-8"))
        msg.attach(alt)
        for filename, data in attachments:
            part = MIMEApplication(data, Name=filename)
            part["Content-Disposition"] = f'attachment; filename="{filename}"'
            msg.attach(part)
    elif body_html:
        msg = MIMEMultipart("alternative")
        msg.attach(MIMEText(body_plain, "plain", "utf-8"))
        msg.attach(MIMEText(body_html, "html", "utf-8"))
    else:
        msg = MIMEText(body_plain, "plain", "utf-8")

    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    recipients: list[str] = []
    if isinstance(to, list):
        msg["To"] = ", ".join(to)
        recipients.extend(to)
    else:
        msg["To"] = to
        recipients.append(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
        recipients.extend(cc)
    if bcc:
        recipients.extend(bcc)

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as s:
        s.starttls()
        s.login(SMTP_USER, SMTP_PASSWORD)
        s.sendmail(SMTP_FROM, recipients, msg.as_string())


async def send_email(to: str, subject: str, body_plain: str, body_html: str | None = None) -> None:
    await asyncio.to_thread(_send_sync, to, subject, body_plain, body_html)


async def send_email_with_attachment(
    to: list[str],
    subject: str,
    body_plain: str,
    body_html: str | None = None,
    attachments: list[tuple[str, bytes]] | None = None,
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
) -> None:
    await asyncio.to_thread(_send_sync, to, subject, body_plain, body_html, attachments, cc, bcc)
