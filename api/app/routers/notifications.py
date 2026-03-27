"""Overseer API – Notification channels router."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, require_role, tenant_scope, apply_tenant_filter
from api.app.routers.audit import write_audit
from api.app.models.models import NotificationChannel, NotificationLog

router = APIRouter()


class ChannelCreate(BaseModel):
    tenant_id: UUID
    name: str
    channel_type: str = "webhook"
    config: dict = {}
    events: list[str] = ["state_change"]


class ChannelUpdate(BaseModel):
    name: str | None = None
    channel_type: str | None = None
    config: dict | None = None
    events: list[str] | None = None
    active: bool | None = None


PASSWORD_MASK = "••••••••"


def _get_password_fields(channel_type: str) -> set[str]:
    """Return config field names that have format: 'password' in the channel's config_schema."""
    from shared.notifications.registry import ChannelRegistry
    registry = ChannelRegistry.get()
    impl = registry.get_channel(channel_type)
    if not impl:
        return set()
    schema = impl.config_schema
    props = schema.get("properties", {})
    return {k for k, v in props.items() if v.get("format") == "password"}


def _mask_config(config: dict, channel_type: str) -> dict:
    """Replace password fields with a mask for API output."""
    pw_fields = _get_password_fields(channel_type)
    if not pw_fields:
        return config
    masked = dict(config)
    for field in pw_fields:
        if field in masked and masked[field]:
            masked[field] = PASSWORD_MASK
    return masked


def _channel_out(ch: NotificationChannel) -> dict:
    return {
        "id": str(ch.id),
        "tenant_id": str(ch.tenant_id),
        "name": ch.name,
        "channel_type": ch.channel_type,
        "config": _mask_config(ch.config or {}, ch.channel_type),
        "events": ch.events,
        "active": ch.active,
        "consecutive_failures": ch.consecutive_failures,
        "last_failure_at": ch.last_failure_at.isoformat() if ch.last_failure_at else None,
        "last_failure_reason": ch.last_failure_reason,
        "created_at": ch.created_at.isoformat() if ch.created_at else None,
        "updated_at": ch.updated_at.isoformat() if ch.updated_at else None,
    }


@router.get("/types")
async def list_channel_types(
    _user: dict = Depends(get_current_user),
):
    """Return all registered notification channel types with their config schemas."""
    from shared.notifications.registry import ChannelRegistry
    registry = ChannelRegistry.get()
    return registry.get_types_info()


