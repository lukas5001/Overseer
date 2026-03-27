//go:build linux

package discovery

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// listeningPort represents a TCP port in LISTEN state with its owning PID.
type listeningPort struct {
	Port int
	PID  int
}

// Discover enumerates running systemd services and listening TCP ports,
// then correlates them to produce DiscoveredService entries with suggested checks.
func Discover(logger *slog.Logger) ([]DiscoveredService, error) {
	// 1. Get all listening ports with their PIDs
	ports, err := getListeningPorts(logger)
	if err != nil {
		logger.Warn("failed to enumerate listening ports", "error", err)
		ports = nil // continue without port info
	}

	// Build PID → ports map
	pidPorts := make(map[int][]int)
	for _, p := range ports {
		if p.PID > 0 {
			pidPorts[p.PID] = append(pidPorts[p.PID], p.Port)
		}
	}

	// 2. Get running/enabled systemd services
	services, err := getSystemdServices(logger)
	if err != nil {
		return nil, fmt.Errorf("enumerate systemd services: %w", err)
	}

	// 3. Correlate services with ports and generate suggestions
	seenPIDs := make(map[int]bool)
	for i := range services {
		svc := &services[i]
		if svc.PID > 0 {
			seenPIDs[svc.PID] = true
			// Also check child PIDs — main PID's children often bind ports
			childPIDs := getChildPIDs(svc.PID)
			for _, cpid := range childPIDs {
				seenPIDs[cpid] = true
				if ps, ok := pidPorts[cpid]; ok {
					svc.Ports = append(svc.Ports, ps...)
				}
			}
			if ps, ok := pidPorts[svc.PID]; ok {
				svc.Ports = append(svc.Ports, ps...)
			}
		}
		svc.Ports = uniqueInts(svc.Ports)
		svc.SuggestedChecks = suggestChecks(svc.Name, svc.Ports)
	}

	// 4. Add orphan listening ports (not owned by any discovered service)
	for _, p := range ports {
		if p.PID > 0 && !seenPIDs[p.PID] {
			seenPIDs[p.PID] = true
			name := pidToName(p.PID)
			if name == "" {
				name = fmt.Sprintf("pid-%d", p.PID)
			}
			sPorts := []int{p.Port}
			// Collect all ports for this PID
			for _, p2 := range ports {
				if p2.PID == p.PID && p2.Port != p.Port {
					sPorts = append(sPorts, p2.Port)
				}
			}
			services = append(services, DiscoveredService{
				Name:            name,
				Type:            "process",
				Status:          "running",
				PID:             p.PID,
				Ports:           uniqueInts(sPorts),
				SuggestedChecks: suggestChecks(name, sPorts),
			})
		}
	}

	return services, nil
}

// getSystemdServices lists active/enabled systemd services, filtering out internal ones.
func getSystemdServices(logger *slog.Logger) ([]DiscoveredService, error) {
	// List running services with their main PID
	out, err := exec.Command("systemctl", "list-units", "--type=service",
		"--no-legend", "--no-pager", "--plain",
		"--output=json").Output()

	// Fallback to text parsing if JSON output is not supported
	if err != nil {
		return getSystemdServicesText(logger)
	}

	// systemctl list-units --output=json may not be available on older systems
	// Try text parsing as primary method for reliability
	if len(out) == 0 || out[0] != '[' {
		return getSystemdServicesText(logger)
	}

	return getSystemdServicesText(logger)
}

func getSystemdServicesText(logger *slog.Logger) ([]DiscoveredService, error) {
	out, err := exec.Command("systemctl", "list-units", "--type=service",
		"--state=active,failed", "--no-legend", "--no-pager", "--plain").Output()
	if err != nil {
		return nil, fmt.Errorf("systemctl list-units: %w", err)
	}

	var services []DiscoveredService

	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}

		unitName := fields[0]
		shortName := strings.TrimSuffix(unitName, ".service")

		// Filter internal services
		if isInternalService(shortName) {
			continue
		}

		// active/sub state
		activeState := "running"
		if len(fields) >= 4 {
			sub := fields[3]
			if sub == "failed" || sub == "dead" || sub == "exited" {
				activeState = sub
			}
		}

		// Get MainPID
		pid := getMainPID(unitName)

		services = append(services, DiscoveredService{
			Name:   shortName,
			Type:   "systemd",
			Status: activeState,
			PID:    pid,
		})
	}

	// Also add enabled-but-not-active services (they matter for discovery)
	enabledOut, err := exec.Command("systemctl", "list-unit-files", "--type=service",
		"--state=enabled", "--no-legend", "--no-pager").Output()
	if err == nil {
		activeSet := make(map[string]bool)
		for _, s := range services {
			activeSet[s.Name] = true
		}
		for _, line := range strings.Split(strings.TrimSpace(string(enabledOut)), "\n") {
			if line == "" {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) < 1 {
				continue
			}
			shortName := strings.TrimSuffix(fields[0], ".service")
			if isInternalService(shortName) || activeSet[shortName] {
				continue
			}
			services = append(services, DiscoveredService{
				Name:   shortName,
				Type:   "systemd",
				Status: "inactive",
			})
		}
	}

	return services, nil
}

