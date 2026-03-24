package checks

import (
	"github.com/lukas5001/overseer-agent/internal/types"
)

// checkCPU dispatches to platform-specific implementation
func checkCPU(config map[string]any, warn, crit *float64) types.CheckResult {
	return checkCPUPlatform(config, warn, crit)
}
