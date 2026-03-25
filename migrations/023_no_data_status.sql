-- Add NO_DATA status to check_status enum
-- NO_DATA = no check results received (new service, agent/collector offline)
-- Distinct from UNKNOWN which means "check ran but returned ambiguous result"

ALTER TYPE check_status ADD VALUE IF NOT EXISTS 'NO_DATA';

-- Update existing services that have never received a check result
-- (status=UNKNOWN, last_check_at IS NULL) to NO_DATA
UPDATE current_status
SET status = 'NO_DATA'
WHERE status = 'UNKNOWN'
  AND last_check_at IS NULL;
