package logcollector

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/lukas5001/overseer-agent/internal/client"
	"github.com/lukas5001/overseer-agent/internal/types"
)

// Collector manages log sources and ships log entries to the server
type Collector struct {
	client    *client.Client
	logger    *slog.Logger
	entryChan chan types.LogEntry
	config    types.LogCollectionConfig

	mu      sync.Mutex
	sources []Source
	queue   *DiskQueue
}

// Source is the interface that all log sources must implement
type Source interface {
	// Start begins tailing/reading the source. It sends entries to the channel.
	Start(ctx context.Context, entryChan chan<- types.LogEntry)
	// Stop gracefully stops the source
	Stop()
	// Name returns a human-readable identifier
	Name() string
}

// New creates a new log Collector
func New(c *client.Client, cfg types.LogCollectionConfig, logger *slog.Logger) *Collector {
	batchSize := cfg.BatchSize
	if batchSize <= 0 {
		batchSize = 1000
	}

	return &Collector{
		client:    c,
		logger:    logger,
		entryChan: make(chan types.LogEntry, batchSize*2),
		config:    cfg,
	}
}

// Run starts the log collector: initializes sources, batches entries, ships to server
func (c *Collector) Run(ctx context.Context) {
	if !c.config.Enabled || len(c.config.Sources) == 0 {
		c.logger.Info("log collection disabled or no sources configured")
		return
	}

	// Initialize disk queue for buffering during outages
	var err error
	c.queue, err = NewDiskQueue(c.logger)
	if err != nil {
		c.logger.Error("failed to create disk queue, log buffering disabled", "error", err)
	}

	c.logger.Info("starting log collection",
		"sources", len(c.config.Sources),
		"batch_size", c.config.BatchSize,
		"flush_interval_s", c.config.FlushIntervalSeconds,
	)

	// Start sources
	c.startSources(ctx)

	// Run batcher
	c.runBatcher(ctx)

	// Cleanup
	c.stopSources()
	if c.queue != nil {
		c.queue.Close()
	}
}

func (c *Collector) startSources(ctx context.Context) {
	for _, srcDef := range c.config.Sources {
		src := c.createSource(srcDef)
		if src == nil {
			c.logger.Warn("unsupported log source type", "type", srcDef.SourceType)
			continue
		}
		c.mu.Lock()
		c.sources = append(c.sources, src)
		c.mu.Unlock()

		c.logger.Info("starting log source", "name", src.Name(), "type", srcDef.SourceType)
		go src.Start(ctx, c.entryChan)
	}
}

func (c *Collector) createSource(def types.LogSourceDef) Source {
	switch def.SourceType {
	case "file":
		return NewFileSource(def.Config, c.logger)
	case "journald":
		return newJournaldSource(def.Config, c.logger)
	case "windows_eventlog":
		return newEventlogSource(def.Config, c.logger)
	default:
		return nil
	}
}

func (c *Collector) stopSources() {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, src := range c.sources {
		src.Stop()
	}
}

func (c *Collector) runBatcher(ctx context.Context) {
	batchSize := c.config.BatchSize
	if batchSize <= 0 {
		batchSize = 1000
	}
	flushInterval := time.Duration(c.config.FlushIntervalSeconds) * time.Second
	if flushInterval <= 0 {
		flushInterval = 5 * time.Second
	}

	batch := make([]types.LogEntry, 0, batchSize)
	timer := time.NewTimer(flushInterval)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			if len(batch) > 0 {
				c.shipBatch(batch)
			}
			// Try to drain remaining entries from channel
			for {
				select {
				case entry := <-c.entryChan:
					batch = append(batch, entry)
					if len(batch) >= batchSize {
						c.shipBatch(batch)
						batch = batch[:0]
					}
				default:
					if len(batch) > 0 {
						c.shipBatch(batch)
					}
					return
				}
			}

		case entry := <-c.entryChan:
			batch = append(batch, entry)
			if len(batch) >= batchSize {
				c.shipBatch(batch)
				batch = make([]types.LogEntry, 0, batchSize)
				timer.Reset(flushInterval)
			}

		case <-timer.C:
			if len(batch) > 0 {
				c.shipBatch(batch)
				batch = make([]types.LogEntry, 0, batchSize)
			}
			timer.Reset(flushInterval)
		}
	}
}

func (c *Collector) shipBatch(batch []types.LogEntry) {
	// First try to send queued entries from disk
	if c.queue != nil {
		c.drainDiskQueue()
	}

	if err := c.client.SendLogs(batch); err != nil {
		c.logger.Warn("failed to send logs, queuing to disk",
			"entries", len(batch),
			"error", err,
		)
		if c.queue != nil {
			c.queue.Enqueue(batch)
		}
		return
	}

	c.logger.Debug("logs shipped", "entries", len(batch))
}

func (c *Collector) drainDiskQueue() {
	for {
		entries, ok := c.queue.Peek()
		if !ok {
			return
		}
		if err := c.client.SendLogs(entries); err != nil {
			c.logger.Debug("disk queue drain failed, will retry later", "error", err)
			return
		}
		c.queue.Dequeue()
		c.logger.Info("disk queue batch sent", "entries", len(entries))
	}
}

// UpdateConfig updates the log collection config (called from config refresh)
func (c *Collector) UpdateConfig(cfg types.LogCollectionConfig) {
	// For now, just log the change. Full hot-reload of sources
	// would require stopping old sources and starting new ones.
	c.config = cfg
}
