//go:build linux

package checks

import (
	"fmt"
	"math"
	"os"
	"strings"
	"syscall"

	"github.com/lukas5001/overseer-agent/internal/types"
)

// pseudoFSTypes are virtual/pseudo filesystem types to skip during discovery.
var pseudoFSTypes = map[string]bool{
	"proc": true, "sysfs": true, "devtmpfs": true, "tmpfs": true,
	"devpts": true, "cgroup": true, "cgroup2": true, "overlay": true,
	"squashfs": true, "autofs": true, "securityfs": true, "pstore": true,
	"debugfs": true, "tracefs": true, "configfs": true, "binfmt_misc": true,
	"mqueue": true, "hugetlbfs": true, "fusectl": true, "efivarfs": true,
	"ramfs": true, "rpc_pipefs": true, "nsfs": true, "fuse.snapfuse": true,
	"fuse.lxcfs": true, "fuse.gvfsd-fuse": true,
}

// discoverDisks returns all real mount points by parsing /proc/mounts.
func discoverDisks() []string {
	data, err := os.ReadFile("/proc/mounts")
	if err != nil {
		return []string{"/"}
	}

	seen := make(map[string]bool)
	var paths []string

	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		mountPoint := fields[1]
		fsType := fields[2]

		if pseudoFSTypes[fsType] {
			continue
		}
		// Skip snap mounts
		if strings.HasPrefix(mountPoint, "/snap/") {
			continue
		}
		if seen[mountPoint] {
			continue
		}
		seen[mountPoint] = true
		paths = append(paths, mountPoint)
	}

	if len(paths) == 0 {
		return []string{"/"}
	}
	return paths
}

func checkSingleDisk(path string, warn, crit *float64) types.CheckResult {
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
