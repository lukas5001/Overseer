package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"time"

	"github.com/Ullaakut/nmap/v3"
	"github.com/gosnmp/gosnmp"
)

// ==================== Discovery Types ====================

// DiscoveryResult is the top-level result of a network discovery scan.
type DiscoveryResult struct {
	Type        string         `json:"type"`         // "network_discovery"
	ScanID      string         `json:"scan_id"`
	CollectorID string         `json:"collector_id"`
	Timestamp   string         `json:"timestamp"`
	Target      string         `json:"target"`
	HostsFound  []DiscoveredHost `json:"hosts_found"`
}

// DiscoveredHost represents a single host found during network scanning.
type DiscoveredHost struct {
	IP              string        `json:"ip"`
	Hostname        string        `json:"hostname,omitempty"`
	MAC             string        `json:"mac,omitempty"`
	Vendor          string        `json:"vendor,omitempty"`
	OSGuess         string        `json:"os_guess,omitempty"`
	DeviceType      string        `json:"device_type"`      // "server", "network_device", "printer", "unknown"
	OpenPorts       []OpenPort    `json:"open_ports"`
	SNMP            *SNMPInfo     `json:"snmp,omitempty"`
	SuggestedChecks []string      `json:"suggested_checks"`
}

// OpenPort represents a discovered open port.
type OpenPort struct {
	Port     int    `json:"port"`
	Protocol string `json:"protocol"` // "tcp"
	Service  string `json:"service,omitempty"`
	Version  string `json:"version,omitempty"`
}

// SNMPInfo holds SNMP system information from a discovered device.
type SNMPInfo struct {
	SysDescr    string `json:"sys_descr,omitempty"`
	SysObjectID string `json:"sys_object_id,omitempty"`
	SysName     string `json:"sys_name,omitempty"`
}

// ==================== Network Scan ====================

// NetworkScan performs an nmap scan against the specified targets and ports.
// targets: CIDR notation (e.g. "192.168.1.0/24") or individual IPs.
// ports: comma-separated port list (e.g. "22,80,443,161,3306,5432,8080,3389").
// snmpCommunity: SNMP community string for querying discovered devices (empty to skip).
func NetworkScan(ctx context.Context, targets, ports, snmpCommunity string) (*DiscoveryResult, error) {
	slog.Info("starting network scan", "targets", targets, "ports", ports)

	scanner, err := nmap.NewScanner(
		ctx,
		nmap.WithTargets(targets),
		nmap.WithPorts(ports),
		nmap.WithServiceInfo(),
		nmap.WithTimingTemplate(nmap.TimingNormal),
		nmap.WithOSDetection(),
	)
	if err != nil {
		return nil, fmt.Errorf("create scanner: %w", err)
	}

	result, warnings, err := scanner.Run()
	if warnings != nil && len(*warnings) > 0 {
		slog.Warn("nmap warnings", "warnings", *warnings)
	}
	if err != nil {
		return nil, fmt.Errorf("nmap scan failed: %w", err)
	}

	var hosts []DiscoveredHost

	for _, host := range result.Hosts {
		if host.Status.State != "up" {
			continue
		}

		dh := DiscoveredHost{
			DeviceType: "unknown",
		}

		// IP address
		for _, addr := range host.Addresses {
			switch addr.AddrType {
			case "ipv4", "ipv6":
				dh.IP = addr.Addr
			case "mac":
				dh.MAC = addr.Addr
				if addr.Vendor != "" {
					dh.Vendor = addr.Vendor
				}
			}
		}

		// MAC OUI vendor lookup (if vendor not already set by nmap)
		if dh.MAC != "" && dh.Vendor == "" {
			dh.Vendor = ouiLookup(dh.MAC)
		}

		// Hostname
		for _, hostname := range host.Hostnames {
			if hostname.Name != "" {
				dh.Hostname = hostname.Name
				break
			}
		}

		// OS guess
		if len(host.OS.Matches) > 0 {
			dh.OSGuess = host.OS.Matches[0].Name
		}

		// Open ports
		for _, port := range host.Ports {
			if port.State.State != "open" {
				continue
			}
			dh.OpenPorts = append(dh.OpenPorts, OpenPort{
				Port:     int(port.ID),
				Protocol: port.Protocol,
				Service:  port.Service.Name,
				Version:  strings.TrimSpace(fmt.Sprintf("%s %s", port.Service.Product, port.Service.Version)),
			})
		}

		// Device type detection via port fingerprinting
		dh.DeviceType = detectDeviceType(dh.OpenPorts, dh.OSGuess)

		// SNMP query if port 161 is open and community string is provided
		if snmpCommunity != "" && hasPort(dh.OpenPorts, 161) {
			snmpInfo := querySNMP(dh.IP, snmpCommunity)
			if snmpInfo != nil {
				dh.SNMP = snmpInfo
				// Refine device type based on SNMP data
				if dh.DeviceType == "unknown" {
					dh.DeviceType = detectDeviceTypeFromSNMP(snmpInfo)
				}
			}
		}

		// Generate suggested checks
		dh.SuggestedChecks = suggestChecksForHost(dh)

		hosts = append(hosts, dh)
	}

	slog.Info("network scan complete", "hosts_found", len(hosts))

	return &DiscoveryResult{
		Type:       "network_discovery",
		Target:     targets,
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		HostsFound: hosts,
	}, nil
}

