-- 031: Dashboard share config
-- Adds share_config JSONB column for storing fixed variables and other sharing options.

ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS share_config JSONB NOT NULL DEFAULT '{}'::jsonb;
