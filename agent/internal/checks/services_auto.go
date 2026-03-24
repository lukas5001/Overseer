package checks

import (
	"github.com/lukas5001/overseer-agent/internal/types"
)

// getConfigStringSlice extracts a string slice from the config map.
func getConfigStringSlice(config map[string]any, key string) []string {
	v, ok := config[key]
	if !ok {
		return nil
	}
	switch val := v.(type) {
	case []any:
		result := make([]string, 0, len(val))
		for _, item := range val {
			if s, ok := item.(string); ok {
				result = append(result, s)
			}
		}
		return result
	case []string:
		return val
	}
	return nil
}

// checkServicesAuto dispatches to platform-specific implementation
func checkServicesAuto(config map[string]any, warn, crit *float64) types.CheckResult {
	return checkServicesAutoPlatform(config, warn, crit)
}
