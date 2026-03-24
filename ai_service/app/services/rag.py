"""RAG (Retrieval-Augmented Generation) via pgvector similarity search."""
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ai_service.app.services.ollama import get_embedding


async def find_similar_knowledge(
    db: AsyncSession,
    tenant_id: UUID,
    query_text: str,
    limit: int = 5,
) -> list[dict]:
    """Find similar knowledge entries using pgvector cosine similarity."""
    embedding = await get_embedding(query_text)
    embedding_str = "[" + ",".join(str(v) for v in embedding) + "]"

    result = await db.execute(text("""
        SELECT id, content, source, confirmed,
               1 - (embedding <=> :query_embedding::vector) AS similarity
        FROM knowledge_embeddings
        WHERE tenant_id = :tenant_id
          AND embedding IS NOT NULL
        ORDER BY embedding <=> :query_embedding::vector
        LIMIT :limit
    """), {
        "query_embedding": embedding_str,
        "tenant_id": tenant_id,
        "limit": limit,
    })

    return [
        {
            "id": str(r.id),
            "content": r.content,
            "source": r.source,
            "confirmed": r.confirmed,
            "similarity": round(float(r.similarity), 4),
        }
        for r in result.fetchall()
    ]
