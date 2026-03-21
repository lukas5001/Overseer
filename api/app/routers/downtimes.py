"""Overseer API – Downtimes router."""
import uuid as uuid_mod
from uuid import UUID
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user
from api.app.models.models import Downtime, CurrentStatus

router = APIRouter()


class DowntimeCreate(BaseModel):
    host_id: UUID | None = None
    service_id: UUID | None = None
    start_at: datetime
    end_at: datetime
    comment: str = ""


@router.post("/", status_code=201)
async def create_downtime(
    body: DowntimeCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    if not body.host_id and not body.service_id:
        raise HTTPException(status_code=422, detail="host_id or service_id required")
    if body.end_at <= body.start_at:
        raise HTTPException(status_code=422, detail="end_at must be after start_at")

    # Determine tenant_id from host or service
    if body.service_id:
        row = await db.execute(
            text("SELECT tenant_id, host_id FROM services WHERE id = :id"),
            {"id": body.service_id},
        )
        svc = row.fetchone()
        if not svc:
            raise HTTPException(status_code=404, detail="Service not found")
        tenant_id = svc.tenant_id
        host_id = body.host_id or svc.host_id
    else:
        row = await db.execute(
            text("SELECT tenant_id FROM hosts WHERE id = :id"),
            {"id": body.host_id},
        )
        h = row.fetchone()
        if not h:
            raise HTTPException(status_code=404, detail="Host not found")
        tenant_id = h.tenant_id
        host_id = body.host_id

    # Need a valid author_id — use first user as fallback for now
    row = await db.execute(text("SELECT id FROM users LIMIT 1"))
    author_id = row.scalar()

    dt_id = str(uuid_mod.uuid4())
    await db.execute(
        text("""
            INSERT INTO downtimes (id, tenant_id, host_id, service_id, start_at, end_at,
                                   author_id, comment, active)
            VALUES (:id, :tenant_id, :host_id, :service_id, :start_at, :end_at,
                    :author_id, :comment, true)
        """),
        {
            "id": dt_id,
            "tenant_id": tenant_id,
            "host_id": str(host_id) if host_id else None,
            "service_id": str(body.service_id) if body.service_id else None,
            "start_at": body.start_at,
            "end_at": body.end_at,
            "author_id": str(author_id),
            "comment": body.comment,
        },
    )

    # Mark affected current_status rows as in_downtime if downtime is active now
    now = datetime.now(timezone.utc)
    if body.start_at <= now <= body.end_at:
        if body.service_id:
            await db.execute(
                text("UPDATE current_status SET in_downtime = true WHERE service_id = :sid"),
                {"sid": body.service_id},
            )
        elif body.host_id:
            await db.execute(
                text("UPDATE current_status SET in_downtime = true WHERE host_id = :hid"),
                {"hid": body.host_id},
            )

    await db.commit()
    return {"id": dt_id, "status": "created"}


@router.delete("/{downtime_id}")
async def delete_downtime(
    downtime_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    result = await db.execute(select(Downtime).where(Downtime.id == downtime_id))
    dt = result.scalar_one_or_none()
    if not dt:
        raise HTTPException(status_code=404, detail="Downtime not found")

    # Remove in_downtime flag from affected services
    if dt.service_id:
        await db.execute(
            text("UPDATE current_status SET in_downtime = false WHERE service_id = :sid"),
            {"sid": dt.service_id},
        )
    elif dt.host_id:
        await db.execute(
            text("UPDATE current_status SET in_downtime = false WHERE host_id = :hid"),
            {"hid": dt.host_id},
        )

    dt.active = False
    await db.commit()
    return {"status": "deleted"}


@router.get("/")
async def list_downtimes(
    tenant_id: UUID | None = None,
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    q = select(Downtime)
    if tenant_id:
        q = q.where(Downtime.tenant_id == tenant_id)
    if active_only:
        now = datetime.now(timezone.utc)
        q = q.where(Downtime.active == True, Downtime.start_at <= now, Downtime.end_at >= now)
    result = await db.execute(q)
    return [
        {
            "id": str(d.id),
            "tenant_id": str(d.tenant_id),
            "host_id": str(d.host_id) if d.host_id else None,
            "service_id": str(d.service_id) if d.service_id else None,
            "start_at": d.start_at.isoformat() if d.start_at else None,
            "end_at": d.end_at.isoformat() if d.end_at else None,
            "comment": d.comment,
            "active": d.active,
        }
        for d in result.scalars().all()
    ]
