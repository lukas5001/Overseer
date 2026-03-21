"""
Overseer Receiver – Accepts check results from Collectors.

Responsibilities:
- Validate API key → identify tenant
- Validate payload schema
- Write to Redis Stream
- Return 202 Accepted immediately
"""
import hashlib
import json
import logging
import os

import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.responses import JSONResponse

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


@app.on_event("startup")
async def startup():
    global redis_pool
    redis_pool = redis.from_url(REDIS_URL, decode_responses=True)
    logger.info("Receiver started, connected to Redis at %s", REDIS_URL)


@app.on_event("shutdown")
async def shutdown():
    if redis_pool:
        await redis_pool.close()


# ==================== API Key Validation ====================

# In production, this queries the database. For now, a simple cache.
_api_key_cache: dict[str, dict] = {}


async def validate_api_key(api_key: str) -> dict:
    """Validate API key and return tenant info.
    
    TODO: Query api_keys table, compare hash, return tenant_id.
    For now, accepts any key with format 'overseer_<tenant_slug>_<secret>'.
    """
    key_hash = hashlib.sha256(api_key.encode()).hexdigest()
    prefix = api_key[:12]

    # TODO: Replace with actual DB lookup
    # For development, extract tenant from key format
    if api_key.startswith("overseer_"):
        parts = api_key.split("_", 2)
        if len(parts) >= 3:
            return {"tenant_slug": parts[1], "key_prefix": prefix}

    raise HTTPException(status_code=401, detail="Invalid API key")


# ==================== Endpoints ====================

@app.post("/api/v1/results", status_code=202)
async def receive_check_results(
    payload: CollectorPayload,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """Receive check results from a Collector."""
    # 1. Validate API key
    tenant_info = await validate_api_key(x_api_key)

    # 2. Enrich payload with validated tenant info
    message = {
        "tenant_slug": tenant_info["tenant_slug"],
        "collector_id": payload.collector_id,
        "timestamp": payload.timestamp.isoformat(),
        "checks": [check.model_dump_json() for check in payload.checks],
        "received_at": __import__("datetime").datetime.utcnow().isoformat(),
    }

    # 3. Write to Redis Stream
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
