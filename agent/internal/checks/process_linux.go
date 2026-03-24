//go:build linux

package checks

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/lukas5001/overseer-agent/internal/types"
)

func checkProcessPlatform(config map[string]any, _, _ *float64) types.CheckResult {
	processName := getConfigString(config, "process", "")
	if processName == "" {
		return types.CheckResult{Status: "UNKNOWN", Message: "no process name configured"}
	}

	// Scan /proc/[pid]/comm for matching process names
	matches, err := filepath.Glob("/proc/[0-9]*/comm")
	if err != nil {
		return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("glob /proc: %v", err)}
	}

	count := 0
	for _, commPath := range matches {
		data, err := os.ReadFile(commPath)
		if err != nil {
			continue // process may have exited
		}
		comm := strings.TrimSpace(string(data))
		if comm == processName {
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
