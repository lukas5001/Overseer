-- Agent support: tokens, host flag, and indexes
-- Enables Go-based agent monitoring as replacement for WinRM

-- New table: agent_tokens (1:1 agent-to-host binding)
CREATE TABLE agent_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    token_prefix VARCHAR(16) NOT NULL,
    name VARCHAR(255) DEFAULT 'default',
    active BOOLEAN NOT NULL DEFAULT true,
    last_seen_at TIMESTAMPTZ,
    agent_version VARCHAR(50),
    agent_os VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(token_hash)
);

CREATE INDEX idx_agent_tokens_prefix ON agent_tokens(token_prefix);
CREATE INDEX idx_agent_tokens_host ON agent_tokens(host_id);

-- New flag on hosts: is this host monitored by an agent?
ALTER TABLE hosts ADD COLUMN agent_managed BOOLEAN NOT NULL DEFAULT false;