func isInternalService(name string) bool {
	for _, prefix := range systemdInternalPrefixes {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	// Also filter common system internals
	internals := map[string]bool{
		"dbus": true, "polkit": true, "rtkit-daemon": true,
		"accounts-daemon": true, "switcheroo-control": true,
		"udisks2": true, "upower": true, "colord": true,
		"avahi-daemon": true, "ModemManager": true,
		"NetworkManager-wait-online": true, "snapd.seeded": true,
	}
	return internals[name]
}

func getMainPID(unit string) int {
	out, err := exec.Command("systemctl", "show", "--property=MainPID", "--value", unit).Output()
	if err != nil {
		return 0
	}
	pid, _ := strconv.Atoi(strings.TrimSpace(string(out)))
	return pid
}

// getListeningPorts parses /proc/net/tcp and /proc/net/tcp6 for LISTEN sockets.
func getListeningPorts(logger *slog.Logger) ([]listeningPort, error) {
	var ports []listeningPort

	for _, path := range []string{"/proc/net/tcp", "/proc/net/tcp6"} {
		f, err := os.Open(path)
		if err != nil {
			continue
		}

		scanner := bufio.NewScanner(f)
		scanner.Scan() // skip header

		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			fields := strings.Fields(line)
			if len(fields) < 10 {
				continue
			}

			// st field (index 3): 0A = LISTEN
			if fields[3] != "0A" {
				continue
			}

			// Parse local address (hex ip:port)
			localAddr := fields[1]
			parts := strings.Split(localAddr, ":")
			if len(parts) != 2 {
				continue
			}

			portHex := parts[1]
			port64, err := strconv.ParseInt(portHex, 16, 32)
			if err != nil {
				continue
			}
			port := int(port64)

			// Parse inode (field 9)
			inode, _ := strconv.Atoi(fields[9])

			// Find PID for this inode
			pid := inodeToPID(inode)

			ports = append(ports, listeningPort{Port: port, PID: pid})
		}
		f.Close()
	}

	return deduplicatePorts(ports), nil
}

// inodeToPID scans /proc/*/fd/* to find which PID owns a socket inode.
func inodeToPID(inode int) int {
	if inode == 0 {
		return 0
	}
	target := fmt.Sprintf("socket:[%d]", inode)

	procDirs, err := filepath.Glob("/proc/[0-9]*/fd/*")
	if err != nil {
		return 0
	}

	for _, fd := range procDirs {
		link, err := os.Readlink(fd)
		if err != nil {
			continue
		}
		if link == target {
			// Extract PID from path: /proc/1234/fd/5
			parts := strings.Split(fd, "/")
			if len(parts) >= 3 {
				pid, _ := strconv.Atoi(parts[2])
				return pid
			}
		}
	}
	return 0
}

// pidToName returns the process name for a given PID.
func pidToName(pid int) string {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/comm", pid))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// getChildPIDs returns direct child PIDs of a process.
func getChildPIDs(pid int) []int {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/task/%d/children", pid, pid))
	if err != nil {
		return nil
	}
	var children []int
	for _, s := range strings.Fields(string(data)) {
		if cpid, err := strconv.Atoi(s); err == nil {
			children = append(children, cpid)
		}
	}
	return children
}

func deduplicatePorts(ports []listeningPort) []listeningPort {
	seen := make(map[string]bool)
	var result []listeningPort
	for _, p := range ports {
		key := fmt.Sprintf("%d:%d", p.Port, p.PID)
		if !seen[key] {
			seen[key] = true
			result = append(result, p)
		}
	}
	return result
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

// hexToIP converts a hex-encoded IP address from /proc/net/tcp to a string.
// Not used currently but kept for potential future use.
func hexToIP(hexIP string) string {
	if len(hexIP) == 8 {
		// IPv4
		b, _ := hex.DecodeString(hexIP)
		if len(b) == 4 {
			return fmt.Sprintf("%d.%d.%d.%d", b[3], b[2], b[1], b[0])
		}
	}
	return hexIP
}
