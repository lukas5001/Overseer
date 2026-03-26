package checks

import (
	"strings"

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

// toFloat64 converts JSON number types to float64
func toFloat64(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	}
	return 0, false
}

type diskEntry struct {
	Path string
	Warn *float64
	Crit *float64
}

// parseDisks extracts disk entries from config.
// New format: {"disks": [{"path": "/", "warn": 80, "crit": 90}, ...]}
// Legacy format: {"path": "/"} with service-level thresholds as fallback.
func parseDisks(config map[string]any, defaultWarn, defaultCrit *float64) []diskEntry {
	if rawDisks, ok := config["disks"]; ok {
		if disksSlice, ok := rawDisks.([]any); ok && len(disksSlice) > 0 {
			var entries []diskEntry
			for _, raw := range disksSlice {
				m, ok := raw.(map[string]any)
				if !ok {
					continue
				}
				entry := diskEntry{
					Path: getConfigString(m, "path", "/"),
					Warn: defaultWarn,
					Crit: defaultCrit,
				}
				if w, ok := m["warn"]; ok {
					if wf, ok := toFloat64(w); ok {
						entry.Warn = &wf
					}
				}
				if c, ok := m["crit"]; ok {
					if cf, ok := toFloat64(c); ok {
						entry.Crit = &cf
					}
				}
				entries = append(entries, entry)
			}
			if len(entries) > 0 {
				return entries
			}
		}
	}

	// Legacy: single path with service-level thresholds
	path := getConfigString(config, "path", "/")
	return []diskEntry{{Path: path, Warn: defaultWarn, Crit: defaultCrit}}
}

var statusSeverity = map[string]int{
	"OK": 0, "UNKNOWN": 1, "WARNING": 2, "CRITICAL": 3,
}

// checkDisk checks one or more disks with per-disk thresholds.
func checkDisk(config map[string]any, warn, crit *float64) types.CheckResult {
	disks := parseDisks(config, warn, crit)

	// Single disk: return directly (preserves exact legacy behavior)
	if len(disks) == 1 {
		return checkSingleDisk(disks[0].Path, disks[0].Warn, disks[0].Crit)
	}

	// Multiple disks: check each, aggregate worst-case
	worstStatus := "OK"
	var worstUsage float64
	var hasValue bool
	var messages []string

	for _, d := range disks {
		result := checkSingleDisk(d.Path, d.Warn, d.Crit)

		if statusSeverity[result.Status] > statusSeverity[worstStatus] {
			worstStatus = result.Status
		}
		if result.Value != nil && (!hasValue || *result.Value > worstUsage) {
			worstUsage = *result.Value
			hasValue = true
		}
		messages = append(messages, result.Message)
	}

	var val *float64
	if hasValue {
		val = &worstUsage
	}

	return types.CheckResult{
		Status:  worstStatus,
		Value:   val,
		Unit:    "%",
		Message: strings.Join(messages, " | "),
	}
}
