"""
Overseer SNMP Utilities – SNMP Walk/Discovery for OID enumeration.
"""

# ── Common OID name mapping (standard MIBs) ──────────────────────────────────

COMMON_OIDS = {
    # System (RFC 1213)
    "1.3.6.1.2.1.1.1": "sysDescr",
    "1.3.6.1.2.1.1.2": "sysObjectID",
    "1.3.6.1.2.1.1.3": "sysUpTime",
    "1.3.6.1.2.1.1.4": "sysContact",
    "1.3.6.1.2.1.1.5": "sysName",
    "1.3.6.1.2.1.1.6": "sysLocation",
    "1.3.6.1.2.1.1.7": "sysServices",
    # Interfaces (IF-MIB)
    "1.3.6.1.2.1.2.1": "ifNumber",
    "1.3.6.1.2.1.2.2.1.1": "ifIndex",
    "1.3.6.1.2.1.2.2.1.2": "ifDescr",
    "1.3.6.1.2.1.2.2.1.3": "ifType",
    "1.3.6.1.2.1.2.2.1.4": "ifMtu",
    "1.3.6.1.2.1.2.2.1.5": "ifSpeed",
    "1.3.6.1.2.1.2.2.1.6": "ifPhysAddress",
    "1.3.6.1.2.1.2.2.1.7": "ifAdminStatus",
    "1.3.6.1.2.1.2.2.1.8": "ifOperStatus",
    "1.3.6.1.2.1.2.2.1.10": "ifInOctets",
    "1.3.6.1.2.1.2.2.1.11": "ifInUcastPkts",
    "1.3.6.1.2.1.2.2.1.13": "ifInDiscards",
    "1.3.6.1.2.1.2.2.1.14": "ifInErrors",
    "1.3.6.1.2.1.2.2.1.16": "ifOutOctets",
    "1.3.6.1.2.1.2.2.1.17": "ifOutUcastPkts",
    "1.3.6.1.2.1.2.2.1.19": "ifOutDiscards",
    "1.3.6.1.2.1.2.2.1.20": "ifOutErrors",
    # IP
    "1.3.6.1.2.1.4.1": "ipForwarding",
    "1.3.6.1.2.1.4.2": "ipDefaultTTL",
    "1.3.6.1.2.1.4.20.1.1": "ipAdEntAddr",
    "1.3.6.1.2.1.4.20.1.2": "ipAdEntIfIndex",
    "1.3.6.1.2.1.4.20.1.3": "ipAdEntNetMask",
    # TCP
    "1.3.6.1.2.1.6.5": "tcpActiveOpens",
    "1.3.6.1.2.1.6.9": "tcpCurrEstab",
    "1.3.6.1.2.1.6.10": "tcpInSegs",
    "1.3.6.1.2.1.6.11": "tcpOutSegs",
    # Host Resources (HOST-RESOURCES-MIB)
    "1.3.6.1.2.1.25.1.1": "hrSystemUptime",
    "1.3.6.1.2.1.25.1.2": "hrSystemDate",
    "1.3.6.1.2.1.25.1.5": "hrSystemNumUsers",
    "1.3.6.1.2.1.25.1.6": "hrSystemProcesses",
    "1.3.6.1.2.1.25.2.2": "hrMemorySize",
    "1.3.6.1.2.1.25.2.3.1.1": "hrStorageIndex",
    "1.3.6.1.2.1.25.2.3.1.2": "hrStorageType",
    "1.3.6.1.2.1.25.2.3.1.3": "hrStorageDescr",
    "1.3.6.1.2.1.25.2.3.1.4": "hrStorageAllocationUnits",
    "1.3.6.1.2.1.25.2.3.1.5": "hrStorageSize",
    "1.3.6.1.2.1.25.2.3.1.6": "hrStorageUsed",
    "1.3.6.1.2.1.25.3.3.1.2": "hrProcessorLoad",
    # Printer (Printer-MIB)
    "1.3.6.1.2.1.43.5.1.1.1": "prtGeneralConfigChanges",
    "1.3.6.1.2.1.43.8.2.1.13": "prtInputDescription",
    "1.3.6.1.2.1.43.8.2.1.18": "prtInputName",
    "1.3.6.1.2.1.43.10.2.1.4": "prtMarkerStatus",
    "1.3.6.1.2.1.43.11.1.1.6": "prtMarkerSuppliesDescription",
    "1.3.6.1.2.1.43.11.1.1.7": "prtMarkerSuppliesSupplyUnit",
    "1.3.6.1.2.1.43.11.1.1.8": "prtMarkerSuppliesMaxCapacity",
    "1.3.6.1.2.1.43.11.1.1.9": "prtMarkerSuppliesLevel",
    # UPS (UPS-MIB)
    "1.3.6.1.2.1.33.1.1.1": "upsIdentManufacturer",
    "1.3.6.1.2.1.33.1.1.2": "upsIdentModel",
    "1.3.6.1.2.1.33.1.2.1": "upsBatteryStatus",
    "1.3.6.1.2.1.33.1.2.2": "upsSecondsOnBattery",
    "1.3.6.1.2.1.33.1.2.3": "upsEstimatedMinutesRemaining",
    "1.3.6.1.2.1.33.1.2.4": "upsEstimatedChargeRemaining",
    "1.3.6.1.2.1.33.1.2.5": "upsBatteryVoltage",
    "1.3.6.1.2.1.33.1.2.6": "upsBatteryCurrent",
    "1.3.6.1.2.1.33.1.2.7": "upsBatteryTemperature",
    "1.3.6.1.2.1.33.1.3.3.1.2": "upsInputFrequency",
    "1.3.6.1.2.1.33.1.3.3.1.3": "upsInputVoltage",
    "1.3.6.1.2.1.33.1.4.1": "upsOutputSource",
    "1.3.6.1.2.1.33.1.4.2": "upsOutputFrequency",
    "1.3.6.1.2.1.33.1.4.4.1.2": "upsOutputVoltage",
    "1.3.6.1.2.1.33.1.4.4.1.4": "upsOutputPower",
    "1.3.6.1.2.1.33.1.4.4.1.5": "upsOutputPercentLoad",
    # IF-MIB (64-bit counters)
    "1.3.6.1.2.1.31.1.1.1.1": "ifName",
    "1.3.6.1.2.1.31.1.1.1.6": "ifHCInOctets",
    "1.3.6.1.2.1.31.1.1.1.10": "ifHCOutOctets",
    "1.3.6.1.2.1.31.1.1.1.15": "ifHighSpeed",
    "1.3.6.1.2.1.31.1.1.1.18": "ifAlias",
    # Entity (ENTITY-MIB) – chassis, modules
    "1.3.6.1.2.1.47.1.1.1.1.2": "entPhysicalDescr",
    "1.3.6.1.2.1.47.1.1.1.1.7": "entPhysicalName",
    "1.3.6.1.2.1.47.1.1.1.1.11": "entPhysicalSerialNum",
    "1.3.6.1.2.1.47.1.1.1.1.13": "entPhysicalModelName",
    # Synology NAS
    "1.3.6.1.4.1.6574.1.1": "synoSystemStatus",
    "1.3.6.1.4.1.6574.1.2": "synoTemperature",
    "1.3.6.1.4.1.6574.1.4.1": "synoCpuFanStatus",
    "1.3.6.1.4.1.6574.1.4.2": "synoSysFanStatus",
    "1.3.6.1.4.1.6574.2.1.1.2": "synoDiskID",
    "1.3.6.1.4.1.6574.2.1.1.3": "synoDiskModel",
    "1.3.6.1.4.1.6574.2.1.1.5": "synoDiskStatus",
    "1.3.6.1.4.1.6574.2.1.1.6": "synoDiskTemperature",
    "1.3.6.1.4.1.6574.3.1.1.2": "synoRaidName",
    "1.3.6.1.4.1.6574.3.1.1.3": "synoRaidStatus",
    # QNAP NAS
    "1.3.6.1.4.1.24681.1.2.1": "qnapSystemCPU",
    "1.3.6.1.4.1.24681.1.2.2": "qnapSystemTotalMem",
    "1.3.6.1.4.1.24681.1.2.3": "qnapSystemFreeMem",
    "1.3.6.1.4.1.24681.1.2.4": "qnapSysUptime",
    "1.3.6.1.4.1.24681.1.2.5": "qnapCPUTemperature",
    "1.3.6.1.4.1.24681.1.2.6": "qnapSystemTemperature",
    "1.3.6.1.4.1.24681.1.2.11.1.1.2": "qnapHdDescr",
    "1.3.6.1.4.1.24681.1.2.11.1.1.3": "qnapHdTemperature",
    "1.3.6.1.4.1.24681.1.2.11.1.1.4": "qnapHdStatus",
    "1.3.6.1.4.1.24681.1.2.11.1.1.5": "qnapHdModel",
    "1.3.6.1.4.1.24681.1.2.11.1.1.6": "qnapHdCapacity",
    "1.3.6.1.4.1.24681.1.2.17.1.1.2": "qnapSysVolumeDescr",
    "1.3.6.1.4.1.24681.1.2.17.1.1.3": "qnapSysVolumeFS",
    "1.3.6.1.4.1.24681.1.2.17.1.1.4": "qnapSysVolumeTotalSize",
    "1.3.6.1.4.1.24681.1.2.17.1.1.5": "qnapSysVolumeFreeSize",
    "1.3.6.1.4.1.24681.1.2.17.1.1.6": "qnapSysVolumeStatus",
    # Cisco
    "1.3.6.1.4.1.9.9.109.1.1.1.1.3": "cpmCPUTotal5sec",
    "1.3.6.1.4.1.9.9.109.1.1.1.1.4": "cpmCPUTotal1min",
    "1.3.6.1.4.1.9.9.109.1.1.1.1.5": "cpmCPUTotal5min",
    "1.3.6.1.4.1.9.2.1.8": "avgBusy5",
}


