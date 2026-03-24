package main

import (
	"fmt"
	"time"

	"github.com/gosnmp/gosnmp"
)

// doSNMPCheck performs a generic SNMP GET for a single OID.
// check.Config must have "oid" (string).
// Optional: "community" (overrides host default), "version" ("1","2c","3").
func doSNMPCheck(host HostConfig, check CheckConfig) CheckResult {
	oid, _ := check.Config["oid"].(string)
	if oid == "" {
		return unknownResult(host.Hostname, check.Name, "snmp", "missing 'oid' in check config")
	}

	community := host.SNMPCommunity
	if c, ok := check.Config["community"].(string); ok && c != "" {
		community = c
	}
	if community == "" {
		community = "public"
	}

	version := gosnmp.Version2c
	switch host.SNMPVersion {
	case "1":
		version = gosnmp.Version1
	case "3":
		version = gosnmp.Version3
	}

	target := host.IPAddress
	if target == "" {
		target = host.Hostname
	}

	g := &gosnmp.GoSNMP{
		Target:    target,
		Port:      161,
		Community: community,
		Version:   version,
		Timeout:   5 * time.Second,
		Retries:   1,
	}

	start := time.Now()
	if err := g.Connect(); err != nil {
		return unknownResult(host.Hostname, check.Name, "snmp",
			fmt.Sprintf("SNMP connect failed: %s", err))
	}
	defer g.Conn.Close()

	result, err := g.Get([]string{oid})
	durationMs := int(time.Since(start).Milliseconds())
	if err != nil {
		return unknownResult(host.Hostname, check.Name, "snmp",
			fmt.Sprintf("SNMP GET failed: %s", err))
	}

	if len(result.Variables) == 0 {
		return unknownResult(host.Hostname, check.Name, "snmp", "no SNMP variable returned")
	}

	pdu := result.Variables[0]
	value, unit, msg := snmpPDUToFloat(pdu, check)

	status := "OK"
	if value == nil {
		status = "UNKNOWN"
		msg = fmt.Sprintf("unsupported SNMP type %v", pdu.Type)
	}

	return CheckResult{
		Host:       host.Hostname,
		Name:       check.Name,
		CheckType:  "snmp",
		Status:     status,
		Value:      value,
		Unit:       unit,
		Message:    msg,
		DurationMs: &durationMs,
	}
}

// snmpPDUToFloat converts a PDU variable to float64 value + unit string.
func snmpPDUToFloat(pdu gosnmp.SnmpPDU, check CheckConfig) (*float64, string, string) {
	unit, _ := check.Config["unit"].(string)
	scale := 1.0
	if s, ok := check.Config["scale"].(float64); ok {
		scale = s
	}

	var raw float64
	switch v := pdu.Value.(type) {
	case int:
		raw = float64(v)
	case int32:
		raw = float64(v)
	case int64:
		raw = float64(v)
	case uint:
		raw = float64(v)
	case uint32:
		raw = float64(v)
	case uint64:
		raw = float64(v)
	case float64:
		raw = v
	case string:
		return nil, "", fmt.Sprintf("string value: %s", v)
	default:
		return nil, "", ""
	}

	result := raw * scale
	msg := fmt.Sprintf("SNMP %s = %.2f%s", pdu.Name, result, unit)
	return &result, unit, msg
}

// doInterfaceStatusCheck checks whether a network interface is up (ifOperStatus OID).
// ifOperStatus: 1=up, 2=down, 3=testing, ...
func doInterfaceStatusCheck(host HostConfig, check CheckConfig) CheckResult {
	// Override OID to ifOperStatus if not set
	if _, ok := check.Config["oid"]; !ok {
		ifIndex, _ := check.Config["if_index"].(float64)
		oid := fmt.Sprintf("1.3.6.1.2.1.2.2.1.8.%d", int(ifIndex))
		check.Config["oid"] = oid
	}
	check.Config["unit"] = ""

	result := doSNMPCheck(host, check)
	if result.Status == "UNKNOWN" {
		return result
	}

	if result.Value != nil {
		switch int(*result.Value) {
		case 1:
			result.Status = "OK"
			result.Message = "Interface UP"
		case 2:
			result.Status = "CRITICAL"
			result.Message = "Interface DOWN"
		default:
			result.Status = "WARNING"
			result.Message = fmt.Sprintf("Interface status: %d", int(*result.Value))
		}
	}
	return result
}
