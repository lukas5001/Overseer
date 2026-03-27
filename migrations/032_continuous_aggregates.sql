-- Migration 032: Metric aggregation views for reports and fast dashboard queries
-- Level 1: Continuous aggregate (auto-refreshed by TimescaleDB)
-- Level 2+3: Regular materialized views (refreshed by application scheduler)

-- Level 1: 5-minute aggregation (continuous aggregate from raw check_results)
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

-- Auto-refresh policy for 5-min aggregate
SELECT add_continuous_aggregate_policy('metrics_5m',
    start_offset => INTERVAL '1 hour',
    end_offset => INTERVAL '5 minutes',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists => TRUE
);

-- Level 2: Hourly aggregation (regular materialized view from metrics_5m)
CREATE MATERIALIZED VIEW metrics_hourly AS
SELECT
    time_bucket('1 hour', bucket) AS bucket,
    service_id,
    AVG(avg_val) AS avg_val,
    MAX(max_val) AS max_val,
    MIN(min_val) AS min_val,
    SUM(samples)::BIGINT AS samples
FROM metrics_5m
GROUP BY 1, service_id
WITH NO DATA;

CREATE INDEX idx_metrics_hourly_svc_bucket ON metrics_hourly (service_id, bucket DESC);

-- Level 3: Daily aggregation (regular materialized view from metrics_hourly)
CREATE MATERIALIZED VIEW metrics_daily AS
SELECT
    time_bucket('1 day', bucket) AS bucket,
    service_id,
    AVG(avg_val) AS avg_val,
    MAX(max_val) AS max_val,
    MIN(min_val) AS min_val,
    SUM(samples)::BIGINT AS samples
FROM metrics_hourly
GROUP BY 1, service_id
WITH NO DATA;

CREATE INDEX idx_metrics_daily_svc_bucket ON metrics_daily (service_id, bucket DESC);
