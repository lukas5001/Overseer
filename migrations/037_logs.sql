-- Migration 037: Log Collection - Hypertable for log storage
-- Part of Block 5.1 — Log Collection & Ingestion

-- Log entries from agents (file tailing, journald, Windows Event Log)
CREATE TABLE IF NOT EXISTS logs (
    time            TIMESTAMPTZ     NOT NULL,
    tenant_id       UUID            NOT NULL,
    host_id         UUID            NOT NULL,
    source          TEXT            NOT NULL,  -- 'file', 'journald', 'windows_eventlog'
    source_path     TEXT,                       -- e.g. /var/log/nginx/error.log
    service         TEXT,                       -- logical service name (nginx, postgresql, etc.)
    severity        SMALLINT        NOT NULL DEFAULT 6,  -- syslog: 0=emergency..7=debug
    message         TEXT            NOT NULL,
    fields          JSONB,                      -- extracted structured fields
    search_vector   TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', message)) STORED
);

-- Convert to TimescaleDB hypertable (1-day chunks)
SELECT create_hypertable('logs', 'time', chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_logs_search ON logs USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_logs_host_time ON logs (host_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_logs_severity ON logs (severity, time DESC);
CREATE INDEX IF NOT EXISTS idx_logs_service ON logs (service, time DESC);
CREATE INDEX IF NOT EXISTS idx_logs_tenant ON logs (tenant_id, time DESC);

-- Note: Compression and retention policies require TimescaleDB Community license.
-- Enable when available:
-- ALTER TABLE logs SET (timescaledb.compress, ...);
-- SELECT add_compression_policy('logs', compress_after => INTERVAL '2 hours');
-- SELECT add_retention_policy('logs', drop_after => INTERVAL '30 days');

-- Log collection config per host (which files/sources to tail)
CREATE TABLE IF NOT EXISTS log_sources (
    id              SERIAL          PRIMARY KEY,
    tenant_id       UUID            NOT NULL,
    host_id         UUID            NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    source_type     TEXT            NOT NULL,  -- 'file', 'journald', 'windows_eventlog'
    config          JSONB           NOT NULL DEFAULT '{}',
    -- file: {"path": "/var/log/nginx/error.log", "service": "nginx", "multiline_pattern": "^\\d{4}"}
    -- journald: {"units": ["nginx", "postgresql"]}
    -- windows_eventlog: {"channels": ["Application", "System"], "min_level": "warning"}
    enabled         BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_log_sources_host ON log_sources (host_id) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_log_sources_tenant ON log_sources (tenant_id);
