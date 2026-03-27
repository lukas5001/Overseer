-- Migration 027: SSL metadata and notification state tracking
--
-- 1. Add metadata JSONB column to check_results for structured check data (e.g., SSL cert details)
-- 2. Create ssl_notification_state table for staged SSL certificate expiry notifications

-- Metadata column for structured check output (SSL cert details, etc.)
ALTER TABLE check_results ADD COLUMN IF NOT EXISTS metadata JSONB;

-- SSL certificate notification stage tracking (staffelung)
-- Tracks which notification stage has been sent to avoid duplicate notifications
CREATE TABLE IF NOT EXISTS ssl_notification_state (
    service_id UUID PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    last_stage VARCHAR(20),              -- '30d', '14d', '7d', '3d', 'expired'
    last_notified_at TIMESTAMPTZ,
    last_days_until_expiry INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
