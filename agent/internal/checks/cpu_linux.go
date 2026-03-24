//go:build linux

package checks

import (
	"bufio"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/lukas5001/overseer-agent/internal/types"
)

func checkCPUPlatform(_ map[string]any, warn, crit *float64) types.CheckResult {
	idle1, total1, err := readCPUStat()
	if err != nil {
		return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("read /proc/stat: %v", err)}
	}

	time.Sleep(1 * time.Second)

	idle2, total2, err := readCPUStat()
	if err != nil {
		return types.CheckResult{Status: "UNKNOWN", Message: fmt.Sprintf("read /proc/stat: %v", err)}
	}

	idleDelta := float64(idle2 - idle1)
	totalDelta := float64(total2 - total1)
	if totalDelta == 0 {
		return types.CheckResult{Status: "UNKNOWN", Message: "no CPU time elapsed"}
	}

	usage := math.Round(((totalDelta-idleDelta)/totalDelta*100)*100) / 100

	status := ApplyThresholds(usage, warn, crit)
	val := usage

	return types.CheckResult{
		Status:  status,
		Value:   &val,
		Unit:    "%",
		Message: fmt.Sprintf("CPU %.1f%%", usage),
	}
}

func readCPUStat() (idle, total uint64, err error) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return 0, 0, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			return 0, 0, fmt.Errorf("unexpected /proc/stat format")
		}
		for i := 1; i < len(fields); i++ {
			val, _ := strconv.ParseUint(fields[i], 10, 64)
			total += val
			if i == 4 { // idle is the 5th field (index 4)
				idle = val
			}
		}
		return idle, total, nil
	}
	return 0, 0, fmt.Errorf("cpu line not found in /proc/stat")
}
