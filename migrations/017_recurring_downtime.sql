-- Phase 2.6: Recurring Downtimes

ALTER TABLE downtimes
    ADD COLUMN IF NOT EXISTS recurrence TEXT,
    ADD COLUMN IF NOT EXISTS parent_downtime_id UUID REFERENCES downtimes(id) ON DELETE CASCADE;
    -- recurrence: RRULE string, e.g. "FREQ=WEEKLY;BYDAY=SU"
    -- parent_downtime_id: generated instances reference the template downtime
