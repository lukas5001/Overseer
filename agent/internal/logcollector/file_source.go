package logcollector

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/lukas5001/overseer-agent/internal/types"
)

// FileSource tails a log file and sends entries to the collector
type FileSource struct {
	path             string
	service          string
	multilinePattern *regexp.Regexp
	logger           *slog.Logger
	stopOnce         sync.Once
	done             chan struct{}
}

// NewFileSource creates a new file tailing source
func NewFileSource(config map[string]any, logger *slog.Logger) *FileSource {
	path, _ := config["path"].(string)
	service, _ := config["service"].(string)

	var multiline *regexp.Regexp
	if pat, ok := config["multiline_pattern"].(string); ok && pat != "" {
		var err error
		multiline, err = regexp.Compile(pat)
		if err != nil {
			logger.Warn("invalid multiline_pattern, ignoring", "pattern", pat, "error", err)
		}
	}

	return &FileSource{
		path:             path,
		service:          service,
		multilinePattern: multiline,
		logger:           logger,
		done:             make(chan struct{}),
	}
}

func (f *FileSource) Name() string {
	return fmt.Sprintf("file:%s", f.path)
}

func (f *FileSource) Stop() {
	f.stopOnce.Do(func() {
		close(f.done)
	})
}

func (f *FileSource) Start(ctx context.Context, entryChan chan<- types.LogEntry) {
	if f.path == "" {
		f.logger.Error("file source: path is empty")
		return
	}

	// Load checkpoint
	checkpoint := loadCheckpoint(f.path)

	for {
		if err := f.tailFile(ctx, entryChan, &checkpoint); err != nil {
			f.logger.Warn("file tailing error, retrying in 5s", "path", f.path, "error", err)
		}

		select {
		case <-ctx.Done():
			return
		case <-f.done:
			return
		case <-time.After(5 * time.Second):
			// Retry
		}
	}
}

func (f *FileSource) tailFile(ctx context.Context, entryChan chan<- types.LogEntry, checkpoint *FileCheckpoint) error {
	file, err := os.Open(f.path)
	if err != nil {
		return fmt.Errorf("open file: %w", err)
	}
	defer file.Close()

	// Check if file was rotated (inode changed)
	info, err := file.Stat()
	if err != nil {
		return fmt.Errorf("stat file: %w", err)
	}

	currentInode := getInode(info)
	if checkpoint.Inode != 0 && checkpoint.Inode != currentInode {
		// File rotated — read from beginning
		f.logger.Info("file rotated, reading from start", "path", f.path)
		checkpoint.Offset = 0
		checkpoint.Inode = currentInode
	} else if checkpoint.Inode == 0 {
		checkpoint.Inode = currentInode
	}

	// Check if file was truncated
	if checkpoint.Offset > info.Size() {
		f.logger.Info("file truncated, resetting offset", "path", f.path)
		checkpoint.Offset = 0
	}

	// Seek to last offset
	if checkpoint.Offset > 0 {
		if _, err := file.Seek(checkpoint.Offset, io.SeekStart); err != nil {
			return fmt.Errorf("seek: %w", err)
		}
	}

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 1024*1024), 1024*1024) // 1MB max line length

	var pendingMultiline strings.Builder
	lineCount := 0

	for {
		select {
		case <-ctx.Done():
			// Flush pending multiline
			if pendingMultiline.Len() > 0 {
				f.emitEntry(entryChan, pendingMultiline.String())
			}
			f.saveCheckpoint(file, checkpoint)
			return nil
		case <-f.done:
			if pendingMultiline.Len() > 0 {
				f.emitEntry(entryChan, pendingMultiline.String())
			}
			f.saveCheckpoint(file, checkpoint)
			return nil
		default:
		}

		if !scanner.Scan() {
			// No more data — flush pending multiline
			if pendingMultiline.Len() > 0 {
				f.emitEntry(entryChan, pendingMultiline.String())
				pendingMultiline.Reset()
			}

			// Save checkpoint
			f.saveCheckpoint(file, checkpoint)

			// Poll for new data
			select {
			case <-ctx.Done():
				return nil
			case <-f.done:
				return nil
			case <-time.After(1 * time.Second):
				// Check if file was rotated
				newInfo, err := os.Stat(f.path)
				if err != nil {
					return fmt.Errorf("stat for rotation check: %w", err)
				}
				newInode := getInode(newInfo)
				if newInode != checkpoint.Inode {
					return nil // Will reopen with new inode
				}
				// Check truncation
				if newInfo.Size() < checkpoint.Offset {
					return nil // Will reopen
				}
				continue
			}
		}

		line := scanner.Text()
		lineCount++

		// Multiline handling
		if f.multilinePattern != nil {
			if f.multilinePattern.MatchString(line) {
				// New log entry starts — flush previous
				if pendingMultiline.Len() > 0 {
					f.emitEntry(entryChan, pendingMultiline.String())
					pendingMultiline.Reset()
				}
				pendingMultiline.WriteString(line)
			} else {
				// Continuation line
				if pendingMultiline.Len() > 0 {
					pendingMultiline.WriteByte('\n')
				}
				pendingMultiline.WriteString(line)
			}
		} else {
			f.emitEntry(entryChan, line)
		}

		// Save checkpoint periodically
		if lineCount%100 == 0 {
			f.saveCheckpoint(file, checkpoint)
		}
	}
}

