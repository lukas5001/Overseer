"""Shared pytest fixtures for the Overseer API test suite."""
import pytest
import pytest_asyncio
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock

import httpx
from jose import jwt

from api.app.main import app
from api.app.core.database import get_db

SECRET_KEY = "dev_secret_key_change_in_production"
ALGORITHM = "HS256"

TEST_USER_ID = "00000000-0000-0000-0000-000000000001"
TEST_USER_EMAIL = "test@test.com"
TEST_USER_ROLE = "super_admin"


def make_token(
    role: str = TEST_USER_ROLE,
    email: str = TEST_USER_EMAIL,
    sub: str = TEST_USER_ID,
    expires_delta: timedelta = timedelta(hours=1),
) -> str:
    payload = {
        "sub": sub,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + expires_delta,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def make_expired_token() -> str:
    return make_token(expires_delta=timedelta(seconds=-1))


def _make_mock_db_session(scalar_one_or_none_return=None):
    """Build an AsyncMock DB session.

    scalar_one_or_none_return: value returned by result.scalar_one_or_none()
                               (None means "user not found / no row")
    """
    result_mock = MagicMock()
    result_mock.scalar_one_or_none.return_value = scalar_one_or_none_return
    result_mock.all.return_value = []
    result_mock.scalars.return_value = MagicMock(all=MagicMock(return_value=[]))
    result_mock.fetchall.return_value = []
    result_mock.fetchone.return_value = None

    session = AsyncMock()
    session.execute = AsyncMock(return_value=result_mock)
    session.commit = AsyncMock()
    return session


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def valid_token() -> str:
    return make_token()


@pytest.fixture
def expired_token() -> str:
    return make_expired_token()


@pytest.fixture
def auth_headers(valid_token) -> dict:
    return {"Authorization": f"Bearer {valid_token}"}


@pytest_asyncio.fixture
async def client():
    """HTTP client that hits the real FastAPI app with an empty-DB mock."""
    async def mock_db_no_user():
        yield _make_mock_db_session(scalar_one_or_none_return=None)

    app.dependency_overrides[get_db] = mock_db_no_user
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client_with_user():
    """HTTP client where the DB mock returns a fake active user row."""
    fake_user = MagicMock()
    fake_user.id = TEST_USER_ID
    fake_user.email = TEST_USER_EMAIL
    fake_user.display_name = "Test User"
    fake_user.role = TEST_USER_ROLE
    fake_user.tenant_id = None
    fake_user.password_hash = "$2b$12$invalidhashfortestingpurposes___"
    fake_user.active = True
    fake_user.last_login_at = None

    async def mock_db_with_user():
        yield _make_mock_db_session(scalar_one_or_none_return=fake_user)

    app.dependency_overrides[get_db] = mock_db_with_user
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
