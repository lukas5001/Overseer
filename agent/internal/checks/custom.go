package checks

import (
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/lukas5001/overseer-agent/internal/types"
)

var numberRegex = regexp.MustCompile(`[-+]?\d+\.?\d*`)

func checkCustom(config map[string]any, _, _ *float64) types.CheckResult {
	command := getConfigString(config, "command", "")
	if command == "" {
		return types.CheckResult{Status: "UNKNOWN", Message: "no command configured"}
	}

	okPattern := getConfigString(config, "ok_pattern", "")
	critPattern := getConfigString(config, "crit_pattern", "")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "cmd", "/C", command)
	} else {
		cmd = exec.CommandContext(ctx, "sh", "-c", command)
	}

	out, err := cmd.CombinedOutput()
	stdout := strings.TrimSpace(string(out))

	// Extract numeric value from output
	var value *float64
	if match := numberRegex.FindString(stdout); match != "" {
		if v, err := strconv.ParseFloat(match, 64); err == nil {
			value = &v
		}
	}

	// Determine status
	if err != nil {
		return types.CheckResult{
			Status:  "CRITICAL",
			Value:   value,
			Message: fmt.Sprintf("Command failed (exit error): %s", truncate(stdout, 200)),
		}
	}

	if critPattern != "" {
		if matched, _ := regexp.MatchString(critPattern, stdout); matched {
			return types.CheckResult{
				Status:  "CRITICAL",
				Value:   value,
				Message: fmt.Sprintf("Critical pattern matched: %s", truncate(stdout, 200)),
			}
		}
	}

	if okPattern != "" {
		if matched, _ := regexp.MatchString(okPattern, stdout); matched {
			return types.CheckResult{
				Status:  "OK",
				Value:   value,
				Message: truncate(stdout, 200),
			}
		}
	}

	if stdout != "" {
		return types.CheckResult{
			Status:  "OK",
			Value:   value,
			Message: truncate(stdout, 200),
		}
	}

	return types.CheckResult{
		Status:  "WARNING",
		Value:   value,
		Message: "command produced no output",
	}
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}
