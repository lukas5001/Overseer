//go:build windows

package checks

import (
	"fmt"
	"os/exec"
	"strings"

	"github.com/lukas5001/overseer-agent/internal/types"
)

func checkProcessPlatform(config map[string]any, _, _ *float64) types.CheckResult {
	processName := getConfigString(config, "process", "")
	if processName == "" {
		return types.CheckResult{Status: "UNKNOWN", Message: "no process name configured"}
	}

	// Use tasklist with filter
	out, err := exec.Command("tasklist", "/FI", fmt.Sprintf("IMAGENAME eq %s", processName), "/NH", "/FO", "CSV").Output()
	if err != nil {
		return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("tasklist failed: %v", err)}
	}

	output := strings.TrimSpace(string(out))
	lines := strings.Split(output, "\n")

	count := 0
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" && !strings.Contains(line, "INFO: No tasks are running") {
			count++
		}
	}

	if count > 0 {
		val := float64(count)
		return types.CheckResult{
			Status:  "OK",
			Value:   &val,
			Message: fmt.Sprintf("Process %s running (%d instance(s))", processName, count),
		}
	}

	return types.CheckResult{
		Status:  "CRITICAL",
		Message: fmt.Sprintf("Process %s not found", processName),
	}
}
