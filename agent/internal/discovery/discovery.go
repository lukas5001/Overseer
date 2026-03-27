// Package discovery implements periodic service discovery for the Overseer agent.
// It detects running services and listening ports on the host and generates
// suggested monitoring checks based on the discovered services.
package discovery

import (
	"context"
	"log/slog"
	"runtime"
	"time"
)

// DiscoveredService represents a single discovered service on the host.
type DiscoveredService struct {
	Name            string   `json:"name"`
	Type            string   `json:"type"`              // "systemd", "windows_service"
	Status          string   `json:"status"`            // "running", "stopped"
	PID             int      `json:"pid,omitempty"`
	Ports           []int    `json:"ports,omitempty"`
	SuggestedChecks []string `json:"suggested_checks"`
}

// Payload is the JSON structure sent to the server.
type Payload struct {
	Type      string              `json:"type"`      // "service_discovery"
	Hostname  string              `json:"hostname"`
	Timestamp string              `json:"timestamp"` // RFC3339
	Services  []DiscoveredService `json:"services"`
}

// Sender is the interface for sending discovery results to the server.
type Sender interface {
	SendDiscovery(payload *Payload) error
}

// knownPorts maps well-known TCP ports to human-readable service names.
var knownPorts = map[int]string{
	22:    "SSH",
	25:    "SMTP",
	53:    "DNS",
	80:    "HTTP",
	443:   "HTTPS",
	3306:  "MySQL",
	5432:  "PostgreSQL",
	6379:  "Redis",
	8080:  "HTTP-Alt",
	8443:  "HTTPS-Alt",
	9090:  "Prometheus",
	27017: "MongoDB",
	3389:  "RDP",
}

// suggestChecks generates monitoring check suggestions based on
// the service name and its listening ports.
func suggestChecks(serviceName string, ports []int) []string {
	checks := make(map[string]bool)

	// Port-based suggestions
	for _, port := range ports {
		switch port {
		case 80, 8080, 8443:
			checks["http"] = true
		case 443:
			checks["http"] = true
			checks["ssl_certificate"] = true
		case 22:
			checks["port"] = true
		case 3306, 5432, 6379, 27017:
			checks["port"] = true
		}
	}

	// Service-name-based suggestions
	switch serviceName {
	case "nginx", "apache2", "httpd", "caddy", "traefik":
		checks["http"] = true
		checks["process"] = true
	case "postgresql", "postgres", "mysql", "mysqld", "mariadb",
		"redis", "redis-server", "mongod", "mongodb":
		checks["process"] = true
		checks["port"] = true
	case "docker", "dockerd", "containerd":
		checks["process"] = true
	case "sshd", "ssh":
		checks["port"] = true
	case "haproxy", "envoy":
		checks["http"] = true
		checks["process"] = true
	}

	result := make([]string, 0, len(checks))
	for k := range checks {
		result = append(result, k)
	}
	return result
}

// systemdInternalPrefixes lists service name prefixes considered
// internal to systemd that should be excluded from discovery results.
var systemdInternalPrefixes = []string{
	"systemd-",
	"dbus",
	"user@",
	"user-runtime-dir@",
	"getty@",
	"serial-getty@",
	"console-getty",
	"initrd-",
	"emergency",
	"rescue",
	"basic.target",
	"multi-user.target",
}

// Run starts the periodic discovery loop. It runs Discover() immediately
// and then every interval. Results are sent via the provided Sender.
func Run(ctx context.Context, hostname string, sender Sender, interval time.Duration, logger *slog.Logger) {
	logger.Info("service discovery starting",
		"interval", interval,
		"os", runtime.GOOS,
	)

	// Run immediately on start
	doDiscovery(ctx, hostname, sender, logger)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			logger.Info("service discovery stopped")
			return
		case <-ticker.C:
			doDiscovery(ctx, hostname, sender, logger)
		}
	}
}

func doDiscovery(ctx context.Context, hostname string, sender Sender, logger *slog.Logger) {
	services, err := Discover(logger)
	if err != nil {
		logger.Error("service discovery failed", "error", err)
		return
	}

	payload := &Payload{
		Type:      "service_discovery",
		Hostname:  hostname,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Services:  services,
	}

	logger.Info("service discovery complete", "services_found", len(services))

	if err := sender.SendDiscovery(payload); err != nil {
		logger.Error("failed to send discovery results", "error", err)
	}
}
