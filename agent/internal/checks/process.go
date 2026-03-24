package checks

import (
	"github.com/lukas5001/overseer-agent/internal/types"
)

// checkProcess dispatches to platform-specific implementation
func checkProcess(config map[string]any, warn, crit *float64) types.CheckResult {
	return checkProcessPlatform(config, warn, crit)
}
