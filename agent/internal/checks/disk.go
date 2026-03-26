package checks

import (
	"sort"
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

var statusSeverity = map[string]int{
	"OK": 0, "UNKNOWN": 1, "WARNING": 2, "CRITICAL": 3,
}

// aggregateResults combines multiple disk check results into one.
func aggregateResults(results []types.CheckResult) types.CheckResult {
	if len(results) == 0 {
		return types.CheckResult{Status: "UNKNOWN", Message: "no disks found"}
	}
	if len(results) == 1 {
		return results[0]
	}

	worstStatus := "OK"
	var worstUsage float64
	var hasValue bool
	var messages []string

	for _, r := range results {
		if statusSeverity[r.Status] > statusSeverity[worstStatus] {
			worstStatus = r.Status
		}
		if r.Value != nil && (!hasValue || *r.Value > worstUsage) {
			worstUsage = *r.Value
			hasValue = true
		}
		messages = append(messages, r.Message)
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

// checkDisk checks disks with auto-discovery and per-disk threshold overrides.
//
// Config formats (newest first):
//
//  1. Auto-discover (default):
//     {"warn": 80, "crit": 90, "overrides": [{"path":"/data","warn":95,"crit":98}], "exclude": ["/boot/efi"]}
//     Discovers all real partitions, applies default thresholds, with per-path overrides.
//
//  2. Explicit list (legacy):
//     {"disks": [{"path":"/","warn":80,"crit":90}, ...]}
//
//  3. Single path (legacy):
//     {"path": "/"}  — uses service-level warn/crit
func checkDisk(config map[string]any, warn, crit *float64) types.CheckResult {
	// Legacy: explicit disks array
	if rawDisks, ok := config["disks"]; ok {
		if disksSlice, ok := rawDisks.([]any); ok && len(disksSlice) > 0 {
			return checkDisksExplicit(disksSlice, warn, crit)
		}
	}

	// Legacy: single path
	if _, ok := config["path"]; ok {
		path := getConfigString(config, "path", "/")
		return checkSingleDisk(path, warn, crit)
	}

	// Auto-discover mode
	return checkDisksAutoDiscover(config, warn, crit)
}

// checkDisksExplicit handles the legacy {"disks": [...]} format.
func checkDisksExplicit(disksSlice []any, defaultWarn, defaultCrit *float64) types.CheckResult {
	var results []types.CheckResult
	for _, raw := range disksSlice {
		m, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		path := getConfigString(m, "path", "/")
		w, c := defaultWarn, defaultCrit
		if wv, ok := m["warn"]; ok {
			if wf, ok := toFloat64(wv); ok {
				w = &wf
			}
		}
		if cv, ok := m["crit"]; ok {
			if cf, ok := toFloat64(cv); ok {
				c = &cf
			}
		}
		results = append(results, checkSingleDisk(path, w, c))
	}
	return aggregateResults(results)
}

// checkDisksAutoDiscover discovers all real partitions and checks them.
func checkDisksAutoDiscover(config map[string]any, defaultWarn, defaultCrit *float64) types.CheckResult {
	// Config-level defaults override service-level thresholds
	if w, ok := config["warn"]; ok {
		if wf, ok := toFloat64(w); ok {
			defaultWarn = &wf
		}
	}
	if c, ok := config["crit"]; ok {
		if cf, ok := toFloat64(c); ok {
			defaultCrit = &cf
		}
	}

	// Parse per-path overrides: [{"path": "/data", "warn": 95, "crit": 98}]
	overrides := make(map[string][2]*float64)
	if rawOverrides, ok := config["overrides"]; ok {
		if overrideSlice, ok := rawOverrides.([]any); ok {
			for _, raw := range overrideSlice {
				m, ok := raw.(map[string]any)
				if !ok {
					continue
				}
				path := getConfigString(m, "path", "")
				if path == "" {
					continue
				}
				var ow, oc *float64
				if w, ok := m["warn"]; ok {
					if wf, ok := toFloat64(w); ok {
						ow = &wf
					}
				}
				if c, ok := m["crit"]; ok {
					if cf, ok := toFloat64(c); ok {
						oc = &cf
					}
				}
				overrides[path] = [2]*float64{ow, oc}
			}
		}
	}

	// Parse exclude list
	exclude := make(map[string]bool)
	if rawExclude, ok := config["exclude"]; ok {
		if excludeSlice, ok := rawExclude.([]any); ok {
			for _, raw := range excludeSlice {
				if s, ok := raw.(string); ok && s != "" {
					exclude[s] = true
				}
			}
		}
	}

	// Discover all real partitions
	paths := discoverDisks()
	sort.Strings(paths)

	var results []types.CheckResult
	for _, path := range paths {
		if exclude[path] {
			continue
		}

		w, c := defaultWarn, defaultCrit
		if ov, ok := overrides[path]; ok {
			if ov[0] != nil {
				w = ov[0]
			}
			if ov[1] != nil {
				c = ov[1]
			}
		}

		results = append(results, checkSingleDisk(path, w, c))
	}

	return aggregateResults(results)
}
