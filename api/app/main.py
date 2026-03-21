"""
Overseer API – REST API for the Web UI and external integrations.

Responsibilities:
- Authentication (JWT)
- CRUD for Tenants, Collectors, Hosts, Services
- Error overview (Fehlerübersicht) endpoint
- Current status queries
- Downtime management
- Acknowledge functionality
- Collector config distribution
- WebSocket for live updates
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import auth, status, tenants, hosts, services, collectors, downtimes, config

# ==================== Config ====================

SECRET_KEY = os.getenv("SECRET_KEY", "dev_secret_key_change_in_production")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://overseer:overseer_dev_password@localhost:5432/overseer")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

# ==================== App ====================

app = FastAPI(
    title="Overseer API",
    version="0.1.0",
    description="Monitoring system API – manages tenants, hosts, services, and check status.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],  # React dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "overseer-api"}
