package main

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// sshConnect opens an SSH connection using password or key from check.Config.
// Config keys: "host" (overrides target), "port" (default 22), "user", "password", "private_key"
func sshConnect(host HostConfig, check CheckConfig) (*ssh.Client, int, error) {
	target := host.IPAddress
	if target == "" {
		target = host.Hostname
	}
	if h, ok := check.Config["host"].(string); ok && h != "" {
		target = h
	}

	port := 22
	if p, ok := check.Config["port"].(float64); ok {
		port = int(p)
	}

	user := "root"
	if u, ok := check.Config["user"].(string); ok && u != "" {
		user = u
	}

	var authMethods []ssh.AuthMethod
	if pw, ok := check.Config["password"].(string); ok && pw != "" {
		authMethods = append(authMethods, ssh.Password(pw))
	}
	if key, ok := check.Config["private_key"].(string); ok && key != "" {
		signer, err := ssh.ParsePrivateKey([]byte(key))
		if err == nil {
			authMethods = append(authMethods, ssh.PublicKeys(signer))
		}
	}
	if len(authMethods) == 0 {
		return nil, port, fmt.Errorf("no SSH auth method configured (need 'password' or 'private_key')")
	}

	cfg := &ssh.ClientConfig{
		User:            user,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // nolint: gosec — monitoring tool, not security-critical
		Timeout:         10 * time.Second,
	}

	addr := fmt.Sprintf("%s:%d", target, port)
	client, err := ssh.Dial("tcp", addr, cfg)
	return client, port, err
}

// runSSHCommand runs a single command over an existing SSH client and returns stdout.
func runSSHCommand(client *ssh.Client, cmd string) (string, error) {
	sess, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer sess.Close()
	out, err := sess.Output(cmd)
	return strings.TrimSpace(string(out)), err
}

// doSSHDiskCheck checks disk usage on a remote host via SSH.
// Config: user, password/private_key, mount (default "/")
func doSSHDiskCheck(host HostConfig, check CheckConfig) CheckResult {
	client, _, err := sshConnect(host, check)
	if err != nil {
		return unknownResult(host.Hostname, check.Name, "ssh_disk",
			fmt.Sprintf("SSH connect failed: %s", err))
	}
	defer client.Close()

	mount := "/"
	if m, ok := check.Config["mount"].(string); ok && m != "" {
		mount = m
	}

	out, err := runSSHCommand(client, fmt.Sprintf("df -P '%s' | tail -1", mount))
	if err != nil {
		return unknownResult(host.Hostname, check.Name, "ssh_disk",
			fmt.Sprintf("df command failed: %s", err))
	}

	// "df -P" output: Filesystem 1024-blocks Used Available Capacity% Mounted
	fields := strings.Fields(out)
	if len(fields) < 5 {
		return unknownResult(host.Hostname, check.Name, "ssh_disk", "unexpected df output")
	}
	pctStr := strings.TrimSuffix(fields[4], "%")
	pct, err := strconv.ParseFloat(pctStr, 64)
	if err != nil {
		return unknownResult(host.Hostname, check.Name, "ssh_disk",
			fmt.Sprintf("could not parse usage '%s'", pctStr))
	}

	return CheckResult{
		Host:      host.Hostname,
		Name:      check.Name,
		CheckType: "ssh_disk",
		Status:    "OK",
		Value:     &pct,
		Unit:      "%",
		Message:   fmt.Sprintf("Disk %s: %.1f%%", mount, pct),
	}
}

// doSSHCPUCheck checks CPU usage via /proc/stat.
func doSSHCPUCheck(host HostConfig, check CheckConfig) CheckResult {
	client, _, err := sshConnect(host, check)
	if err != nil {
		return unknownResult(host.Hostname, check.Name, "ssh_cpu",
			fmt.Sprintf("SSH connect failed: %s", err))
	}
	defer client.Close()

	// Read /proc/stat twice with 1 second gap to calculate CPU usage
	out1, err := runSSHCommand(client, "head -1 /proc/stat")
	if err != nil {
		return unknownResult(host.Hostname, check.Name, "ssh_cpu", fmt.Sprintf("read /proc/stat failed: %s", err))
	}
	time.Sleep(1 * time.Second)
	out2, err := runSSHCommand(client, "head -1 /proc/stat")
	if err != nil {
		return unknownResult(host.Hostname, check.Name, "ssh_cpu", fmt.Sprintf("read /proc/stat failed: %s", err))
	}

	pct, err := parseCPUStat(out1, out2)
	if err != nil {
		return unknownResult(host.Hostname, check.Name, "ssh_cpu", err.Error())
	}

	return CheckResult{
		Host:      host.Hostname,
		Name:      check.Name,
		CheckType: "ssh_cpu",
		Status:    "OK",
		Value:     &pct,
		Unit:      "%",
		Message:   fmt.Sprintf("CPU: %.1f%%", pct),
	}
}

// parseCPUStat computes CPU usage % from two /proc/stat "cpu" lines.
func parseCPUStat(line1, line2 string) (float64, error) {
	parse := func(line string) (idle, total float64, err error) {
		fields := strings.Fields(line)
		if len(fields) < 5 || fields[0] != "cpu" {
			return 0, 0, fmt.Errorf("unexpected /proc/stat format")
		}
		for i, f := range fields[1:] {
			v, e := strconv.ParseFloat(f, 64)
			if e != nil {
				continue
			}
			total += v
			if i == 3 { // idle is index 4 in /proc/stat (fields[4] after "cpu")
				idle = v
			}
		}
		return
	}
	idle1, total1, err := parse(line1)
	if err != nil {
		return 0, err
	}
	idle2, total2, err := parse(line2)
	if err != nil {
		return 0, err
	}
	deltaTotal := total2 - total1
	deltaIdle := idle2 - idle1
	if deltaTotal == 0 {
		return 0, nil
	}
	pct := (1.0 - deltaIdle/deltaTotal) * 100.0
	return math.Round(pct*10) / 10, nil
}

