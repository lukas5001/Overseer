"""Overseer API – Monitoring Scripts router (server-managed scripts for agent checks)."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, require_role, tenant_scope
from api.app.models.models import MonitoringScript
from api.app.routers.audit import write_audit
from shared.schemas import MonitoringScriptOut, MonitoringScriptCreate, MonitoringScriptUpdate

router = APIRouter()


@router.get("/", response_model=list[MonitoringScriptOut])
async def list_scripts(
    tenant_id: UUID | None = Query(None),
    interpreter: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
    scope=Depends(tenant_scope),
):
    query = select(MonitoringScript)
    if scope is not None:
        query = query.where(MonitoringScript.tenant_id.in_(scope))
    if tenant_id is not None:
        query = query.where(MonitoringScript.tenant_id == tenant_id)
    if interpreter is not None:
        query = query.where(MonitoringScript.interpreter == interpreter)
    query = query.order_by(MonitoringScript.name)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{script_id}", response_model=MonitoringScriptOut)
async def get_script(
    script_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
    scope=Depends(tenant_scope),
):
    result = await db.execute(select(MonitoringScript).where(MonitoringScript.id == script_id))
    script = result.scalar_one_or_none()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    if scope is not None and script.tenant_id not in scope:
        raise HTTPException(status_code=403, detail="Access denied")
    return script


@router.post("/", response_model=MonitoringScriptOut, status_code=201)
async def create_script(
    body: MonitoringScriptCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    scope=Depends(tenant_scope),
):
    if scope is not None and body.tenant_id not in scope:
        raise HTTPException(status_code=403, detail="Access denied to this tenant")

    script = MonitoringScript(
        tenant_id=body.tenant_id,
        name=body.name,
        description=body.description,
        interpreter=body.interpreter,
        script_body=body.script_body,
        expected_output=body.expected_output,
        created_by=UUID(user["sub"]) if user.get("sub") else None,
    )
    db.add(script)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Script with this name already exists in this tenant")
    await db.refresh(script)

    await write_audit(
        db, user=user, action="script_create",
        target_type="monitoring_script", target_id=script.id,
        tenant_id=body.tenant_id,
        detail={"name": body.name, "interpreter": body.interpreter},
    )
    await db.commit()

    return script


@router.put("/{script_id}", response_model=MonitoringScriptOut)
async def update_script(
    script_id: UUID,
    body: MonitoringScriptUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    scope=Depends(tenant_scope),
):
    result = await db.execute(select(MonitoringScript).where(MonitoringScript.id == script_id))
    script = result.scalar_one_or_none()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    if scope is not None and script.tenant_id not in scope:
        raise HTTPException(status_code=403, detail="Access denied")

    if body.name is not None:
        script.name = body.name
    if body.description is not None:
        script.description = body.description
    if body.interpreter is not None:
        script.interpreter = body.interpreter
    if body.script_body is not None:
        script.script_body = body.script_body
    if body.expected_output is not None:
        script.expected_output = body.expected_output
    script.updated_at = datetime.now(timezone.utc)

    changes = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    await write_audit(
        db, user=user, action="script_update",
        target_type="monitoring_script", target_id=script_id,
        tenant_id=script.tenant_id,
        detail={"name": script.name, "changed_fields": list(changes.keys())},
    )

    await db.commit()
    await db.refresh(script)
    return script


@router.delete("/{script_id}", status_code=204)
async def delete_script(
    script_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    scope=Depends(tenant_scope),
):
    result = await db.execute(select(MonitoringScript).where(MonitoringScript.id == script_id))
    script = result.scalar_one_or_none()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    if scope is not None and script.tenant_id not in scope:
        raise HTTPException(status_code=403, detail="Access denied")

    await write_audit(
        db, user=user, action="script_delete",
        target_type="monitoring_script", target_id=script_id,
        tenant_id=script.tenant_id,
        detail={"name": script.name},
    )

    await db.delete(script)
    await db.commit()
