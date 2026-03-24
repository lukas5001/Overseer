package checks

import (
	"fmt"
	"runtime/debug"
	"time"

	"github.com/lukas5001/overseer-agent/internal/types"
)

// CheckFunc executes a check with the given config and thresholds
type CheckFunc func(config map[string]any, warn, crit *float64) types.CheckResult

var registry = map[string]CheckFunc{
	"agent_cpu":           checkCPU,
	"agent_memory":        checkMemory,
	"agent_disk":          checkDisk,
	"agent_service":       checkService,
	"agent_process":       checkProcess,
	"agent_eventlog":      checkEventlog,
	"agent_custom":        checkCustom,
	"agent_script":        checkScript,
	"agent_services_auto": checkServicesAuto,
}

// Execute runs a check by type with timeout and panic recovery
func Execute(checkType string, config map[string]any, warn, crit *float64, timeout time.Duration) types.CheckResult {
	fn, ok := registry[checkType]
	if !ok {
		return types.CheckResult{
			Status:  "UNKNOWN",
			Message: fmt.Sprintf("unsupported check type: %s", checkType),
		}
	}

	if timeout <= 0 {
		timeout = 30 * time.Second
	}

	resultCh := make(chan types.CheckResult, 1)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				stack := debug.Stack()
				resultCh <- types.CheckResult{
					Status:  "UNKNOWN",
					Message: fmt.Sprintf("check panicked: %v\n%s", r, string(stack)),
				}
			}
		}()
		resultCh <- fn(config, warn, crit)
	}()

	select {
	case result := <-resultCh:
		return result
	case <-time.After(timeout):
		return types.CheckResult{
			Status:  "UNKNOWN",
			Message: fmt.Sprintf("check timed out after %s", timeout),
		}
	}
}

// ApplyThresholds evaluates a value against warning and critical thresholds
func ApplyThresholds(value float64, warn, crit *float64) string {
	if crit != nil && value >= *crit {
		return "CRITICAL"
	}
	if warn != nil && value >= *warn {
		return "WARNING"
	}
	return "OK"
}
