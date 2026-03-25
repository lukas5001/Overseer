-- 026: Add retry_interval_seconds to services
-- When a check fails (SOFT state), retry with shorter interval for faster error detection.
-- Default 15s: with 60s interval + 3 attempts → 90s detection vs 180s previously.

ALTER TABLE services
    ADD COLUMN retry_interval_seconds INTEGER NOT NULL DEFAULT 15;

-- Set existing services to interval/4 (min 10s)
UPDATE services
   SET retry_interval_seconds = GREATEST(interval_seconds / 4, 10);
