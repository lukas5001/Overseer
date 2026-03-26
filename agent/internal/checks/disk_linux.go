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
	"fuse.lxcfs": true, "fuse.gvfsd-fuse": true, "bpf": true,
}

// discoverDisks returns all real mount points by parsing /proc/mounts.
// Deduplicates by device: if the same device is mounted multiple times
// (e.g. systemd bind mounts for PrivateTmp/LogsDirectory), only the
// shortest mount point is kept.
func discoverDisks() []string {
	data, err := os.ReadFile("/proc/mounts")
	if err != nil {
		return []string{"/"}
	}

	// device → shortest mount point
	deviceMap := make(map[string]string)

	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		device := fields[0]
		mountPoint := fields[1]
		fsType := fields[2]

		if pseudoFSTypes[fsType] {
			continue
		}
		// Skip snap mounts
		if strings.HasPrefix(mountPoint, "/snap/") {
			continue
		}
		// Skip non-device mounts (e.g. "systemd-1", "none")
		if !strings.HasPrefix(device, "/") {
			continue
		}

		// Keep shortest mount point per device (dedup bind mounts)
		if existing, ok := deviceMap[device]; !ok || len(mountPoint) < len(existing) {
			deviceMap[device] = mountPoint
		}
	}

	var paths []string
	for _, mp := range deviceMap {
		paths = append(paths, mp)
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
