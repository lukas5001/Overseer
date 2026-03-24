//go:build linux

package checks

import (
	"fmt"
	"math"
	"syscall"

	"github.com/lukas5001/overseer-agent/internal/types"
)

func checkDiskPlatform(config map[string]any, warn, crit *float64) types.CheckResult {
	path := getConfigString(config, "path", "/")

	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("statfs %s: %v", path, err)}
	}

	total := stat.Blocks * uint64(stat.Bsize)
	free := stat.Bavail * uint64(stat.Bsize) // available to unprivileged user
	used := total - free
	if total == 0 {
		return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("disk %s: total size is 0", path)}
	}

	usage := math.Round((float64(used)/float64(total)*100)*100) / 100
	freeGB := float64(free) / 1024 / 1024 / 1024
	totalGB := float64(total) / 1024 / 1024 / 1024

	status := ApplyThresholds(usage, warn, crit)

	return types.CheckResult{
		Status:  status,
		Value:   &usage,
		Unit:    "%",
		Message: fmt.Sprintf("Disk %s %.1f%% (%.1f GB free / %.1f GB total)", path, usage, freeGB, totalGB),
	}
}
