"""Tests for the Notification Plugin System (Block 1.4)."""
import asyncio
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from shared.notifications.base import Notification, SendResult, NotificationChannel
from shared.notifications.registry import ChannelRegistry
from shared.notifications.dispatcher import Dispatcher, RETRY_DELAYS, AUTO_DISABLE_THRESHOLD


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_notification(**overrides) -> Notification:
    defaults = dict(
        type="alert",
        host_name="test-host",
        host_ip="10.0.0.1",
        service_name="cpu_check",
        status="CRITICAL",
        previous_status="OK",
        message="CPU is at 99%",
        triggered_at=datetime(2026, 3, 27, 12, 0, tzinfo=timezone.utc),
        tenant_name="TestCo",
    )
    defaults.update(overrides)
    return Notification(**defaults)


def _make_channel_row(channel_type="webhook", config=None, **kw) -> dict:
    row = {
        "id": uuid4(),
        "channel_type": channel_type,
        "config": config or {"url": "https://hooks.example.com/test"},
        "name": f"Test {channel_type}",
    }
    row.update(kw)
    return row


class DummyChannel(NotificationChannel):
    """A channel that always succeeds (for testing)."""

    @property
    def channel_type(self) -> str:
        return "dummy"

    @property
    def display_name(self) -> str:
        return "Dummy"

    @property
    def config_schema(self) -> dict:
        return {"type": "object", "properties": {}}

    async def send(self, notification: Notification, channel_config: dict) -> SendResult:
        return SendResult(success=True)


class FailingChannel(NotificationChannel):
    """A channel that always fails (for testing)."""

    def __init__(self):
        self.send_count = 0

    @property
    def channel_type(self) -> str:
        return "failing"

    @property
    def display_name(self) -> str:
        return "Failing"

    @property
    def config_schema(self) -> dict:
        return {"type": "object", "properties": {}}

    async def send(self, notification: Notification, channel_config: dict) -> SendResult:
        self.send_count += 1
        return SendResult(success=False, error="Connection refused")


# ── Registry Tests ────────────────────────────────────────────────────────────

class TestChannelRegistry:

    def setup_method(self):
        ChannelRegistry.reset()

    def test_auto_discovery_finds_email_and_webhook(self):
        """Registry discovers built-in email and webhook channels."""
        registry = ChannelRegistry.get()
        assert "email" in registry.all_channels()
        assert "webhook" in registry.all_channels()

    def test_get_channel_returns_correct_type(self):
        registry = ChannelRegistry.get()
        email_ch = registry.get_channel("email")
        assert email_ch is not None
        assert email_ch.channel_type == "email"
        assert email_ch.display_name == "Email"

    def test_get_channel_unknown_returns_none(self):
        registry = ChannelRegistry.get()
        assert registry.get_channel("nonexistent") is None

    def test_manual_register(self):
        registry = ChannelRegistry.get()
        dummy = DummyChannel()
        registry.register(dummy)
        assert registry.get_channel("dummy") is dummy

    def test_get_types_info(self):
        registry = ChannelRegistry.get()
        types = registry.get_types_info()
        assert len(types) >= 2
        type_keys = [t["channel_type"] for t in types]
        assert "email" in type_keys
        assert "webhook" in type_keys
        for t in types:
            assert "config_schema" in t
            assert "display_name" in t

    def test_singleton_pattern(self):
        r1 = ChannelRegistry.get()
        r2 = ChannelRegistry.get()
        assert r1 is r2

    def test_reset_creates_new_instance(self):
        r1 = ChannelRegistry.get()
        ChannelRegistry.reset()
        r2 = ChannelRegistry.get()
        assert r1 is not r2

    def test_config_schema_structure(self):
        """Each channel's config_schema should be a valid JSON Schema-like dict."""
        registry = ChannelRegistry.get()
        for ch in registry.all_channels().values():
            schema = ch.config_schema
            assert isinstance(schema, dict)
            assert "properties" in schema


# ── Email Channel Tests ───────────────────────────────────────────────────────

class TestEmailChannel:

    def setup_method(self):
        ChannelRegistry.reset()

    @pytest.mark.asyncio
    async def test_email_validate_config_valid(self):
        registry = ChannelRegistry.get()
        ch = registry.get_channel("email")
        errors = await ch.validate_config({"email": "test@example.com"})
        assert errors == []

    @pytest.mark.asyncio
    async def test_email_validate_config_missing(self):
        registry = ChannelRegistry.get()
        ch = registry.get_channel("email")
        errors = await ch.validate_config({})
        assert len(errors) > 0
        assert "required" in errors[0].lower()

    @pytest.mark.asyncio
    async def test_email_validate_config_invalid(self):
        registry = ChannelRegistry.get()
        ch = registry.get_channel("email")
        errors = await ch.validate_config({"email": "not-an-email"})
        assert len(errors) > 0

    @pytest.mark.asyncio
    async def test_email_send_no_address(self):
        registry = ChannelRegistry.get()
        ch = registry.get_channel("email")
        notification = _make_notification()
        result = await ch.send(notification, {})
        assert not result.success
        assert "no email" in result.error.lower()

    @pytest.mark.asyncio
    @patch("shared.email.send_email", new_callable=AsyncMock)
    async def test_email_send_success(self, mock_send):
        registry = ChannelRegistry.get()
        ch = registry.get_channel("email")
        notification = _make_notification()
        result = await ch.send(notification, {"email": "ops@example.com"})
        assert result.success
        mock_send.assert_called_once()
        # Verify subject and HTML body
        call_args = mock_send.call_args
        assert "ops@example.com" == call_args[0][0]
        assert "CRITICAL" in call_args[0][1]  # subject

    @pytest.mark.asyncio
    @patch("shared.email.send_email", new_callable=AsyncMock, side_effect=Exception("SMTP error"))
    async def test_email_send_failure(self, mock_send):
        registry = ChannelRegistry.get()
        ch = registry.get_channel("email")
        notification = _make_notification()
        result = await ch.send(notification, {"email": "ops@example.com"})
        assert not result.success
        assert "SMTP error" in result.error


