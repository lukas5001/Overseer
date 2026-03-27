-- 036: Host/Service dependency relationships for alert suppression
-- When a parent device is down, alerts for dependent children are suppressed.

CREATE TABLE IF NOT EXISTS dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source_type VARCHAR(20) NOT NULL,       -- 'host' or 'service'
    source_id UUID NOT NULL,
    depends_on_type VARCHAR(20) NOT NULL,   -- 'host' or 'service'
    depends_on_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(source_type, source_id, depends_on_type, depends_on_id)
);

CREATE INDEX idx_deps_source ON dependencies(source_type, source_id);
CREATE INDEX idx_deps_target ON dependencies(depends_on_type, depends_on_id);
CREATE INDEX idx_deps_tenant ON dependencies(tenant_id);