// ==================== Device Type Detection ====================

// detectDeviceType determines the device type based on open ports and OS guess.
func detectDeviceType(ports []OpenPort, osGuess string) string {
	portNums := make(map[int]bool)
	for _, p := range ports {
		portNums[p.Port] = true
	}

	// Printer detection
	if portNums[631] || portNums[9100] || portNums[515] {
		return "printer"
	}

	// Network device: SNMP only (no SSH/HTTP combo typical of servers)
	if portNums[161] && !portNums[22] && !portNums[3389] {
		return "network_device"
	}

	// Windows server
	if portNums[3389] {
		return "windows_server"
	}

	// Linux/Unix server: SSH + web ports
	if portNums[22] && (portNums[80] || portNums[443] || portNums[8080]) {
		return "server"
	}

	// Server with SSH
	if portNums[22] {
		return "server"
	}

	// Web-only device (no SSH) — could be an appliance
	if (portNums[80] || portNums[443]) && !portNums[22] {
		if portNums[161] {
			return "network_device"
		}
		return "appliance"
	}

	// OS-based fallback
	osLower := strings.ToLower(osGuess)
	if strings.Contains(osLower, "linux") || strings.Contains(osLower, "ubuntu") ||
		strings.Contains(osLower, "debian") || strings.Contains(osLower, "centos") {
		return "server"
	}
	if strings.Contains(osLower, "windows") {
		return "windows_server"
	}
	if strings.Contains(osLower, "cisco") || strings.Contains(osLower, "juniper") ||
		strings.Contains(osLower, "mikrotik") || strings.Contains(osLower, "routeros") {
		return "network_device"
	}

	return "unknown"
}

// detectDeviceTypeFromSNMP uses sysObjectID / sysDescr to guess device type.
func detectDeviceTypeFromSNMP(info *SNMPInfo) string {
	descr := strings.ToLower(info.SysDescr)
	oid := info.SysObjectID

	// Cisco
	if strings.HasPrefix(oid, "1.3.6.1.4.1.9.") || strings.Contains(descr, "cisco") {
		return "network_device"
	}
	// Juniper
	if strings.HasPrefix(oid, "1.3.6.1.4.1.2636.") || strings.Contains(descr, "juniper") {
		return "network_device"
	}
	// HP/Aruba networking
	if strings.HasPrefix(oid, "1.3.6.1.4.1.11.") || strings.Contains(descr, "procurve") {
		return "network_device"
	}
	// MikroTik
	if strings.HasPrefix(oid, "1.3.6.1.4.1.14988.") || strings.Contains(descr, "mikrotik") || strings.Contains(descr, "routeros") {
		return "network_device"
	}
	// Ubiquiti
	if strings.HasPrefix(oid, "1.3.6.1.4.1.41112.") || strings.Contains(descr, "ubiquiti") || strings.Contains(descr, "unifi") {
		return "network_device"
	}
	// net-snmp (typically Linux servers)
	if strings.HasPrefix(oid, "1.3.6.1.4.1.8072.") || strings.Contains(descr, "linux") {
		return "server"
	}
	// Windows
	if strings.Contains(descr, "windows") || strings.Contains(descr, "microsoft") {
		return "windows_server"
	}
	// Printer
	if strings.Contains(descr, "printer") || strings.Contains(descr, "ricoh") ||
		strings.Contains(descr, "xerox") || strings.Contains(descr, "brother") ||
		strings.Contains(descr, "canon") || strings.Contains(descr, "epson") {
		return "printer"
	}

	return "unknown"
}

