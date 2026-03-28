"""Overseer API – Agent token management and agent-facing endpoints."""
import hashlib
import secrets
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Header, Request, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, require_role, tenant_scope, apply_tenant_filter
from api.app.routers.audit import write_audit
from shared.check_policies import apply_global_policies, LOAD_POLICIES_SQL

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class AgentTokenResponse(BaseModel):
    token: str
    host_id: str
    expires_hint: str = "never"


class AgentTokenInfo(BaseModel):
    active: bool
    last_seen_at: datetime | None
    agent_version: str | None
    agent_os: str | None
    created_at: datetime


class HeartbeatRequest(BaseModel):
    agent_version: str | None = None
    os: str | None = None
    hostname: str | None = None


class AgentCheckDef(BaseModel):
    service_id: str
    name: str
    check_type: str
    config: dict
    interval_seconds: int
    threshold_warn: float | None
    threshold_crit: float | None
    max_check_attempts: int
    retry_interval_seconds: int = 15


class LogSourceDef(BaseModel):
    source_type: str          # 'file', 'journald', 'windows_eventlog'
    config: dict


class LogCollectionConfig(BaseModel):
    enabled: bool = False
    batch_size: int = 1000
    flush_interval_seconds: int = 5
    sources: list[LogSourceDef] = []


class AgentConfigResponse(BaseModel):
    host_id: str
    hostname: str
    tenant_id: str
    config_interval_seconds: int = 300
    checks: list[AgentCheckDef]
    log_collection: LogCollectionConfig = LogCollectionConfig()


# ── Agent Token Auth Dependency ──────────────────────────────────────────────

