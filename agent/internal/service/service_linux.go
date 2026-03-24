//go:build linux

package service

// IsWindowsService always returns false on Linux
func IsWindowsService() bool {
	return false
}

// RunAsService is a no-op on Linux (systemd manages the process)
func RunAsService(runFunc func() error) error {
	return runFunc()
}
