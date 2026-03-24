-- Make collector_id optional on hosts (active-only hosts don't need a collector)
ALTER TABLE hosts ALTER COLUMN collector_id DROP NOT NULL;
