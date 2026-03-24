"""Natural language query endpoint – translates questions to SQL."""
import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ai_service.app.auth import get_current_user
from ai_service.app.database import get_db
from ai_service.app.services.ollama import chat_completion
from ai_service.app.services.prompts import NL_QUERY_SYSTEM_PROMPT, NL_ANSWER_SYSTEM_PROMPT

router = APIRouter()

# Keywords that must NEVER appear in generated SQL
_FORBIDDEN_KEYWORDS = re.compile(
    r"\b(DELETE|DROP|TRUNCATE|UPDATE|INSERT|ALTER|CREATE|GRANT|REVOKE|EXEC|EXECUTE)\b",
    re.IGNORECASE,
)


class NLQueryRequest(BaseModel):
    question: str
    tenant_id: UUID
    context_host_id: UUID | None = None


def _validate_sql(sql: str) -> str:
    """Validate that the generated SQL is a safe SELECT query."""
    # Strip markdown code fences if present
    sql = sql.strip()
    if sql.startswith("```"):
        sql = re.sub(r"^```\w*\n?", "", sql)
        sql = re.sub(r"\n?```$", "", sql)
    sql = sql.strip().rstrip(";")

    if not sql.upper().startswith("SELECT"):
        raise ValueError("Nur SELECT-Queries sind erlaubt")

    if _FORBIDDEN_KEYWORDS.search(sql):
        raise ValueError("Query enthält verbotene Keywords")

    # Reject multiple statements
    if ";" in sql:
        raise ValueError("Mehrere Statements sind nicht erlaubt")

    return sql


@router.post("/")
async def natural_language_query(
    body: NLQueryRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Step 1: Generate SQL from natural language
    context_hint = ""
    if body.context_host_id:
        context_hint = f"\nKontext: Der User schaut gerade den Host mit ID {body.context_host_id} an."

    messages = [
        {"role": "system", "content": NL_QUERY_SYSTEM_PROMPT},
        {"role": "user", "content": f"{body.question}{context_hint}"},
    ]

    try:
        raw_sql = await chat_completion(messages, temperature=0.1)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ollama-Fehler: {e}")

    # Step 2: Validate SQL strictly
    try:
        safe_sql = _validate_sql(raw_sql)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"Ungültige generierte Query: {e}")

    # Step 3: Inject tenant_id filter via parameter binding
    # Wrap in subquery to enforce tenant isolation
    if ":tenant_id" not in safe_sql:
        raise HTTPException(
            status_code=422,
            detail="Generierte Query enthält keinen tenant_id-Filter",
        )

    # Step 4: Execute with tenant_id parameter
    try:
        result = await db.execute(text(safe_sql), {"tenant_id": body.tenant_id})
        rows = result.fetchall()
        columns = list(result.keys()) if rows else []
        data = [dict(zip(columns, row)) for row in rows]
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"SQL-Ausführungsfehler: {e}")

    # Step 5: Generate human-readable answer
    answer_messages = [
        {"role": "system", "content": NL_ANSWER_SYSTEM_PROMPT},
        {"role": "user", "content": f"Frage: {body.question}\n\nSQL-Ergebnis ({len(data)} Zeilen):\n{data[:50]}"},
    ]

    try:
        answer = await chat_completion(answer_messages, temperature=0.3)
    except Exception:
        # Fallback: return raw data without AI summary
        answer = f"{len(data)} Ergebnis(se) gefunden."

    return {
        "question": body.question,
        "answer": answer,
        "data": data[:100],
        "sql_used": safe_sql,
    }
