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
from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from shared.schemas import CollectorPayload

# ==================== Config ====================

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://overseer:overseer_dev_password@localhost:5432/overseer")
STREAM_NAME = "overseer:check_results"

# Rate limiting: max requests per key per window
RATE_LIMIT_MAX = int(os.getenv("RATE_LIMIT_MAX", "120"))   # requests
RATE_LIMIT_WINDOW = int(os.getenv("RATE_LIMIT_WINDOW", "60"))  # seconds

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


# ==================== Rate Limiting ====================

async def check_rate_limit(key_prefix: str) -> None:
    """Sliding-window rate limit via Redis INCR + EXPIRE.

    Uses the key prefix (first 12 chars) as the rate-limit bucket so that
    even if the full key is rotated the prefix-based bucket is consistent.
    Raises HTTP 429 if the limit is exceeded.
    """
    bucket = f"ratelimit:{key_prefix}:{int(datetime.now(timezone.utc).timestamp()) // RATE_LIMIT_WINDOW}"
    count = await redis_pool.incr(bucket)
    if count == 1:
        await redis_pool.expire(bucket, RATE_LIMIT_WINDOW * 2)
    if count > RATE_LIMIT_MAX:
        logger.warning("Rate limit exceeded for key prefix %s (%d req/window)", key_prefix, count)
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded: max {RATE_LIMIT_MAX} requests per {RATE_LIMIT_WINDOW}s",
            headers={"Retry-After": str(RATE_LIMIT_WINDOW)},
        )


# ==================== API Key Validation ====================

async def validate_api_key(api_key: str) -> dict:
    """Validate API key via DB lookup. Returns {tenant_slug, tenant_id}."""
    key_hash = hashlib.sha256(api_key.encode()).hexdigest()
    key_prefix = api_key[:12]

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT ak.id, ak.tenant_id, t.slug AS tenant_slug
                FROM api_keys ak
                JOIN tenants t ON t.id = ak.tenant_id
                WHERE ak.key_prefix = :prefix
                  AND ak.key_hash = :hash
                  AND ak.active = true
                  AND t.active = true
            """),
            {"prefix": key_prefix, "hash": key_hash},
        )
        row = result.fetchone()

    if not row:
        raise HTTPException(status_code=401, detail="Invalid API key")

    # Update last_used_at in background (fire and forget, non-blocking)
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE api_keys SET last_used_at = :now WHERE id = :id"),
            {"now": datetime.now(timezone.utc), "id": row.id},
        )
        await db.commit()

    return {"tenant_slug": row.tenant_slug, "tenant_id": str(row.tenant_id), "key_prefix": key_prefix, "source": "api_key"}


# ==================== Agent Token Validation ====================

async def validate_agent_token(agent_token: str) -> dict:
    """Validate agent token via DB lookup. Returns {tenant_slug, tenant_id, host_id}."""
    token_hash = hashlib.sha256(agent_token.encode()).hexdigest()
    token_prefix = agent_token[:16]

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT at.id AS token_id, at.host_id, at.tenant_id, t.slug AS tenant_slug
                FROM agent_tokens at
                JOIN tenants t ON t.id = at.tenant_id
                WHERE at.token_hash = :hash
                  AND at.active = true
                  AND t.active = true
            """),
            {"hash": token_hash},
        )
        row = result.fetchone()

    if not row:
        raise HTTPException(status_code=401, detail="Invalid agent token")

    # Update last_seen_at on agent_tokens
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE agent_tokens SET last_seen_at = :now WHERE id = :id"),
            {"now": datetime.now(timezone.utc), "id": row.token_id},
        )
        await db.commit()

    return {
        "tenant_slug": row.tenant_slug,
        "tenant_id": str(row.tenant_id),
        "key_prefix": token_prefix,
        "source": "agent_token",
        "host_id": str(row.host_id),
    }


# ==================== Endpoints ====================

@app.post("/api/v1/results", status_code=202)
async def receive_check_results(
    request: Request,
    payload: CollectorPayload,
):
    """Receive check results from a Collector or Agent."""
    # Accept either X-API-Key or X-Agent-Token
    api_key = request.headers.get("X-API-Key")
    agent_token = request.headers.get("X-Agent-Token")

    if agent_token:
        await check_rate_limit(agent_token[:16])
        tenant_info = await validate_agent_token(agent_token)
    elif api_key:
        await check_rate_limit(api_key[:12])
        tenant_info = await validate_api_key(api_key)
    else:
        raise HTTPException(status_code=401, detail="Missing X-API-Key or X-Agent-Token header")

    message = {
        "tenant_slug": tenant_info["tenant_slug"],
        "collector_id": payload.collector_id,
        "timestamp": payload.timestamp.isoformat(),
        "checks": [check.model_dump_json() for check in payload.checks],
        "received_at": datetime.now(timezone.utc).isoformat(),
    }

    await redis_pool.xadd(STREAM_NAME, {"data": json.dumps(message)})

    # Update collector last_seen_at only for API key auth (collectors)
    if tenant_info.get("source") == "api_key":
        async with AsyncSessionLocal() as db:
            await db.execute(
                text("UPDATE collectors SET last_seen_at = :now WHERE id = CAST(:cid AS uuid)"),
                {"now": datetime.now(timezone.utc), "cid": payload.collector_id},
            )
            await db.commit()

    logger.info(
        "Received %d checks from %s=%s tenant=%s",
        len(payload.checks),
        "agent" if tenant_info.get("source") == "agent_token" else "collector",
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
