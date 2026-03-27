"""Overseer Notification Plugin System."""
from shared.notifications.base import Notification, SendResult, NotificationChannel
from shared.notifications.registry import ChannelRegistry
from shared.notifications.dispatcher import Dispatcher

__all__ = [
    "Notification",
    "SendResult",
    "NotificationChannel",
    "ChannelRegistry",
    "Dispatcher",
]
