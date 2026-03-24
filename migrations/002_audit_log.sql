-- Overseer: Audit Log
-- Tracks who did what: ACKs, downtimes, host/service/user creation, etc.

CREATE TABLE IF NOT EXISTS audit_log (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID REFERENCES tenants(id) ON DELETE SET NULL,
    actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_email VARCHAR(255),          -- denormalised: readable even if user is deleted
    action      VARCHAR(100) NOT NULL, -- e.g. 'acknowledge', 'downtime_create', 'host_create'
    target_type VARCHAR(50),           -- 'service', 'host', 'downtime', 'user', ...
    target_id   UUID,
    detail      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_tenant   ON audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_audit_log_actor    ON audit_log(actor_id,  created_at DESC);
CREATE INDEX idx_audit_log_action   ON audit_log(action,    created_at DESC);
CREATE INDEX idx_audit_log_target   ON audit_log(target_type, target_id);
