"""Overseer API – Global Check Policies router."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, require_role
from api.app.models.models import GlobalCheckPolicy, Tenant

router = APIRouter()


class PolicyCreate(BaseModel):
    name: str
    description: str = ""
    check_type: str
    merge_config: dict = {}
    merge_strategy: str = "merge"
    scope_mode: str = "all"
    scope_tenant_ids: list[UUID] = []
    enabled: bool = True
    priority: int = 0


class PolicyUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    check_type: str | None = None
    merge_config: dict | None = None
    merge_strategy: str | None = None
    scope_mode: str | None = None
    scope_tenant_ids: list[UUID] | None = None
    enabled: bool | None = None
    priority: int | None = None


def _policy_out(p: GlobalCheckPolicy) -> dict:
    return {
        "id": str(p.id),
        "name": p.name,
        "description": p.description,
        "check_type": p.check_type,
        "merge_config": p.merge_config,
        "merge_strategy": p.merge_strategy,
        "scope_mode": p.scope_mode,
        "scope_tenant_ids": [str(t) for t in (p.scope_tenant_ids or [])],
        "enabled": p.enabled,
        "priority": p.priority,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


@router.get("/")
async def list_global_policies(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    result = await db.execute(
        select(GlobalCheckPolicy).order_by(GlobalCheckPolicy.priority, GlobalCheckPolicy.name)
    )
    policies = result.scalars().all()

    # Resolve tenant names for scope_tenant_ids
    all_tenant_ids: set[UUID] = set()
    for p in policies:
        all_tenant_ids.update(p.scope_tenant_ids or [])

    tenant_names: dict[str, str] = {}
    if all_tenant_ids:
        t_result = await db.execute(select(Tenant.id, Tenant.name).where(Tenant.id.in_(all_tenant_ids)))
        tenant_names = {str(r.id): r.name for r in t_result.all()}

    out = []
    for p in policies:
        d = _policy_out(p)
        d["scope_tenant_names"] = [tenant_names.get(tid, tid) for tid in d["scope_tenant_ids"]]
        out.append(d)
    return out


@router.post("/", status_code=201)
async def create_global_policy(
    body: PolicyCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin")),
):
    if body.merge_strategy not in ("merge", "override"):
        raise HTTPException(status_code=400, detail="merge_strategy must be 'merge' or 'override'")
    if body.scope_mode not in ("all", "include_tenants", "exclude_tenants"):
        raise HTTPException(status_code=400, detail="scope_mode must be 'all', 'include_tenants', or 'exclude_tenants'")

    policy = GlobalCheckPolicy(
        name=body.name,
        description=body.description,
        check_type=body.check_type,
        merge_config=body.merge_config,
        merge_strategy=body.merge_strategy,
        scope_mode=body.scope_mode,
        scope_tenant_ids=body.scope_tenant_ids,
        enabled=body.enabled,
        priority=body.priority,
    )
    db.add(policy)
    await db.commit()
    await db.refresh(policy)
    return _policy_out(policy)


@router.get("/{policy_id}")
async def get_global_policy(
    policy_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    policy = await db.get(GlobalCheckPolicy, policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    return _policy_out(policy)


@router.patch("/{policy_id}")
async def update_global_policy(
    policy_id: UUID,
    body: PolicyUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin")),
):
    policy = await db.get(GlobalCheckPolicy, policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    if body.merge_strategy is not None and body.merge_strategy not in ("merge", "override"):
        raise HTTPException(status_code=400, detail="merge_strategy must be 'merge' or 'override'")
    if body.scope_mode is not None and body.scope_mode not in ("all", "include_tenants", "exclude_tenants"):
        raise HTTPException(status_code=400, detail="scope_mode must be 'all', 'include_tenants', or 'exclude_tenants'")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(policy, field, value)
    policy.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(policy)
    return _policy_out(policy)


@router.delete("/{policy_id}", status_code=204)
async def delete_global_policy(
    policy_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin")),
):
    policy = await db.get(GlobalCheckPolicy, policy_id)
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    await db.delete(policy)
    await db.commit()
