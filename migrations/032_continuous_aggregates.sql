-- Migration 032: TimescaleDB Continuous Aggregates for reports and fast dashboard queries
-- Three levels: 5-min, hourly, daily — each cascading from the previous

-- Level 1: 5-minute aggregation (from raw check_results)
CREATE MATERIALIZED VIEW metrics_5m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('5 minutes', time) AS bucket,
    service_id,
    AVG(value) AS avg_val,
    MAX(value) AS max_val,
    MIN(value) AS min_val,
    COUNT(*) AS samples
FROM check_results
WHERE value IS NOT NULL
GROUP BY bucket, service_id
WITH NO DATA;

-- Level 2: Hourly aggregation (from metrics_5m)
CREATE MATERIALIZED VIEW metrics_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', bucket) AS bucket,
    service_id,
    AVG(avg_val) AS avg_val,
    MAX(max_val) AS max_val,
    MIN(min_val) AS min_val,
    SUM(samples) AS samples
FROM metrics_5m
GROUP BY 1, service_id
WITH NO DATA;

-- Level 3: Daily aggregation (from metrics_hourly)
CREATE MATERIALIZED VIEW metrics_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', bucket) AS bucket,
    service_id,
    AVG(avg_val) AS avg_val,
    MAX(max_val) AS max_val,
    MIN(min_val) AS min_val,
    SUM(samples) AS samples
FROM metrics_hourly
GROUP BY 1, service_id
WITH NO DATA;

-- Automatic refresh policies
SELECT add_continuous_aggregate_policy('metrics_5m',
    start_offset => INTERVAL '1 hour',
    end_offset => INTERVAL '5 minutes',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy('metrics_hourly',
    start_offset => INTERVAL '1 day',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy('metrics_daily',
    start_offset => INTERVAL '1 month',
    end_offset => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Enable compression on continuous aggregates and add compression policies
ALTER MATERIALIZED VIEW metrics_5m SET (timescaledb.compress = true);
SELECT add_compression_policy('metrics_5m', compress_after => INTERVAL '7 days', if_not_exists => TRUE);

ALTER MATERIALIZED VIEW metrics_hourly SET (timescaledb.compress = true);
SELECT add_compression_policy('metrics_hourly', compress_after => INTERVAL '30 days', if_not_exists => TRUE);

ALTER MATERIALIZED VIEW metrics_daily SET (timescaledb.compress = true);
SELECT add_compression_policy('metrics_daily', compress_after => INTERVAL '90 days', if_not_exists => TRUE);
