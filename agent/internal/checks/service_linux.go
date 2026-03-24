//go:build linux

package checks

import (
	"fmt"
	"os/exec"
	"strings"

	"github.com/lukas5001/overseer-agent/internal/types"
)

func checkServicePlatform(config map[string]any, _, _ *float64) types.CheckResult {
	serviceName := getConfigString(config, "service", "")
	if serviceName == "" {
		return types.CheckResult{Status: "UNKNOWN", Message: "no service name configured"}
	}

	out, err := exec.Command("systemctl", "is-active", serviceName).Output()
	state := strings.TrimSpace(string(out))

	if err != nil {
		// systemctl returns exit code 3 for inactive services
		if state == "inactive" || state == "dead" {
			return types.CheckResult{
				Status:  "CRITICAL",
				Message: fmt.Sprintf("Service %s is %s", serviceName, state),
			}
		}
		return types.CheckResult{
			Status:  "CRITICAL",
			Message: fmt.Sprintf("Service %s: %s", serviceName, state),
		}
	}

	if state == "active" {
		return types.CheckResult{
			Status:  "OK",
			Message: fmt.Sprintf("Service %s is running", serviceName),
		}
	}

	return types.CheckResult{
		Status:  "WARNING",
		Message: fmt.Sprintf("Service %s is %s", serviceName, state),
	}
}
