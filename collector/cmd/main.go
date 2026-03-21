/*
Overseer Collector – Runs on a Linux VM at each customer site.

Responsibilities:
- Fetch configuration from central API (hosts, checks, thresholds)
- Execute checks against all devices in the customer network
- Batch results and send to Receiver via HTTPS POST
- Buffer locally if server unreachable, retry with backoff

Environment variables:
  OVERSEER_API_URL       Base URL of the API server (default: http://localhost:8000)
  OVERSEER_RECEIVER_URL  Base URL of the Receiver (default: http://localhost:8001)
  OVERSEER_API_KEY       API key for this collector (required)
  OVERSEER_COLLECTOR_ID  UUID of this collector in the DB (required)
*/
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"time"
)

// ==================== API Config Response ====================

type RemoteConfig struct {
	CollectorID     string       `json:"collector_id"`
	TenantID        string       `json:"tenant_id"`
	IntervalSeconds int          `json:"interval_seconds"`
	Hosts           []HostConfig `json:"hosts"`
}

type HostConfig struct {
	Hostname      string        `json:"hostname"`
	DisplayName   string        `json:"display_name"`
	IPAddress     string        `json:"ip_address"`
	HostType      string        `json:"host_type"`
	SNMPCommunity string        `json:"snmp_community"`
	SNMPVersion   string        `json:"snmp_version"`
	Checks        []CheckConfig `json:"checks"`
}

type CheckConfig struct {
	Name            string                 `json:"name"`
	Type            string                 `json:"type"`
	Config          map[string]interface{} `json:"config"`
	IntervalSeconds int                    `json:"interval_seconds"`
	ThresholdWarn   *float64               `json:"threshold_warn"`
	ThresholdCrit   *float64               `json:"threshold_crit"`
}

// ==================== Check Result ====================

type CheckResult struct {
	Host       string   `json:"host"`
	Name       string   `json:"name"`
	Status     string   `json:"status"` // OK, WARNING, CRITICAL, UNKNOWN
	Value      *float64 `json:"value,omitempty"`
	Unit       string   `json:"unit,omitempty"`
	Message    string   `json:"message,omitempty"`
	CheckType  string   `json:"check_type"`
	DurationMs *int     `json:"check_duration_ms,omitempty"`
}

type Payload struct {
	CollectorID string        `json:"collector_id"`
	TenantID    string        `json:"tenant_id"`
	Timestamp   string        `json:"timestamp"`
	Checks      []CheckResult `json:"checks"`
}

// ==================== Runtime state ====================

var (
	apiURL       = getEnv("OVERSEER_API_URL", "http://localhost:8000")
	receiverURL  = getEnv("OVERSEER_RECEIVER_URL", "http://localhost:8001")
	apiKey       = getEnv("OVERSEER_API_KEY", "")
	collectorID  = getEnv("OVERSEER_COLLECTOR_ID", "")
	httpClient   = &http.Client{Timeout: 15 * time.Second}
)

// ==================== Main ====================

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("Overseer Collector starting...")

	if apiKey == "" || collectorID == "" {
		log.Fatal("OVERSEER_API_KEY and OVERSEER_COLLECTOR_ID must be set")
	}

	log.Printf("API:      %s", apiURL)
	log.Printf("Receiver: %s", receiverURL)
	log.Printf("Collector ID: %s", collectorID)

	// Initial config fetch with retry
	cfg, err := fetchConfigWithRetry(5)
	if err != nil {
		log.Fatalf("Could not load config from server: %s", err)
	}

	interval := time.Duration(cfg.IntervalSeconds) * time.Second
	log.Printf("Config loaded: %d hosts, interval=%s", len(cfg.Hosts), interval)

	// Run immediately, then on ticker
	runChecks(cfg)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for range ticker.C {
		// Re-fetch config every cycle so changes are picked up automatically
		if newCfg, err := fetchConfig(); err == nil {
			cfg = newCfg
		} else {
			log.Printf("Config refresh failed (using last known config): %s", err)
		}
		runChecks(cfg)
	}
}

