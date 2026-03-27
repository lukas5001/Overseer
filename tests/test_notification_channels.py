"""Tests for Slack, Teams, Telegram notification channels (Block 1.5)."""
import json
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from shared.notifications.base import Notification, SendResult
from shared.notifications.registry import ChannelRegistry
from shared.notifications.channels.slack import SlackChannel, _build_blocks, STATUS_EMOJI as SLACK_EMOJI
from shared.notifications.channels.teams import TeamsChannel, _build_adaptive_card
from shared.notifications.channels.telegram import (
    TelegramChannel, _build_message, escape_markdown_v2,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_notification(**overrides) -> Notification:
    defaults = dict(
        type="alert",
        host_name="web-prod-01",
        host_ip="10.0.1.15",
        service_name="cpu_check",
        status="CRITICAL",
        previous_status="OK",
        message="CPU is at 98.2%",
        triggered_at=datetime(2026, 3, 27, 14, 23, tzinfo=timezone.utc),
        tenant_name="Acme Corp",
    )
    defaults.update(overrides)
    return Notification(**defaults)


def _mock_httpx_response(status_code=200, text="ok", json_data=None):
    """Create a mock httpx response."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = text
    if json_data is not None:
        resp.json = MagicMock(return_value=json_data)
    else:
        resp.json = MagicMock(return_value={"ok": True})
    return resp


def _mock_httpx_client(response):
    """Create a mock httpx.AsyncClient context manager."""
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    return mock_client


# ── Registry Discovery ────────────────────────────────────────────────────────

class TestRegistryDiscovery:

    def setup_method(self):
        ChannelRegistry.reset()

    def test_auto_discovery_finds_new_channels(self):
        registry = ChannelRegistry.get()
        channels = registry.all_channels()
        assert "slack" in channels
        assert "teams" in channels
        assert "telegram" in channels

    def test_channel_types_info_includes_new_channels(self):
        registry = ChannelRegistry.get()
        types = registry.get_types_info()
        type_keys = [t["channel_type"] for t in types]
        assert "slack" in type_keys
        assert "teams" in type_keys
        assert "telegram" in type_keys


# ── Slack Tests ───────────────────────────────────────────────────────────────

class TestSlackChannel:

    def test_block_kit_format(self):
        """Slack message is formatted as Block Kit blocks."""
        notification = _make_notification()
        blocks = _build_blocks(notification)
        assert isinstance(blocks, list)
        assert len(blocks) >= 2
        # First block is header
        assert blocks[0]["type"] == "header"
        # Second block is section with details
        assert blocks[1]["type"] == "section"
        assert "mrkdwn" in blocks[1]["text"]["type"]

    def test_severity_emoji_critical(self):
        notification = _make_notification(status="CRITICAL")
        blocks = _build_blocks(notification)
        header_text = blocks[0]["text"]["text"]
        assert "\U0001f534" in header_text  # 🔴

    def test_severity_emoji_warning(self):
        notification = _make_notification(status="WARNING")
        blocks = _build_blocks(notification)
        header_text = blocks[0]["text"]["text"]
        assert "\U0001f7e0" in header_text  # 🟠

    def test_severity_emoji_recovery(self):
        notification = _make_notification(status="OK", previous_status="CRITICAL",
                                          duration=timedelta(minutes=23))
        blocks = _build_blocks(notification)
        header_text = blocks[0]["text"]["text"]
        assert "\u2705" in header_text  # ✅
        assert "RECOVERED" in header_text

    def test_dashboard_link_button(self):
        notification = _make_notification(dashboard_url="https://overseer.example.com/hosts/123")
        blocks = _build_blocks(notification)
        action_block = [b for b in blocks if b["type"] == "actions"]
        assert len(action_block) == 1
        assert action_block[0]["elements"][0]["url"] == "https://overseer.example.com/hosts/123"

    def test_no_dashboard_link_when_empty(self):
        notification = _make_notification(dashboard_url="")
        blocks = _build_blocks(notification)
        action_blocks = [b for b in blocks if b["type"] == "actions"]
        assert len(action_blocks) == 0

    def test_all_fields_present(self):
        notification = _make_notification(tenant_name="Acme Corp", duration=timedelta(minutes=5))
        blocks = _build_blocks(notification)
        section_text = blocks[1]["text"]["text"]
        assert "cpu_check" in section_text
        assert "CRITICAL" in section_text
        assert "web-prod-01" in section_text
        assert "10.0.1.15" in section_text
        assert "Acme Corp" in section_text
        assert "5 minutes" in section_text

    @pytest.mark.asyncio
    async def test_validate_config_valid(self):
        ch = SlackChannel()
        errors = await ch.validate_config({"webhook_url": "https://hooks.slack.com/services/T/B/X"})
        assert errors == []

    @pytest.mark.asyncio
    async def test_validate_config_missing_url(self):
        ch = SlackChannel()
        errors = await ch.validate_config({})
        assert len(errors) > 0
        assert "required" in errors[0].lower()

    @pytest.mark.asyncio
    async def test_validate_config_invalid_url(self):
        ch = SlackChannel()
        errors = await ch.validate_config({"webhook_url": "http://example.com/hook"})
        assert len(errors) > 0

    @pytest.mark.asyncio
    async def test_validate_config_discord_webhook(self):
        ch = SlackChannel()
        errors = await ch.validate_config({"webhook_url": "https://discord.com/api/webhooks/123/abc"})
        assert errors == []

    @pytest.mark.asyncio
    @patch("httpx.AsyncClient")
    async def test_send_success(self, mock_client_cls):
        resp = _mock_httpx_response(200)
        mock_client = _mock_httpx_client(resp)
        mock_client_cls.return_value = mock_client

        ch = SlackChannel()
        notification = _make_notification()
        result = await ch.send(notification, {"webhook_url": "https://hooks.slack.com/services/T/B/X"})
        assert result.success
        assert result.http_status == 200

        # Verify payload contains blocks
        call_args = mock_client.post.call_args
        payload = call_args[1]["json"]
        assert "blocks" in payload
        assert payload["username"] == "Overseer"

    @pytest.mark.asyncio
    @patch("httpx.AsyncClient")
    async def test_send_failure(self, mock_client_cls):
        resp = _mock_httpx_response(500, text="Internal Server Error")
        mock_client = _mock_httpx_client(resp)
        mock_client_cls.return_value = mock_client

        ch = SlackChannel()
        notification = _make_notification()
        result = await ch.send(notification, {"webhook_url": "https://hooks.slack.com/services/T/B/X"})
        assert not result.success
        assert result.http_status == 500

    @pytest.mark.asyncio
    async def test_send_no_url(self):
        ch = SlackChannel()
        notification = _make_notification()
        result = await ch.send(notification, {})
        assert not result.success
        assert "no webhook url" in result.error.lower()

    @pytest.mark.asyncio
    @patch("httpx.AsyncClient")
    async def test_send_timeout(self, mock_client_cls):
        import httpx
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=httpx.TimeoutException("timed out"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        ch = SlackChannel()
        notification = _make_notification()
        result = await ch.send(notification, {"webhook_url": "https://hooks.slack.com/services/T/B/X"})
        assert not result.success
        assert "timed out" in result.error.lower()

    @pytest.mark.asyncio
    @patch("httpx.AsyncClient")
    async def test_test_connection(self, mock_client_cls):
        resp = _mock_httpx_response(200)
        mock_client = _mock_httpx_client(resp)
        mock_client_cls.return_value = mock_client

        ch = SlackChannel()
        result = await ch.test_connection({"webhook_url": "https://hooks.slack.com/services/T/B/X"})
        assert result.success


# ── Teams Tests ───────────────────────────────────────────────────────────────

class TestTeamsChannel:

    def test_adaptive_card_structure(self):
        """Teams payload is a valid Adaptive Card structure."""
        notification = _make_notification()
        payload = _build_adaptive_card(notification)
        assert payload["type"] == "message"
        assert len(payload["attachments"]) == 1
        attachment = payload["attachments"][0]
        assert attachment["contentType"] == "application/vnd.microsoft.card.adaptive"
        card = attachment["content"]
        assert card["type"] == "AdaptiveCard"
        assert card["version"] == "1.4"
        assert len(card["body"]) >= 2

    def test_adaptive_card_all_fields(self):
        notification = _make_notification(tenant_name="Acme Corp", duration=timedelta(minutes=10))
        payload = _build_adaptive_card(notification)
        card = payload["attachments"][0]["content"]

        # Title
        title_block = card["body"][0]
        assert "CRITICAL" in title_block["text"]
        assert "web-prod-01" in title_block["text"]

        # FactSet
        fact_set = card["body"][1]
        assert fact_set["type"] == "FactSet"
        fact_titles = [f["title"] for f in fact_set["facts"]]
        assert "Service" in fact_titles
        assert "Status" in fact_titles
        assert "Host" in fact_titles
        assert "Tenant" in fact_titles
        assert "Duration" in fact_titles

    def test_adaptive_card_title_prefix(self):
        notification = _make_notification()
        payload = _build_adaptive_card(notification, title_prefix="[Production]")
        title = payload["attachments"][0]["content"]["body"][0]["text"]
        assert title.startswith("[Production]")

    def test_adaptive_card_dashboard_action(self):
        notification = _make_notification(dashboard_url="https://overseer.example.com/hosts/123")
        payload = _build_adaptive_card(notification)
        card = payload["attachments"][0]["content"]
        assert "actions" in card
        assert card["actions"][0]["type"] == "Action.OpenUrl"

    def test_adaptive_card_no_action_without_url(self):
        notification = _make_notification(dashboard_url="")
        payload = _build_adaptive_card(notification)
        card = payload["attachments"][0]["content"]
        assert "actions" not in card

    def test_adaptive_card_valid_json(self):
        """Entire payload serialises to valid JSON."""
        notification = _make_notification()
        payload = _build_adaptive_card(notification)
        dumped = json.dumps(payload)
        assert json.loads(dumped) == payload

    @pytest.mark.asyncio
    async def test_validate_config_valid(self):
        ch = TeamsChannel()
        errors = await ch.validate_config({"webhook_url": "https://prod.workflows.microsoft.com/abc"})
        assert errors == []

    @pytest.mark.asyncio
    async def test_validate_config_missing_url(self):
        ch = TeamsChannel()
        errors = await ch.validate_config({})
        assert len(errors) > 0

    @pytest.mark.asyncio
    async def test_validate_config_http_url(self):
        ch = TeamsChannel()
        errors = await ch.validate_config({"webhook_url": "http://insecure.example.com"})
        assert len(errors) > 0
        assert "HTTPS" in errors[0]

    @pytest.mark.asyncio
    @patch("httpx.AsyncClient")
    async def test_send_success(self, mock_client_cls):
        resp = _mock_httpx_response(200)
        mock_client = _mock_httpx_client(resp)
        mock_client_cls.return_value = mock_client

        ch = TeamsChannel()
        notification = _make_notification()
        result = await ch.send(notification, {"webhook_url": "https://prod.workflows.microsoft.com/abc"})
        assert result.success

        call_args = mock_client.post.call_args
        payload = call_args[1]["json"]
        assert payload["type"] == "message"

    @pytest.mark.asyncio
    async def test_send_no_url(self):
        ch = TeamsChannel()
        notification = _make_notification()
        result = await ch.send(notification, {})
        assert not result.success

    @pytest.mark.asyncio
    @patch("httpx.AsyncClient")
    async def test_send_timeout(self, mock_client_cls):
        import httpx
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=httpx.TimeoutException("timed out"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        ch = TeamsChannel()
        notification = _make_notification()
        result = await ch.send(notification, {"webhook_url": "https://prod.workflows.microsoft.com/abc"})
        assert not result.success
        assert "timed out" in result.error.lower()

    @pytest.mark.asyncio
    @patch("httpx.AsyncClient")
    async def test_test_connection(self, mock_client_cls):
        resp = _mock_httpx_response(200)
        mock_client = _mock_httpx_client(resp)
        mock_client_cls.return_value = mock_client

        ch = TeamsChannel()
        result = await ch.test_connection({"webhook_url": "https://prod.workflows.microsoft.com/abc"})
        assert result.success


# ── Telegram Tests ────────────────────────────────────────────────────────────

class TestTelegramChannel:

    def test_escape_markdown_v2_special_chars(self):
        """Escapes all MarkdownV2 special characters."""
        text = "web-01.example.com (10.0.1.15)"
        escaped = escape_markdown_v2(text)
        assert r"web\-01\.example\.com \(10\.0\.1\.15\)" == escaped

    def test_escape_markdown_v2_underscores(self):
        text = "cpu_check_total"
        escaped = escape_markdown_v2(text)
        assert r"cpu\_check\_total" == escaped

    def test_escape_markdown_v2_all_specials(self):
        """Test all MarkdownV2 special characters."""
        text = "_*[]()~`>#+-=|{}.!\\"
        escaped = escape_markdown_v2(text)
        # Every character should be escaped with a backslash
        for ch in "_*[]()~`>#+-=|{}.!\\":
            assert f"\\{ch}" in escaped

    def test_message_format_critical(self):
        notification = _make_notification(host_name="web-01.example.com")
        msg = _build_message(notification)
        assert "\U0001f534" in msg  # 🔴
        assert "CRITICAL" in msg
        assert r"web\-01\.example\.com" in msg
        assert "cpu\\_check" in msg

    def test_message_format_recovery(self):
        notification = _make_notification(
            status="OK", previous_status="CRITICAL",
            host_name="web-01", duration=timedelta(minutes=23),
        )
        msg = _build_message(notification)
        assert "RECOVERED" in msg
        assert "23 minutes" in msg

    def test_message_with_dashboard_url(self):
        notification = _make_notification(dashboard_url="https://overseer.example.com/hosts/123")
        msg = _build_message(notification)
        assert "[View in Overseer]" in msg
        assert "https://overseer.example.com/hosts/123" in msg

    @pytest.mark.asyncio
    async def test_validate_config_valid(self):
        ch = TelegramChannel()
        errors = await ch.validate_config({"bot_token": "123456789:ABCdefGHI-JKLmnop", "chat_id": "-100123456"})
        assert errors == []

    @pytest.mark.asyncio
    async def test_validate_config_missing_fields(self):
        ch = TelegramChannel()
        errors = await ch.validate_config({})
        assert len(errors) >= 2  # both token and chat_id

    @pytest.mark.asyncio
    async def test_validate_config_bad_token(self):
        ch = TelegramChannel()
        errors = await ch.validate_config({"bot_token": "not-a-token", "chat_id": "123"})
        assert len(errors) > 0
        assert "format" in errors[0].lower()

    @pytest.mark.asyncio
    @patch("httpx.AsyncClient")
    async def test_send_success(self, mock_client_cls):
        resp = _mock_httpx_response(200, json_data={"ok": True, "result": {}})
        mock_client = _mock_httpx_client(resp)
        mock_client_cls.return_value = mock_client

        ch = TelegramChannel()
        notification = _make_notification()
        result = await ch.send(notification, {"bot_token": "123:ABC", "chat_id": "-100123"})
        assert result.success

        call_args = mock_client.post.call_args
        payload = call_args[1]["json"]
        assert payload["parse_mode"] == "MarkdownV2"
        assert payload["chat_id"] == "-100123"

    @pytest.mark.asyncio
    @patch("httpx.AsyncClient")
    async def test_send_api_error(self, mock_client_cls):
        resp = _mock_httpx_response(400, json_data={"ok": False, "description": "Bad Request: chat not found"})
        mock_client = _mock_httpx_client(resp)
        mock_client_cls.return_value = mock_client

        ch = TelegramChannel()
        notification = _make_notification()
        result = await ch.send(notification, {"bot_token": "123:ABC", "chat_id": "invalid"})
        assert not result.success
        assert "chat not found" in result.error

    @pytest.mark.asyncio
    async def test_send_no_credentials(self):
        ch = TelegramChannel()
        notification = _make_notification()
        result = await ch.send(notification, {})
        assert not result.success

    @pytest.mark.asyncio
    @patch("httpx.AsyncClient")
    async def test_send_timeout(self, mock_client_cls):
        import httpx
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=httpx.TimeoutException("timed out"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        ch = TelegramChannel()
        notification = _make_notification()
        result = await ch.send(notification, {"bot_token": "123:ABC", "chat_id": "-100123"})
        assert not result.success
        assert "timed out" in result.error.lower()

    @pytest.mark.asyncio
    @patch("httpx.AsyncClient")
    async def test_test_connection(self, mock_client_cls):
        resp = _mock_httpx_response(200, json_data={"ok": True, "result": {}})
        mock_client = _mock_httpx_client(resp)
        mock_client_cls.return_value = mock_client

        ch = TelegramChannel()
        result = await ch.test_connection({"bot_token": "123:ABC", "chat_id": "-100123"})
        assert result.success
