"""Overseer API – Notification channels router."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, require_role, tenant_scope, apply_tenant_filter
from api.app.routers.audit import write_audit
from api.app.models.models import NotificationChannel

router = APIRouter()


class ChannelCreate(BaseModel):
    tenant_id: UUID
    name: str
    channel_type: str = "webhook"
    config: dict = {}
    events: list[str] = ["state_change"]


class ChannelUpdate(BaseModel):
    name: str | None = None
    config: dict | None = None
    events: list[str] | None = None
    active: bool | None = None


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
    return [
        {
            "id": str(ch.id),
            "tenant_id": str(ch.tenant_id),
            "name": ch.name,
            "channel_type": ch.channel_type,
            "config": ch.config,
            "events": ch.events,
            "active": ch.active,
            "created_at": ch.created_at.isoformat() if ch.created_at else None,
        }
        for ch in result.scalars().all()
    ]


@router.post("/", status_code=201)
async def create_channel(
    body: ChannelCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
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

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(channel, field, value)
    channel.updated_at = datetime.now(timezone.utc)
    changes = body.model_dump(exclude_none=True)
    await write_audit(db, user=_user, action="notification_channel_update",
                      target_type="notification_channel", target_id=channel_id,
                      tenant_id=channel.tenant_id,
                      detail={"changed_fields": list(changes.keys())})
    await db.commit()
    return {"id": str(channel.id), "name": channel.name, "active": channel.active}


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
    """Send a test notification through this channel."""
    import httpx

    result = await db.execute(
        select(NotificationChannel).where(NotificationChannel.id == channel_id)
    )
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    if channel.channel_type == "webhook":
        url = channel.config.get("url")
        if not url:
            raise HTTPException(status_code=422, detail="No URL configured")
        headers = channel.config.get("headers", {})
        payload = {
            "event": "test",
            "channel_name": channel.name,
            "message": "Overseer test notification",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(url, json=payload, headers=headers)
            return {"status": "sent", "http_status": resp.status_code}
        except httpx.RequestError as e:
            return {"status": "error", "detail": str(e)}
    else:
        raise HTTPException(status_code=422, detail=f"Unknown channel type: {channel.channel_type}")