// ==================== Config Fetch ====================

func fetchConfig() (RemoteConfig, error) {
	url := fmt.Sprintf("%s/api/v1/config/collector/%s", apiURL, collectorID)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return RemoteConfig{}, err
	}
	req.Header.Set("X-API-Key", apiKey)

	resp, err := httpClient.Do(req)
	if err != nil {
		return RemoteConfig{}, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return RemoteConfig{}, fmt.Errorf("server returned %d: %s", resp.StatusCode, string(body))
	}

	var cfg RemoteConfig
	if err := json.NewDecoder(resp.Body).Decode(&cfg); err != nil {
		return RemoteConfig{}, fmt.Errorf("decode response: %w", err)
	}
	return cfg, nil
}

func fetchConfigWithRetry(maxAttempts int) (RemoteConfig, error) {
	var lastErr error
	for i := 1; i <= maxAttempts; i++ {
		cfg, err := fetchConfig()
		if err == nil {
			return cfg, nil
		}
		lastErr = err
		wait := time.Duration(i*i) * time.Second
		log.Printf("Config fetch attempt %d/%d failed: %s – retrying in %s", i, maxAttempts, err, wait)
		time.Sleep(wait)
	}
	return RemoteConfig{}, lastErr
}

// ==================== Run Checks ====================

func runChecks(cfg RemoteConfig) {
	log.Printf("Running checks for %d hosts...", len(cfg.Hosts))
	var results []CheckResult

	for _, host := range cfg.Hosts {
		target := host.IPAddress
		if target == "" {
			target = host.Hostname
		}
		for _, check := range host.Checks {
			result := executeCheck(host, target, check)
			results = append(results, result)
		}
	}

	log.Printf("Checks done: %d results", len(results))

	if len(results) == 0 {
		return
	}

	payload := Payload{
		CollectorID: cfg.CollectorID,
		TenantID:    cfg.TenantID,
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		Checks:      results,
	}

	if err := sendResultsWithRetry(payload, 3); err != nil {
		log.Printf("ERROR sending results: %s", err)
	}
}

func executeCheck(host HostConfig, target string, check CheckConfig) CheckResult {
	switch check.Type {
	case "ping":
		return doPingCheck(host.Hostname, target, check.Name)
	case "port":
		port := 0
		if p, ok := check.Config["port"]; ok {
			switch v := p.(type) {
			case float64:
				port = int(v)
			case int:
				port = v
			}
		}
		if port > 0 {
			return doPortCheck(host.Hostname, target, port, check.Name)
		}
		return unknownResult(host.Hostname, check.Name, check.Type, "missing port in config")
	case "http":
		url := ""
		if u, ok := check.Config["url"]; ok {
			url, _ = u.(string)
		}
		if url != "" {
			return doHTTPCheck(host.Hostname, url, check.Name)
		}
		return unknownResult(host.Hostname, check.Name, check.Type, "missing url in config")
	default:
		// snmp, ssh_disk, ssh_cpu, ssh_mem, script – not yet implemented
		return unknownResult(host.Hostname, check.Name, check.Type,
			fmt.Sprintf("check type '%s' not yet implemented in collector", check.Type))
	}
}

func unknownResult(hostname, name, checkType, msg string) CheckResult {
	return CheckResult{
		Host:      hostname,
		Name:      name,
		Status:    "UNKNOWN",
		Message:   msg,
		CheckType: checkType,
	}
}

// ==================== Send Results ====================

func sendResultsWithRetry(payload Payload, maxAttempts int) error {
	var lastErr error
	for i := 1; i <= maxAttempts; i++ {
		if err := sendResults(payload); err == nil {
			return nil
		} else {
			lastErr = err
			if i < maxAttempts {
				wait := time.Duration(i*2) * time.Second
				log.Printf("Send attempt %d/%d failed: %s – retrying in %s", i, maxAttempts, err, wait)
				time.Sleep(wait)
			}
		}
	}
	return lastErr
}