def resolve_oid_name(oid: str) -> str:
    """Look up a human-readable name for an OID, stripping instance suffix."""
    if oid in COMMON_OIDS:
        return COMMON_OIDS[oid]

    # Try stripping instance suffixes (.0, .1, .2, etc.)
    parts = oid.split(".")
    for i in range(len(parts) - 1, max(len(parts) - 4, 0), -1):
        prefix = ".".join(parts[:i])
        suffix = ".".join(parts[i:])
        if prefix in COMMON_OIDS:
            return f"{COMMON_OIDS[prefix]}.{suffix}"

    return oid


async def snmp_walk_async(ip: str, community: str = "public", version: str = "2c",
                         base_oid: str = "1.3.6.1.2.1", timeout: int = 10,
                         max_results: int = 500) -> list[dict]:
    """Perform an async SNMP walk and return discovered OIDs with values.

    Returns list of: {"oid": str, "name": str, "value": str, "type": str}
    """
    from pysnmp.hlapi.asyncio import (
        SnmpEngine, CommunityData, UdpTransportTarget,
        ContextData, ObjectType, ObjectIdentity, nextCmd,
    )

    mp_model = 0 if version == "1" else 1
    results = []

    engine = SnmpEngine()
    try:
        kwargs = dict(
            lexicographicMode=False,  # stop when leaving the subtree
        )
        initial_var_binds = [ObjectType(ObjectIdentity(base_oid))]

        while True:
            error_indication, error_status, _error_index, var_binds = await nextCmd(
                engine,
                CommunityData(community, mpModel=mp_model),
                UdpTransportTarget((ip, 161), timeout=timeout, retries=1),
                ContextData(),
                *initial_var_binds,
                **kwargs,
            )

            if error_indication or error_status:
                break

            if not var_binds:
                break

            for oid_obj, val in var_binds:
                oid_str = oid_obj.prettyPrint()

                # Check if we left the subtree
                if not oid_str.startswith(base_oid + ".") and oid_str != base_oid:
                    return results

                val_str = val.prettyPrint()
                val_type = val.__class__.__name__

                results.append({
                    "oid": oid_str,
                    "name": resolve_oid_name(oid_str),
                    "value": val_str,
                    "type": val_type,
                })

                if len(results) >= max_results:
                    return results

            # Continue from the last OID
            initial_var_binds = [ObjectType(var_binds[-1][0])]
    finally:
        engine.closeDispatcher()

    return results


def snmp_walk(ip: str, community: str = "public", version: str = "2c",
              base_oid: str = "1.3.6.1.2.1", timeout: int = 10,
              max_results: int = 500) -> list[dict]:
    """Synchronous wrapper for snmp_walk_async (runs in asyncio.run)."""
    import asyncio
    return asyncio.run(snmp_walk_async(ip, community, version, base_oid, timeout, max_results))
