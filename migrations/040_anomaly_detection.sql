-- Migration 040: Anomaly Detection & Predictive Alerts
-- Part of Block 5.4

-- Baselines: 168 buckets per service (7 days × 24 hours)
CREATE TABLE IF NOT EXISTS metric_baselines (
    service_id      UUID            NOT NULL,
    day_of_week     SMALLINT        NOT NULL,   -- 0=Monday .. 6=Sunday
    hour_of_day     SMALLINT        NOT NULL,   -- 0-23
    mean            DOUBLE PRECISION NOT NULL,
    std_dev         DOUBLE PRECISION NOT NULL,
    median          DOUBLE PRECISION,
    sample_count    INTEGER         NOT NULL,
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    PRIMARY KEY (service_id, day_of_week, hour_of_day)
);

-- Anomaly configuration per service
CREATE TABLE IF NOT EXISTS anomaly_config (
    service_id          UUID            NOT NULL PRIMARY KEY,
    tenant_id           UUID            NOT NULL,
    enabled             BOOLEAN         NOT NULL DEFAULT FALSE,
    sensitivity         DOUBLE PRECISION NOT NULL DEFAULT 3.0,  -- Z-Score threshold
    min_training_days   INTEGER         NOT NULL DEFAULT 7,
    status              VARCHAR(20)     NOT NULL DEFAULT 'disabled',
        -- disabled, learning, active
    learning_started_at TIMESTAMPTZ,
    activated_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anomaly_config_tenant ON anomaly_config (tenant_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_config_status ON anomaly_config (status) WHERE enabled = TRUE;

-- Anomaly events
CREATE TABLE IF NOT EXISTS anomaly_events (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id      UUID            NOT NULL,
    tenant_id       UUID            NOT NULL,
    detected_at     TIMESTAMPTZ     NOT NULL,
    value           DOUBLE PRECISION NOT NULL,
    expected_mean   DOUBLE PRECISION NOT NULL,
    expected_std    DOUBLE PRECISION NOT NULL,
    z_score         DOUBLE PRECISION NOT NULL,
    is_false_positive BOOLEAN       NOT NULL DEFAULT FALSE,
    feedback_by     UUID,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anomaly_events_service ON anomaly_events (service_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomaly_events_tenant ON anomaly_events (tenant_id, detected_at DESC);

-- Predictive alerts (resource exhaustion forecasts)
CREATE TABLE IF NOT EXISTS predictions (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id      UUID            NOT NULL,
    tenant_id       UUID            NOT NULL,
    current_value   DOUBLE PRECISION NOT NULL,
    capacity        DOUBLE PRECISION NOT NULL,
    rate_per_day    DOUBLE PRECISION NOT NULL,
    days_until_full DOUBLE PRECISION,
    predicted_date  DATE,
    confidence      DOUBLE PRECISION NOT NULL,   -- R² score
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_predictions_service ON predictions (service_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_tenant ON predictions (tenant_id, created_at DESC);
