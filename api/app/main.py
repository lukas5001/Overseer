"""
Overseer API – REST API for the Web UI and external integrations.
"""
import asyncio
import os
from datetime import datetime, timezone, timedelta

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from api.app.core.database import AsyncSessionLocal
from api.app.routers import auth, status, tenants, hosts, services, collectors, downtimes, config, history, users, audit, notifications, templates, two_factor, saved_filters

# ==================== Config ====================

SECRET_KEY = os.getenv("SECRET_KEY", "dev_secret_key_change_in_production")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://overseer:overseer_dev_password@localhost:5432/overseer")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")

# ==================== App ====================

app = FastAPI(
    title="Overseer API",
    version="0.1.0",
    description="Monitoring system API – manages tenants, hosts, services, and check status.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
        content={"status": "healthy" if healthy else "degraded", "checks": checks},
        status_code=status_code,
    )


# ==================== Background Tasks ====================

async def downtime_expiry_watcher():
    """Every 60s: deactivate expired downtimes and clear in_downtime flags."""
    await asyncio.sleep(20)
    while True:
        try:
            async with AsyncSessionLocal() as db:
                now = datetime.now(timezone.utc)
                # Find active downtimes that have passed end_at
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

                    # Clear in_downtime on affected current_status rows
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

        except Exception as e:
            print(f"[DowntimeExpiry] Error: {e}")

        await asyncio.sleep(60)


async def dead_collector_watcher():
    """Every 60s: find collectors silent for >2×interval, set their services to UNKNOWN."""
    await asyncio.sleep(15)  # give startup a moment
    while True:
        try:
            async with AsyncSessionLocal() as db:
                # Find collectors whose last_seen_at is older than 3 minutes
                # (conservative: covers up to 3×60s intervals)
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
                    # Set all HARD-state services for this collector to UNKNOWN
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

        except Exception as e:
            print(f"[DeadCollector] Error: {e}")

        await asyncio.sleep(60)


@app.on_event("startup")
async def startup():
    asyncio.create_task(dead_collector_watcher())
    asyncio.create_task(downtime_expiry_watcher())
