package checks

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/lukas5001/overseer-agent/internal/types"
)

// checkScript executes a server-managed or local script and parses the output.
//
// Config keys:
//
//	script_content      – inline script body (from server DB)
//	script_path         – path to a local script file
//	script_interpreter  – "powershell", "bash", or "python"
//	expected_output     – "nagios" (default), "text", or "json"
func checkScript(config map[string]any, warn, crit *float64) types.CheckResult {
	content := getConfigString(config, "script_content", "")
	scriptPath := getConfigString(config, "script_path", "")
	interpreter := getConfigString(config, "script_interpreter", "")
	outputFormat := getConfigString(config, "expected_output", "nagios")

	if content == "" && scriptPath == "" {
		return types.CheckResult{Status: "UNKNOWN", Message: "no script_content or script_path configured"}
	}
	if interpreter == "" {
		interpreter = guessInterpreter(scriptPath)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var cmd *exec.Cmd
	if content != "" {
		// Server-managed: write to temp file, execute, clean up
		ext := interpreterExtension(interpreter)
		tmp, err := os.CreateTemp("", "overseer-script-*"+ext)
		if err != nil {
			return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("create temp file: %v", err)}
		}
		tmpPath := tmp.Name()
		defer os.Remove(tmpPath)

		if _, err := tmp.WriteString(content); err != nil {
			tmp.Close()
			return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("write temp file: %v", err)}
		}
		tmp.Close()

		cmd = buildCommand(ctx, interpreter, tmpPath)
	} else {
		// Local script
		cmd = buildCommand(ctx, interpreter, scriptPath)
	}

	out, err := cmd.CombinedOutput()
	stdout := strings.TrimSpace(string(out))
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("exec error: %v", err)}
		}
	}

	switch outputFormat {
	case "nagios":
		return parseNagiosOutput(stdout, exitCode, warn, crit)
	case "json":
		return parseJSONOutput(stdout, exitCode)
	default: // "text"
		return parseTextOutput(stdout, exitCode, warn, crit)
	}
}

func guessInterpreter(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".ps1":
		return "powershell"
	case ".py":
		return "python"
	case ".sh":
		return "bash"
	}
	if runtime.GOOS == "windows" {
		return "powershell"
	}
	return "bash"
}

func interpreterExtension(interpreter string) string {
	switch interpreter {
	case "powershell":
		return ".ps1"
	case "python":
		return ".py"
	case "bash":
		return ".sh"
	}
	return ".sh"
}

func buildCommand(ctx context.Context, interpreter, path string) *exec.Cmd {
	switch interpreter {
	case "powershell":
		if runtime.GOOS == "windows" {
			return exec.CommandContext(ctx, "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path)
		}
		return exec.CommandContext(ctx, "pwsh", "-NoProfile", "-File", path)
	case "python":
		return exec.CommandContext(ctx, "python", path)
	default: // bash
		return exec.CommandContext(ctx, "bash", path)
	}
}

// parseNagiosOutput parses Nagios plugin convention:
// Exit code: 0=OK, 1=WARNING, 2=CRITICAL, 3=UNKNOWN
// Output: "STATUS - message | perfdata"
func parseNagiosOutput(stdout string, exitCode int, warn, crit *float64) types.CheckResult {
	status := nagiosExitToStatus(exitCode)

	// Split message from perfdata
	msg := stdout
	var value *float64
	var unit string

	if idx := strings.Index(stdout, "|"); idx >= 0 {
		msg = strings.TrimSpace(stdout[:idx])
		perfStr := strings.TrimSpace(stdout[idx+1:])
		value, unit = extractNagiosPerfdata(perfStr)
	} else {
		// Try extracting a number from message
		if match := numberRegex.FindString(stdout); match != "" {
			if v, err := strconv.ParseFloat(match, 64); err == nil {
				value = &v
			}
		}
	}

	// If thresholds are set and exit code was 0, re-evaluate with thresholds
	if exitCode == 0 && value != nil && (warn != nil || crit != nil) {
		status = ApplyThresholds(*value, warn, crit)
	}

	return types.CheckResult{
		Status:  status,
		Value:   value,
		Unit:    unit,
		Message: truncate(msg, 500),
	}
}

func nagiosExitToStatus(code int) string {
	switch code {
	case 0:
		return "OK"
	case 1:
		return "WARNING"
	case 2:
		return "CRITICAL"
	default:
		return "UNKNOWN"
	}
}

var perfdataRegex = regexp.MustCompile(`^([^=]+)=([0-9.]+)([a-zA-Z%]*)`)

func extractNagiosPerfdata(perf string) (*float64, string) {
	match := perfdataRegex.FindStringSubmatch(perf)
	if match == nil {
		return nil, ""
	}
	v, err := strconv.ParseFloat(match[2], 64)
	if err != nil {
		return nil, ""
	}
	return &v, match[3]
}

// parseJSONOutput expects: {"status": "OK", "value": 42.0, "message": "..."}
func parseJSONOutput(stdout string, exitCode int) types.CheckResult {
	var parsed struct {
		Status  string   `json:"status"`
		Value   *float64 `json:"value"`
		Unit    string   `json:"unit"`
		Message string   `json:"message"`
	}

	if err := json.Unmarshal([]byte(stdout), &parsed); err != nil {
		return types.CheckResult{
			Status:  "UNKNOWN",
			Message: fmt.Sprintf("JSON parse error: %v — output: %s", err, truncate(stdout, 200)),
		}
	}

	status := strings.ToUpper(parsed.Status)
	if status != "OK" && status != "WARNING" && status != "CRITICAL" && status != "UNKNOWN" {
		status = nagiosExitToStatus(exitCode)
	}

	return types.CheckResult{
		Status:  status,
		Value:   parsed.Value,
		Unit:    parsed.Unit,
		Message: truncate(parsed.Message, 500),
	}
}

// parseTextOutput uses exit code for status, extracts numbers from output
func parseTextOutput(stdout string, exitCode int, warn, crit *float64) types.CheckResult {
	var value *float64
	if match := numberRegex.FindString(stdout); match != "" {
		if v, err := strconv.ParseFloat(match, 64); err == nil {
			value = &v
		}
	}

	status := "OK"
	if exitCode != 0 {
		status = "CRITICAL"
	} else if value != nil && (warn != nil || crit != nil) {
		status = ApplyThresholds(*value, warn, crit)
	}

	msg := stdout
	if msg == "" {
		msg = fmt.Sprintf("exit code %d", exitCode)
	}

	return types.CheckResult{
		Status:  status,
		Value:   value,
		Message: truncate(msg, 500),
	}
}
