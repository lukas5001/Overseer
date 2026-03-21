"""
Status & Error Overview endpoints.

This is the most important router – it powers the Fehlerübersicht
that employees watch continuously.
"""
from fastapi import APIRouter, Query
from uuid import UUID

from shared.schemas import ErrorOverviewItem, CurrentStatusOut, CheckStatus

router = APIRouter()


@router.get("/errors", response_model=list[ErrorOverviewItem])
async def get_error_overview(
    tenant_id: UUID | None = None,
    status: CheckStatus | None = None,
    acknowledged: bool | None = None,
    include_downtime: bool = False,
):
    """Get the live error overview – all non-OK checks.
    
    This is the main dashboard endpoint. Returns all checks in
    WARNING, CRITICAL, or UNKNOWN state, sorted by severity then duration.
    
    Filters:
    - tenant_id: Filter by specific tenant
    - status: Filter by specific status (WARNING, CRITICAL, UNKNOWN)
    - acknowledged: Filter by acknowledged state
    - include_downtime: Whether to include checks that are in a downtime window
    """
    # TODO: Implement with actual DB query
    # Query should:
    # 1. JOIN current_status + services + hosts + tenants
    # 2. WHERE status != 'OK' AND state_type = 'HARD'
    # 3. WHERE NOT in_downtime (unless include_downtime=True)
    # 4. Apply tenant_id filter (ALWAYS for non-super_admin)
    # 5. ORDER BY status DESC (CRITICAL first), last_state_change_at ASC (longest first)
    return []


@router.get("/summary")
async def get_status_summary(tenant_id: UUID | None = None):
    """Get a summary count of checks by status.
    
    Returns: { "ok": 1234, "warning": 12, "critical": 3, "unknown": 1, "total": 1250 }
    """
    # TODO: Implement with COUNT(*) GROUP BY status query
    return {"ok": 0, "warning": 0, "critical": 0, "unknown": 0, "total": 0}


@router.get("/host/{host_id}", response_model=list[CurrentStatusOut])
async def get_host_status(host_id: UUID):
    """Get all service statuses for a specific host."""
    # TODO: Implement
    return []


@router.post("/acknowledge/{service_id}")
async def acknowledge_problem(service_id: UUID, comment: str = ""):
    """Acknowledge a problem – marks it as 'being worked on'."""
    # TODO: Implement – update current_status.acknowledged = True
    return {"status": "acknowledged"}


@router.delete("/acknowledge/{service_id}")
async def remove_acknowledgement(service_id: UUID):
    """Remove acknowledgement from a problem."""
    # TODO: Implement
    return {"status": "removed"}
