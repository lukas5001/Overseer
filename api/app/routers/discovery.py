"""Overseer API – Discovery router for auto-discovery results and network scans."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, require_role, tenant_scope, apply_tenant_filter
from api.app.routers.audit import write_audit

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class NetworkScanRequest(BaseModel):
    target: str
    ports: str = "22,80,443,161,3306,5432,6379,8080,3389,9100"
    collector_id: UUID
    snmp_community: str = ""


class NetworkScanResponse(BaseModel):
    scan_id: str
    status: str


class ScanStatusResponse(BaseModel):
    id: str
    status: str
    target: str
    hosts_found: int
    error_message: str | None
    started_at: str | None
    completed_at: str | None


class DiscoveryResultOut(BaseModel):
    id: str
    tenant_id: str
    scan_id: str | None
    source: str
    ip_address: str | None
    hostname: str | None
    mac_address: str | None
    vendor: str | None
    device_type: str | None
    os_guess: str | None
    open_ports: list
    snmp_data: dict | None
    services: list
    suggested_checks: list
    matched_host_id: str | None
    status: str
    first_seen_at: str
    last_seen_at: str


class AddHostRequest(BaseModel):
    hostname: str
    display_name: str | None = None
    ip_address: str | None = None
    host_type_id: UUID
    tags: list[str] = []
    checks: list[dict] = []  # [{check_type, name, config, interval_seconds}]
    collector_id: UUID | None = None


class BulkAddRequest(BaseModel):
    ids: list[UUID]
    tags: list[str] = []
    host_type_id: UUID
    collector_id: UUID | None = None


# ── Network Scan Endpoints ───────────────────────────────────────────────────

@router.post("/network-scan", response_model=NetworkScanResponse, status_code=201)
async def start_network_scan(
    body: NetworkScanRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    scope=Depends(tenant_scope),
):
    """Start a network discovery scan via a collector."""
    # Verify collector exists and user has access
    result = await db.execute(
        text("SELECT id, tenant_id FROM collectors WHERE id = :id AND active = true"),
        {"id": body.collector_id},
    )
    collector = result.fetchone()
    if not collector:
        raise HTTPException(404, "Collector not found")
    if scope is not None and collector.tenant_id not in scope:
        raise HTTPException(403, "Access denied to this collector's tenant")

    # Create scan record
    scan_result = await db.execute(
        text("""
            INSERT INTO discovery_scans (tenant_id, collector_id, target, ports, status)
            VALUES (:tenant_id, :collector_id, :target, :ports, 'pending')
            RETURNING id
        """),
        {
            "tenant_id": collector.tenant_id,
            "collector_id": body.collector_id,
            "target": body.target,
            "ports": body.ports,
        },
    )
    scan_id = scan_result.fetchone().id

    await write_audit(
        db, user=user, action="discovery_scan_start",
        target_type="discovery_scan", target_id=scan_id,
        tenant_id=collector.tenant_id,
        detail={"target": body.target, "collector_id": str(body.collector_id)},
    )
    await db.commit()

    return NetworkScanResponse(scan_id=str(scan_id), status="pending")


@router.get("/scans/{scan_id}", response_model=ScanStatusResponse)
async def get_scan_status(
    scan_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    """Get status of a network scan."""
    result = await db.execute(
        text("SELECT id, status, target, hosts_found, error_message, started_at, completed_at, tenant_id FROM discovery_scans WHERE id = :id"),
        {"id": scan_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(404, "Scan not found")
    if _scope is not None and row.tenant_id not in _scope:
        raise HTTPException(403, "Access denied")

    return ScanStatusResponse(
        id=str(row.id),
        status=row.status,
        target=row.target,
        hosts_found=row.hosts_found or 0,
        error_message=row.error_message,
        started_at=row.started_at.isoformat() if row.started_at else None,
        completed_at=row.completed_at.isoformat() if row.completed_at else None,
    )


@router.get("/scans")
async def list_scans(
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    """List recent scans."""
    scope_filter = ""
    params: dict = {"limit": limit}
    if _scope is not None:
        placeholders = ", ".join(f":t{i}" for i in range(len(_scope)))
        scope_filter = f"AND tenant_id IN ({placeholders})"
        for i, tid in enumerate(_scope):
            params[f"t{i}"] = tid

    result = await db.execute(
        text(f"""
            SELECT id, tenant_id, collector_id, target, ports, status, hosts_found,
                   error_message, started_at, completed_at, created_at
            FROM discovery_scans
            WHERE 1=1 {scope_filter}
            ORDER BY created_at DESC
            LIMIT :limit
        """),
        params,
    )
    rows = result.fetchall()
    return [
        {
            "id": str(r.id),
            "tenant_id": str(r.tenant_id),
            "collector_id": str(r.collector_id) if r.collector_id else None,
            "target": r.target,
            "ports": r.ports,
            "status": r.status,
            "hosts_found": r.hosts_found or 0,
            "error_message": r.error_message,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


# ── Discovery Results Endpoints ──────────────────────────────────────────────

@router.get("/results")
async def list_results(
    response: Response,
    status_filter: str | None = Query(default=None, alias="status"),
    source: str | None = None,
    device_type: str | None = None,
    scan_id: UUID | None = None,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    """List discovery results with filtering."""
    conditions = ["1=1"]
    params: dict = {"limit": limit, "offset": offset}

    if _scope is not None:
        placeholders = ", ".join(f":t{i}" for i in range(len(_scope)))
        conditions.append(f"dr.tenant_id IN ({placeholders})")
        for i, tid in enumerate(_scope):
            params[f"t{i}"] = tid

    if status_filter:
        statuses = [s.strip() for s in status_filter.split(",")]
        status_ph = ", ".join(f":st{i}" for i in range(len(statuses)))
        conditions.append(f"dr.status IN ({status_ph})")
        for i, s in enumerate(statuses):
            params[f"st{i}"] = s

    if source:
        conditions.append("dr.source = :source")
        params["source"] = source

    if device_type:
        conditions.append("dr.device_type = :device_type")
        params["device_type"] = device_type

    if scan_id:
        conditions.append("dr.scan_id = :scan_id")
        params["scan_id"] = scan_id

    where = " AND ".join(conditions)

    # Count
    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM discovery_results dr WHERE {where}"),
        params,
    )
    total = count_result.scalar_one()
    response.headers["X-Total-Count"] = str(total)

    result = await db.execute(
        text(f"""
            SELECT dr.*, h.hostname AS matched_hostname
            FROM discovery_results dr
            LEFT JOIN hosts h ON dr.matched_host_id = h.id
            WHERE {where}
            ORDER BY dr.last_seen_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    rows = result.fetchall()

    return [
        {
            "id": str(r.id),
            "tenant_id": str(r.tenant_id),
            "scan_id": str(r.scan_id) if r.scan_id else None,
            "source": r.source,
            "ip_address": str(r.ip_address) if r.ip_address else None,
            "hostname": r.hostname,
            "mac_address": r.mac_address,
            "vendor": r.vendor,
            "device_type": r.device_type,
            "os_guess": r.os_guess,
            "open_ports": r.open_ports or [],
            "snmp_data": r.snmp_data,
            "services": r.services or [],
            "suggested_checks": r.suggested_checks or [],
            "matched_host_id": str(r.matched_host_id) if r.matched_host_id else None,
            "matched_hostname": r.matched_hostname,
            "status": r.status,
            "first_seen_at": r.first_seen_at.isoformat(),
            "last_seen_at": r.last_seen_at.isoformat(),
        }
        for r in rows
    ]


