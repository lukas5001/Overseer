//go:build linux

package logcollector

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/lukas5001/overseer-agent/internal/types"
)

// JournaldSource reads from systemd journal via journalctl
type JournaldSource struct {
	units    []string
	logger   *slog.Logger
	stopOnce sync.Once
	done     chan struct{}
}

func newJournaldSource(config map[string]any, logger *slog.Logger) Source {
	var units []string
	if raw, ok := config["units"]; ok {
		switch v := raw.(type) {
		case []any:
			for _, u := range v {
				if s, ok := u.(string); ok {
					units = append(units, s)
				}
			}
		case []string:
			units = v
		}
	}

	return &JournaldSource{
		units:  units,
		logger: logger,
		done:   make(chan struct{}),
	}
}

func (j *JournaldSource) Name() string {
	return fmt.Sprintf("journald:%s", strings.Join(j.units, ","))
}

func (j *JournaldSource) Stop() {
	j.stopOnce.Do(func() {
		close(j.done)
	})
}

func (j *JournaldSource) Start(ctx context.Context, entryChan chan<- types.LogEntry) {
	// Load cursor checkpoint
	cursor := j.loadCursor()

	for {
		if err := j.follow(ctx, entryChan, &cursor); err != nil {
			j.logger.Warn("journald follow error, retrying in 5s", "error", err)
		}

		select {
		case <-ctx.Done():
			return
		case <-j.done:
			return
		case <-time.After(5 * time.Second):
		}
	}
}

func (j *JournaldSource) follow(ctx context.Context, entryChan chan<- types.LogEntry, cursor *string) error {
	// Build journalctl command
	args := []string{
		"--follow",
		"--output=json",
		"--no-pager",
	}

	if *cursor != "" {
		args = append(args, "--after-cursor="+*cursor)
	} else {
		// Start from now if no cursor
		args = append(args, "--since=now")
	}

	for _, unit := range j.units {
		args = append(args, "--unit="+unit)
	}

	cmd := exec.CommandContext(ctx, "journalctl", args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("journalctl stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("journalctl start: %w", err)
	}

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 256*1024), 256*1024)

	for scanner.Scan() {
		select {
		case <-ctx.Done():
			cmd.Process.Kill()
			cmd.Wait()
			return nil
		case <-j.done:
			cmd.Process.Kill()
			cmd.Wait()
			return nil
		default:
		}

		line := scanner.Text()
		if line == "" {
			continue
		}

		var entry map[string]any
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}

		// Extract fields
		message, _ := entry["MESSAGE"].(string)
		if message == "" {
			continue
		}

		unit, _ := entry["_SYSTEMD_UNIT"].(string)
		if unit == "" {
			unit, _ = entry["SYSLOG_IDENTIFIER"].(string)
		}
		// Strip .service suffix
		unit = strings.TrimSuffix(unit, ".service")

		// Extract cursor for checkpointing
		if cur, ok := entry["__CURSOR"].(string); ok {
			*cursor = cur
			j.saveCursor(cur)
		}

		// Map journal priority to syslog severity
		severity := 6 // default info
		if prio, ok := entry["PRIORITY"].(string); ok {
			switch prio {
			case "0":
				severity = 0 // emergency
			case "1":
				severity = 1 // alert
			case "2":
				severity = 2 // critical
			case "3":
				severity = 3 // error
			case "4":
				severity = 4 // warning
			case "5":
				severity = 5 // notice
			case "6":
				severity = 6 // info
			case "7":
				severity = 7 // debug
			}
		}

		// Parse timestamp
		ts := time.Now().UTC().Format(time.RFC3339Nano)
		if usec, ok := entry["__REALTIME_TIMESTAMP"].(string); ok {
			var usecVal int64
			fmt.Sscanf(usec, "%d", &usecVal)
			if usecVal > 0 {
				ts = time.UnixMicro(usecVal).UTC().Format(time.RFC3339Nano)
			}
		}

		entryChan <- types.LogEntry{
			Timestamp:  ts,
			Source:     "journald",
			SourcePath: unit,
			Service:    unit,
			Severity:   severity,
			Message:    message,
		}
	}

	cmd.Wait()
	return scanner.Err()
}

func (j *JournaldSource) cursorFile() string {
	if _, err := os.Stat("/var/lib/overseer-agent"); err == nil {
		return "/var/lib/overseer-agent/journald-cursor"
	}
	dir, _ := os.UserConfigDir()
	return dir + "/overseer-agent/journald-cursor"
}

func (j *JournaldSource) loadCursor() string {
	data, err := os.ReadFile(j.cursorFile())
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func (j *JournaldSource) saveCursor(cursor string) {
	path := j.cursorFile()
	// Ensure dir exists
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			os.MkdirAll(path[:i], 0755)
			break
		}
	}
	os.WriteFile(path, []byte(cursor), 0644)
}
