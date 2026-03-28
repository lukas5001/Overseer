package logcollector

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/lukas5001/overseer-agent/internal/types"
)

const (
	maxQueueSizeBytes = 500 * 1024 * 1024 // 500 MB
)

// DiskQueue persists log batches to disk when the server is unreachable
type DiskQueue struct {
	dir    string
	logger *slog.Logger
	mu     sync.Mutex
}

// NewDiskQueue creates a new disk queue in the standard data directory
func NewDiskQueue(logger *slog.Logger) (*DiskQueue, error) {
	dir := queueDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("create queue dir %s: %w", dir, err)
	}

	dq := &DiskQueue{
		dir:    dir,
		logger: logger,
	}

	// Log existing queue state
	size, count := dq.stats()
	if count > 0 {
		logger.Info("disk queue has pending batches",
			"files", count,
			"size_mb", size/(1024*1024),
		)
	}

	return dq, nil
}

func queueDir() string {
	if _, err := os.Stat("/var/lib/overseer-agent"); err == nil {
		return "/var/lib/overseer-agent/log-queue"
	}
	dir, _ := os.UserConfigDir()
	return filepath.Join(dir, "overseer-agent", "log-queue")
}

// Enqueue writes a batch of log entries to disk
func (dq *DiskQueue) Enqueue(entries []types.LogEntry) {
	dq.mu.Lock()
	defer dq.mu.Unlock()

	// Check total queue size
	totalSize, _ := dq.stats()
	if totalSize >= maxQueueSizeBytes {
		dq.logger.Warn("disk queue full, dropping log batch",
			"entries", len(entries),
			"queue_size_mb", totalSize/(1024*1024),
		)
		return
	}

	data, err := json.Marshal(entries)
	if err != nil {
		dq.logger.Error("failed to marshal log entries for disk queue", "error", err)
		return
	}

	filename := fmt.Sprintf("%d.json", time.Now().UnixNano())
	path := filepath.Join(dq.dir, filename)

	if err := os.WriteFile(path, data, 0644); err != nil {
		dq.logger.Error("failed to write disk queue file", "path", path, "error", err)
		return
	}

	dq.logger.Debug("queued log batch to disk", "entries", len(entries), "file", filename)
}

// Peek returns the oldest batch without removing it
func (dq *DiskQueue) Peek() ([]types.LogEntry, bool) {
	dq.mu.Lock()
	defer dq.mu.Unlock()

	files := dq.sortedFiles()
	if len(files) == 0 {
		return nil, false
	}

	data, err := os.ReadFile(filepath.Join(dq.dir, files[0]))
	if err != nil {
		dq.logger.Error("failed to read disk queue file", "file", files[0], "error", err)
		// Remove corrupt file
		os.Remove(filepath.Join(dq.dir, files[0]))
		return nil, false
	}

	var entries []types.LogEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		dq.logger.Error("failed to unmarshal disk queue file", "file", files[0], "error", err)
		os.Remove(filepath.Join(dq.dir, files[0]))
		return nil, false
	}

	return entries, true
}

// Dequeue removes the oldest batch
func (dq *DiskQueue) Dequeue() {
	dq.mu.Lock()
	defer dq.mu.Unlock()

	files := dq.sortedFiles()
	if len(files) == 0 {
		return
	}

	os.Remove(filepath.Join(dq.dir, files[0]))
}

// Close is a no-op for now
func (dq *DiskQueue) Close() {}

func (dq *DiskQueue) sortedFiles() []string {
	entries, err := os.ReadDir(dq.dir)
	if err != nil {
		return nil
	}

	var files []string
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".json" {
			files = append(files, e.Name())
		}
	}
	sort.Strings(files) // Sorted by timestamp (filename is unix nano)
	return files
}

func (dq *DiskQueue) stats() (totalSize int64, count int) {
	entries, err := os.ReadDir(dq.dir)
	if err != nil {
		return 0, 0
	}

	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".json" {
			info, err := e.Info()
			if err == nil {
				totalSize += info.Size()
				count++
			}
		}
	}
	return
}
