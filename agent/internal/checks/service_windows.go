//go:build windows

package checks

import (
	"fmt"

	"golang.org/x/sys/windows/svc/mgr"

	"github.com/lukas5001/overseer-agent/internal/types"
)

func checkServicePlatform(config map[string]any, _, _ *float64) types.CheckResult {
	serviceName := getConfigString(config, "service", "")
	if serviceName == "" {
		return types.CheckResult{Status: "UNKNOWN", Message: "no service name configured"}
	}

	m, err := mgr.Connect()
	if err != nil {
		return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("connect to SCM: %v", err)}
	}
	defer m.Disconnect()

	s, err := m.OpenService(serviceName)
	if err != nil {
		return types.CheckResult{Status: "CRITICAL", Message: fmt.Sprintf("Service %s not found: %v", serviceName, err)}
	}
	defer s.Close()

	status, err := s.Query()
	if err != nil {
		return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("query service %s: %v", serviceName, err)}
	}

	switch status.State {
	case 4: // SERVICE_RUNNING
		return types.CheckResult{
			Status:  "OK",
			Message: fmt.Sprintf("Service %s is running", serviceName),
		}
	case 1: // SERVICE_STOPPED
		return types.CheckResult{
			Status:  "CRITICAL",
			Message: fmt.Sprintf("Service %s is stopped", serviceName),
		}
	default:
		return types.CheckResult{
			Status:  "WARNING",
			Message: fmt.Sprintf("Service %s state: %d", serviceName, status.State),
		}
	}
}
