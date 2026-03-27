"""Auto-discovery registry for notification channels."""
from __future__ import annotations

import importlib
import logging
import pkgutil
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from shared.notifications.base import NotificationChannel

logger = logging.getLogger("overseer.notifications.registry")


class ChannelRegistry:
    """Discovers and manages notification channel implementations.

    On first access, scans shared/notifications/channels/ for classes
    that subclass NotificationChannel and registers them by channel_type.
    """

    _instance: ChannelRegistry | None = None
    _channels: dict[str, NotificationChannel]

    def __init__(self) -> None:
        self._channels = {}

    @classmethod
    def get(cls) -> ChannelRegistry:
        """Return the singleton registry, auto-discovering on first call."""
        if cls._instance is None:
            cls._instance = cls()
            cls._instance._discover()
        return cls._instance

    @classmethod
    def reset(cls) -> None:
        """Reset the singleton (useful for tests)."""
        cls._instance = None

    def _discover(self) -> None:
        """Scan the channels/ package and register all NotificationChannel subclasses."""
        from shared.notifications.base import NotificationChannel as BaseClass

        try:
            import shared.notifications.channels as channels_pkg
        except ImportError:
            logger.warning("Could not import shared.notifications.channels package")
            return

        for importer, modname, _ispkg in pkgutil.iter_modules(channels_pkg.__path__):
            try:
                module = importlib.import_module(f"shared.notifications.channels.{modname}")
                for attr_name in dir(module):
                    attr = getattr(module, attr_name)
                    if (
                        isinstance(attr, type)
                        and issubclass(attr, BaseClass)
                        and attr is not BaseClass
                    ):
                        instance = attr()
                        self._channels[instance.channel_type] = instance
                        logger.info("Registered notification channel: %s (%s)",
                                    instance.channel_type, instance.display_name)
            except Exception as e:
                logger.error("Failed to load channel module %s: %s", modname, e)

    def register(self, channel: NotificationChannel) -> None:
        """Manually register a channel instance."""
        self._channels[channel.channel_type] = channel

    def get_channel(self, channel_type: str) -> NotificationChannel | None:
        """Get a channel implementation by type key."""
        return self._channels.get(channel_type)

    def all_channels(self) -> dict[str, NotificationChannel]:
        """Return all registered channels."""
        return dict(self._channels)

    def get_types_info(self) -> list[dict]:
        """Return metadata for all registered channel types (for the API)."""
        return [
            {
                "channel_type": ch.channel_type,
                "display_name": ch.display_name,
                "config_schema": ch.config_schema,
            }
            for ch in self._channels.values()
        ]
