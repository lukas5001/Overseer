//go:build !windows

package logcollector

import (
	"log/slog"
)

func newEventlogSource(config map[string]any, logger *slog.Logger) Source {
	logger.Warn("windows_eventlog source is only supported on Windows")
	return nil
}
