-- Phase 2.1: Alert Rules and Active Alerts

CREATE TABLE alert_rules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    conditions  JSONB NOT NULL DEFAULT '{
        "statuses": ["CRITICAL", "UNKNOWN"],
        "min_duration_minutes": 5,
        "host_tags": [],
        "service_names": []
    }',
    notification_channels UUID[] NOT NULL DEFAULT '{}',
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE active_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    rule_id         UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    fired_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ,
    escalation_step INTEGER NOT NULL DEFAULT 0,
    UNIQUE(service_id, rule_id)
);

CREATE INDEX idx_active_alerts_service ON active_alerts(service_id) WHERE resolved_at IS NULL;
CREATE INDEX idx_active_alerts_tenant ON active_alerts(tenant_id) WHERE resolved_at IS NULL;
