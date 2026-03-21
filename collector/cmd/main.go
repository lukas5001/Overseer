/*
Overseer Collector – Runs on a Linux VM at each customer site.

Responsibilities:
- Fetch configuration from central API (hosts, checks, thresholds)
- Execute checks against all devices in the customer network
- SNMP for switches/routers, Ping, SSH, HTTP, TCP port checks
- Batch results and send to Receiver via HTTPS POST
- Buffer locally if server is unreachable, retry with backoff

Usage:
  overseer-collector --config /etc/overseer/collector.yaml
  overseer-collector --server https://monitoring.example.com --api-key <key>
*/
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
)

// ==================== Data Structures ====================

type CollectorConfig struct {
	Server   ServerConfig `yaml:"server" json:"server"`
	Collector struct {
		ID       string `yaml:"id" json:"id"`
		Interval string `yaml:"interval" json:"interval"`
	} `yaml:"collector" json:"collector"`
	Hosts []HostConfig `yaml:"hosts" json:"hosts"`
}

type ServerConfig struct {
	URL      string `yaml:"url" json:"url"`
	APIKey   string `yaml:"api_key" json:"api_key"`
	Timeout  string `yaml:"timeout" json:"timeout"`
	RetryMax int    `yaml:"retry_max" json:"retry_max"`
}

type HostConfig struct {
	Hostname string       `yaml:"hostname" json:"hostname"`
	IP       string       `yaml:"ip" json:"ip"`
	Checks   []CheckConfig `yaml:"checks" json:"checks"`
}

type CheckConfig struct {
	Name      string  `yaml:"name" json:"name"`
	Type      string  `yaml:"type" json:"type"`
	OID       string  `yaml:"oid,omitempty" json:"oid,omitempty"`
	Community string  `yaml:"community,omitempty" json:"community,omitempty"`
	Port      int     `yaml:"port,omitempty" json:"port,omitempty"`
	Mount     string  `yaml:"mount,omitempty" json:"mount,omitempty"`
	Process   string  `yaml:"process,omitempty" json:"process,omitempty"`
	Command   string  `yaml:"command,omitempty" json:"command,omitempty"`
	Warn      float64 `yaml:"warn,omitempty" json:"warn,omitempty"`
	Crit      float64 `yaml:"crit,omitempty" json:"crit,omitempty"`
	Timeout   string  `yaml:"timeout,omitempty" json:"timeout,omitempty"`
}

// ==================== Check Result ====================

type CheckResult struct {
	Host          string   `json:"host"`
	Name          string   `json:"name"`
	Status        string   `json:"status"` // OK, WARNING, CRITICAL, UNKNOWN
	Value         *float64 `json:"value,omitempty"`
	Unit          string   `json:"unit,omitempty"`
	Message       string   `json:"message,omitempty"`
	CheckType     string   `json:"check_type"`
	DurationMs    *int     `json:"check_duration_ms,omitempty"`
}

type Payload struct {
	CollectorID string        `json:"collector_id"`
	TenantID    string        `json:"tenant_id"`
	Timestamp   string        `json:"timestamp"`
	Checks      []CheckResult `json:"checks"`
}

// ==================== Main ====================

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("Overseer Collector starting...")

	// TODO: Load config from file or fetch from API
	// For now, demonstrate the structure

	config := CollectorConfig{
		Server: ServerConfig{
			URL:      getEnvOrDefault("OVERSEER_SERVER_URL", "http://localhost:8001"),
			APIKey:   getEnvOrDefault("OVERSEER_API_KEY", "overseer_demo_devkey"),
			Timeout:  "10s",
			RetryMax: 5,
		},
	}
	config.Collector.ID = getEnvOrDefault("OVERSEER_COLLECTOR_ID", "collector-dev")
	config.Collector.Interval = "60s"

	interval, err := time.ParseDuration(config.Collector.Interval)
	if err != nil {
		log.Fatalf("Invalid interval: %s", err)
	}

	log.Printf("Collector ID: %s", config.Collector.ID)
	log.Printf("Server: %s", config.Server.URL)
	log.Printf("Interval: %s", interval)

	// Main loop
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Run immediately, then on ticker
	runChecks(config)
	for range ticker.C {
		runChecks(config)
	}
}

func runChecks(config CollectorConfig) {
	log.Println("Running checks...")
	var results []CheckResult

	// TODO: Iterate over hosts and execute checks based on type
	// For now, a demo ping check
	results = append(results, doPingCheck("localhost", "self_ping"))

	if len(results) == 0 {
		log.Println("No check results to send")
		return
	}

	payload := Payload{
		CollectorID: config.Collector.ID,
		TenantID:    "demo",  // TODO: Extract from config / API key
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		Checks:      results,
	}

	err := sendResults(config.Server, payload)
	if err != nil {
		log.Printf("ERROR sending results: %s", err)
		// TODO: Buffer to local file, retry with backoff
	}
}

// ==================== Check Implementations ====================

func doPingCheck(host string, name string) CheckResult {
	start := time.Now()

	// TODO: Implement actual ICMP ping (requires raw socket or external 'ping' command)
	// For now, simulate
	duration := int(time.Since(start).Milliseconds())
	value := float64(duration)

	return CheckResult{
		Host:       host,
		Name:       name,
		Status:     "OK",
		Value:      &value,
		Unit:       "ms",
		Message:    fmt.Sprintf("Ping response time: %dms", duration),
		CheckType:  "ping",
		DurationMs: &duration,
	}
}

// TODO: Implement these check functions:
// - doSNMPCheck(host, oid, community, version) CheckResult
// - doPortCheck(host, port) CheckResult
// - doHTTPCheck(host, url, expectedStatus) CheckResult
// - doSSHDiskCheck(host, mount, user, keyPath) CheckResult
// - doSSHProcessCheck(host, processName, user, keyPath) CheckResult
// - doScriptCheck(command, timeout) CheckResult

// ==================== Send Results ====================

func sendResults(serverConfig ServerConfig, payload Payload) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequest("POST", serverConfig.URL+"/api/v1/results", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", serverConfig.APIKey)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted {
		return fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	log.Printf("Sent %d check results → %d Accepted", len(payload.Checks), resp.StatusCode)
	return nil
}

// ==================== Helpers ====================

func getEnvOrDefault(key, defaultValue string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultValue
}
