-- 022: Monitoring Scripts – server-managed scripts for agent_script checks
CREATE TABLE IF NOT EXISTS monitoring_scripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    interpreter VARCHAR(20) NOT NULL DEFAULT 'powershell',
    script_body TEXT NOT NULL,
    expected_output VARCHAR(20) NOT NULL DEFAULT 'nagios',
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_monitoring_scripts_tenant ON monitoring_scripts(tenant_id);
