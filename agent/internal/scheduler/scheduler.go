package scheduler

import (
	"context"
	"log/slog"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/lukas5001/overseer-agent/internal/checks"
	"github.com/lukas5001/overseer-agent/internal/types"
)

type scheduledCheck struct {
	def     types.CheckDef
	lastRun time.Time
	running atomic.Bool
}

// Scheduler manages check execution with individual intervals
type Scheduler struct {
	checks     map[string]*scheduledCheck // service_id → check state
	results    chan types.CheckResult
	mu         sync.RWMutex
	workerPool chan struct{} // semaphore
	hostname   string
	logger     *slog.Logger
}

// New creates a new Scheduler
func New(hostname string, resultsChan chan types.CheckResult, logger *slog.Logger) *Scheduler {
	poolSize := runtime.NumCPU()
	if poolSize < 2 {
		poolSize = 2
	}
	if poolSize > 16 {
		poolSize = 16
	}

	return &Scheduler{
		checks:     make(map[string]*scheduledCheck),
		results:    resultsChan,
		workerPool: make(chan struct{}, poolSize),
		hostname:   hostname,
		logger:     logger,
	}
}

// UpdateConfig replaces the current check definitions
func (s *Scheduler) UpdateConfig(defs []types.CheckDef) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Build new set
	newSet := make(map[string]*scheduledCheck, len(defs))
	for _, def := range defs {
		if existing, ok := s.checks[def.ServiceID]; ok {
			// Keep existing state, update definition
			existing.def = def
			newSet[def.ServiceID] = existing
		} else {
			newSet[def.ServiceID] = &scheduledCheck{def: def}
		}
	}

	s.checks = newSet
}

// Run starts the scheduler tick loop (1 second interval)
func (s *Scheduler) Run(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.tick()
		}
	}
}

func (s *Scheduler) tick() {
	s.mu.RLock()
	defer s.mu.RUnlock()

	now := time.Now()

	for _, sc := range s.checks {
		interval := time.Duration(sc.def.IntervalSeconds) * time.Second
		if interval <= 0 {
			interval = 60 * time.Second
		}

		if now.Sub(sc.lastRun) < interval {
			continue
		}
		if sc.running.Load() {
			continue
		}

		sc.lastRun = now
		sc.running.Store(true)

		// Copy for goroutine
		def := sc.def
		scRef := sc

		go func() {
			defer scRef.running.Store(false)

			// Acquire worker slot
			s.workerPool <- struct{}{}
			defer func() { <-s.workerPool }()

			start := time.Now()
			result := checks.Execute(
				def.CheckType,
				def.Config,
				def.ThresholdWarn,
				def.ThresholdCrit,
				30*time.Second,
			)
			duration := time.Since(start)

			result.Host = s.hostname
			result.Name = def.Name
			result.CheckType = def.CheckType
			result.CheckDurationMs = int(duration.Milliseconds())

			s.logger.Debug("check completed",
				"name", def.Name,
				"type", def.CheckType,
				"status", result.Status,
				"duration_ms", result.CheckDurationMs,
			)

			s.results <- result
		}()
	}
}
