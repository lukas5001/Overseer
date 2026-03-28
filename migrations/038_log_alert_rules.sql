-- Migration 038: Log-based Alert Rules
-- Part of Block 5.2 — Log Viewer Frontend + Log-basierte Alerts

CREATE TABLE IF NOT EXISTS log_alert_rules (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID            NOT NULL,
    name            VARCHAR(255)    NOT NULL,
    enabled         BOOLEAN         NOT NULL DEFAULT TRUE,

    -- Pattern matching
    pattern         TEXT            NOT NULL,       -- regex or plain text
    is_regex        BOOLEAN         NOT NULL DEFAULT FALSE,

    -- Scope
    host_ids        UUID[]          DEFAULT '{}',   -- empty = all hosts
    services        TEXT[]          DEFAULT '{}',   -- empty = all services
    severity_min    SMALLINT        DEFAULT NULL,   -- only logs with severity <= this (more severe)

    -- Condition
    condition_type  VARCHAR(20)     NOT NULL DEFAULT 'any_match',
        -- 'any_match': fire immediately on first match
        -- 'threshold': fire when > threshold_count matches in time_window_seconds
        -- 'absence':   fire when pattern NOT seen in time_window_seconds
    threshold_count INTEGER         DEFAULT 1,          -- for 'threshold' type
    time_window_seconds INTEGER     DEFAULT 300,        -- for 'threshold' and 'absence' types (default 5 min)

    -- Alert config
    alert_severity  VARCHAR(10)     NOT NULL DEFAULT 'CRITICAL',  -- 'WARNING' or 'CRITICAL'
    notification_channels UUID[]    DEFAULT '{}',

    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_log_alert_rules_tenant ON log_alert_rules (tenant_id) WHERE enabled = TRUE;