@router.post("/results/{result_id}/add", status_code=201)
async def add_as_host(
    result_id: UUID,
    body: AddHostRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    _scope=Depends(tenant_scope),
):
    """Add a discovered device as a monitored host with optional checks."""
    # Get discovery result
    dr = await db.execute(
        text("SELECT * FROM discovery_results WHERE id = :id"),
        {"id": result_id},
    )
    row = dr.fetchone()
    if not row:
        raise HTTPException(404, "Discovery result not found")
    if _scope is not None and row.tenant_id not in _scope:
        raise HTTPException(403, "Access denied")
    if row.status == "added":
        raise HTTPException(400, "Already added as host")

    ip = body.ip_address or (str(row.ip_address) if row.ip_address else None)

    # Create host
    host_result = await db.execute(
        text("""
            INSERT INTO hosts (tenant_id, hostname, display_name, ip_address, host_type_id, tags, collector_id, active)
            VALUES (:tenant_id, :hostname, :display_name, :ip, :host_type_id, :tags, :collector_id, true)
            RETURNING id
        """),
        {
            "tenant_id": row.tenant_id,
            "hostname": body.hostname,
            "display_name": body.display_name,
            "ip": ip,
            "host_type_id": body.host_type_id,
            "tags": body.tags,
            "collector_id": body.collector_id,
        },
    )
    host_id = host_result.fetchone().id

    # Create checks/services
    created_services = 0
    for check in body.checks:
        check_type = check.get("check_type", "ping")
        check_name = check.get("name", check_type)
        check_config = check.get("config", {})
        interval = check.get("interval_seconds", 60)
        mode = "agent" if check_type.startswith("agent_") else "passive"

        svc_result = await db.execute(
            text("""
                INSERT INTO services (host_id, tenant_id, name, check_type, check_config, interval_seconds, check_mode, active)
                VALUES (:host_id, :tenant_id, :name, :check_type, :config, :interval, :mode, true)
                RETURNING id
            """),
            {
                "host_id": host_id,
                "tenant_id": row.tenant_id,
                "name": check_name,
                "check_type": check_type,
                "config": check_config,
                "interval": interval,
                "mode": mode,
            },
        )
        svc_id = svc_result.fetchone().id

        # Create current_status row
        await db.execute(
            text("""
                INSERT INTO current_status (service_id, host_id, tenant_id, status, state_type)
                VALUES (:sid, :hid, :tid, 'NO_DATA', 'SOFT')
            """),
            {"sid": svc_id, "hid": host_id, "tid": row.tenant_id},
        )
        created_services += 1

    # Update discovery result
    await db.execute(
        text("UPDATE discovery_results SET status = 'added', matched_host_id = :hid WHERE id = :id"),
        {"hid": host_id, "id": result_id},
    )

    await write_audit(
        db, user=user, action="discovery_add_host",
        target_type="host", target_id=host_id,
        tenant_id=row.tenant_id,
        detail={"hostname": body.hostname, "checks": created_services, "from_discovery": str(result_id)},
    )
    await db.commit()

    return {"host_id": str(host_id), "services_created": created_services}