func (f *FileSource) emitEntry(entryChan chan<- types.LogEntry, message string) {
	if message == "" {
		return
	}

	entryChan <- types.LogEntry{
		Timestamp:  time.Now().UTC().Format(time.RFC3339Nano),
		Source:     "file",
		SourcePath: f.path,
		Service:    f.service,
		Severity:   detectSeverity(message),
		Message:    message,
	}
}

func (f *FileSource) saveCheckpoint(file *os.File, checkpoint *FileCheckpoint) {
	offset, err := file.Seek(0, io.SeekCurrent)
	if err != nil {
		return
	}
	checkpoint.Offset = offset
	saveCheckpoint(f.path, checkpoint)
}

// FileCheckpoint tracks the read position in a file
type FileCheckpoint struct {
	Offset int64  `json:"offset"`
	Inode  uint64 `json:"inode"`
}

func checkpointPath() string {
	if _, err := os.Stat("/var/lib/overseer-agent"); err == nil {
		return "/var/lib/overseer-agent/log-offsets.json"
	}
	// Fallback for Windows or non-standard installs
	dir, _ := os.UserConfigDir()
	return dir + "/overseer-agent/log-offsets.json"
}

func loadAllCheckpoints() map[string]*FileCheckpoint {
	data, err := os.ReadFile(checkpointPath())
	if err != nil {
		return make(map[string]*FileCheckpoint)
	}
	var checkpoints map[string]*FileCheckpoint
	if err := json.Unmarshal(data, &checkpoints); err != nil {
		return make(map[string]*FileCheckpoint)
	}
	return checkpoints
}

func loadCheckpoint(path string) FileCheckpoint {
	all := loadAllCheckpoints()
	if cp, ok := all[path]; ok {
		return *cp
	}
	return FileCheckpoint{}
}

func saveCheckpoint(filePath string, cp *FileCheckpoint) {
	all := loadAllCheckpoints()
	all[filePath] = cp
	data, err := json.MarshalIndent(all, "", "  ")
	if err != nil {
		return
	}
	// Ensure directory exists
	dir := checkpointPath()
	for i := len(dir) - 1; i >= 0; i-- {
		if dir[i] == '/' || dir[i] == '\\' {
			os.MkdirAll(dir[:i], 0755)
			break
		}
	}
	os.WriteFile(checkpointPath(), data, 0644)
}

// detectSeverity parses log severity from message text
func detectSeverity(msg string) int {
	upper := strings.ToUpper(msg)

	// Check for critical/emergency first
	if strings.Contains(upper, "FATAL") || strings.Contains(upper, "EMERGENCY") || strings.Contains(upper, "EMERG") {
		return 0 // emergency
	}
	if strings.Contains(upper, "CRITICAL") || strings.Contains(upper, "CRIT") {
		return 2 // critical
	}
	if strings.Contains(upper, "ERROR") || strings.Contains(upper, "ERR]") || strings.Contains(upper, "[ERROR]") {
		return 3 // error
	}
	if strings.Contains(upper, "WARNING") || strings.Contains(upper, "WARN") || strings.Contains(upper, "[WARN]") {
		return 4 // warning
	}
	if strings.Contains(upper, "NOTICE") {
		return 5 // notice
	}
	if strings.Contains(upper, "DEBUG") || strings.Contains(upper, "[DEBUG]") {
		return 7 // debug
	}
	// Default: info
	return 6
}