// doSSHMemCheck checks RAM usage via /proc/meminfo.
func doSSHMemCheck(host HostConfig, check CheckConfig) CheckResult {
	client, _, err := sshConnect(host, check)
	if err != nil {
		return unknownResult(host.Hostname, check.Name, "ssh_mem",
			fmt.Sprintf("SSH connect failed: %s", err))
	}
	defer client.Close()

	out, err := runSSHCommand(client, "grep -E '^(MemTotal|MemAvailable):' /proc/meminfo")
	if err != nil {
		return unknownResult(host.Hostname, check.Name, "ssh_mem",
			fmt.Sprintf("/proc/meminfo read failed: %s", err))
	}

	var total, avail float64
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		v, _ := strconv.ParseFloat(fields[1], 64)
		switch fields[0] {
		case "MemTotal:":
			total = v
		case "MemAvailable:":
			avail = v
		}
	}
	if total == 0 {
		return unknownResult(host.Hostname, check.Name, "ssh_mem", "could not parse /proc/meminfo")
	}
	pct := (1.0 - avail/total) * 100.0
	pct = math.Round(pct*10) / 10

	return CheckResult{
		Host:      host.Hostname,
		Name:      check.Name,
		CheckType: "ssh_mem",
		Status:    "OK",
		Value:     &pct,
		Unit:      "%",
		Message:   fmt.Sprintf("RAM: %.1f%% used (%.0f MB free)", pct, avail/1024),
	}
}

// doSSHProcessCheck checks whether a process is running (pgrep).
// Config: "process" (process name)
func doSSHProcessCheck(host HostConfig, check CheckConfig) CheckResult {
	client, _, err := sshConnect(host, check)
	if err != nil {
		return unknownResult(host.Hostname, check.Name, "ssh_process",
			fmt.Sprintf("SSH connect failed: %s", err))
	}
	defer client.Close()

	process, _ := check.Config["process"].(string)
	if process == "" {
		return unknownResult(host.Hostname, check.Name, "ssh_process", "missing 'process' in config")
	}

	out, err := runSSHCommand(client, fmt.Sprintf("pgrep -c '%s' 2>/dev/null || echo 0", process))
	count := 0
	if err == nil {
		count, _ = strconv.Atoi(strings.TrimSpace(out))
	}

	status := "OK"
	msg := fmt.Sprintf("Process '%s' running (%d instance(s))", process, count)
	if count == 0 {
		status = "CRITICAL"
		msg = fmt.Sprintf("Process '%s' NOT running", process)
	}

	v := float64(count)
	return CheckResult{
		Host: host.Hostname, Name: check.Name, CheckType: "ssh_process",
		Status: status, Value: &v, Unit: "procs", Message: msg,
	}
}

// doSSHServiceCheck checks systemd service status.
// Config: "service" (e.g. "nginx")
func doSSHServiceCheck(host HostConfig, check CheckConfig) CheckResult {
	client, _, err := sshConnect(host, check)
	if err != nil {
		return unknownResult(host.Hostname, check.Name, "ssh_service",
			fmt.Sprintf("SSH connect failed: %s", err))
	}
	defer client.Close()

	svc, _ := check.Config["service"].(string)
	if svc == "" {
		return unknownResult(host.Hostname, check.Name, "ssh_service", "missing 'service' in config")
	}

	out, _ := runSSHCommand(client, fmt.Sprintf("systemctl is-active '%s' 2>/dev/null", svc))
	state := strings.TrimSpace(out)

	status := "CRITICAL"
	if state == "active" {
		status = "OK"
	} else if state == "activating" {
		status = "WARNING"
	}

	return CheckResult{
		Host: host.Hostname, Name: check.Name, CheckType: "ssh_service",
		Status: status, Message: fmt.Sprintf("Service '%s': %s", svc, state),
	}
}

// doSSHCustomCheck runs an arbitrary command; interprets exit code (0=OK, 1=WARNING, 2=CRITICAL).
// Config: "command"
func doSSHCustomCheck(host HostConfig, check CheckConfig) CheckResult {
	client, _, err := sshConnect(host, check)
	if err != nil {
		return unknownResult(host.Hostname, check.Name, "ssh_custom",
			fmt.Sprintf("SSH connect failed: %s", err))
	}
	defer client.Close()

	cmd, _ := check.Config["command"].(string)
	if cmd == "" {
		return unknownResult(host.Hostname, check.Name, "ssh_custom", "missing 'command' in config")
	}

	sess, err := client.NewSession()
	if err != nil {
		return unknownResult(host.Hostname, check.Name, "ssh_custom", fmt.Sprintf("session failed: %s", err))
	}
	defer sess.Close()

	out, err := sess.Output(cmd)
	output := strings.TrimSpace(string(out))

	status := "OK"
	if err != nil {
		// Check exit code via error message
		msg := err.Error()
		if strings.Contains(msg, "exit status 2") {
			status = "CRITICAL"
		} else if strings.Contains(msg, "exit status 1") {
			status = "WARNING"
		} else {
			status = "UNKNOWN"
		}
	}

	// Try to parse a numeric value from the output (first number found)
	var value *float64
	re := regexp.MustCompile(`[-+]?\d+\.?\d*`)
	if m := re.FindString(output); m != "" {
		if v, e := strconv.ParseFloat(m, 64); e == nil {
			value = &v
		}
	}

	return CheckResult{
		Host: host.Hostname, Name: check.Name, CheckType: "ssh_custom",
		Status: status, Value: value, Message: output,
	}
}