@router.get("/")
async def list_channels(
    tenant_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    q = select(NotificationChannel).order_by(NotificationChannel.name)
    q = apply_tenant_filter(q, NotificationChannel.tenant_id, _scope, tenant_id)
    result = await db.execute(q)
    return [_channel_out(ch) for ch in result.scalars().all()]


@router.post("/", status_code=201)
async def create_channel(
    body: ChannelCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    # Validate config against channel schema
    from shared.notifications.registry import ChannelRegistry
    registry = ChannelRegistry.get()
    channel_impl = registry.get_channel(body.channel_type)
    if channel_impl:
        errors = await channel_impl.validate_config(body.config)
        if errors:
            raise HTTPException(status_code=422, detail="; ".join(errors))

    channel = NotificationChannel(
        tenant_id=body.tenant_id,
        name=body.name,
        channel_type=body.channel_type,
        config=body.config,
        events=body.events,
    )
    db.add(channel)
    await write_audit(db, user=_user, action="notification_channel_create",
                      target_type="notification_channel",
                      tenant_id=body.tenant_id,
                      detail={"name": body.name, "type": body.channel_type})
    await db.commit()
    await db.refresh(channel)
    return {"id": str(channel.id), "name": channel.name}


@router.patch("/{channel_id}")
async def update_channel(
    channel_id: UUID,
    body: ChannelUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    result = await db.execute(
        select(NotificationChannel).where(NotificationChannel.id == channel_id)
    )
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    updates = body.model_dump(exclude_none=True)

    # If config is being updated, strip out masked password placeholders
    # so the original secret values are preserved
    if "config" in updates and updates["config"]:
        pw_fields = _get_password_fields(channel.channel_type)
        old_config = dict(channel.config or {})
        new_config = dict(updates["config"])
        for pf in pw_fields:
            if new_config.get(pf) == PASSWORD_MASK:
                new_config[pf] = old_config.get(pf, "")
        updates["config"] = new_config

    for field, value in updates.items():
        setattr(channel, field, value)
    channel.updated_at = datetime.now(timezone.utc)

    # If re-enabling, reset failure counter
    if body.active is True:
        channel.consecutive_failures = 0
        channel.last_failure_at = None
        channel.last_failure_reason = None

    changes = body.model_dump(exclude_none=True)
    await write_audit(db, user=_user, action="notification_channel_update",
                      target_type="notification_channel", target_id=channel_id,
                      tenant_id=channel.tenant_id,
                      detail={"changed_fields": list(changes.keys())})
    await db.commit()
    return _channel_out(channel)


@router.delete("/{channel_id}", status_code=204)
async def delete_channel(
    channel_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    result = await db.execute(
        select(NotificationChannel).where(NotificationChannel.id == channel_id)
    )
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    channel.active = False
    channel.updated_at = datetime.now(timezone.utc)
    await write_audit(db, user=_user, action="notification_channel_delete",
                      target_type="notification_channel", target_id=channel_id,
                      tenant_id=channel.tenant_id)
    await db.commit()


@router.post("/{channel_id}/test")
async def test_channel(
    channel_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    """Send a test notification through this channel using the plugin system."""
    result = await db.execute(
        select(NotificationChannel).where(NotificationChannel.id == channel_id)
    )
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    from shared.notifications.registry import ChannelRegistry
    registry = ChannelRegistry.get()
    channel_impl = registry.get_channel(channel.channel_type)
    if not channel_impl:
        raise HTTPException(status_code=422, detail=f"Unknown channel type: {channel.channel_type}")

    send_result = await channel_impl.test_connection(channel.config)
    return {
        "status": "sent" if send_result.success else "error",
        "detail": send_result.error if not send_result.success else None,
        "http_status": send_result.http_status,
    }


# ── Notification Log ──────────────────────────────────────────────────────────

@router.get("/log")
async def list_notification_log(
    tenant_id: UUID | None = None,
    channel_id: UUID | None = None,
    success: bool | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    """Return notification log entries (most recent first)."""
    q = select(NotificationLog).order_by(NotificationLog.sent_at.desc())
    q = apply_tenant_filter(q, NotificationLog.tenant_id, _scope, tenant_id)

    if channel_id is not None:
        q = q.where(NotificationLog.channel_id == channel_id)
    if success is not None:
        q = q.where(NotificationLog.success == success)

    # Count total
    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    q = q.offset(offset).limit(limit)
    result = await db.execute(q)

    from fastapi.responses import JSONResponse
    data = [
        {
            "id": str(log.id),
            "tenant_id": str(log.tenant_id),
            "channel_id": str(log.channel_id) if log.channel_id else None,
            "channel_type": log.channel_type,
            "notification_type": log.notification_type,
            "host_name": log.host_name,
            "service_name": log.service_name,
            "status": log.status,
            "success": log.success,
            "error_message": log.error_message,
            "sent_at": log.sent_at.isoformat() if log.sent_at else None,
        }
        for log in result.scalars().all()
    ]
    return JSONResponse(content=data, headers={"X-Total-Count": str(total)})


# ── Active Alert Groups ──────────────────────────────────────────────────────

@router.get("/alert-groups")
async def list_active_alert_groups(
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    """Return active alert groups from Redis."""
    import json
    import os
    import redis.asyncio as aioredis

    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    r = aioredis.from_url(redis_url, decode_responses=True)

    try:
        groups = []
        cursor = 0
        while True:
            cursor, keys = await r.scan(cursor=cursor, match="overseer:alert_group:*", count=100)
            for key in keys:
                # Skip timer/lock keys
                if ":lock:" in key or ":timer:" in key:
                    continue
                group_data = await r.hgetall(key)
                if not group_data or group_data.get("status") == "resolved":
                    continue
                tenant_id = group_data.get("tenant_id", "")
                # Apply tenant scope
                if _scope is not None and tenant_id not in [str(s) for s in _scope]:
                    continue
                try:
                    alerts = json.loads(group_data.get("alerts", "[]"))
                except json.JSONDecodeError:
                    alerts = []
                groups.append({
                    "group_key": group_data.get("group_key", ""),
                    "group_by": group_data.get("group_by", "host"),
                    "tenant_id": tenant_id,
                    "alert_count": int(group_data.get("alert_count", "0")),
                    "status": group_data.get("status", "pending"),
                    "alerts": alerts,
                    "created_at": group_data.get("created_at"),
                    "last_alert_at": group_data.get("last_alert_at"),
                    "last_notified_at": group_data.get("last_notified_at"),
                })
        return groups
    finally:
        await r.close()
