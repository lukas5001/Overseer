//go:build linux

package checks

import (
	"fmt"
	"os/exec"
	"strings"

	"github.com/lukas5001/overseer-agent/internal/types"
)

func checkServicesAutoPlatform(config map[string]any, _, _ *float64) types.CheckResult {
	exclude := getConfigStringSlice(config, "exclude")
	excludeMap := make(map[string]bool, len(exclude))
	for _, e := range exclude {
		excludeMap[strings.ToLower(e)] = true
	}

	// List all enabled services
	out, err := exec.Command("systemctl", "list-unit-files", "--type=service", "--state=enabled", "--no-legend", "--no-pager").Output()
	if err != nil {
		return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("list-unit-files: %v", err)}
	}

	var total, running int
	var failed []string

	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 1 {
			continue
		}

		unitName := fields[0]
		// Strip .service suffix for display and exclude matching
		shortName := strings.TrimSuffix(unitName, ".service")

		if excludeMap[strings.ToLower(shortName)] || excludeMap[strings.ToLower(unitName)] {
			continue
		}

		total++

		stateOut, err := exec.Command("systemctl", "is-active", unitName).Output()
		state := strings.TrimSpace(string(stateOut))

		if err == nil && state == "active" {
			running++
		} else {
			failed = append(failed, shortName)
		}
	}

	failedCount := len(failed)
	val := float64(failedCount)

	if failedCount == 0 {
		return types.CheckResult{
			Status:  "OK",
			Value:   &val,
			Message: fmt.Sprintf("All %d enabled services running", total),
		}
	}

	names := failed
	if len(names) > 10 {
		names = names[:10]
	}
	msg := fmt.Sprintf("%d/%d enabled services not running: %s", failedCount, total, strings.Join(names, ", "))
	if failedCount > 10 {
		msg += fmt.Sprintf(" (+%d more)", failedCount-10)
	}

	return types.CheckResult{
		Status:  "CRITICAL",
		Value:   &val,
		Message: msg,
	}
}
