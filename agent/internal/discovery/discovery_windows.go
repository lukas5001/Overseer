//go:build windows

package discovery

import (
	"fmt"
	"log/slog"
	"os/exec"
	"strconv"
	"strings"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

// listeningPort represents a TCP port in LISTEN state with its owning PID.
type listeningPort struct {
	Port int
	PID  int
}

// Discover enumerates Windows services and listening TCP ports,
// then correlates them to produce DiscoveredService entries with suggested checks.
func Discover(logger *slog.Logger) ([]DiscoveredService, error) {
	// 1. Get listening ports
	ports, err := getListeningPorts(logger)
	if err != nil {
		logger.Warn("failed to enumerate listening ports", "error", err)
		ports = nil
	}

	pidPorts := make(map[int][]int)
	for _, p := range ports {
		if p.PID > 0 {
			pidPorts[p.PID] = append(pidPorts[p.PID], p.Port)
		}
	}

	// 2. Get Windows services
	services, err := getWindowsServices(logger)
	if err != nil {
		return nil, fmt.Errorf("enumerate windows services: %w", err)
	}

	// 3. Correlate services with ports
	for i := range services {
		svc := &services[i]
		if svc.PID > 0 {
			if ps, ok := pidPorts[svc.PID]; ok {
				svc.Ports = uniqueInts(ps)
			}
		}
		svc.SuggestedChecks = suggestChecks(svc.Name, svc.Ports)
	}

	return services, nil
}

func getWindowsServices(logger *slog.Logger) ([]DiscoveredService, error) {
	m, err := mgr.Connect()
	if err != nil {
		return nil, fmt.Errorf("connect to SCM: %w", err)
	}
	defer m.Disconnect()

	serviceNames, err := m.ListServices()
	if err != nil {
		return nil, fmt.Errorf("list services: %w", err)
	}

	var services []DiscoveredService

	for _, name := range serviceNames {
		s, err := m.OpenService(name)
		if err != nil {
			continue
		}

		cfg, err := s.Config()
		if err != nil {
			s.Close()
			continue
		}

		// Only discover automatic-start or running services
		status, err := s.Query()
		s.Close()
		if err != nil {
			continue
		}

		isAutoStart := cfg.StartType == mgr.StartAutomatic
		isRunning := status.State == svc.Running

		if !isAutoStart && !isRunning {
			continue
		}

		stateStr := "stopped"
		var pid int
		if isRunning {
			stateStr = "running"
			pid = int(status.ProcessId)
		}

		services = append(services, DiscoveredService{
			Name:   name,
			Type:   "windows_service",
			Status: stateStr,
			PID:    pid,
		})
	}

	return services, nil
}

// getListeningPorts uses netstat to find listening TCP ports on Windows.
func getListeningPorts(logger *slog.Logger) ([]listeningPort, error) {
	out, err := exec.Command("netstat", "-ano", "-p", "TCP").Output()
	if err != nil {
		return nil, fmt.Errorf("netstat: %w", err)
	}

	var ports []listeningPort
	seen := make(map[string]bool)

	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if !strings.Contains(line, "LISTENING") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}

		// Parse local address (e.g., "0.0.0.0:8080" or "[::]:443")
		localAddr := fields[1]
		lastColon := strings.LastIndex(localAddr, ":")
		if lastColon < 0 {
			continue
		}
		portStr := localAddr[lastColon+1:]
		port, err := strconv.Atoi(portStr)
		if err != nil {
			continue
		}

		pid, _ := strconv.Atoi(fields[4])

		key := fmt.Sprintf("%d:%d", port, pid)
		if seen[key] {
			continue
		}
		seen[key] = true

		ports = append(ports, listeningPort{Port: port, PID: pid})
	}

	return ports, nil
}

func uniqueInts(ints []int) []int {
	seen := make(map[int]bool)
	var result []int
	for _, i := range ints {
		if !seen[i] {
			seen[i] = true
			result = append(result, i)
		}
	}
	return result
}
