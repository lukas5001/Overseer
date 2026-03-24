"""
Overseer AI Service – LLM-powered analysis and natural language queries.
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ai_service.app.config import AI_ENABLED

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")

app = FastAPI(title="Overseer AI Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With", "Accept"],
)

if AI_ENABLED:
    from ai_service.app.routers import analysis, query, knowledge
    app.include_router(analysis.router, prefix="/ai/analyze", tags=["analysis"])
    app.include_router(query.router, prefix="/ai/query", tags=["query"])
    app.include_router(knowledge.router, prefix="/ai/knowledge", tags=["knowledge"])


@app.get("/health")
async def health():
    return {"status": "ok", "ai_enabled": AI_ENABLED}
