"""Overseer API – Dependencies router for host/service dependency management."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, require_role, tenant_scope
from api.app.routers.audit import write_audit

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class DependencyCreate(BaseModel):
    source_type: str  # 'host' or 'service'
    source_id: UUID
    depends_on_type: str  # 'host' or 'service'
    depends_on_id: UUID


class DependencyOut(BaseModel):
    id: str
    tenant_id: str
    source_type: str
    source_id: str
    source_name: str | None = None
    depends_on_type: str
    depends_on_id: str
    depends_on_name: str | None = None
    created_at: str


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _resolve_name(db: AsyncSession, entity_type: str, entity_id: UUID) -> str | None:
    """Resolve a host or service name from ID."""
    if entity_type == "host":
        r = await db.execute(text("SELECT hostname FROM hosts WHERE id = :id"), {"id": entity_id})
    else:
        r = await db.execute(text("SELECT name FROM services WHERE id = :id"), {"id": entity_id})
    row = r.fetchone()
    return row[0] if row else None


async def _would_create_cycle(db: AsyncSession, source_type: str, source_id: UUID,
                               depends_on_type: str, depends_on_id: UUID) -> bool:
    """Check if adding this dependency would create a cycle (A→B→...→A)."""
    # Walk ancestors of depends_on_id. If we find source_id, there's a cycle.
    visited = set()
    queue = [(depends_on_type, depends_on_id)]

    while queue:
        etype, eid = queue.pop(0)
        if etype == source_type and eid == source_id:
            return True
        key = (etype, str(eid))
        if key in visited:
            continue
        visited.add(key)

        # Find what this entity depends on
        result = await db.execute(
            text("SELECT depends_on_type, depends_on_id FROM dependencies WHERE source_type = :st AND source_id = :sid"),
            {"st": etype, "sid": eid},
        )
        for row in result.fetchall():
            queue.append((row.depends_on_type, row.depends_on_id))

    return False


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/")
async def list_dependencies(
    host_id: UUID | None = None,
    service_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    """List dependencies. Filter by host_id or service_id to get deps for a specific entity."""
    conditions = ["1=1"]
    params: dict = {}

    if _scope is not None:
        placeholders = ", ".join(f":t{i}" for i in range(len(_scope)))
        conditions.append(f"d.tenant_id IN ({placeholders})")
        for i, tid in enumerate(_scope):
            params[f"t{i}"] = tid

    if host_id:
        conditions.append("((d.source_type = 'host' AND d.source_id = :entity_id) OR (d.depends_on_type = 'host' AND d.depends_on_id = :entity_id))")
        params["entity_id"] = host_id
    elif service_id:
        conditions.append("((d.source_type = 'service' AND d.source_id = :entity_id) OR (d.depends_on_type = 'service' AND d.depends_on_id = :entity_id))")
        params["entity_id"] = service_id

    where = " AND ".join(conditions)
    result = await db.execute(
        text(f"""
            SELECT d.*,
                   CASE d.source_type
                       WHEN 'host' THEN (SELECT hostname FROM hosts WHERE id = d.source_id)
                       ELSE (SELECT name FROM services WHERE id = d.source_id)
                   END AS source_name,
                   CASE d.depends_on_type
                       WHEN 'host' THEN (SELECT hostname FROM hosts WHERE id = d.depends_on_id)
                       ELSE (SELECT name FROM services WHERE id = d.depends_on_id)
                   END AS depends_on_name
            FROM dependencies d
            WHERE {where}
            ORDER BY d.created_at DESC
        """),
        params,
    )
    rows = result.fetchall()

    return [
        {
            "id": str(r.id),
            "tenant_id": str(r.tenant_id),
            "source_type": r.source_type,
            "source_id": str(r.source_id),
            "source_name": r.source_name,
            "depends_on_type": r.depends_on_type,
            "depends_on_id": str(r.depends_on_id),
            "depends_on_name": r.depends_on_name,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.post("/", status_code=201)
async def create_dependency(
    body: DependencyCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    _scope=Depends(tenant_scope),
):
    """Create a dependency between two entities. Rejects cycles."""
    # Validate entity types
    if body.source_type not in ("host", "service"):
        raise HTTPException(400, "source_type must be 'host' or 'service'")
    if body.depends_on_type not in ("host", "service"):
        raise HTTPException(400, "depends_on_type must be 'host' or 'service'")
    if body.source_type == body.depends_on_type and body.source_id == body.depends_on_id:
        raise HTTPException(400, "Entity cannot depend on itself")

    # Resolve tenant from source entity
    if body.source_type == "host":
        r = await db.execute(text("SELECT tenant_id FROM hosts WHERE id = :id"), {"id": body.source_id})
    else:
        r = await db.execute(text("SELECT tenant_id FROM services WHERE id = :id"), {"id": body.source_id})
    row = r.fetchone()
    if not row:
        raise HTTPException(404, f"Source {body.source_type} not found")
    tenant_id = row.tenant_id

    if _scope is not None and tenant_id not in _scope:
        raise HTTPException(403, "Access denied")

    # Verify depends_on entity exists
    dep_name = await _resolve_name(db, body.depends_on_type, body.depends_on_id)
    if dep_name is None:
        raise HTTPException(404, f"Depends-on {body.depends_on_type} not found")

    # Cycle detection
    if await _would_create_cycle(db, body.source_type, body.source_id, body.depends_on_type, body.depends_on_id):
        raise HTTPException(400, "This dependency would create a cycle")

    # Check for duplicate
    existing = await db.execute(
        text("""
            SELECT id FROM dependencies
            WHERE source_type = :st AND source_id = :sid
              AND depends_on_type = :dt AND depends_on_id = :did
        """),
        {"st": body.source_type, "sid": body.source_id, "dt": body.depends_on_type, "did": body.depends_on_id},
    )
    if existing.fetchone():
        raise HTTPException(400, "Dependency already exists")

    result = await db.execute(
        text("""
            INSERT INTO dependencies (tenant_id, source_type, source_id, depends_on_type, depends_on_id)
            VALUES (:tid, :st, :sid, :dt, :did)
            RETURNING id
        """),
        {"tid": tenant_id, "st": body.source_type, "sid": body.source_id, "dt": body.depends_on_type, "did": body.depends_on_id},
    )
    dep_id = result.fetchone().id

    source_name = await _resolve_name(db, body.source_type, body.source_id)
    await write_audit(
        db, user=user, action="dependency_create",
        target_type="dependency", target_id=dep_id,
        tenant_id=tenant_id,
        detail={
            "source": f"{body.source_type}:{source_name}",
            "depends_on": f"{body.depends_on_type}:{dep_name}",
        },
    )
    await db.commit()

    return {
        "id": str(dep_id),
        "source_type": body.source_type,
        "source_id": str(body.source_id),
        "source_name": source_name,
        "depends_on_type": body.depends_on_type,
        "depends_on_id": str(body.depends_on_id),
        "depends_on_name": dep_name,
    }


@router.delete("/{dep_id}", status_code=200)
async def delete_dependency(
    dep_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    _scope=Depends(tenant_scope),
):
    """Delete a dependency."""
    result = await db.execute(
        text("SELECT id, tenant_id, source_type, source_id, depends_on_type, depends_on_id FROM dependencies WHERE id = :id"),
        {"id": dep_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(404, "Dependency not found")
    if _scope is not None and row.tenant_id not in _scope:
        raise HTTPException(403, "Access denied")

    await db.execute(text("DELETE FROM dependencies WHERE id = :id"), {"id": dep_id})
    await write_audit(
        db, user=user, action="dependency_delete",
        target_type="dependency", target_id=dep_id,
        tenant_id=row.tenant_id,
    )
    await db.commit()
    return {"status": "deleted"}


@router.get("/tree")
async def dependency_tree(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    """Get the full dependency tree (all dependencies with names and current status)."""
    conditions = ["1=1"]
    params: dict = {}
    if _scope is not None:
        placeholders = ", ".join(f":t{i}" for i in range(len(_scope)))
        conditions.append(f"d.tenant_id IN ({placeholders})")
        for i, tid in enumerate(_scope):
            params[f"t{i}"] = tid

    where = " AND ".join(conditions)

    # Get all dependencies with entity names
    result = await db.execute(
        text(f"""
            SELECT d.*,
                   CASE d.source_type
                       WHEN 'host' THEN (SELECT hostname FROM hosts WHERE id = d.source_id)
                       ELSE (SELECT name FROM services WHERE id = d.source_id)
                   END AS source_name,
                   CASE d.depends_on_type
                       WHEN 'host' THEN (SELECT hostname FROM hosts WHERE id = d.depends_on_id)
                       ELSE (SELECT name FROM services WHERE id = d.depends_on_id)
                   END AS depends_on_name
            FROM dependencies d
            WHERE {where}
        """),
        params,
    )
    deps = result.fetchall()

    # Get current status of all hosts involved
    host_ids = set()
    for d in deps:
        if d.source_type == "host":
            host_ids.add(d.source_id)
        if d.depends_on_type == "host":
            host_ids.add(d.depends_on_id)

    host_statuses: dict = {}
    if host_ids:
        status_result = await db.execute(
            text("""
                SELECT h.id, COALESCE(
                    (SELECT MAX(CASE cs.status
                        WHEN 'CRITICAL' THEN 4 WHEN 'WARNING' THEN 3
                        WHEN 'NO_DATA' THEN 2 WHEN 'UNKNOWN' THEN 1 ELSE 0 END)
                     FROM current_status cs
                     JOIN services s ON cs.service_id = s.id
                     WHERE s.host_id = h.id AND s.active = true AND cs.state_type = 'HARD'),
                    0
                ) AS worst_severity
                FROM hosts h WHERE h.id = ANY(:ids)
            """),
            {"ids": list(host_ids)},
        )
        severity_map = {0: "OK", 1: "UNKNOWN", 2: "NO_DATA", 3: "WARNING", 4: "CRITICAL"}
        for r in status_result.fetchall():
            host_statuses[str(r.id)] = severity_map.get(r.worst_severity, "OK")

    return {
        "dependencies": [
            {
                "id": str(d.id),
                "source_type": d.source_type,
                "source_id": str(d.source_id),
                "source_name": d.source_name,
                "depends_on_type": d.depends_on_type,
                "depends_on_id": str(d.depends_on_id),
                "depends_on_name": d.depends_on_name,
            }
            for d in deps
        ],
        "host_statuses": host_statuses,
    }
