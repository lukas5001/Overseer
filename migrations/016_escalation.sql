-- Phase 2.2: Escalation Policies

CREATE TABLE escalation_policies (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    steps   JSONB NOT NULL DEFAULT '[]',
    -- steps format: [{"delay_minutes": 0, "channels": ["<uuid>"]}, {"delay_minutes": 30, "channels": ["<uuid>"]}]
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_escalation_per_rule ON escalation_policies(rule_id);