// ==================== SNMP Query ====================

// querySNMP queries sysDescr, sysObjectID and sysName from a host.
func querySNMP(ip, community string) *SNMPInfo {
	g := &gosnmp.GoSNMP{
		Target:    ip,
		Port:      161,
		Community: community,
		Version:   gosnmp.Version2c,
		Timeout:   3 * time.Second,
		Retries:   1,
	}

	if err := g.Connect(); err != nil {
		slog.Debug("SNMP connect failed during discovery", "ip", ip, "error", err)
		return nil
	}
	defer g.Conn.Close()

	oids := []string{
		"1.3.6.1.2.1.1.1.0", // sysDescr
		"1.3.6.1.2.1.1.2.0", // sysObjectID
		"1.3.6.1.2.1.1.5.0", // sysName
	}

	result, err := g.Get(oids)
	if err != nil {
		slog.Debug("SNMP GET failed during discovery", "ip", ip, "error", err)
		return nil
	}

	info := &SNMPInfo{}
	for _, v := range result.Variables {
		switch v.Name {
		case ".1.3.6.1.2.1.1.1.0":
			if s, ok := v.Value.([]byte); ok {
				info.SysDescr = string(s)
			} else if s, ok := v.Value.(string); ok {
				info.SysDescr = s
			}
		case ".1.3.6.1.2.1.1.2.0":
			info.SysObjectID = fmt.Sprintf("%v", v.Value)
		case ".1.3.6.1.2.1.1.5.0":
			if s, ok := v.Value.([]byte); ok {
				info.SysName = string(s)
			} else if s, ok := v.Value.(string); ok {
				info.SysName = s
			}
		}
	}

	if info.SysDescr == "" && info.SysObjectID == "" {
		return nil
	}
	return info
}

// ==================== Suggested Checks ====================

// suggestChecksForHost generates monitoring check suggestions based on discovered info.
func suggestChecksForHost(host DiscoveredHost) []string {
	checks := map[string]bool{
		"ping": true, // always suggest ping
	}

	for _, p := range host.OpenPorts {
		switch p.Port {
		case 80, 8080:
			checks["http"] = true
		case 443:
			checks["http"] = true
			checks["ssl_certificate"] = true
		case 22:
			checks["port"] = true
		case 3306, 5432, 6379, 27017:
			checks["port"] = true
		case 161:
			checks["snmp"] = true
		}
	}

	// Device-type-based additions
	switch host.DeviceType {
	case "server":
		checks["cpu"] = true
		checks["memory"] = true
		checks["disk"] = true
	case "windows_server":
		checks["cpu"] = true
		checks["memory"] = true
		checks["disk"] = true
	case "network_device":
		checks["snmp"] = true
	}

	result := make([]string, 0, len(checks))
	for k := range checks {
		result = append(result, k)
	}
	return result
}

// ==================== MAC OUI Lookup ====================

// ouiLookup resolves the vendor from a MAC address using the OUI prefix (first 3 bytes).
func ouiLookup(mac string) string {
	// Normalize MAC: AA:BB:CC:DD:EE:FF → AABBCC
	mac = strings.ToUpper(strings.ReplaceAll(strings.ReplaceAll(mac, ":", ""), "-", ""))
	if len(mac) < 6 {
		return ""
	}
	prefix := mac[:6]
	if vendor, ok := ouiTable[prefix]; ok {
		return vendor
	}
	return ""
}

