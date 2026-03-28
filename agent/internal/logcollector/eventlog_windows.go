//go:build windows

package logcollector

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/lukas5001/overseer-agent/internal/types"
)

// EventlogSource reads from Windows Event Log via wevtutil
type EventlogSource struct {
	channels []string
	minLevel string // "information", "warning", "error", "critical"
	logger   *slog.Logger
	stopOnce sync.Once
	done     chan struct{}
}

func newEventlogSource(config map[string]any, logger *slog.Logger) Source {
	var channels []string
	if raw, ok := config["channels"]; ok {
		switch v := raw.(type) {
		case []any:
			for _, c := range v {
				if s, ok := c.(string); ok {
					channels = append(channels, s)
				}
			}
		case []string:
			channels = v
		}
	}
	if len(channels) == 0 {
		channels = []string{"Application", "System"}
	}

	minLevel := "warning"
	if ml, ok := config["min_level"].(string); ok {
		minLevel = ml
	}

	return &EventlogSource{
		channels: channels,
		minLevel: minLevel,
		logger:   logger,
		done:     make(chan struct{}),
	}
}

func (e *EventlogSource) Name() string {
	return fmt.Sprintf("eventlog:%s", strings.Join(e.channels, ","))
}

func (e *EventlogSource) Stop() {
	e.stopOnce.Do(func() {
		close(e.done)
	})
}

func (e *EventlogSource) Start(ctx context.Context, entryChan chan<- types.LogEntry) {
	for {
		for _, channel := range e.channels {
			if err := e.readChannel(ctx, channel, entryChan); err != nil {
				e.logger.Warn("eventlog read error", "channel", channel, "error", err)
			}
		}

		select {
		case <-ctx.Done():
			return
		case <-e.done:
			return
		case <-time.After(10 * time.Second):
			// Poll interval for new events
		}
	}
}

func (e *EventlogSource) readChannel(ctx context.Context, channel string, entryChan chan<- types.LogEntry) error {
	// Load bookmark (last event time)
	lastTime := e.loadBookmark(channel)
	if lastTime == "" {
		// Start from last 5 minutes
		lastTime = time.Now().Add(-5 * time.Minute).UTC().Format("2006-01-02T15:04:05.000Z")
	}

	// Build wevtutil query
	levelFilter := e.buildLevelFilter()
	query := fmt.Sprintf(
		"*[System[TimeCreated[@SystemTime>'%s']%s]]",
		lastTime, levelFilter,
	)

	cmd := exec.CommandContext(ctx, "wevtutil", "qe", channel,
		"/q:"+query,
		"/f:text",
		"/rd:true",  // Reverse direction (newest first → we reverse)
		"/c:500",    // Max 500 events per poll
	)

	output, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("wevtutil: %w", err)
	}

	// Parse wevtutil text output
	events := parseWevtutilOutput(string(output))

	var newestTime string
	for _, evt := range events {
		severity := mapEventLevel(evt["Level"])

		ts := evt["Date"]
		if ts == "" {
			ts = time.Now().UTC().Format(time.RFC3339Nano)
		}
		if newestTime == "" || ts > newestTime {
			newestTime = ts
		}

		entryChan <- types.LogEntry{
			Timestamp:  ts,
			Source:     "windows_eventlog",
			SourcePath: channel,
			Service:    evt["Source"],
			Severity:   severity,
			Message:    evt["Description"],
			Fields: map[string]any{
				"event_id": evt["Event ID"],
				"task":     evt["Task Category"],
			},
		}
	}

	if newestTime != "" {
		e.saveBookmark(channel, newestTime)
	}

	return nil
}

func (e *EventlogSource) buildLevelFilter() string {
	switch strings.ToLower(e.minLevel) {
	case "critical":
		return " and (Level=1)"
	case "error":
		return " and (Level<=2)"
	case "warning":
		return " and (Level<=3)"
	case "information", "info":
		return " and (Level<=4)"
	default:
		return " and (Level<=3)" // warning and above
	}
}

func mapEventLevel(level string) int {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "critical":
		return 2
	case "error":
		return 3
	case "warning":
		return 4
	case "information":
		return 6
	case "verbose":
		return 7
	default:
		return 6
	}
}

func parseWevtutilOutput(output string) []map[string]string {
	var events []map[string]string
	current := make(map[string]string)

	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			if len(current) > 0 {
				events = append(events, current)
				current = make(map[string]string)
			}
			continue
		}

		if idx := strings.Index(line, ":"); idx > 0 {
			key := strings.TrimSpace(line[:idx])
			value := strings.TrimSpace(line[idx+1:])
			current[key] = value
		} else if desc, ok := current["Description"]; ok {
			// Multi-line description
			current["Description"] = desc + "\n" + line
		}
	}
	if len(current) > 0 {
		events = append(events, current)
	}

	return events
}

func (e *EventlogSource) bookmarkDir() string {
	dir, _ := os.UserConfigDir()
	return filepath.Join(dir, "overseer-agent")
}

func (e *EventlogSource) loadBookmark(channel string) string {
	data, err := os.ReadFile(filepath.Join(e.bookmarkDir(), "eventlog-bookmark-"+channel+".json"))
	if err != nil {
		return ""
	}
	var bm struct{ LastTime string }
	json.Unmarshal(data, &bm)
	return bm.LastTime
}

func (e *EventlogSource) saveBookmark(channel, lastTime string) {
	os.MkdirAll(e.bookmarkDir(), 0755)
	data, _ := json.Marshal(struct{ LastTime string }{lastTime})
	os.WriteFile(filepath.Join(e.bookmarkDir(), "eventlog-bookmark-"+channel+".json"), data, 0644)
}
