"""Tests for /api/v1/status endpoints."""
import pytest


# ---------------------------------------------------------------------------
# GET /api/v1/status/errors
# ---------------------------------------------------------------------------

async def test_error_overview_requires_auth(client):
    """No token → 403."""
    resp = await client.get("/api/v1/status/errors")
    assert resp.status_code == 403


async def test_error_overview_returns_list(client, auth_headers):
    """Valid token + empty DB mock → 200 with an empty list."""
    resp = await client.get("/api/v1/status/errors", headers=auth_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


# ---------------------------------------------------------------------------
# GET /api/v1/status/summary
# ---------------------------------------------------------------------------

async def test_summary_requires_auth(client):
    """No token → 403."""
    resp = await client.get("/api/v1/status/summary")
    assert resp.status_code == 403


async def test_summary_returns_ok(client, auth_headers):
    """Valid token + empty DB mock → 200 with zeroed-out counts."""
    resp = await client.get("/api/v1/status/summary", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    # All counts are zero because the mock returns no rows
    assert data["total"] == 0
    assert "ok" in data
    assert "warning" in data
    assert "critical" in data
    assert "unknown" in data
