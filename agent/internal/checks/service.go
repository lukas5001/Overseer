package checks

import (
	"github.com/lukas5001/overseer-agent/internal/types"
)

// checkService dispatches to platform-specific implementation
func checkService(config map[string]any, warn, crit *float64) types.CheckResult {
	return checkServicePlatform(config, warn, crit)
}
