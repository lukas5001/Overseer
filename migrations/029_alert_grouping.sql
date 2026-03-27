-- 029_alert_grouping.sql – Alert Grouping support
-- Adds alert_groups table for tracking grouped notifications
-- and default grouping settings in tenant.settings JSONB.

-- Table to persist alert group state (survives restarts)
CREATE TABLE IF NOT EXISTS alert_groups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    group_key       TEXT NOT NULL,          -- e.g. "host:web-01" or "host:web-01:CRITICAL"
    group_by        VARCHAR(30) NOT NULL DEFAULT 'host',
    alerts          JSONB NOT NULL DEFAULT '[]'::jsonb,   -- array of alert objects
    alert_count     INTEGER NOT NULL DEFAULT 0,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, active, resolved
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    first_alert_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_alert_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_notified_at TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ,
    UNIQUE(tenant_id, group_key, status) -- only one active group per key per tenant
);

CREATE INDEX IF NOT EXISTS idx_alert_groups_tenant_status ON alert_groups(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_alert_groups_last_notified ON alert_groups(last_notified_at) WHERE status = 'active';

-- Set default grouping settings for all tenants that don't have them yet
UPDATE tenants
SET settings = settings || '{
    "alert_grouping": {
        "enabled": true,
        "group_by": "host",
        "group_wait_seconds": 30,
        "group_interval_seconds": 300,
        "repeat_interval_seconds": 14400
    }
}'::jsonb
WHERE NOT (settings ? 'alert_grouping');