@router.post("/results/{result_id}/ignore", status_code=200)
async def ignore_result(
    result_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    _scope=Depends(tenant_scope),
):
    """Ignore a discovery result."""
    dr = await db.execute(
        text("SELECT id, tenant_id, hostname, ip_address FROM discovery_results WHERE id = :id"),
        {"id": result_id},
    )
    row = dr.fetchone()
    if not row:
        raise HTTPException(404, "Discovery result not found")
    if _scope is not None and row.tenant_id not in _scope:
        raise HTTPException(403, "Access denied")

    await db.execute(
        text("UPDATE discovery_results SET status = 'ignored' WHERE id = :id"),
        {"id": result_id},
    )
    await write_audit(
        db, user=user, action="discovery_ignore",
        target_type="discovery_result", target_id=result_id,
        tenant_id=row.tenant_id,
        detail={"hostname": row.hostname, "ip": str(row.ip_address) if row.ip_address else None},
    )
    await db.commit()
    return {"status": "ignored"}


@router.post("/results/bulk-add", status_code=201)
async def bulk_add(
    body: BulkAddRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    _scope=Depends(tenant_scope),
):
    """Bulk-add multiple discovery results as hosts with their suggested checks."""
    created_hosts = []

    for dr_id in body.ids:
        dr = await db.execute(
            text("SELECT * FROM discovery_results WHERE id = :id AND status IN ('new', 'known')"),
            {"id": dr_id},
        )
        row = dr.fetchone()
        if not row:
            continue
        if _scope is not None and row.tenant_id not in _scope:
            continue

        hostname = row.hostname or (str(row.ip_address) if row.ip_address else f"discovered-{str(dr_id)[:8]}")
        ip = str(row.ip_address) if row.ip_address else None
        tags = body.tags

        # Create host
        host_result = await db.execute(
            text("""
                INSERT INTO hosts (tenant_id, hostname, ip_address, host_type_id, tags, collector_id, active)
                VALUES (:tenant_id, :hostname, :ip, :host_type_id, :tags, :collector_id, true)
                ON CONFLICT (tenant_id, hostname) DO NOTHING
                RETURNING id
            """),
            {
                "tenant_id": row.tenant_id,
                "hostname": hostname,
                "ip": ip,
                "host_type_id": body.host_type_id,
                "tags": tags,
                "collector_id": body.collector_id,
            },
        )
        host_row = host_result.fetchone()
        if not host_row:
            continue  # Duplicate hostname
        host_id = host_row.id

        # Create suggested checks as services
        suggested = row.suggested_checks or []
        for check_type in suggested:
            check_name = check_type
            config: dict = {}
            mode = "passive"

            # Build config based on check type
            if check_type == "ping":
                config = {}
            elif check_type == "http":
                config = {"url": f"http://{ip or hostname}/"}
            elif check_type == "ssl_certificate":
                config = {"hostname": ip or hostname, "port": 443}
            elif check_type == "port":
                # Use first non-standard port
                ports = row.open_ports or []
                for p in ports:
                    port_num = p.get("port", 0) if isinstance(p, dict) else p
                    if port_num not in (80, 443):
                        config = {"port": port_num}
                        break

            svc_result = await db.execute(
                text("""
                    INSERT INTO services (host_id, tenant_id, name, check_type, check_config, interval_seconds, check_mode, active)
                    VALUES (:host_id, :tid, :name, :ct, :cfg, 60, :mode, true)
                    ON CONFLICT (host_id, name) DO NOTHING
                    RETURNING id
                """),
                {
                    "host_id": host_id, "tid": row.tenant_id,
                    "name": check_name, "ct": check_type, "cfg": config, "mode": mode,
                },
            )
            svc_row = svc_result.fetchone()
            if svc_row:
                await db.execute(
                    text("""
                        INSERT INTO current_status (service_id, host_id, tenant_id, status, state_type)
                        VALUES (:sid, :hid, :tid, 'NO_DATA', 'SOFT')
                    """),
                    {"sid": svc_row.id, "hid": host_id, "tid": row.tenant_id},
                )

        # Mark as added
        await db.execute(
            text("UPDATE discovery_results SET status = 'added', matched_host_id = :hid WHERE id = :id"),
            {"hid": host_id, "id": dr_id},
        )
        created_hosts.append({"id": str(host_id), "hostname": hostname})

    if created_hosts:
        await write_audit(
            db, user=user, action="discovery_bulk_add",
            target_type="discovery", target_id=None,
            tenant_id=None,
            detail={"hosts_created": len(created_hosts)},
        )
    await db.commit()

    return {"hosts_created": len(created_hosts), "hosts": created_hosts}


