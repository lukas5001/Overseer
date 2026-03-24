//go:build windows

package checks

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"

	"github.com/lukas5001/overseer-agent/internal/types"
)

func checkEventlog(config map[string]any, _, _ *float64) types.CheckResult {
	logName := getConfigString(config, "log", "System")
	level := getConfigString(config, "level", "Error")
	minutesStr := getConfigString(config, "minutes", "30")
	minutes, err := strconv.Atoi(minutesStr)
	if err != nil {
		minutes = 30
	}

	// Map level name to Windows event level numbers
	// 1=Critical, 2=Error, 3=Warning
	levelFilter := "Level=2" // Error by default
	switch strings.ToLower(level) {
	case "critical":
		levelFilter = "Level=1"
	case "error":
		levelFilter = "(Level=1 or Level=2)"
	case "warning":
		levelFilter = "(Level=1 or Level=2 or Level=3)"
	}

	millis := minutes * 60000
	query := fmt.Sprintf("*[System[TimeCreated[timediff(@SystemTime) <= %d] and %s]]", millis, levelFilter)

	out, err := exec.Command("wevtutil", "qe", logName, "/q:"+query, "/c:100", "/f:text").Output()
	if err != nil {
		return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("wevtutil failed: %v", err)}
	}

	output := strings.TrimSpace(string(out))
	if output == "" {
		return types.CheckResult{
			Status:  "OK",
			Message: fmt.Sprintf("No %s events in %s log (last %d min)", level, logName, minutes),
		}
	}

	// Count events (each event starts with "Event[")
	eventCount := strings.Count(output, "Event[")
	if eventCount == 0 {
		// Fallback: count non-empty lines
		for _, line := range strings.Split(output, "\n") {
			if strings.TrimSpace(line) != "" {
				eventCount++
			}
		}
	}

	val := float64(eventCount)
	return types.CheckResult{
		Status:  "CRITICAL",
		Value:   &val,
		Message: fmt.Sprintf("%d %s event(s) in %s log (last %d min)", eventCount, level, logName, minutes),
	}
}
