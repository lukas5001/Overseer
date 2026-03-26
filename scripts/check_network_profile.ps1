# check_network_profile.ps1 — Nagios-compatible network profile check
# Checks that all active network adapters have NetworkCategory = Private.
# Exit codes: 0=OK, 2=CRITICAL

try {
    $profiles = Get-NetConnectionProfile -ErrorAction Stop | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' }

    if (-not $profiles) {
        Write-Host "UNKNOWN - No active network connections found"
        exit 3
    }

    $bad = $profiles | Where-Object { $_.NetworkCategory -ne 'Private' }

    if ($bad) {
        $details = ($bad | ForEach-Object { "$($_.InterfaceAlias): $($_.NetworkCategory)" }) -join ', '
        Write-Host "CRITICAL - Network not Private: $details"
        exit 2
    }

    $details = ($profiles | ForEach-Object { "$($_.InterfaceAlias): Private" }) -join ', '
    Write-Host "OK - All networks Private ($details)"
    exit 0
}
catch {
    Write-Host "UNKNOWN - $($_.Exception.Message)"
    exit 3
}
