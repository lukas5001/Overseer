package types

// RemoteConfig is the response from GET /api/v1/agent/config
type RemoteConfig struct {
	HostID                string              `json:"host_id"`
	Hostname              string              `json:"hostname"`
	TenantID              string              `json:"tenant_id"`
	ConfigIntervalSeconds int                 `json:"config_interval_seconds"`
	Checks                []CheckDef          `json:"checks"`
	LogCollection         LogCollectionConfig `json:"log_collection"`
}

// LogCollectionConfig defines the log collection settings from the server
type LogCollectionConfig struct {
	Enabled              bool            `json:"enabled"`
	BatchSize            int             `json:"batch_size"`
	FlushIntervalSeconds int             `json:"flush_interval_seconds"`
	Sources              []LogSourceDef  `json:"sources"`
}

// LogSourceDef defines a single log source
type LogSourceDef struct {
	SourceType string         `json:"source_type"` // "file", "journald", "windows_eventlog"
	Config     map[string]any `json:"config"`
}

// LogEntry is a single log line to be sent to the server
type LogEntry struct {
	Timestamp  string         `json:"timestamp"`
	Source     string         `json:"source"`
	SourcePath string         `json:"source_path,omitempty"`
	Service    string         `json:"service,omitempty"`
	Severity   int            `json:"severity"`
	Message    string         `json:"message"`
	Fields     map[string]any `json:"fields,omitempty"`
}

// CheckDef defines a single check as configured on the server
type CheckDef struct {
	ServiceID       string         `json:"service_id"`
	Name            string         `json:"name"`
	CheckType       string         `json:"check_type"`
	Config          map[string]any `json:"config"`
	IntervalSeconds int            `json:"interval_seconds"`
	ThresholdWarn   *float64       `json:"threshold_warn"`
	ThresholdCrit       *float64       `json:"threshold_crit"`
	MaxAttempts         int            `json:"max_check_attempts"`
	RetryIntervalSeconds int          `json:"retry_interval_seconds"`
}

// ResultPayload is sent to POST /api/v1/results
type ResultPayload struct {
	CollectorID string        `json:"collector_id"` // "agent:<host_id>"
	TenantID    string        `json:"tenant_id"`
	Timestamp   string        `json:"timestamp"` // RFC3339
	Checks      []CheckResult `json:"checks"`
}

// CheckResult is a single check execution result
type CheckResult struct {
	Host            string         `json:"host"`
	Name            string         `json:"name"`
	Status          string         `json:"status"` // OK, WARNING, CRITICAL, UNKNOWN
	Value           *float64       `json:"value,omitempty"`
	Unit            string         `json:"unit,omitempty"`
	Message         string         `json:"message,omitempty"`
	CheckType       string         `json:"check_type"`
	CheckDurationMs int            `json:"check_duration_ms,omitempty"`
	Metadata        map[string]any `json:"metadata,omitempty"`
}

// HeartbeatInfo is sent to POST /api/v1/agent/heartbeat
type HeartbeatInfo struct {
	AgentVersion string `json:"agent_version"`
	OS           string `json:"os"`
	Hostname     string `json:"hostname"`
}