# ── Ignored Management ───────────────────────────────────────────────────────

@router.get("/ignored")
async def list_ignored(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    """List ignored discovery results."""
    conditions = ["dr.status = 'ignored'"]
    params: dict = {"limit": limit, "offset": offset}

    if _scope is not None:
        placeholders = ", ".join(f":t{i}" for i in range(len(_scope)))
        conditions.append(f"dr.tenant_id IN ({placeholders})")
        for i, tid in enumerate(_scope):
            params[f"t{i}"] = tid

    where = " AND ".join(conditions)
    result = await db.execute(
        text(f"""
            SELECT dr.*
            FROM discovery_results dr
            WHERE {where}
            ORDER BY dr.last_seen_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    rows = result.fetchall()

    return [
        {
            "id": str(r.id),
            "source": r.source,
            "ip_address": str(r.ip_address) if r.ip_address else None,
            "hostname": r.hostname,
            "device_type": r.device_type,
            "first_seen_at": r.first_seen_at.isoformat(),
            "last_seen_at": r.last_seen_at.isoformat(),
        }
        for r in rows
    ]


@router.delete("/ignored/{result_id}", status_code=200)
async def unignore_result(
    result_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_role("super_admin", "tenant_admin")),
    _scope=Depends(tenant_scope),
):
    """Un-ignore a discovery result (set back to 'new')."""
    dr = await db.execute(
        text("SELECT id, tenant_id FROM discovery_results WHERE id = :id AND status = 'ignored'"),
        {"id": result_id},
    )
    row = dr.fetchone()
    if not row:
        raise HTTPException(404, "Ignored result not found")
    if _scope is not None and row.tenant_id not in _scope:
        raise HTTPException(403, "Access denied")

    await db.execute(
        text("UPDATE discovery_results SET status = 'new' WHERE id = :id"),
        {"id": result_id},
    )
    await db.commit()
    return {"status": "new"}


# ── Collector Discovery Results Receiver ─────────────────────────────────────

@router.post("/results/ingest", status_code=202)
async def ingest_discovery_results(
    body: dict,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Receive network scan results from collector (called by backend when collector reports)."""
    scan_id = body.get("scan_id")
    hosts_found = body.get("hosts_found", [])
    tenant_id = body.get("tenant_id")

    if not tenant_id:
        raise HTTPException(400, "tenant_id required")

    now = datetime.now(timezone.utc)

    for host in hosts_found:
        ip = host.get("ip")
        hostname = host.get("hostname") or None

        # Try to match to existing host by IP
        matched_host_id = None
        match_status = "new"
        if ip:
            match = await db.execute(
                text("SELECT id FROM hosts WHERE ip_address = :ip AND tenant_id = :tid AND active = true LIMIT 1"),
                {"ip": ip, "tid": tenant_id},
            )
            matched = match.fetchone()
            if matched:
                matched_host_id = matched.id
                match_status = "known"

        # Upsert discovery result
        await db.execute(
            text("""
                INSERT INTO discovery_results
                    (tenant_id, scan_id, source, ip_address, hostname, mac_address, vendor,
                     device_type, os_guess, open_ports, snmp_data, suggested_checks,
                     matched_host_id, status, first_seen_at, last_seen_at)
                VALUES
                    (:tid, :scan_id, 'network_scan', :ip, :hostname, :mac, :vendor,
                     :device_type, :os_guess, :open_ports, :snmp_data, :suggested_checks,
                     :matched_host_id, :status, :now, :now)
                ON CONFLICT (tenant_id, source, ip_address)
                DO UPDATE SET
                    hostname = COALESCE(EXCLUDED.hostname, discovery_results.hostname),
                    mac_address = COALESCE(EXCLUDED.mac_address, discovery_results.mac_address),
                    vendor = COALESCE(EXCLUDED.vendor, discovery_results.vendor),
                    device_type = COALESCE(EXCLUDED.device_type, discovery_results.device_type),
                    os_guess = COALESCE(EXCLUDED.os_guess, discovery_results.os_guess),
                    open_ports = EXCLUDED.open_ports,
                    snmp_data = EXCLUDED.snmp_data,
                    suggested_checks = EXCLUDED.suggested_checks,
                    matched_host_id = COALESCE(EXCLUDED.matched_host_id, discovery_results.matched_host_id),
                    status = CASE
                        WHEN discovery_results.status IN ('added', 'ignored') THEN discovery_results.status
                        ELSE EXCLUDED.status
                    END,
                    last_seen_at = EXCLUDED.last_seen_at,
                    scan_id = EXCLUDED.scan_id
            """),
            {
                "tid": tenant_id,
                "scan_id": scan_id,
                "ip": ip,
                "hostname": hostname,
                "mac": host.get("mac"),
                "vendor": host.get("vendor"),
                "device_type": host.get("device_type"),
                "os_guess": host.get("os_guess"),
                "open_ports": host.get("open_ports", []),
                "snmp_data": host.get("snmp"),
                "suggested_checks": host.get("suggested_checks", []),
                "matched_host_id": matched_host_id,
                "status": match_status,
                "now": now,
            },
        )

    # Update scan status if scan_id provided
    if scan_id:
        await db.execute(
            text("""
                UPDATE discovery_scans
                SET status = 'completed', hosts_found = :count, completed_at = :now
                WHERE id = :id
            """),
            {"count": len(hosts_found), "now": now, "id": scan_id},
        )

    await db.commit()
    return {"ingested": len(hosts_found)}
