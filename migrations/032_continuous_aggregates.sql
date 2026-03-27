-- Migration 032: Metric aggregation views for reports and fast dashboard queries
-- All three levels use regular materialized views, refreshed by the API background job

-- Level 1: 5-minute aggregation (from raw check_results)
CREATE MATERIALIZED VIEW metrics_5m AS
SELECT
    time_bucket('5 minutes', time) AS bucket,
    service_id,
    AVG(value) AS avg_val,
    MAX(value) AS max_val,
    MIN(value) AS min_val,
    COUNT(*) AS samples
FROM check_results
WHERE value IS NOT NULL
GROUP BY 1, service_id
WITH NO DATA;

CREATE UNIQUE INDEX idx_metrics_5m_uniq ON metrics_5m (service_id, bucket);
CREATE INDEX idx_metrics_5m_bucket ON metrics_5m (bucket DESC);

-- Level 2: Hourly aggregation (from metrics_5m)
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

CREATE UNIQUE INDEX idx_metrics_hourly_uniq ON metrics_hourly (service_id, bucket);
CREATE INDEX idx_metrics_hourly_bucket ON metrics_hourly (bucket DESC);

-- Level 3: Daily aggregation (from metrics_hourly)
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

CREATE UNIQUE INDEX idx_metrics_daily_uniq ON metrics_daily (service_id, bucket);
CREATE INDEX idx_metrics_daily_bucket ON metrics_daily (bucket DESC);
