//go:build windows

package checks

import (
	"fmt"
	"strings"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"

	"github.com/lukas5001/overseer-agent/internal/types"
)

func checkServicesAutoPlatform(config map[string]any, _, _ *float64) types.CheckResult {
	exclude := getConfigStringSlice(config, "exclude")
	excludeMap := make(map[string]bool, len(exclude))
	for _, e := range exclude {
		excludeMap[strings.ToLower(e)] = true
	}

	m, err := mgr.Connect()
	if err != nil {
		return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("connect to SCM: %v", err)}
	}
	defer m.Disconnect()

	serviceNames, err := m.ListServices()
	if err != nil {
		return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("list services: %v", err)}
	}

	var total, running int
	var stopped []string

	for _, name := range serviceNames {
		if excludeMap[strings.ToLower(name)] {
			continue
		}

		s, err := m.OpenService(name)
		if err != nil {
			continue
		}

		cfg, err := s.Config()
		if err != nil {
			s.Close()
			continue
		}

		// Only check services with Automatic start type (2 = SERVICE_AUTO_START)
		if cfg.StartType != mgr.StartAutomatic {
			s.Close()
			continue
		}

		// Also skip Automatic (Delayed Start) that are "Trigger Start" only
		// by checking if the service is demand-start-like; we include delayed auto though.

		total++

		status, err := s.Query()
		s.Close()
		if err != nil {
			continue
		}

		if status.State == svc.Running {
			running++
		} else if status.State == svc.Stopped {
			stopped = append(stopped, name)
		}
		// Other states (starting, stopping, paused) — count as not-running but don't list
	}

	stoppedCount := len(stopped)
	val := float64(stoppedCount)

	if stoppedCount == 0 {
		return types.CheckResult{
			Status:  "OK",
			Value:   &val,
			Message: fmt.Sprintf("All %d automatic services running", total),
		}
	}

	// Show up to 10 stopped service names
	names := stopped
	if len(names) > 10 {
		names = names[:10]
	}
	msg := fmt.Sprintf("%d/%d automatic services stopped: %s", stoppedCount, total, strings.Join(names, ", "))
	if stoppedCount > 10 {
		msg += fmt.Sprintf(" (+%d more)", stoppedCount-10)
	}

	return types.CheckResult{
		Status:  "CRITICAL",
		Value:   &val,
		Message: msg,
	}
}
