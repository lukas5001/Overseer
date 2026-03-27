"""Notification Plugin System – ABC + data classes."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone


@dataclass
class Notification:
    """Payload passed to every channel's send() method."""
    type: str                        # 'alert', 'recovery', 'test', 'ssl_certificate'
    host_name: str
    host_ip: str
    service_name: str
    status: str                      # 'OK', 'WARNING', 'CRITICAL', 'UNKNOWN', 'NO_DATA'
    previous_status: str
    message: str
    triggered_at: datetime
    duration: timedelta | None = None
    tenant_name: str = ""
    dashboard_url: str = ""
    alert_id: str | None = None
    extra_data: dict | None = None


@dataclass
class SendResult:
    """Result of a channel send attempt."""
    success: bool
    error: str | None = None
    http_status: int | None = None
    details: dict = field(default_factory=dict)


class NotificationChannel(ABC):
    """Base class every notification channel must implement."""

    @property
    @abstractmethod
    def channel_type(self) -> str:
        """Unique type key: 'email', 'webhook', 'slack', etc."""
        ...

    @property
    @abstractmethod
    def display_name(self) -> str:
        """Human-readable name for the UI."""
        ...

    @property
    @abstractmethod
    def config_schema(self) -> dict:
        """JSON Schema describing configuration fields for the frontend."""
        ...

    @abstractmethod
    async def send(self, notification: Notification, channel_config: dict) -> SendResult:
        """Send a notification. Must return SendResult."""
        ...

    async def validate_config(self, config: dict) -> list[str]:
        """Validate channel config. Return list of error messages (empty = OK)."""
        return []

    async def test_connection(self, config: dict) -> SendResult:
        """Send a test notification. Default implementation uses send()."""
        test_notification = Notification(
            type="test",
            host_name="test-host",
            host_ip="127.0.0.1",
            service_name="test-service",
            status="CRITICAL",
            previous_status="OK",
            message="This is a test notification from Overseer.",
            triggered_at=datetime.now(timezone.utc),
            tenant_name="Test Tenant",
        )
        return await self.send(test_notification, config)
