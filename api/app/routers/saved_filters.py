"""Overseer API – Saved Filters CRUD for error overview presets."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.auth import get_current_user
from api.app.core.database import get_db
from api.app.models.models import SavedFilter
from api.app.routers.audit import write_audit

router = APIRouter()


class FilterConfig(BaseModel):
    hidden_tenants: list[str] = []
    statuses: list[str] = []
    search: str = ""
    show_acknowledged: bool = False
    show_downtime: bool = False
    only_ack: bool = False
    only_downtime: bool = False
    sort_key: str = "status"
    sort_asc: bool = True


class SavedFilterCreate(BaseModel):
    name: str
    description: str | None = None
    filter_config: FilterConfig


class SavedFilterUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    filter_config: FilterConfig | None = None


class SavedFilterOut(BaseModel):
    id: str
    name: str
    description: str | None
    filter_config: dict
    created_by: str | None
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


@router.get("/")
async def list_saved_filters(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SavedFilter).order_by(SavedFilter.name)
    )
    filters = result.scalars().all()
    return [
        {
            "id": str(f.id),
            "name": f.name,
            "description": f.description,
            "filter_config": f.filter_config,
            "created_by": str(f.created_by) if f.created_by else None,
            "created_at": f.created_at.isoformat() if f.created_at else None,
            "updated_at": f.updated_at.isoformat() if f.updated_at else None,
        }
        for f in filters
    ]


@router.post("/", status_code=201)
async def create_saved_filter(
    body: SavedFilterCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    f = SavedFilter(
        name=body.name,
        description=body.description,
        filter_config=body.filter_config.model_dump(),
        created_by=user["sub"],
    )
    db.add(f)
    await db.flush()
    await write_audit(db, user=user, action="saved_filter_create",
                      target_type="saved_filter", target_id=f.id,
                      detail={"name": body.name})
    await db.commit()
    await db.refresh(f)
    return {"id": str(f.id), "name": f.name}


@router.put("/{filter_id}")
async def update_saved_filter(
    filter_id: UUID,
    body: SavedFilterUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    result = await db.execute(select(SavedFilter).where(SavedFilter.id == filter_id))
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="Filter nicht gefunden")

    if body.name is not None:
        f.name = body.name
    if body.description is not None:
        f.description = body.description
    if body.filter_config is not None:
        f.filter_config = body.filter_config.model_dump()
    f.updated_at = datetime.now(timezone.utc)
    await write_audit(db, user=user, action="saved_filter_update",
                      target_type="saved_filter", target_id=f.id,
                      detail={"name": f.name})
    await db.commit()
    return {"id": str(f.id), "name": f.name}


@router.delete("/default")
async def clear_default_filter(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Remove the default filter for the current user."""
    await db.execute(
        text("DELETE FROM user_preferences WHERE user_id = :uid"),
        {"uid": user["sub"]},
    )
    await db.commit()
    return {"status": "ok"}


@router.delete("/{filter_id}")
async def delete_saved_filter(
    filter_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    result = await db.execute(select(SavedFilter).where(SavedFilter.id == filter_id))
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="Filter nicht gefunden")

    await write_audit(db, user=user, action="saved_filter_delete",
                      target_type="saved_filter", target_id=f.id,
                      detail={"name": f.name})
    await db.delete(f)
    await db.commit()
    return {"status": "deleted"}


@router.put("/{filter_id}/set-default")
async def set_default_filter(
    filter_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Set a saved filter as the default view for the current user."""
    result = await db.execute(select(SavedFilter).where(SavedFilter.id == filter_id))
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="Filter nicht gefunden")

    await db.execute(
        text(
            "INSERT INTO user_preferences (user_id, default_filter_id, updated_at) "
            "VALUES (:uid, :fid, now()) "
            "ON CONFLICT (user_id) DO UPDATE SET default_filter_id = :fid, updated_at = now()"
        ),
        {"fid": str(filter_id), "uid": user["sub"]},
    )
    await write_audit(db, user=user, action="saved_filter_set_default",
                      target_type="saved_filter", target_id=f.id,
                      detail={"name": f.name})
    await db.commit()
    return {"status": "ok", "default_filter_id": str(filter_id)}
