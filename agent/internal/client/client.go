package client

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"runtime"
	"time"

	"github.com/klauspost/compress/zstd"
	"github.com/lukas5001/overseer-agent/internal/types"
	"github.com/lukas5001/overseer-agent/internal/version"
)

var zstdEncoder, _ = zstd.NewWriter(nil, zstd.WithEncoderLevel(zstd.SpeedDefault))

// Client is the HTTP client for communicating with the Overseer server
type Client struct {
	baseURL    string
	token      string
	httpClient *http.Client
	logger     *slog.Logger
}

// New creates a new Client
func New(baseURL, token string, insecureSkipVerify bool, logger *slog.Logger) *Client {
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: insecureSkipVerify,
		},
		MaxIdleConns:        10,
		IdleConnTimeout:     90 * time.Second,
		DisableKeepAlives:   false,
	}

	return &Client{
		baseURL: baseURL,
		token:   token,
		httpClient: &http.Client{
			Timeout:   30 * time.Second,
			Transport: transport,
		},
		logger: logger,
	}
}

func (c *Client) userAgent() string {
	return fmt.Sprintf("Overseer-Agent/%s (%s/%s)", version.Version, runtime.GOOS, runtime.GOARCH)
}

func (c *Client) doRequest(method, path string, body any) (*http.Response, error) {
	var reqBody io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal request body: %w", err)
		}
		reqBody = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, c.baseURL+path, reqBody)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("X-Agent-Token", c.token)
	req.Header.Set("User-Agent", c.userAgent())
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	return c.httpClient.Do(req)
}

// doWithRetry executes a request with retry logic (3 attempts, exponential backoff)
func (c *Client) doWithRetry(method, path string, body any) (*http.Response, error) {
	var lastErr error
	backoff := 2 * time.Second

	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			c.logger.Warn("retrying request", "attempt", attempt+1, "path", path, "backoff", backoff)
			time.Sleep(backoff)
			backoff *= 2
		}

		resp, err := c.doRequest(method, path, body)
		if err != nil {
			lastErr = err
			continue
		}

		// Only retry on 5xx errors
		if resp.StatusCode >= 500 {
			respBody, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			lastErr = fmt.Errorf("server error %d: %s", resp.StatusCode, string(respBody))
			continue
		}

		return resp, nil
	}

	return nil, fmt.Errorf("all retries failed: %w", lastErr)
}

// FetchConfig fetches the remote check configuration
func (c *Client) FetchConfig() (*types.RemoteConfig, error) {
	resp, err := c.doWithRetry("GET", "/api/v1/agent/config", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("fetch config: HTTP %d: %s", resp.StatusCode, string(body))
	}

	var cfg types.RemoteConfig
	if err := json.NewDecoder(resp.Body).Decode(&cfg); err != nil {
		return nil, fmt.Errorf("decode config response: %w", err)
	}

	return &cfg, nil
}

// SendResults sends check results to the receiver endpoint
func (c *Client) SendResults(payload *types.ResultPayload) error {
	resp, err := c.doWithRetry("POST", "/receiver/api/v1/results", payload)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 202 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("send results: HTTP %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// SendHeartbeat sends a heartbeat to the server
func (c *Client) SendHeartbeat(info *types.HeartbeatInfo) error {
	resp, err := c.doWithRetry("POST", "/api/v1/agent/heartbeat", info)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("heartbeat: HTTP %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// SendLogs sends log entries to the receiver endpoint with optional zstd compression
func (c *Client) SendLogs(entries []types.LogEntry) error {
	data, err := json.Marshal(entries)
	if err != nil {
		return fmt.Errorf("marshal log entries: %w", err)
	}

	// Compress with zstd if payload is large enough
	var body io.Reader
	var contentEncoding string
	if len(data) > 1024 {
		compressed, err := zstdCompress(data)
		if err != nil {
			// Fallback to uncompressed
			body = bytes.NewReader(data)
		} else {
			body = bytes.NewReader(compressed)
			contentEncoding = "zstd"
		}
	} else {
		body = bytes.NewReader(data)
	}

	req, err := http.NewRequest("POST", c.baseURL+"/receiver/api/v1/logs/ingest", body)
	if err != nil {
		return fmt.Errorf("create log request: %w", err)
	}

	req.Header.Set("X-Agent-Token", c.token)
	req.Header.Set("User-Agent", c.userAgent())
	req.Header.Set("Content-Type", "application/json")
	if contentEncoding != "" {
		req.Header.Set("Content-Encoding", contentEncoding)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send logs: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("send logs: HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

func zstdCompress(data []byte) ([]byte, error) {
	return zstdEncoder.EncodeAll(data, make([]byte, 0, len(data)/2)), nil
}

// SendDiscovery sends service discovery results to the server.
// Accepts any JSON-serializable payload (discovery.Payload).
func (c *Client) SendDiscovery(payload any) error {
	resp, err := c.doWithRetry("POST", "/api/v1/agent/discovery", payload)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 && resp.StatusCode != 202 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("discovery: HTTP %d: %s", resp.StatusCode, string(body))
	}

	return nil
}
