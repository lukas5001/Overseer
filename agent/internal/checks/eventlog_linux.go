//go:build linux

package checks

import (
	"github.com/lukas5001/overseer-agent/internal/types"
)

// checkEventlog is a stub on Linux — Windows Event Log is not available
func checkEventlog(_ map[string]any, _, _ *float64) types.CheckResult {
	return types.CheckResult{
		Status:  "UNKNOWN",
		Message: "Event Log check is only available on Windows",
	}
}
