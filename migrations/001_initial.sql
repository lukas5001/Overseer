-- Overseer: Initial Schema
-- PostgreSQL 16 + TimescaleDB

-- ==================== Extensions ====================
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==================== Enum Types ====================
CREATE TYPE check_status AS ENUM ('OK', 'WARNING', 'CRITICAL', 'UNKNOWN');
CREATE TYPE state_type AS ENUM ('SOFT', 'HARD');
CREATE TYPE user_role AS ENUM ('super_admin', 'tenant_admin', 'tenant_operator', 'tenant_viewer');
CREATE TYPE host_type AS ENUM ('server', 'switch', 'router', 'printer', 'firewall', 'access_point', 'other');

-- ==================== Tenants ====================
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT true,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);

-- ==================== API Keys ====================
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key_hash VARCHAR(255) NOT NULL,
    key_prefix VARCHAR(12) NOT NULL,  -- first 8 chars for identification
    name VARCHAR(255) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);

-- ==================== Users ====================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = super_admin
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'tenant_viewer',
    active BOOLEAN NOT NULL DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_tenant ON users(tenant_id);

-- ==================== Collectors ====================
CREATE TABLE collectors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    hostname VARCHAR(255),
    ip_address INET,
    active BOOLEAN NOT NULL DEFAULT true,
    last_seen_at TIMESTAMPTZ,
    config_version INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collectors_tenant ON collectors(tenant_id);

-- ==================== Hosts ====================
CREATE TABLE hosts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    collector_id UUID NOT NULL REFERENCES collectors(id) ON DELETE CASCADE,
    hostname VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    ip_address INET,
    host_type host_type NOT NULL DEFAULT 'server',
    snmp_community VARCHAR(255),
    snmp_version VARCHAR(10) DEFAULT '2c',
    tags JSONB NOT NULL DEFAULT '[]',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, hostname)
);

CREATE INDEX idx_hosts_tenant ON hosts(tenant_id);
CREATE INDEX idx_hosts_collector ON hosts(collector_id);

-- ==================== Services (Checks) ====================
CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    host_id UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    check_type VARCHAR(100) NOT NULL,  -- ping, snmp, ssh_disk, http, port, process, script, etc.
    check_config JSONB NOT NULL DEFAULT '{}',  -- type-specific config (OID, mount, port, etc.)
    interval_seconds INTEGER NOT NULL DEFAULT 60,
    threshold_warn FLOAT,
    threshold_crit FLOAT,
    max_check_attempts INTEGER NOT NULL DEFAULT 3,  -- attempts before hard state
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(host_id, name)
);

CREATE INDEX idx_services_host ON services(host_id);
CREATE INDEX idx_services_tenant ON services(tenant_id);

-- ==================== Current Status ====================
-- Denormalized table for fast dashboard queries
CREATE TABLE current_status (
    service_id UUID PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE,
    host_id UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    status check_status NOT NULL DEFAULT 'UNKNOWN',
    state_type state_type NOT NULL DEFAULT 'SOFT',
    current_attempt INTEGER NOT NULL DEFAULT 0,
    status_message TEXT,
    value FLOAT,
    unit VARCHAR(50),
    last_check_at TIMESTAMPTZ,
    last_state_change_at TIMESTAMPTZ,
    acknowledged BOOLEAN NOT NULL DEFAULT false,
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,
    acknowledge_comment TEXT,
    in_downtime BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_current_status_tenant ON current_status(tenant_id);
CREATE INDEX idx_current_status_status ON current_status(status) WHERE status != 'OK';
CREATE INDEX idx_current_status_tenant_status ON current_status(tenant_id, status);

-- ==================== Check Results (Timeseries) ====================
CREATE TABLE check_results (
    time TIMESTAMPTZ NOT NULL,
    service_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    status check_status NOT NULL,
    value FLOAT,
    unit VARCHAR(50),
    message TEXT,
    perfdata JSONB,
    check_duration_ms INTEGER
);

-- Convert to TimescaleDB hypertable
SELECT create_hypertable('check_results', 'time');

CREATE INDEX idx_check_results_service ON check_results(service_id, time DESC);
CREATE INDEX idx_check_results_tenant ON check_results(tenant_id, time DESC);

-- Retention policy: keep raw data for 90 days
SELECT add_retention_policy('check_results', INTERVAL '90 days');

-- ==================== State History ====================
CREATE TABLE state_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    previous_status check_status,
    new_status check_status NOT NULL,
    state_type state_type NOT NULL,
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_state_history_service ON state_history(service_id, created_at DESC);
CREATE INDEX idx_state_history_tenant ON state_history(tenant_id, created_at DESC);

-- ==================== Downtimes ====================
CREATE TABLE downtimes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    host_id UUID REFERENCES hosts(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id) ON DELETE CASCADE,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    author_id UUID NOT NULL REFERENCES users(id),
    comment TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT downtime_target CHECK (host_id IS NOT NULL OR service_id IS NOT NULL)
);

CREATE INDEX idx_downtimes_tenant ON downtimes(tenant_id);
CREATE INDEX idx_downtimes_active ON downtimes(active, start_at, end_at) WHERE active = true;

-- ==================== Audit Log ====================
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100),
    entity_id UUID,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_tenant ON audit_log(tenant_id, created_at DESC);

-- ==================== Updated_at Trigger ====================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_collectors_updated_at BEFORE UPDATE ON collectors FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_hosts_updated_at BEFORE UPDATE ON hosts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_services_updated_at BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION update_updated_at();
