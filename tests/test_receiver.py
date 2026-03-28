"""Tests for the Overseer Receiver."""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from httpx import AsyncClient, ASGITransport

from receiver.app.main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
def _reset_receiver_engine():
    """Reset the receiver's SQLAlchemy engine before each test to avoid event loop conflicts."""
    import receiver.app.main as mod
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    mod.engine = create_async_engine(mod.DATABASE_URL, echo=False, pool_pre_ping=True)
    mod.AsyncSessionLocal = async_sessionmaker(mod.engine, class_=AsyncSession, expire_on_commit=False)
    yield


@pytest.mark.anyio
async def test_health_endpoint():
    """Health endpoint should respond."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
        assert response.status_code in (200, 503)  # 503 if Redis not connected


@pytest.mark.anyio
async def test_receive_requires_api_key():
    """Posting results without API key should return 401."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/results",
            json={
                "collector_id": "test-collector",
                "tenant_id": "test-tenant",
                "timestamp": "2026-03-20T14:30:00Z",
                "checks": [],
            },
        )
        assert response.status_code == 401  # Missing X-API-Key or X-Agent-Token header


@pytest.mark.anyio
async def test_receive_validates_api_key():
    """Posting results with invalid API key should return 401."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with patch("receiver.app.main.validate_api_key", new_callable=AsyncMock, side_effect=HTTPException(status_code=401, detail="Invalid API key")):
            response = await client.post(
                "/api/v1/results",
                json={
                    "collector_id": "test-collector",
                    "tenant_id": "test-tenant",
                    "timestamp": "2026-03-20T14:30:00Z",
                    "checks": [],
                },
                headers={"X-API-Key": "invalid_key"},
            )
            assert response.status_code == 401


@pytest.mark.anyio
async def test_receive_valid_payload():
    """Valid payload with correct API key format should be accepted (mocked DB + Redis)."""
    transport = ASGITransport(app=app)
    mock_tenant = {"tenant_slug": "kunde-abc", "tenant_id": "00000000-0000-0000-0000-000000000001", "key_prefix": "overseer_kun", "source": "api_key"}
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with patch("receiver.app.main.check_rate_limit", new_callable=AsyncMock), \
             patch("receiver.app.main.validate_api_key", new_callable=AsyncMock, return_value=mock_tenant), \
             patch("receiver.app.main.redis_pool") as mock_redis, \
             patch("receiver.app.main.AsyncSessionLocal") as mock_session_factory:
            mock_redis.xadd = AsyncMock()
            # Mock the DB session for collector last_seen_at update
            mock_db = AsyncMock()
            mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_db)
            mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)
            response = await client.post(
                "/api/v1/results",
                json={
                    "collector_id": "collector-kunde-abc",
                    "tenant_id": "kunde-abc",
                    "timestamp": "2026-03-20T14:30:00Z",
                    "checks": [
                        {
                            "host": "switch-core-01",
                            "name": "ping",
                            "status": "OK",
                            "value": 1.5,
                            "unit": "ms",
                            "message": "Ping OK: 1.5ms",
                            "check_type": "ping",
                        }
                    ],
                },
                headers={"X-API-Key": "overseer_kundeabc_secretkey123"},
            )
            assert response.status_code == 202
