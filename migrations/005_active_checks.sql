-- Active Checks: allow server-side check execution
-- check_mode: 'passive' (collector sends results) or 'active' (server runs checks)

ALTER TABLE services ADD COLUMN IF NOT EXISTS check_mode VARCHAR(10) NOT NULL DEFAULT 'passive';

-- Index for the active check scheduler to quickly find due checks
CREATE INDEX IF NOT EXISTS idx_services_active_checks
    ON services (check_mode, active)
    WHERE check_mode = 'active' AND active = true;