async def get_agent_auth(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Validate X-Agent-Token header. Returns {host_id, tenant_id, token_id}."""
    token = request.headers.get("X-Agent-Token")
    if not token:
        raise HTTPException(status_code=401, detail="Missing X-Agent-Token header")

    token_hash = hashlib.sha256(token.encode()).hexdigest()

    result = await db.execute(
        text("""
            SELECT at.id, at.host_id, at.tenant_id, h.hostname
            FROM agent_tokens at
            JOIN hosts h ON h.id = at.host_id
            JOIN tenants t ON t.id = at.tenant_id
            WHERE at.token_hash = :hash
              AND at.active = true
              AND h.active = true
              AND t.active = true
        """),
        {"hash": token_hash},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Invalid or inactive agent token")

    return {
        "token_id": str(row.id),
        "host_id": str(row.host_id),
        "tenant_id": str(row.tenant_id),
        "hostname": row.hostname,
    }


# ── Admin Endpoints (JWT Auth) ───────────────────────────────────────────────

@router.post("/hosts/{host_id}/agent-token", response_model=AgentTokenResponse)
async def generate_agent_token(
    host_id: UUID,
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    scope=Depends(tenant_scope),
    db: AsyncSession = Depends(get_db),
):
    """Generate a new agent token for a host. Token is returned once in plaintext."""
    # Verify host exists and user has access
    host = await db.execute(
        text("SELECT id, tenant_id, hostname, agent_managed FROM hosts WHERE id = :id AND active = true"),
        {"id": host_id},
    )
    host_row = host.fetchone()
    if not host_row:
        raise HTTPException(status_code=404, detail="Host not found")

    # Agent-Tokens nur für agent-fähige Host-Typen
    ht_result = await db.execute(
        text("SELECT ht.agent_capable FROM host_types ht JOIN hosts h ON h.host_type_id = ht.id WHERE h.id = :id"),
        {"id": host_id},
    )
    ht_row = ht_result.fetchone()
    if ht_row and not ht_row.agent_capable:
        raise HTTPException(
            status_code=400,
            detail="Agent-Tokens können nur für agent-fähige Host-Typen generiert werden.",
        )

    # Tenant scope check
    if scope is not None and host_row.tenant_id not in scope:
        raise HTTPException(status_code=403, detail="Access denied to this tenant")

    # Deactivate existing tokens for this host
    await db.execute(
        text("UPDATE agent_tokens SET active = false WHERE host_id = :hid AND active = true"),
        {"hid": host_id},
    )

    # Generate token
    raw_token = "overseer_agent_" + secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    token_prefix = raw_token[:16]

    await db.execute(
        text("""
            INSERT INTO agent_tokens (host_id, tenant_id, token_hash, token_prefix, name, active, created_at)
            VALUES (:host_id, :tenant_id, :hash, :prefix, 'default', true, :now)
        """),
        {
            "host_id": host_id,
            "tenant_id": host_row.tenant_id,
            "hash": token_hash,
            "prefix": token_prefix,
            "now": datetime.now(timezone.utc),
        },
    )

    # Set agent_managed = true
    await db.execute(
        text("UPDATE hosts SET agent_managed = true WHERE id = :id"),
        {"id": host_id},
    )

    await write_audit(
        db, user=user, action="agent_token_create",
        target_type="host", target_id=host_id,
        tenant_id=host_row.tenant_id,
        detail={"hostname": host_row.hostname},
    )

    await db.commit()

    return AgentTokenResponse(token=raw_token, host_id=str(host_id))


@router.delete("/hosts/{host_id}/agent-token", status_code=200)
async def revoke_agent_token(
    host_id: UUID,
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    scope=Depends(tenant_scope),
    db: AsyncSession = Depends(get_db),
):
    """Revoke the agent token for a host."""
    host = await db.execute(
        text("SELECT id, tenant_id, hostname FROM hosts WHERE id = :id"),
        {"id": host_id},
    )
    host_row = host.fetchone()
    if not host_row:
        raise HTTPException(status_code=404, detail="Host not found")

    if scope is not None and host_row.tenant_id not in scope:
        raise HTTPException(status_code=403, detail="Access denied to this tenant")

    await db.execute(
        text("UPDATE agent_tokens SET active = false WHERE host_id = :hid AND active = true"),
        {"hid": host_id},
    )
    await db.execute(
        text("UPDATE hosts SET agent_managed = false WHERE id = :id"),
        {"id": host_id},
    )

    await write_audit(
        db, user=user, action="agent_token_revoke",
        target_type="host", target_id=host_id,
        tenant_id=host_row.tenant_id,
        detail={"hostname": host_row.hostname},
    )

    await db.commit()
    return {"status": "revoked"}


@router.get("/hosts/{host_id}/agent-token", response_model=AgentTokenInfo)
async def get_agent_token_info(
    host_id: UUID,
    user: dict = Depends(get_current_user),
    scope=Depends(tenant_scope),
    db: AsyncSession = Depends(get_db),
):
    """Get agent token metadata (NOT the token itself)."""
    host = await db.execute(
        text("SELECT tenant_id FROM hosts WHERE id = :id"),
        {"id": host_id},
    )
    host_row = host.fetchone()
    if not host_row:
        raise HTTPException(status_code=404, detail="Host not found")

    if scope is not None and host_row.tenant_id not in scope:
        raise HTTPException(status_code=403, detail="Access denied to this tenant")

    result = await db.execute(
        text("""
            SELECT active, last_seen_at, agent_version, agent_os, created_at
            FROM agent_tokens
            WHERE host_id = :hid AND active = true
            ORDER BY created_at DESC LIMIT 1
        """),
        {"hid": host_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No active agent token for this host")

    return AgentTokenInfo(
        active=row.active,
        last_seen_at=row.last_seen_at,
        agent_version=row.agent_version,
        agent_os=row.agent_os,
        created_at=row.created_at,
    )


class AgentSummaryResponse(BaseModel):
    total: int
    online: int


@router.get("/agents/summary", response_model=AgentSummaryResponse)
async def get_agent_summary(
    user: dict = Depends(get_current_user),
    scope=Depends(tenant_scope),
    db: AsyncSession = Depends(get_db),
):
    """Get total and online agent count (for dashboard)."""
    scope_filter = ""
    params: dict = {}
    if scope is not None:
        placeholders = ", ".join(f":t{i}" for i in range(len(scope)))
        scope_filter = f"AND at.tenant_id IN ({placeholders})"
        for i, tid in enumerate(scope):
            params[f"t{i}"] = tid

    result = await db.execute(
        text(f"""
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE at.last_seen_at > NOW() - INTERVAL '3 minutes') AS online
            FROM agent_tokens at
            JOIN hosts h ON h.id = at.host_id
            WHERE at.active = true AND h.active = true {scope_filter}
        """),
        params,
    )
    row = result.fetchone()
    return AgentSummaryResponse(total=row.total or 0, online=row.online or 0)


# ── Agent-Facing Endpoints (Token Auth) ─────────────────────────────────────

@router.get("/agent/config", response_model=AgentConfigResponse)
async def get_agent_config(
    agent: dict = Depends(get_agent_auth),
    db: AsyncSession = Depends(get_db),
):
    """Agent fetches its check configuration from the server."""
    result = await db.execute(
        text("""
            SELECT s.id, s.name, s.check_type, s.check_config,
                   s.interval_seconds, s.threshold_warn, s.threshold_crit,
                   s.max_check_attempts, s.retry_interval_seconds
            FROM services s
            WHERE s.host_id = CAST(:host_id AS uuid)
              AND s.check_mode = 'agent'
              AND s.active = true
        """),
        {"host_id": agent["host_id"]},
    )
    rows = result.fetchall()

    # Load global check policies
    policy_result = await db.execute(text(LOAD_POLICIES_SQL))
    policies = [dict(row._mapping) for row in policy_result.fetchall()]

    # Resolve server-managed scripts for agent_script checks
    script_ids = []
    for r in rows:
        if r.check_type == "agent_script" and r.check_config and r.check_config.get("script_id"):
            script_ids.append(r.check_config["script_id"])

    scripts_map: dict = {}
    if script_ids:
        script_result = await db.execute(
            text("SELECT id, script_body, interpreter, expected_output FROM monitoring_scripts WHERE id = ANY(:ids)"),
            {"ids": script_ids},
        )
        for sr in script_result.fetchall():
            scripts_map[str(sr.id)] = {
                "script_content": sr.script_body,
                "script_interpreter": sr.interpreter,
                "expected_output": sr.expected_output,
            }

    checks = []
    for r in rows:
        config = dict(r.check_config or {})

        # Apply global check policies
        config = apply_global_policies(r.check_type, config, agent["tenant_id"], policies)

        # Inject script content for server-managed scripts
        if r.check_type == "agent_script" and config.get("script_id"):
            script_data = scripts_map.get(config["script_id"])
            if script_data:
                config.update(script_data)
            del config["script_id"]  # Agent doesn't need the DB ID

        checks.append(AgentCheckDef(
            service_id=str(r.id),
            name=r.name,
            check_type=r.check_type,
            config=config,
            interval_seconds=r.interval_seconds,
            threshold_warn=r.threshold_warn,
            threshold_crit=r.threshold_crit,
            max_check_attempts=r.max_check_attempts,
            retry_interval_seconds=r.retry_interval_seconds,
        ))

    # Load log collection sources
    log_result = await db.execute(
        text("""
            SELECT source_type, config
            FROM log_sources
            WHERE host_id = CAST(:host_id AS integer)
              AND tenant_id = CAST(:tenant_id AS uuid)
              AND enabled = true
        """),
        {"host_id": agent["host_id"], "tenant_id": agent["tenant_id"]},
    )
    log_rows = log_result.fetchall()

    log_collection = LogCollectionConfig(
        enabled=len(log_rows) > 0,
        sources=[LogSourceDef(source_type=r.source_type, config=r.config or {}) for r in log_rows],
    )

    return AgentConfigResponse(
        host_id=agent["host_id"],
        hostname=agent["hostname"],
        tenant_id=agent["tenant_id"],
        checks=checks,
        log_collection=log_collection,
    )


@router.post("/agent/discovery", status_code=202)
async def agent_discovery(
    body: dict,
    agent: dict = Depends(get_agent_auth),
    db: AsyncSession = Depends(get_db),
):
    """Receive service discovery data from an agent."""
    now = datetime.now(timezone.utc)
    services = body.get("services", [])
    hostname = body.get("hostname", agent["hostname"])

    # Collect all suggested checks from services
    all_suggested = set()
    for svc in services:
        for c in svc.get("suggested_checks", []):
            all_suggested.add(c)

    # Collect all ports from services
    all_ports = []
    for svc in services:
        for port in svc.get("ports", []):
            all_ports.append({"port": port, "protocol": "tcp", "service": svc.get("name", "")})

    # Upsert discovery result for this agent host
    await db.execute(
        text("""
            INSERT INTO discovery_results
                (tenant_id, source, hostname, device_type, services,
                 suggested_checks, open_ports, matched_host_id, status, first_seen_at, last_seen_at)
            VALUES
                (:tid, 'agent_discovery', :hostname, 'server', :services,
                 :suggested_checks, :open_ports, CAST(:host_id AS uuid), 'known', :now, :now)
            ON CONFLICT (tenant_id, source, hostname)
            DO UPDATE SET
                services = EXCLUDED.services,
                suggested_checks = EXCLUDED.suggested_checks,
                open_ports = EXCLUDED.open_ports,
                last_seen_at = EXCLUDED.last_seen_at
        """),
        {
            "tid": agent["tenant_id"],
            "hostname": hostname,
            "services": services,
            "suggested_checks": list(all_suggested),
            "open_ports": all_ports,
            "host_id": agent["host_id"],
            "now": now,
        },
    )
    await db.commit()

    return {"status": "accepted", "services_received": len(services)}


@router.post("/agent/heartbeat", status_code=200)
async def agent_heartbeat(
    body: HeartbeatRequest,
    agent: dict = Depends(get_agent_auth),
    db: AsyncSession = Depends(get_db),
):
    """Agent sends a heartbeat with version and OS info."""
    await db.execute(
        text("""
            UPDATE agent_tokens
            SET last_seen_at = :now,
                agent_version = COALESCE(:version, agent_version),
                agent_os = COALESCE(:os, agent_os)
            WHERE id = CAST(:token_id AS uuid)
        """),
        {
            "now": datetime.now(timezone.utc),
            "version": body.agent_version,
            "os": body.os,
            "token_id": agent["token_id"],
        },
    )
    await db.commit()

    return {"status": "ok"}
