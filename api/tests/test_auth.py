"""Tests for /api/v1/auth endpoints."""
import pytest


# ---------------------------------------------------------------------------
# POST /api/v1/auth/login
# ---------------------------------------------------------------------------

async def test_login_missing_credentials(client):
    """No body at all → FastAPI validation error 422."""
    resp = await client.post("/api/v1/auth/login")
    assert resp.status_code == 422


async def test_login_wrong_password(client):
    """Valid JSON body but the DB mock returns no user → 401."""
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@example.com", "password": "wrong"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid credentials"


# ---------------------------------------------------------------------------
# GET /api/v1/auth/me
# ---------------------------------------------------------------------------

async def test_me_unauthenticated(client):
    """No Authorization header → 403 (HTTPBearer with auto_error=False raises 403)."""
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 403


async def test_me_authenticated(client_with_user, valid_token):
    """Valid JWT + DB returns a user → 200 with user payload."""
    resp = await client_with_user.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {valid_token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "test@test.com"
    assert data["role"] == "super_admin"
    assert "id" in data


# ---------------------------------------------------------------------------
# POST /api/v1/auth/refresh
# ---------------------------------------------------------------------------

async def test_refresh_valid_token(client, valid_token):
    """Valid token → 200 with a fresh token in the response body."""
    resp = await client.post(
        "/api/v1/auth/refresh",
        headers={"Authorization": f"Bearer {valid_token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["expires_in"] == 480 * 60


async def test_refresh_expired_token(client, expired_token):
    """Expired token → 401 (JWTError caught by get_current_user)."""
    resp = await client.post(
        "/api/v1/auth/refresh",
        headers={"Authorization": f"Bearer {expired_token}"},
    )
    assert resp.status_code == 401
