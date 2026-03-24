-- 009: Saved filters for error overview page
-- Allows users to create reusable filter presets visible to all users

CREATE TABLE IF NOT EXISTS saved_filters (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    description VARCHAR(255),
    filter_config JSONB NOT NULL DEFAULT '{}',
    created_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- filter_config example:
-- {
--   "hidden_tenants": ["uuid1", "uuid2"],
--   "status": "CRITICAL",
--   "search": "switch",
--   "show_acknowledged": false,
--   "sort_key": "status",
--   "sort_asc": true
-- }
