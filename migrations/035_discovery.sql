-- 035: Auto-Discovery results table
-- Stores results from agent service discovery and collector network scans.

CREATE TABLE IF NOT EXISTS discovery_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    scan_id UUID,
    source VARCHAR(30) NOT NULL,              -- 'network_scan', 'agent_discovery'
    ip_address INET,
    hostname VARCHAR(255),
    mac_address VARCHAR(17),
    vendor VARCHAR(255),
    device_type VARCHAR(50),                  -- 'server', 'network_device', 'printer', 'unknown'
    os_guess VARCHAR(255),
    open_ports JSONB DEFAULT '[]'::jsonb,
    snmp_data JSONB,
    services JSONB DEFAULT '[]'::jsonb,       -- agent-discovered services
    suggested_checks JSONB DEFAULT '[]'::jsonb,
    matched_host_id UUID REFERENCES hosts(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'new', -- 'new', 'known', 'added', 'ignored'
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, source, ip_address),
    UNIQUE(tenant_id, source, hostname)
);

CREATE INDEX idx_discovery_results_tenant ON discovery_results(tenant_id);
CREATE INDEX idx_discovery_results_status ON discovery_results(tenant_id, status);
CREATE INDEX idx_discovery_results_scan ON discovery_results(scan_id) WHERE scan_id IS NOT NULL;

-- Network scan tracking table
CREATE TABLE IF NOT EXISTS discovery_scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    collector_id UUID REFERENCES collectors(id) ON DELETE SET NULL,
    target VARCHAR(255) NOT NULL,
    ports VARCHAR(500),
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'
    hosts_found INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