func sendResults(payload Payload) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequest("POST", receiverURL+"/api/v1/results", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", apiKey)

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	log.Printf("Sent %d results → 202 Accepted", len(payload.Checks))
	return nil
}

// ==================== Helpers ====================

func getEnv(key, defaultValue string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultValue
}

// ==================== Check Implementations ====================

// doPingCheck runs "ping -c 1 -W 2 <target>" and parses RTT.
func doPingCheck(hostname, target, name string) CheckResult {
	start := time.Now()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ping", "-c", "1", "-W", "2", target)
	out, err := cmd.CombinedOutput()
	durationMs := int(time.Since(start).Milliseconds())

	if ctx.Err() != nil {
		return CheckResult{
			Host: hostname, Name: name, CheckType: "ping",
			Status:     "CRITICAL",
			Message:    fmt.Sprintf("Ping timeout after 5s: %s", target),
			DurationMs: &durationMs,
		}
	}

	if err != nil {
		return CheckResult{
			Host: hostname, Name: name, CheckType: "ping",
			Status:     "CRITICAL",
			Message:    fmt.Sprintf("Host unreachable: %s", target),
			DurationMs: &durationMs,
		}
	}

	// Parse RTT from output: "rtt min/avg/max/mdev = 0.123/0.123/0.123/0.000 ms"
	rtt := parseRTT(string(out))
	msg := fmt.Sprintf("Ping OK: %.2fms", rtt)

	return CheckResult{
		Host: hostname, Name: name, CheckType: "ping",
		Status:     "OK",
		Value:      &rtt,
		Unit:       "ms",
		Message:    msg,
		DurationMs: &durationMs,
	}
}

var rttRegex = regexp.MustCompile(`min/avg/max.*?=\s*[\d.]+/([\d.]+)/`)

func parseRTT(output string) float64 {
	if m := rttRegex.FindStringSubmatch(output); len(m) > 1 {
		if v, err := strconv.ParseFloat(m[1], 64); err == nil {
			return v
		}
	}
	return 0
}

// doPortCheck attempts a TCP connection to host:port.
func doPortCheck(hostname, target string, port int, name string) CheckResult {
	start := time.Now()
	addr := fmt.Sprintf("%s:%d", target, port)

	conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	durationMs := int(time.Since(start).Milliseconds())
	rtt := float64(durationMs)

	if err != nil {
		return CheckResult{
			Host: hostname, Name: name, CheckType: "port",
			Status:     "CRITICAL",
			Message:    fmt.Sprintf("Port %d unreachable on %s: %s", port, target, err),
			DurationMs: &durationMs,
		}
	}
	conn.Close()

	return CheckResult{
		Host: hostname, Name: name, CheckType: "port",
		Status:     "OK",
		Value:      &rtt,
		Unit:       "ms",
		Message:    fmt.Sprintf("Port %d open (%.0fms)", port, rtt),
		DurationMs: &durationMs,
	}
}

// doHTTPCheck does a GET request and checks for 2xx response.
func doHTTPCheck(hostname, url, name string) CheckResult {
	start := time.Now()

	client := &http.Client{
		Timeout: 10 * time.Second,
		// Don't follow redirects as a separate check
	}

	resp, err := client.Get(url)
	durationMs := int(time.Since(start).Milliseconds())
	rtt := float64(durationMs)

	if err != nil {
		return CheckResult{
			Host: hostname, Name: name, CheckType: "http",
			Status:     "CRITICAL",
			Message:    fmt.Sprintf("HTTP request failed: %s", err),
			DurationMs: &durationMs,
		}
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	status := "OK"
	msg := fmt.Sprintf("HTTP %d in %.0fms", resp.StatusCode, rtt)
	if resp.StatusCode >= 500 {
		status = "CRITICAL"
	} else if resp.StatusCode >= 400 {
		status = "WARNING"
	}

	return CheckResult{
		Host: hostname, Name: name, CheckType: "http",
		Status:     status,
		Value:      &rtt,
		Unit:       "ms",
		Message:    msg,
		DurationMs: &durationMs,
	}
}
