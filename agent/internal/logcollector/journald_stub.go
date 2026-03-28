//go:build !linux

package logcollector

import (
	"log/slog"
)

func newJournaldSource(config map[string]any, logger *slog.Logger) Source {
	logger.Warn("journald source is only supported on Linux")
	return nil
}
