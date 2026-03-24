//go:build linux

package checks

import (
	"bufio"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"

	"github.com/lukas5001/overseer-agent/internal/types"
)

func checkMemoryPlatform(_ map[string]any, warn, crit *float64) types.CheckResult {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("read /proc/meminfo: %v", err)}
	}
	defer f.Close()

	var memTotal, memAvailable uint64
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "MemTotal:") {
			memTotal = parseMemInfoValue(line)
		} else if strings.HasPrefix(line, "MemAvailable:") {
			memAvailable = parseMemInfoValue(line)
		}
	}

	if memTotal == 0 {
		return types.CheckResult{Status: "UNKNOWN", Message: "could not parse MemTotal from /proc/meminfo"}
	}

	usage := math.Round(((float64(memTotal)-float64(memAvailable))/float64(memTotal)*100)*100) / 100
	usedGB := float64(memTotal-memAvailable) / 1024 / 1024
	totalGB := float64(memTotal) / 1024 / 1024

	status := ApplyThresholds(usage, warn, crit)

	return types.CheckResult{
		Status:  status,
		Value:   &usage,
		Unit:    "%",
		Message: fmt.Sprintf("Memory %.1f%% (%.1f/%.1f GB)", usage, usedGB, totalGB),
	}
}

func parseMemInfoValue(line string) uint64 {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return 0
	}
	val, _ := strconv.ParseUint(fields[1], 10, 64)
	return val // already in kB
}
