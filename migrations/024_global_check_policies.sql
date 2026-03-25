-- Global Check Policies: config overrides applied across tenants/hosts
-- Example: exclude "sppsvc" from agent_services_auto for all tenants

CREATE TABLE global_check_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    check_type VARCHAR(100) NOT NULL,          -- e.g. 'agent_services_auto', '*' for all
    merge_config JSONB NOT NULL DEFAULT '{}',   -- config values to merge into check_config
    merge_strategy VARCHAR(20) NOT NULL DEFAULT 'merge',  -- 'merge' or 'override'
    scope_mode VARCHAR(20) NOT NULL DEFAULT 'all',        -- 'all', 'include_tenants', 'exclude_tenants'
    scope_tenant_ids UUID[] NOT NULL DEFAULT '{}',
    enabled BOOLEAN NOT NULL DEFAULT true,
    priority INT NOT NULL DEFAULT 0,            -- higher = applied later (wins on conflict)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gcp_enabled ON global_check_policies (enabled) WHERE enabled = true;
