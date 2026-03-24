"""Overseer API – Audit log + dead-letter queue router."""
import os
import uuid
from datetime import datetime, timezone
from uuid import UUID

import redis.asyncio as redis_lib
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, require_role, tenant_scope, apply_tenant_filter
from api.app.models.models import AuditLog

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
DEAD_LETTER_STREAM = "overseer:dead-letters"

# Actions that are low-importance and hidden by default in the UI
MINOR_ACTIONS = {
    "preference_update", "saved_filter_create", "saved_filter_update",
    "saved_filter_delete", "saved_filter_set_default", "token_refresh",
}

router = APIRouter()


async def write_audit(
    db: AsyncSession,
    *,
    user: dict,
    action: str,
    target_type: str | None = None,
    target_id: UUID | None = None,
    tenant_id: UUID | None = None,
    detail: dict | None = None,
):
    """Insert one audit log entry. Call before db.commit() in write endpoints."""
    entry = AuditLog(
        tenant_id=tenant_id,
        actor_id=UUID(user["sub"]) if user.get("sub") else None,
        actor_email=user.get("email"),
        action=action,
        target_type=target_type,
        target_id=target_id,
        detail=detail or {},
        created_at=datetime.now(timezone.utc),
    )
    db.add(entry)


@router.get("/")
async def list_audit_log(
    response: Response,
    action: str | None = None,
    target_type: str | None = None,
    include_minor: bool = False,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope = Depends(tenant_scope),
):
    q = select(AuditLog).order_by(AuditLog.created_at.desc())
    q = apply_tenant_filter(q, AuditLog.tenant_id, _scope)
    if action:
        q = q.where(AuditLog.action == action)
    if target_type:
        q = q.where(AuditLog.target_type == target_type)
    if not include_minor:
        q = q.where(AuditLog.action.notin_(MINOR_ACTIONS))

    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar_one()
    response.headers["X-Total-Count"] = str(total)

    result = await db.execute(q.offset(offset).limit(limit))
    rows = result.scalars().all()

    return [
        {
            "id": str(e.id),
            "tenant_id": str(e.tenant_id) if e.tenant_id else None,
            "actor_email": e.actor_email,
            "action": e.action,
            "target_type": e.target_type,
            "target_id": str(e.target_id) if e.target_id else None,
            "detail": e.detail,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in rows
    ]


@router.get("/dead-letters")
async def list_dead_letters(
    count: int = Query(default=50, ge=1, le=200),
    _user: dict = Depends(require_role("super_admin")),
):
    """Read messages that the worker failed to process after MAX_RETRIES attempts."""
    r = redis_lib.from_url(REDIS_URL, decode_responses=True)
    try:
        entries = await r.xrevrange(DEAD_LETTER_STREAM, count=count)
    finally:
        await r.close()

    return [
        {
            "stream_id": entry_id,
            "original_id": data.get("original_id"),
            "error": data.get("error"),
            "delivery_count": data.get("delivery_count"),
            "failed_at": data.get("failed_at"),
            "data_preview": data.get("data", "")[:200],  # truncate large payloads
        }
        for entry_id, data in entries
    ]


@router.delete("/dead-letters/{stream_id}")
async def delete_dead_letter(
    stream_id: str,
    _user: dict = Depends(require_role("super_admin")),
):
    """Remove a specific dead-letter entry by its stream ID."""
    r = redis_lib.from_url(REDIS_URL, decode_responses=True)
    try:
        deleted = await r.xdel(DEAD_LETTER_STREAM, stream_id)
    finally:
        await r.close()
    if not deleted:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Dead-letter entry not found")
    return {"status": "deleted"}
