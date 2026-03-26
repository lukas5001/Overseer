# check_logged_in_users.ps1 — JSON-Output Beispiel
# Zählt aktive Benutzersitzungen und gibt strukturiertes JSON zurück.
#
# Expected output: json
# Alle Felder (status, value, unit, message) werden direkt aus dem JSON gelesen.

try {
    $sessions = query user 2>$null
    # Erste Zeile ist Header, Rest sind Sessions
    $count = 0
    if ($sessions) {
        $count = ($sessions | Select-Object -Skip 1 | Where-Object { $_.Trim() -ne '' }).Count
    }

    $users = @()
    if ($sessions) {
        foreach ($line in ($sessions | Select-Object -Skip 1)) {
            if ($line.Trim()) {
                $users += ($line.Trim() -split '\s+')[0]
            }
        }
    }

    $userList = ($users | Select-Object -Unique) -join ', '

    if ($count -eq 0) {
        $status = "OK"
        $msg = "Keine aktiven Sitzungen"
    } else {
        $status = "OK"
        $msg = "$count Sitzung(en): $userList"
    }

    $result = @{
        status  = $status
        value   = $count
        unit    = ""
        message = $msg
    } | ConvertTo-Json -Compress

    Write-Host $result
    exit 0
}
catch {
    $err = @{
        status  = "UNKNOWN"
        message = $_.Exception.Message
    } | ConvertTo-Json -Compress

    Write-Host $err
    exit 3
}
