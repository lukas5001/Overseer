//go:build windows

package checks

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"

	"github.com/lukas5001/overseer-agent/internal/types"
)

func checkCPUPlatform(_ map[string]any, warn, crit *float64) types.CheckResult {
	// Use WMIC to get CPU load percentage
	out, err := exec.Command("wmic", "cpu", "get", "loadpercentage", "/value").Output()
	if err != nil {
		return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("wmic cpu failed: %v", err)}
	}

	// Parse "LoadPercentage=XX"
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "LoadPercentage=") {
			valStr := strings.TrimPrefix(line, "LoadPercentage=")
			val, err := strconv.ParseFloat(strings.TrimSpace(valStr), 64)
			if err != nil {
				return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("parse cpu load: %v", err)}
			}

			status := ApplyThresholds(val, warn, crit)
			return types.CheckResult{
				Status:  status,
				Value:   &val,
				Unit:    "%",
				Message: fmt.Sprintf("CPU %.0f%%", val),
			}
		}
	}

	return types.CheckResult{Status: "UNKNOWN", Message: "could not parse CPU load from wmic"}
}
