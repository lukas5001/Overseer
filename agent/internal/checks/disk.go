package checks

import (
	"github.com/lukas5001/overseer-agent/internal/types"
)

func getConfigString(config map[string]any, key, defaultVal string) string {
	if v, ok := config[key]; ok {
		if s, ok := v.(string); ok && s != "" {
			return s
		}
	}
	return defaultVal
}

// checkDisk dispatches to platform-specific implementation
func checkDisk(config map[string]any, warn, crit *float64) types.CheckResult {
	return checkDiskPlatform(config, warn, crit)
}
