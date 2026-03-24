//go:build windows

package service

import (
	"fmt"
	"os"
	"time"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const serviceName = "OverseerAgent"
const serviceDisplayName = "Overseer Monitoring Agent"
const serviceDescription = "Monitors this computer and sends metrics to the Overseer server."

// IsWindowsService returns true if the process is running as a Windows service
func IsWindowsService() bool {
	isService, err := svc.IsWindowsService()
	if err != nil {
		return false
	}
	return isService
}

// RunAsService runs the provided function as a Windows service
func RunAsService(runFunc func() error) error {
	return svc.Run(serviceName, &agentHandler{runFunc: runFunc})
}

type agentHandler struct {
	runFunc func() error
	stopCh  chan struct{}
}

func (h *agentHandler) Execute(args []string, r <-chan svc.ChangeRequest, changes chan<- svc.Status) (bool, uint32) {
	changes <- svc.Status{State: svc.StartPending}

	h.stopCh = make(chan struct{})
	errCh := make(chan error, 1)

	go func() {
		errCh <- h.runFunc()
	}()

	changes <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}

	for {
		select {
		case c := <-r:
			switch c.Cmd {
			case svc.Stop, svc.Shutdown:
				changes <- svc.Status{State: svc.StopPending}
				// Signal the agent to stop by sending SIGTERM equivalent
				// The agent's signal handler will pick this up
				p, _ := os.FindProcess(os.Getpid())
				p.Signal(os.Interrupt)
				// Wait for agent to finish (max 30s)
				select {
				case <-errCh:
				case <-time.After(30 * time.Second):
				}
				return false, 0
			}
		case err := <-errCh:
			if err != nil {
				return false, 1
			}
			return false, 0
		}
	}
}

// Install registers the agent as a Windows service
func Install(configPath string) error {
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("get executable path: %w", err)
	}

	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("connect to service manager: %w", err)
	}
	defer m.Disconnect()

	s, err := m.OpenService(serviceName)
	if err == nil {
		s.Close()
		return fmt.Errorf("service %s already exists", serviceName)
	}

	s, err = m.CreateService(
		serviceName,
		exePath,
		mgr.Config{
			DisplayName:  serviceDisplayName,
			Description:  serviceDescription,
			StartType:    mgr.StartAutomatic,
			ErrorControl: mgr.ErrorNormal,
		},
		"--config", configPath,
	)
	if err != nil {
		return fmt.Errorf("create service: %w", err)
	}
	defer s.Close()

	// Set recovery: restart after 60 seconds on failure
	err = s.SetRecoveryActions(
		[]mgr.RecoveryAction{
			{Type: mgr.ServiceRestart, Delay: 60 * time.Second},
			{Type: mgr.ServiceRestart, Delay: 60 * time.Second},
			{Type: mgr.ServiceRestart, Delay: 60 * time.Second},
		},
		86400, // reset period in seconds (24h)
	)
	if err != nil {
		// Non-fatal: service is created, recovery just not set
		fmt.Fprintf(os.Stderr, "warning: could not set recovery options: %v\n", err)
	}

	fmt.Printf("Service '%s' installed successfully.\n", serviceName)
	fmt.Printf("Config path: %s\n", configPath)
	fmt.Printf("Start with: net start %s\n", serviceName)
	return nil
}

// Uninstall removes the Windows service
func Uninstall() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("connect to service manager: %w", err)
	}
	defer m.Disconnect()

	s, err := m.OpenService(serviceName)
	if err != nil {
		return fmt.Errorf("service %s not found: %w", serviceName, err)
	}
	defer s.Close()

	// Try to stop the service first
	_, _ = s.Control(svc.Stop)
	time.Sleep(2 * time.Second)

	err = s.Delete()
	if err != nil {
		return fmt.Errorf("delete service: %w", err)
	}

	fmt.Printf("Service '%s' uninstalled successfully.\n", serviceName)
	return nil
}

// Start starts the Windows service
func Start() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("connect to service manager: %w", err)
	}
	defer m.Disconnect()

	s, err := m.OpenService(serviceName)
	if err != nil {
		return fmt.Errorf("service %s not found: %w", serviceName, err)
	}
	defer s.Close()

	err = s.Start()
	if err != nil {
		return fmt.Errorf("start service: %w", err)
	}

	fmt.Printf("Service '%s' started.\n", serviceName)
	return nil
}

// Stop stops the Windows service
func Stop() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("connect to service manager: %w", err)
	}
	defer m.Disconnect()

	s, err := m.OpenService(serviceName)
	if err != nil {
		return fmt.Errorf("service %s not found: %w", serviceName, err)
	}
	defer s.Close()

	_, err = s.Control(svc.Stop)
	if err != nil {
		return fmt.Errorf("stop service: %w", err)
	}

	fmt.Printf("Service '%s' stopped.\n", serviceName)
	return nil
}

// Status prints the current service status
func Status() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("connect to service manager: %w", err)
	}
	defer m.Disconnect()

	s, err := m.OpenService(serviceName)
	if err != nil {
		return fmt.Errorf("service %s not found: %w", serviceName, err)
	}
	defer s.Close()

	status, err := s.Query()
	if err != nil {
		return fmt.Errorf("query service: %w", err)
	}

	stateNames := map[svc.State]string{
		svc.Stopped:         "Stopped",
		svc.StartPending:    "Start Pending",
		svc.StopPending:     "Stop Pending",
		svc.Running:         "Running",
		svc.ContinuePending: "Continue Pending",
		svc.PausePending:    "Pause Pending",
		svc.Paused:          "Paused",
	}

	stateName := stateNames[status.State]
	if stateName == "" {
		stateName = fmt.Sprintf("Unknown (%d)", status.State)
	}

	fmt.Printf("Service: %s\n", serviceName)
	fmt.Printf("Status:  %s\n", stateName)
	fmt.Printf("PID:     %d\n", status.ProcessId)
	return nil
}