// ouiTable is a compact lookup table of common MAC OUI prefixes → vendor names.
// This covers the most common networking/server/IoT vendors.
var ouiTable = map[string]string{
	// Cisco
	"000142": "Cisco", "0001C7": "Cisco", "000164": "Cisco",
	"00000C": "Cisco", "001011": "Cisco", "001BD4": "Cisco",
	"002155": "Cisco", "00264A": "Cisco", "002CC8": "Cisco",
	// Juniper
	"000585": "Juniper", "002159": "Juniper", "002688": "Juniper",
	"00127F": "Juniper", "0019E2": "Juniper", "0023AB": "Juniper",
	// HPE / Aruba
	"001C7E": "HP", "001E0B": "HP",
	"001F29": "HP", "0021B7": "HP", "0023E1": "HP",
	"002481": "HP", "00259C": "HP", "0030C1": "HP",
	"24BE05": "HP Aruba", "000B86": "HP Aruba",
	// Dell
	"001422": "Dell", "001832": "Dell", "002170": "Dell",
	"0024E8": "Dell", "00B0D0": "Dell", "D4BE6F": "Dell",
	"F8BC12": "Dell", "F8DB88": "Dell",
	// Ubiquiti
	"0027D2": "Ubiquiti", "0418D6": "Ubiquiti", "245A4C": "Ubiquiti",
	"448A5B": "Ubiquiti", "687251": "Ubiquiti", "7483C2": "Ubiquiti",
	"802AA8": "Ubiquiti", "B4FBE4": "Ubiquiti", "DC9FDB": "Ubiquiti",
	"F09FC2": "Ubiquiti", "FCECDA": "Ubiquiti",
	// MikroTik
	"000C42": "MikroTik", "D4CA6D": "MikroTik", "2C6E85": "MikroTik",
	"4C5E0C": "MikroTik", "6C3B6B": "MikroTik", "E48D8C": "MikroTik",
	// VMware
	"005056": "VMware", "000C29": "VMware", "001C14": "VMware",
	// Proxmox / QEMU (KVM)
	"525400": "QEMU/KVM",
	// Intel
	"001B21": "Intel", "001E67": "Intel", "002314": "Intel",
	"0050F1": "Intel", "A0369F": "Intel", "3C970E": "Intel",
	// Realtek
	"001731": "Realtek", "00E04C": "Realtek", "52540A": "Realtek",
	// Supermicro
	"003048": "Supermicro", "0025B5": "Supermicro", "AC1F6B": "Supermicro",
	// Lenovo
	"6CAE8B": "Lenovo", "844BF5": "Lenovo",
	// Apple
	"000393": "Apple", "000A27": "Apple", "000A95": "Apple",
	"001451": "Apple", "0019E3": "Apple", "001CB3": "Apple",
	"002312": "Apple", "0025BC": "Apple", "0026BB": "Apple",
	// TP-Link
	"001D0F": "TP-Link", "0023CD": "TP-Link", "50C7BF": "TP-Link",
	"E894F6": "TP-Link", "60E327": "TP-Link", "C006C3": "TP-Link",
	// Netgear
	"0026F2": "Netgear", "002590": "Netgear", "000FB5": "Netgear",
	"C43DC7": "Netgear", "E0469A": "Netgear",
	// Fortinet
	"000946": "Fortinet", "001C4E": "Fortinet", "009061": "Fortinet",
	"70488F": "Fortinet", "E8EDE8": "Fortinet",
	// Synology
	"001132": "Synology", "0011D8": "Synology",
	// QNAP
	"001BFC": "QNAP", "002265": "QNAP",
	// Raspberry Pi
	"B827EB": "Raspberry Pi", "D83ADD": "Raspberry Pi", "DC2632": "Raspberry Pi",
	"E45F01": "Raspberry Pi",
	// Printer vendors
	"0000AA": "Xerox", "000874": "Xerox", "00000E": "Fujitsu",
	"001599": "Samsung", "001E8F": "Canon", "002507": "Ricoh",
	"0002A5": "Epson", "0000F0": "Epson", "0026AB": "Epson",
	"0017C8": "Kyocera", "001F45": "Konica Minolta",
	"001BA9": "Brother", "002654": "Brother",
}

// ==================== Helpers ====================

func hasPort(ports []OpenPort, target int) bool {
	for _, p := range ports {
		if p.Port == target {
			return true
		}
	}
	return false
}

// ResolveHostname attempts a reverse DNS lookup for an IP.
func resolveHostname(ip string) string {
	names, err := net.LookupAddr(ip)
	if err != nil || len(names) == 0 {
		return ""
	}
	return strings.TrimSuffix(names[0], ".")
}
