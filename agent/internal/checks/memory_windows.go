//go:build windows

package checks

import (
	"fmt"
	"math"
	"unsafe"

	"golang.org/x/sys/windows"

	"github.com/lukas5001/overseer-agent/internal/types"
)

type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

func checkMemoryPlatform(_ map[string]any, warn, crit *float64) types.CheckResult {
	kernel32 := windows.NewLazyDLL("kernel32.dll")
	proc := kernel32.NewProc("GlobalMemoryStatusEx")

	var ms memoryStatusEx
	ms.Length = uint32(unsafe.Sizeof(ms))

	ret, _, err := proc.Call(uintptr(unsafe.Pointer(&ms)))
	if ret == 0 {
		return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("GlobalMemoryStatusEx failed: %v", err)}
	}

	usage := math.Round(float64(ms.MemoryLoad)*100) / 100
	usedGB := float64(ms.TotalPhys-ms.AvailPhys) / 1024 / 1024 / 1024
	totalGB := float64(ms.TotalPhys) / 1024 / 1024 / 1024

	status := ApplyThresholds(usage, warn, crit)

	return types.CheckResult{
		Status:  status,
		Value:   &usage,
		Unit:    "%",
		Message: fmt.Sprintf("Memory %.0f%% (%.1f/%.1f GB)", usage, usedGB, totalGB),
	}
}
