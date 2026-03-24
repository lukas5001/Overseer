-- Notification channels (webhooks) per tenant
CREATE TABLE IF NOT EXISTS notification_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    channel_type VARCHAR(50) NOT NULL DEFAULT 'webhook',  -- 'webhook', future: 'email', 'slack'
    config JSONB NOT NULL DEFAULT '{}',                    -- {"url": "https://...", "headers": {...}}
    events TEXT[] NOT NULL DEFAULT ARRAY['state_change'],  -- which events trigger this channel
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_channels_tenant
    ON notification_channels(tenant_id) WHERE active = true;
