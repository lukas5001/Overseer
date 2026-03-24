//go:build windows

package main

import (
	"fmt"

	"github.com/lukas5001/overseer-agent/internal/service"
)

func handlePlatformCommand(cmd, configPath string) error {
	switch cmd {
	case "install":
		return service.Install(configPath)
	case "uninstall":
		return service.Uninstall()
	case "start":
		return service.Start()
	case "stop":
		return service.Stop()
	case "status":
		return service.Status()
	default:
		return fmt.Errorf("unknown command: %s\nAvailable commands: run, version, install, uninstall, start, stop, status", cmd)
	}
}
