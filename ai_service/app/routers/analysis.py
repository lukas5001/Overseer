"""AI analysis endpoint – diagnoses failing services."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ai_service.app.auth import get_current_user
from ai_service.app.database import get_db
from ai_service.app.services.context import (
    get_service_context,
    get_check_history,
    get_state_history,
    get_tenant_id_for_service,
)
from ai_service.app.services.rag import find_similar_knowledge
from ai_service.app.services.ollama import chat_completion
from ai_service.app.services.prompts import ANALYSIS_SYSTEM_PROMPT, ANALYSIS_USER_PROMPT

router = APIRouter()


def _format_check_history(checks: list[dict]) -> str:
    if not checks:
        return "(keine Daten)"
    lines = []
    for c in checks[:50]:
        lines.append(f"  {c['time']} | {c['status']} | Wert: {c['value']} | {c['message'] or ''}")
    if len(checks) > 50:
        lines.append(f"  ... und {len(checks) - 50} weitere Einträge")
    return "\n".join(lines)


def _format_state_history(states: list[dict]) -> str:
    if not states:
        return "(keine Daten)"
    lines = []
    for s in states:
        lines.append(f"  {s['changed_at']} | {s['old_status']} → {s['new_status']} ({s['state_type']}) | {s['message'] or ''}")
    return "\n".join(lines)


def _format_knowledge(entries: list[dict]) -> str:
    if not entries:
        return ""
    lines = ["Ähnliche bekannte Probleme aus der Wissensdatenbank:"]
    for e in entries:
        lines.append(f"  - (Ähnlichkeit {e['similarity']:.0%}): {e['content']}")
    return "\n".join(lines)


@router.post("/{service_id}")
async def analyze_service(
    service_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ctx = await get_service_context(db, service_id)
    if not ctx:
        raise HTTPException(status_code=404, detail="Service nicht gefunden")

    checks = await get_check_history(db, service_id)
    states = await get_state_history(db, service_id)

    # RAG: find similar knowledge
    tenant_id = await get_tenant_id_for_service(db, service_id)
    similar = []
    if tenant_id:
        query_text = f"{ctx['service_name']} {ctx['check_type']} {ctx['status_message']}"
        try:
            similar = await find_similar_knowledge(db, tenant_id, query_text)
        except Exception:
            pass  # Knowledge base may be empty or embeddings not available

    # Determine status_since from state history
    status_since = states[0]["changed_at"] if states else ctx["last_check_at"]

    user_prompt = ANALYSIS_USER_PROMPT.format(
        service_name=ctx["service_name"],
        check_type=ctx["check_type"],
        host_name=ctx["host_name"],
        host_address=ctx["host_address"],
        current_status=ctx["current_status"],
        status_message=ctx["status_message"],
        status_since=status_since,
        warning_threshold=ctx["warning_threshold"] or "nicht gesetzt",
        critical_threshold=ctx["critical_threshold"] or "nicht gesetzt",
        check_history=_format_check_history(checks),
        state_history=_format_state_history(states),
        knowledge_context=_format_knowledge(similar),
    )

    messages = [
        {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    try:
        diagnosis = await chat_completion(messages)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ollama-Fehler: {e}")

    return {
        "service_id": str(service_id),
        "service_name": ctx["service_name"],
        "diagnosis": diagnosis,
        "similar_cases": similar,
    }
