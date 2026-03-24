package sender

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/lukas5001/overseer-agent/internal/client"
	"github.com/lukas5001/overseer-agent/internal/types"
)

const (
	maxBatchSize    = 100
	flushInterval   = 10 * time.Second
	maxBufferSize   = 10000
)

// Sender batches check results and sends them to the server
type Sender struct {
	client      *client.Client
	resultsChan <-chan types.CheckResult
	hostID      string
	hostname    string
	tenantID    string
	logger      *slog.Logger

	mu     sync.Mutex
	buffer []types.CheckResult // ring buffer for failed sends
}

// New creates a new Sender
func New(
	c *client.Client,
	resultsChan <-chan types.CheckResult,
	hostID, hostname, tenantID string,
	logger *slog.Logger,
) *Sender {
	return &Sender{
		client:      c,
		resultsChan: resultsChan,
		hostID:      hostID,
		hostname:    hostname,
		tenantID:    tenantID,
		logger:      logger,
	}
}

// Run starts the sender loop
func (s *Sender) Run(ctx context.Context) {
	batch := make([]types.CheckResult, 0, maxBatchSize)
	timer := time.NewTimer(flushInterval)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			// Flush remaining
			if len(batch) > 0 {
				s.flush(batch)
			}
			return

		case result := <-s.resultsChan:
			batch = append(batch, result)
			if len(batch) >= maxBatchSize {
				s.flush(batch)
				batch = make([]types.CheckResult, 0, maxBatchSize)
				timer.Reset(flushInterval)
			}

		case <-timer.C:
			if len(batch) > 0 {
				s.flush(batch)
				batch = make([]types.CheckResult, 0, maxBatchSize)
			}
			timer.Reset(flushInterval)
		}
	}
}

func (s *Sender) flush(batch []types.CheckResult) {
	// First try to send buffered results
	s.sendBuffered()

	payload := &types.ResultPayload{
		CollectorID: "agent:" + s.hostID,
		TenantID:    s.tenantID,
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		Checks:      batch,
	}

	if err := s.client.SendResults(payload); err != nil {
		s.logger.Warn("failed to send results, buffering",
			"checks", len(batch),
			"error", err,
		)
		s.addToBuffer(batch)
		return
	}

	s.logger.Info("results sent", "checks", len(batch))
}

func (s *Sender) addToBuffer(results []types.CheckResult) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.buffer = append(s.buffer, results...)
	// Trim to max buffer size (drop oldest)
	if len(s.buffer) > maxBufferSize {
		s.buffer = s.buffer[len(s.buffer)-maxBufferSize:]
	}
}

func (s *Sender) sendBuffered() {
	s.mu.Lock()
	if len(s.buffer) == 0 {
		s.mu.Unlock()
		return
	}
	toSend := s.buffer
	s.buffer = nil
	s.mu.Unlock()

	// Send buffered results in batches
	for i := 0; i < len(toSend); i += maxBatchSize {
		end := i + maxBatchSize
		if end > len(toSend) {
			end = len(toSend)
		}

		payload := &types.ResultPayload{
			CollectorID: "agent:" + s.hostID,
			TenantID:    s.tenantID,
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
			Checks:      toSend[i:end],
		}

		if err := s.client.SendResults(payload); err != nil {
			s.logger.Warn("failed to send buffered results, re-buffering",
				"checks", len(toSend[i:]),
				"error", err,
			)
			// Re-buffer remaining
			s.mu.Lock()
			s.buffer = append(toSend[i:], s.buffer...)
			if len(s.buffer) > maxBufferSize {
				s.buffer = s.buffer[len(s.buffer)-maxBufferSize:]
			}
			s.mu.Unlock()
			return
		}

		s.logger.Info("buffered results sent", "checks", end-i)
	}
}

// Flush sends any pending results immediately (for graceful shutdown)
func (s *Sender) Flush() {
	s.sendBuffered()
}
