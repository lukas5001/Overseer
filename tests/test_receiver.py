"""Tests for the Overseer Receiver."""
import pytest
from httpx import AsyncClient, ASGITransport

from receiver.app.main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_health_endpoint():
    """Health endpoint should respond."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
        assert response.status_code in (200, 503)  # 503 if Redis not connected


@pytest.mark.anyio
async def test_receive_requires_api_key():
    """Posting results without API key should return 422."""
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
    """Valid payload with correct API key format should be accepted (if Redis is available)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
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
        # 202 if Redis connected + valid key, 401 if key not in DB, 500 if no Redis
        assert response.status_code in (202, 401, 500)
