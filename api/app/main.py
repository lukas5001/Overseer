"""
Overseer API – REST API for the Web UI and external integrations.
"""
import asyncio
import os
from datetime import datetime, timezone, timedelta

import redis.asyncio as aioredis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from api.app.core.database import AsyncSessionLocal
from api.app.routers import auth, status, tenants, hosts, services, collectors, downtimes, config, history, users, audit, notifications, templates, two_factor, saved_filters, alert_rules, sla, admin, agent

# ==================== ENV Validation ====================

def _validate_env():
    secret = os.getenv("SECRET_KEY", "")
    if not secret or secret.startswith("dev_") or len(secret) < 32:
        raise RuntimeError(
            "SECRET_KEY ist nicht gesetzt oder unsicher. "
            "Setze SECRET_KEY auf einen zufälligen String mit mindestens 32 Zeichen. "
            "Generiere einen Key mit: python -c \"import secrets; print(secrets.token_hex(32))\""
        )
    enc_key = os.getenv("FIELD_ENCRYPTION_KEY", "")
    if not enc_key or len(enc_key) < 32:
        raise RuntimeError(
            "FIELD_ENCRYPTION_KEY ist nicht gesetzt. "
            "Setze FIELD_ENCRYPTION_KEY auf einen 32-Byte Base64-URL-sicheren String. "
            "Generiere: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
        )

_validate_env()


def _validate_license():
    import hashlib, hmac, json, base64, logging
    from datetime import datetime

    logger = logging.getLogger("overseer.license")
    key = os.getenv("LICENSE_KEY", "")
    if not key:
        return  # Kein Lizenz-Key = Community-Version (unlimitiert in Dev)
    try:
        raw = base64.urlsafe_b64decode(key)
        parts = raw.rsplit(b".", 1)
        if len(parts) != 2:
            raise ValueError("Ungültiges Key-Format")
        data, sig = parts
        payload = json.loads(data)
        expires = datetime.strptime(payload["expires"], "%Y-%m-%d")
        if expires < datetime.now():
            logger.warning("LICENSE_KEY ist abgelaufen (expired: %s). Grace-Period: 7 Tage.", payload["expires"])
    except Exception as e:
        logger.warning("LICENSE_KEY Validierung fehlgeschlagen: %s. API startet trotzdem.", e)


_validate_license()

# ==================== Config ====================

SECRET_KEY = os.getenv("SECRET_KEY", "dev_secret_key_change_in_production")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://overseer:overseer_dev_password@localhost:5432/overseer")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")

# ==================== App ====================

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Overseer API",
    version="0.1.0",
    description="Monitoring system API – manages tenants, hosts, services, and check status.",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With", "Accept", "X-Agent-Token"],
    expose_headers=["X-Total-Count"],
)

# ==================== Routers ====================

