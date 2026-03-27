-- Migration 028: Notification Plugin System
-- Adds failure tracking to notification_channels and creates notification_log table.

-- Add failure-tracking columns to notification_channels
ALTER TABLE notification_channels
    ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_failure_reason TEXT;

-- Notification log – records every send attempt
CREATE TABLE IF NOT EXISTS notification_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES notification_channels(id) ON DELETE SET NULL,
    channel_type VARCHAR(50) NOT NULL,
    notification_type VARCHAR(20) NOT NULL,   -- 'alert', 'recovery', 'test', 'ssl_certificate'
    host_name VARCHAR(255),
    service_name VARCHAR(255),
    status VARCHAR(20),
    success BOOLEAN NOT NULL,
    error_message TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_log_tenant_time
    ON notification_log(tenant_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_log_channel
    ON notification_log(channel_id, sent_at DESC);
