-- 018: pgvector Extension und Knowledge-Embeddings-Tabelle für AI Service
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE knowledge_embeddings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
    service_id  UUID REFERENCES services(id) ON DELETE SET NULL,
    content     TEXT NOT NULL,
    embedding   vector(4096),
    source      VARCHAR(50) NOT NULL DEFAULT 'user',
    confirmed   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index wird erst bei ausreichend Einträgen (>1000) manuell erstellt:
-- CREATE INDEX ON knowledge_embeddings USING hnsw (embedding vector_cosine_ops);
