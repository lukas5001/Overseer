-- 010: Add default_filter_id to users for per-user default filter view
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_filter_id UUID;
