"""
Overseer Receiver – Accepts check results from Collectors.

Responsibilities:
- Validate API key → identify tenant (real DB lookup)
- Validate payload schema
- Write to Redis Stream
- Return 202 Accepted immediately
"""
import hashlib
import json
import logging
import os
from datetime import datetime, timezone

import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from shared.schemas import CollectorPayload

# ==================== Config ====================

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://overseer:overseer_dev_password@localhost:5432/overseer")
STREAM_NAME = "overseer:check_results"

# ==================== App ====================

app = FastAPI(title="Overseer Receiver", version="0.1.0")
logger = logging.getLogger("overseer.receiver")
logging.basicConfig(level=logging.INFO)

redis_pool: redis.Redis | None = None
engine = create_async_engine(DATABASE_URL, echo=False, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@app.on_event("startup")
async def startup():
    global redis_pool
    redis_pool = redis.from_url(REDIS_URL, decode_responses=True)
    logger.info("Receiver started, connected to Redis at %s", REDIS_URL)


@app.on_event("shutdown")
async def shutdown():
    if redis_pool:
        await redis_pool.close()
    await engine.dispose()


# ==================== API Key Validation ====================

async def validate_api_key(api_key: str) -> dict:
    """Validate API key via DB lookup. Returns {tenant_slug, tenant_id}."""
    key_hash = hashlib.sha256(api_key.encode()).hexdigest()
    key_prefix = api_key[:12]

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT ak.id, ak.tenant_id, ak.key_hash, t.slug AS tenant_slug
                FROM api_keys ak
                JOIN tenants t ON t.id = ak.tenant_id
                WHERE ak.key_prefix = :prefix
                  AND ak.active = true
                  AND t.active = true
            """),
            {"prefix": key_prefix},
        )
        row = result.fetchone()

    if not row or row.key_hash != key_hash:
        raise HTTPException(status_code=401, detail="Invalid API key")

    # Update last_used_at in background (fire and forget, non-blocking)
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE api_keys SET last_used_at = :now WHERE id = :id"),
            {"now": datetime.now(timezone.utc), "id": row.id},
        )
        await db.commit()

    return {"tenant_slug": row.tenant_slug, "tenant_id": str(row.tenant_id)}


# ==================== Endpoints ====================

@app.post("/api/v1/results", status_code=202)
async def receive_check_results(
    payload: CollectorPayload,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Receive check results from a Collector."""
    tenant_info = await validate_api_key(x_api_key)

    message = {
        "tenant_slug": tenant_info["tenant_slug"],
        "collector_id": payload.collector_id,
        "timestamp": payload.timestamp.isoformat(),
        "checks": [check.model_dump_json() for check in payload.checks],
        "received_at": datetime.now(timezone.utc).isoformat(),
    }

    await redis_pool.xadd(STREAM_NAME, {"data": json.dumps(message)})

    logger.info(
        "Received %d checks from collector=%s tenant=%s",
        len(payload.checks),
        payload.collector_id,
        tenant_info["tenant_slug"],
    )

    return {"status": "accepted", "checks_received": len(payload.checks)}


@app.get("/health")
async def health():
    """Health check endpoint."""
    try:
        await redis_pool.ping()
        return {"status": "healthy", "redis": "connected"}
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"status": "unhealthy", "redis": str(e)},
        )
