-- TimescaleDB Hypertable Konfiguration

-- Chunk-Interval auf 1 Tag setzen (default wäre 7 Tage)
SELECT set_chunk_time_interval('check_results', INTERVAL '1 day');

-- Kompressionseinstellungen
ALTER TABLE check_results SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'service_id',
    timescaledb.compress_orderby = 'time DESC'
);

-- Automatische Kompression nach 30 Tagen
SELECT add_compression_policy('check_results', INTERVAL '30 days');

-- Retention-Policy: falls bereits vorhanden aus 001_initial.sql entfernen und neu anlegen
SELECT remove_retention_policy('check_results', if_exists => true);
SELECT add_retention_policy('check_results', INTERVAL '90 days');
