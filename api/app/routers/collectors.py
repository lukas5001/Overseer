"""Overseer API – Collectors router."""
import hashlib
import os
import secrets
from datetime import datetime, timezone, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.app.core.database import get_db
from api.app.core.auth import get_current_user, get_collector_auth, require_role, tenant_scope, apply_tenant_filter
from api.app.core.quotas import check_quota
from api.app.models.models import Collector, CurrentStatus
from api.app.routers.audit import write_audit
from shared.schemas import CollectorOut

router = APIRouter()


class CollectorCreate(BaseModel):
    tenant_id: UUID
    name: str
    hostname: str | None = None


@router.post("/", status_code=201)
async def create_collector(
    body: CollectorCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    """Create a collector and generate its API key."""
    await check_quota(db, body.tenant_id, "collectors")
    import uuid as uuid_mod
    collector_id = uuid_mod.uuid4()

    await db.execute(
        text("""
            INSERT INTO collectors (id, tenant_id, name, hostname, active, config_version, created_at, updated_at)
            VALUES (:id, :tenant_id, :name, :hostname, true, 0, now(), now())
        """),
        {
            "id": str(collector_id),
            "tenant_id": str(body.tenant_id),
            "name": body.name,
            "hostname": body.hostname,
        },
    )

    # Generate API key
    raw_key = "overseer_" + secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()

    await db.execute(
        text("""
            INSERT INTO api_keys (id, tenant_id, key_hash, key_prefix, name, active, created_at)
            VALUES (gen_random_uuid(), :tenant_id, :key_hash, '', :name, true, now())
        """),
        {
            "tenant_id": str(body.tenant_id),
            "key_hash": key_hash,
            "name": f"Collector: {body.name}",
        },
    )

    await write_audit(db, user=_user, action="collector_create",
                      target_type="collector", target_id=collector_id,
                      tenant_id=body.tenant_id,
                      detail={"name": body.name})
    await db.commit()
    return {
        "id": str(collector_id),
        "name": body.name,
        "tenant_id": str(body.tenant_id),
        "api_key": raw_key,
    }


@router.delete("/{collector_id}", status_code=200)
async def delete_collector(
    collector_id: UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_role("super_admin", "tenant_admin")),
):
    result = await db.execute(
        select(Collector).where(Collector.id == collector_id, Collector.active == True)
    )
    collector = result.scalar_one_or_none()
    if not collector:
        raise HTTPException(status_code=404, detail="Collector not found")
    collector.active = False
    await write_audit(db, user=_user, action="collector_delete",
                      target_type="collector", target_id=collector_id,
                      tenant_id=collector.tenant_id,
                      detail={"name": collector.name})
    await db.commit()
    return {"status": "deactivated"}


@router.get("/", response_model=list[CollectorOut])
async def list_collectors(
    tenant_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope = Depends(tenant_scope),
):
    q = select(Collector).where(Collector.active == True).order_by(Collector.name)
    q = apply_tenant_filter(q, Collector.tenant_id, _scope, tenant_id)
    result = await db.execute(q)
    return result.scalars().all()


@router.patch("/{collector_id}/heartbeat")
async def heartbeat(
    collector_id: UUID,
    db: AsyncSession = Depends(get_db),
    _auth: dict = Depends(get_collector_auth),
):
    """Called by the Collector every interval to signal it is alive."""
    result = await db.execute(
        select(Collector).where(Collector.id == collector_id, Collector.active == True)
    )
    collector = result.scalar_one_or_none()
    if not collector:
        raise HTTPException(status_code=404, detail="Collector not found")

    collector.last_seen_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True, "last_seen_at": collector.last_seen_at.isoformat()}


@router.get("/{collector_id}/installer")
async def get_installer(
    collector_id: UUID,
    os_type: str = Query(default="linux", alias="os"),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
    _scope=Depends(tenant_scope),
):
    """Generate a shell (linux) or PowerShell (windows) installer script for a collector."""
    collector = await db.get(Collector, collector_id)
    if not collector:
        raise HTTPException(status_code=404, detail="Collector not found")
    if _scope is not None and collector.tenant_id not in _scope:
        raise HTTPException(status_code=403, detail="Access denied")

    # Get first active API key for this tenant
    key_row = (await db.execute(text("""
        SELECT key_hash FROM api_keys
        WHERE tenant_id = :tid AND active = TRUE
        ORDER BY created_at DESC LIMIT 1
    """), {"tid": collector.tenant_id})).fetchone()
    api_key_placeholder = key_row.key_hash[:8] + "..." if key_row else "<YOUR_API_KEY>"

    receiver_url = os.getenv("RECEIVER_URL", "https://overseer.example.com")
    collector_id_str = str(collector_id)
    tenant_id_str = str(collector.tenant_id)

    if os_type == "windows":
        script = f"""# Overseer Collector Installer (Windows PowerShell)
# Automatisch generiert fuer Collector: {collector.name}
$ErrorActionPreference = "Stop"

$InstallDir = "C:\\overseer-collector"
$PythonExe = "python"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# Create virtual environment
& $PythonExe -m venv "$InstallDir\\venv"
& "$InstallDir\\venv\\Scripts\\pip" install requests pysnmp --quiet

# Write config
@"
api_key: "{api_key_placeholder}"
receiver_url: "{receiver_url}"
collector_id: "{collector_id_str}"
tenant_id: "{tenant_id_str}"
check_interval: 60
log_level: info
"@ | Set-Content "$InstallDir\\config.yaml"

Write-Host "Overseer Collector installed to $InstallDir"
Write-Host "Edit $InstallDir\\config.yaml and set your API key, then run:"
Write-Host "  & '$InstallDir\\venv\\Scripts\\python' -m overseer_collector"
"""
        filename = "overseer-collector-install.ps1"
        media_type = "text/plain"
    else:
        script = f"""#!/bin/bash
# Overseer Collector Installer (Linux)
# Automatisch generiert fuer Collector: {collector.name}
set -e

INSTALL_DIR="/opt/overseer-collector"

echo "=== Overseer Collector Installer ==="
mkdir -p "$INSTALL_DIR"

python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install requests pysnmp --quiet

cat > "$INSTALL_DIR/config.yaml" <<'YAML'
api_key: "{api_key_placeholder}"
receiver_url: "{receiver_url}"
collector_id: "{collector_id_str}"
tenant_id: "{tenant_id_str}"
check_interval: 60
log_level: info
YAML

cat > /etc/systemd/system/overseer-collector.service <<'UNIT'
[Unit]
Description=Overseer Collector
After=network.target

[Service]
ExecStart={INSTALL_DIR}/venv/bin/python -m overseer_collector
WorkingDirectory={INSTALL_DIR}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable overseer-collector

echo ""
echo "Collector installed. Edit $INSTALL_DIR/config.yaml and set your API key."
echo "Then start with: systemctl start overseer-collector"
"""
        filename = "overseer-collector-install.sh"
        media_type = "text/plain"

    return PlainTextResponse(
        content=script,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
