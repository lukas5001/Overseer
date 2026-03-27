-- 030: Custom Dashboards
-- Adds dashboards + dashboard_versions tables for configurable custom dashboards.

CREATE TABLE IF NOT EXISTS dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_shared BOOLEAN NOT NULL DEFAULT false,
    share_token VARCHAR(64) UNIQUE,
    share_expires_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, title)
);

CREATE INDEX IF NOT EXISTS idx_dashboards_tenant ON dashboards(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_share_token ON dashboards(share_token) WHERE share_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS dashboard_versions (
    id SERIAL PRIMARY KEY,
    dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    config JSONB NOT NULL,
    changed_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_versions_dashboard ON dashboard_versions(dashboard_id, version DESC);
