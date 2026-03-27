-- Migration 033: Report scheduling and delivery tracking
-- Supports periodic automated report generation + email delivery

CREATE TABLE report_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    report_type VARCHAR(50) NOT NULL,        -- 'executive', 'technical', 'sla'
    cron_expression VARCHAR(100) NOT NULL,   -- '0 8 1 * *' = 1st of month, 8:00
    recipients JSONB NOT NULL,               -- {"to": ["cto@example.com"], "cc": [], "bcc": []}
    scope JSONB,                             -- {"host_ids": [...], "tags": [...]} or null = all
    branding JSONB NOT NULL DEFAULT '{}',    -- logo_path, company_name, primary_color, footer_text
    cover_text TEXT,
    timezone VARCHAR(50) DEFAULT 'Europe/Rome',
    enabled BOOLEAN DEFAULT true,
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    created_by UUID,                         -- no FK on users (JWT re-seed issue)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_report_schedules_tenant ON report_schedules (tenant_id);
CREATE INDEX idx_report_schedules_enabled ON report_schedules (enabled) WHERE enabled = true;

CREATE TABLE report_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID REFERENCES report_schedules(id) ON DELETE SET NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    report_type VARCHAR(50) NOT NULL,
    report_period_start DATE NOT NULL,
    report_period_end DATE NOT NULL,
    pdf_path VARCHAR(500),
    pdf_size_bytes BIGINT,
    recipients JSONB,
    status VARCHAR(20) DEFAULT 'pending',    -- pending, generating, sent, failed
    error_message TEXT,
    generated_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    created_by UUID,                         -- no FK on users
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_report_deliveries_tenant ON report_deliveries (tenant_id);
CREATE INDEX idx_report_deliveries_schedule ON report_deliveries (schedule_id);
CREATE INDEX idx_report_deliveries_status ON report_deliveries (status);
CREATE INDEX idx_report_deliveries_created ON report_deliveries (created_at DESC);