# ── Webhook Channel Tests ─────────────────────────────────────────────────────

class TestWebhookChannel:

    def setup_method(self):
        ChannelRegistry.reset()

    @pytest.mark.asyncio
    async def test_webhook_validate_config_valid(self):
        registry = ChannelRegistry.get()
        ch = registry.get_channel("webhook")
        errors = await ch.validate_config({"url": "https://hooks.example.com"})
        assert errors == []

    @pytest.mark.asyncio
    async def test_webhook_validate_config_missing_url(self):
        registry = ChannelRegistry.get()
        ch = registry.get_channel("webhook")
        errors = await ch.validate_config({})
        assert len(errors) > 0

    @pytest.mark.asyncio
    async def test_webhook_validate_config_bad_url(self):
        registry = ChannelRegistry.get()
        ch = registry.get_channel("webhook")
        errors = await ch.validate_config({"url": "not-a-url"})
        assert len(errors) > 0

    @pytest.mark.asyncio
    async def test_webhook_send_no_url(self):
        registry = ChannelRegistry.get()
        ch = registry.get_channel("webhook")
        notification = _make_notification()
        result = await ch.send(notification, {})
        assert not result.success
        assert "no url" in result.error.lower()

    @pytest.mark.asyncio
    @patch("httpx.AsyncClient")
    async def test_webhook_send_success(self, mock_client_cls):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        registry = ChannelRegistry.get()
        ch = registry.get_channel("webhook")
        notification = _make_notification()
        result = await ch.send(notification, {"url": "https://hooks.example.com/test"})
        assert result.success
        assert result.http_status == 200


# ── Dispatcher Tests ──────────────────────────────────────────────────────────

