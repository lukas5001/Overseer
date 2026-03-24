"""Knowledge base CRUD – stores and retrieves confirmed problem/solution pairs."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ai_service.app.auth import get_current_user
from ai_service.app.database import get_db
from ai_service.app.services.ollama import get_embedding

router = APIRouter()


class KnowledgeCreate(BaseModel):
    content: str
    tenant_id: UUID
    service_id: UUID | None = None


class KnowledgeOut(BaseModel):
    id: str
    content: str
    source: str
    confirmed: bool
    similarity: float | None = None


@router.post("/", response_model=KnowledgeOut)
async def add_knowledge(
    body: KnowledgeCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a confirmed knowledge entry with its embedding."""
    try:
        embedding = await get_embedding(body.content)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Embedding-Fehler: {e}")

    embedding_str = "[" + ",".join(str(v) for v in embedding) + "]"

    result = await db.execute(text("""
        INSERT INTO knowledge_embeddings (content, embedding, service_id, tenant_id, source, confirmed)
        VALUES (:content, :embedding::vector, :service_id, :tenant_id, 'user', TRUE)
        RETURNING id, content, source, confirmed
    """), {
        "content": body.content,
        "embedding": embedding_str,
        "service_id": body.service_id,
        "tenant_id": body.tenant_id,
    })
    await db.commit()

    row = result.fetchone()
    return KnowledgeOut(
        id=str(row.id),
        content=row.content,
        source=row.source,
        confirmed=row.confirmed,
    )


@router.get("/{service_id}", response_model=list[KnowledgeOut])
async def get_relevant_knowledge(
    service_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Find relevant knowledge entries for a service based on its current error."""
    # Get current service error
    svc = await db.execute(text("""
        SELECT s.name, s.check_type, cs.status_message, h.tenant_id
        FROM services s
        JOIN hosts h ON s.host_id = h.id
        LEFT JOIN current_status cs ON cs.service_id = s.id
        WHERE s.id = :service_id
    """), {"service_id": service_id})
    row = svc.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Service nicht gefunden")

    query_text = f"{row.name} {row.check_type} {row.status_message or ''}"

    try:
        embedding = await get_embedding(query_text)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Embedding-Fehler: {e}")

    embedding_str = "[" + ",".join(str(v) for v in embedding) + "]"

    result = await db.execute(text("""
        SELECT id, content, source, confirmed,
               1 - (embedding <=> :query_embedding::vector) AS similarity
        FROM knowledge_embeddings
        WHERE tenant_id = :tenant_id
          AND embedding IS NOT NULL
        ORDER BY embedding <=> :query_embedding::vector
        LIMIT 5
    """), {
        "query_embedding": embedding_str,
        "tenant_id": row.tenant_id,
    })

    return [
        KnowledgeOut(
            id=str(r.id),
            content=r.content,
            source=r.source,
            confirmed=r.confirmed,
            similarity=round(float(r.similarity), 4),
        )
        for r in result.fetchall()
    ]


@router.delete("/{knowledge_id}")
async def delete_knowledge(
    knowledge_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a knowledge entry."""
    result = await db.execute(text("""
        DELETE FROM knowledge_embeddings WHERE id = :id
    """), {"id": knowledge_id})
    await db.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Knowledge-Eintrag nicht gefunden")

    return {"deleted": True}
