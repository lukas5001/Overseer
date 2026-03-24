package checks

import (
	"github.com/lukas5001/overseer-agent/internal/types"
)

// checkMemory dispatches to platform-specific implementation
func checkMemory(config map[string]any, warn, crit *float64) types.CheckResult {
	return checkMemoryPlatform(config, warn, crit)
}