app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(status.router, prefix="/api/v1/status", tags=["status"])
app.include_router(tenants.router, prefix="/api/v1/tenants", tags=["tenants"])
app.include_router(hosts.router, prefix="/api/v1/hosts", tags=["hosts"])
app.include_router(services.router, prefix="/api/v1/services", tags=["services"])
app.include_router(collectors.router, prefix="/api/v1/collectors", tags=["collectors"])
app.include_router(downtimes.router, prefix="/api/v1/downtimes", tags=["downtimes"])
app.include_router(config.router, prefix="/api/v1/config", tags=["config"])
app.include_router(history.router, prefix="/api/v1/history", tags=["history"])
app.include_router(users.router, prefix="/api/v1/users", tags=["users"])
app.include_router(audit.router, prefix="/api/v1/audit", tags=["audit"])
app.include_router(notifications.router, prefix="/api/v1/notifications", tags=["notifications"])
app.include_router(templates.router, prefix="/api/v1/service-templates", tags=["service-templates"])
app.include_router(two_factor.router, prefix="/api/v1/2fa", tags=["2fa"])
app.include_router(saved_filters.router, prefix="/api/v1/saved-filters", tags=["saved-filters"])
app.include_router(alert_rules.router, prefix="/api/v1/alert-rules", tags=["alert-rules"])
app.include_router(sla.router, prefix="/api/v1", tags=["sla"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin"])
app.include_router(agent.router, prefix="/api/v1", tags=["agent"])


@app.get("/health")
async def health():
    checks = {"api": "ok"}
    healthy = True

    # DB check
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"error: {e}"
        healthy = False

    # Redis check
    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url(REDIS_URL, socket_connect_timeout=2)
        await r.ping()
        await r.aclose()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {e}"
        healthy = False

    from fastapi.responses import JSONResponse
    status_code = 200 if healthy else 503
    return JSONResponse(
        content={"status": "ok" if healthy else "error", "database": checks.get("database", "error"), "redis": checks.get("redis", "error")},
        status_code=status_code,
    )


# ==================== Background Tasks ====================

_redis_client: aioredis.Redis | None = None


def _get_redis() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(REDIS_URL)
    return _redis_client


async def _run_downtime_expiry():
    """Core logic for downtime expiry – runs under distributed lock."""
    async with AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)
        expired = await db.execute(text("""
            SELECT id, service_id, host_id
            FROM downtimes
            WHERE active = true AND end_at < :now
        """), {"now": now})
        rows = expired.fetchall()

        for row in rows:
            await db.execute(text(
                "UPDATE downtimes SET active = false WHERE id = :id"
            ), {"id": row.id})

            if row.service_id:
                await db.execute(text("""
                    UPDATE current_status SET in_downtime = false
                    WHERE service_id = :sid
                """), {"sid": row.service_id})
            elif row.host_id:
                await db.execute(text("""
                    UPDATE current_status cs
                    SET in_downtime = false
                    FROM services s
                    WHERE cs.service_id = s.id AND s.host_id = :hid
                """), {"hid": row.host_id})

        if rows:
            await db.commit()


async def downtime_expiry_watcher():
    """Every 60s: deactivate expired downtimes and clear in_downtime flags."""
    await asyncio.sleep(20)
    while True:
        try:
            async with _get_redis().lock("overseer:lock:downtime_watcher", timeout=55, blocking_timeout=1):
                try:
                    await _run_downtime_expiry()
                except Exception as e:
                    print(f"[DowntimeExpiry] Error: {e}")
        except Exception:
            pass  # Could not acquire lock – another instance is running
        await asyncio.sleep(60)


async def _run_dead_collector_check():
    """Core logic for dead collector detection – runs under distributed lock."""
    async with AsyncSessionLocal() as db:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=3)
        dead = await db.execute(text("""
            SELECT id, tenant_id, name
            FROM collectors
            WHERE active = true
              AND last_seen_at IS NOT NULL
              AND last_seen_at < :cutoff
        """), {"cutoff": cutoff})
        dead_rows = dead.fetchall()

        for row in dead_rows:
            await db.execute(text("""
                UPDATE current_status cs
                SET status = 'UNKNOWN',
                    state_type = 'HARD',
                    status_message = 'Collector offline – keine Daten seit mehr als 3 Minuten',
                    last_check_at = :now
                FROM services s
                JOIN hosts h ON s.host_id = h.id
                WHERE cs.service_id = s.id
                  AND h.collector_id = :collector_id
                  AND cs.status != 'UNKNOWN'
            """), {"collector_id": row.id, "now": datetime.now(timezone.utc)})

        if dead_rows:
            await db.commit()
            for row in dead_rows:
                print(f"[DeadCollector] {row.name} ({row.id}) – services set to UNKNOWN")


async def dead_collector_watcher():
    """Every 60s: find collectors silent for >2×interval, set their services to UNKNOWN."""
    await asyncio.sleep(15)
    while True:
        try:
            async with _get_redis().lock("overseer:lock:dead_collector_watcher", timeout=55, blocking_timeout=1):
                try:
                    await _run_dead_collector_check()
                except Exception as e:
                    print(f"[DeadCollector] Error: {e}")
        except Exception:
            pass  # Could not acquire lock – another instance is running
        await asyncio.sleep(60)


@app.on_event("startup")
async def startup():
    asyncio.create_task(dead_collector_watcher())
    asyncio.create_task(downtime_expiry_watcher())
