//go:build linux

package main

import "fmt"

func handlePlatformCommand(cmd, _ string) error {
	switch cmd {
	case "install", "uninstall", "start", "stop", "status":
		return fmt.Errorf("command '%s' is only available on Windows\nOn Linux, use systemd:\n  sudo systemctl %s overseer-agent", cmd, cmd)
	default:
		return fmt.Errorf("unknown command: %s\nAvailable commands: run, version", cmd)
	}
}