class TestDispatcher:

    def setup_method(self):
        ChannelRegistry.reset()

    def _mock_session_factory(self):
        """Create a mock async session factory."""
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=MagicMock(fetchone=MagicMock(return_value=MagicMock(consecutive_failures=0))))
        mock_db.commit = AsyncMock()
        mock_db.__aenter__ = AsyncMock(return_value=mock_db)
        mock_db.__aexit__ = AsyncMock(return_value=False)

        factory = MagicMock()
        factory.return_value = mock_db
        return factory

    @pytest.mark.asyncio
    async def test_dispatch_to_dummy_channel(self):
        """Dispatcher sends to a registered channel successfully."""
        registry = ChannelRegistry.get()
        dummy = DummyChannel()
        registry.register(dummy)

        factory = self._mock_session_factory()
        dispatcher = Dispatcher(factory)
        notification = _make_notification()
        channel_row = _make_channel_row(channel_type="dummy", config={})

        results = await dispatcher.dispatch(notification, [channel_row], uuid4())
        assert len(results) == 1
        assert results[0].success

    @pytest.mark.asyncio
    async def test_dispatch_unknown_channel_type(self):
        """Dispatcher handles unknown channel type gracefully."""
        factory = self._mock_session_factory()
        dispatcher = Dispatcher(factory)
        notification = _make_notification()
        channel_row = _make_channel_row(channel_type="nonexistent")

        results = await dispatcher.dispatch(notification, [channel_row], uuid4())
        assert len(results) == 1
        assert not results[0].success
        assert "Unknown channel type" in results[0].error

    @pytest.mark.asyncio
    @patch("shared.notifications.dispatcher.RETRY_DELAYS", [0, 0, 0])
    async def test_dispatch_retry_on_failure(self):
        """Dispatcher retries failed sends."""
        registry = ChannelRegistry.get()
        failing = FailingChannel()
        registry.register(failing)

        factory = self._mock_session_factory()
        dispatcher = Dispatcher(factory)
        notification = _make_notification()
        channel_row = _make_channel_row(channel_type="failing", config={})

        results = await dispatcher.dispatch(notification, [channel_row], uuid4())
        assert len(results) == 1
        assert not results[0].success
        # Should have attempted 4 times (1 initial + 3 retries)
        assert failing.send_count == 4

    @pytest.mark.asyncio
    async def test_dispatch_multiple_channels_concurrently(self):
        """Dispatcher sends to multiple channels concurrently."""
        registry = ChannelRegistry.get()
        dummy = DummyChannel()
        registry.register(dummy)

        factory = self._mock_session_factory()
        dispatcher = Dispatcher(factory)
        notification = _make_notification()
        channels = [
            _make_channel_row(channel_type="dummy", config={}),
            _make_channel_row(channel_type="dummy", config={}),
            _make_channel_row(channel_type="dummy", config={}),
        ]

        results = await dispatcher.dispatch(notification, channels, uuid4())
        assert len(results) == 3
        assert all(r.success for r in results)

    @pytest.mark.asyncio
    @patch("shared.notifications.dispatcher.RETRY_DELAYS", [0, 0, 0])
    async def test_auto_disable_after_threshold(self):
        """Channel gets auto-disabled after consecutive failures."""
        registry = ChannelRegistry.get()
        failing = FailingChannel()
        registry.register(failing)

        # Mock DB to return failure count at threshold
        mock_db = AsyncMock()
        mock_row = MagicMock()
        mock_row.consecutive_failures = AUTO_DISABLE_THRESHOLD
        mock_result = MagicMock()
        mock_result.fetchone = MagicMock(return_value=mock_row)
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db.commit = AsyncMock()
        mock_db.__aenter__ = AsyncMock(return_value=mock_db)
        mock_db.__aexit__ = AsyncMock(return_value=False)

        factory = MagicMock(return_value=mock_db)
        dispatcher = Dispatcher(factory)
        notification = _make_notification()
        channel_row = _make_channel_row(channel_type="failing", config={})

        await dispatcher.dispatch(notification, [channel_row], uuid4())

        # Verify that db.execute was called (for failure tracking + auto-disable)
        assert mock_db.execute.call_count > 0

    @pytest.mark.asyncio
    async def test_success_resets_failures(self):
        """Successful send resets consecutive_failures counter."""
        registry = ChannelRegistry.get()
        dummy = DummyChannel()
        registry.register(dummy)

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock()
        mock_db.commit = AsyncMock()
        mock_db.__aenter__ = AsyncMock(return_value=mock_db)
        mock_db.__aexit__ = AsyncMock(return_value=False)

        factory = MagicMock(return_value=mock_db)
        dispatcher = Dispatcher(factory)
        notification = _make_notification()
        channel_row = _make_channel_row(channel_type="dummy", config={})

        await dispatcher.dispatch(notification, [channel_row], uuid4())

        # Verify reset query was called
        calls = mock_db.execute.call_args_list
        # Should have at least the reset call and the log call
        assert len(calls) >= 2

    @pytest.mark.asyncio
    async def test_notification_log_written(self):
        """Every send attempt triggers a log write (factory called for logging)."""
        registry = ChannelRegistry.get()
        dummy = DummyChannel()
        registry.register(dummy)

        factory_call_count = 0

        def counting_factory():
            nonlocal factory_call_count
            factory_call_count += 1
            mock_db = AsyncMock()
            mock_db.execute = AsyncMock(return_value=MagicMock(
                fetchone=MagicMock(return_value=MagicMock(consecutive_failures=0))
            ))
            mock_db.commit = AsyncMock()
            mock_db.__aenter__ = AsyncMock(return_value=mock_db)
            mock_db.__aexit__ = AsyncMock(return_value=False)
            return mock_db

        factory = MagicMock(side_effect=counting_factory)
        dispatcher = Dispatcher(factory)
        notification = _make_notification()
        channel_row = _make_channel_row(channel_type="dummy", config={})

        await dispatcher.dispatch(notification, [channel_row], uuid4())

        # Factory should be called at least twice: once for _on_success, once for _log_send
        assert factory_call_count >= 2


# ── Notification Data Class Tests ─────────────────────────────────────────────

class TestNotificationDataclass:

    def test_notification_creation(self):
        n = _make_notification()
        assert n.host_name == "test-host"
        assert n.status == "CRITICAL"
        assert n.extra_data is None

    def test_notification_with_extra_data(self):
        n = _make_notification(extra_data={"cert_subject": "*.example.com"})
        assert n.extra_data["cert_subject"] == "*.example.com"

    def test_send_result_success(self):
        r = SendResult(success=True)
        assert r.success
        assert r.error is None

    def test_send_result_failure(self):
        r = SendResult(success=False, error="Connection refused", http_status=500)
        assert not r.success
        assert r.error == "Connection refused"
        assert r.http_status == 500


# ── Test Connection Tests ─────────────────────────────────────────────────────

class TestTestConnection:

    def setup_method(self):
        ChannelRegistry.reset()

    @pytest.mark.asyncio
    async def test_test_connection_uses_send(self):
        """test_connection sends a test notification via send()."""
        dummy = DummyChannel()
        result = await dummy.test_connection({})
        assert result.success

    @pytest.mark.asyncio
    async def test_test_connection_on_failing_channel(self):
        failing = FailingChannel()
        result = await failing.test_connection({})
        assert not result.success
