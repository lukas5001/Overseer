//go:build windows

package checks

import (
	"fmt"
	"math"
	"unsafe"

	"golang.org/x/sys/windows"

	"github.com/lukas5001/overseer-agent/internal/types"
)

func checkSingleDisk(path string, warn, crit *float64) types.CheckResult {
	// Ensure trailing backslash for Windows API
	if len(path) > 0 && path[len(path)-1] != '\\' {
		path += "\\"
	}

	kernel32 := windows.NewLazyDLL("kernel32.dll")
	proc := kernel32.NewProc("GetDiskFreeSpaceExW")

	pathPtr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("invalid path %s: %v", path, err)}
	}

	var freeBytesAvailable, totalBytes, totalFreeBytes uint64

	ret, _, callErr := proc.Call(
		uintptr(unsafe.Pointer(pathPtr)),
		uintptr(unsafe.Pointer(&freeBytesAvailable)),
		uintptr(unsafe.Pointer(&totalBytes)),
		uintptr(unsafe.Pointer(&totalFreeBytes)),
	)
	if ret == 0 {
		return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("GetDiskFreeSpaceEx %s: %v", path, callErr)}
	}

	if totalBytes == 0 {
		return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("disk %s: total size is 0", path)}
	}

	used := totalBytes - freeBytesAvailable
	usage := math.Round((float64(used)/float64(totalBytes)*100)*100) / 100
	freeGB := float64(freeBytesAvailable) / 1024 / 1024 / 1024
	totalGB := float64(totalBytes) / 1024 / 1024 / 1024

	status := ApplyThresholds(usage, warn, crit)

	return types.CheckResult{
		Status:  status,
		Value:   &usage,
		Unit:    "%",
		Message: fmt.Sprintf("Disk %s %.1f%% (%.1f GB free / %.1f GB total)", path, usage, freeGB, totalGB),
	}
}
