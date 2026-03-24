# Windows-Rechner mit Overseer überwachen

## Voraussetzungen

- Windows 10/11 Pro oder Windows Server 2016+
- Ein Benutzer mit Administrator-Rechten auf dem Windows-Rechner
- Netzwerkzugriff vom Overseer-Server auf den Windows-Rechner (Port 5985 oder 5986)

---

## Schritt 1: WinRM auf dem Windows-Rechner aktivieren

PowerShell **als Administrator** öffnen und folgenden Befehl ausführen:

```powershell
Enable-PSRemoting -Force
```

Das macht automatisch:
- Startet den WinRM-Dienst
- Setzt den Dienst auf "Automatisch starten"
- Erstellt einen HTTP-Listener auf Port 5985
- Konfiguriert die Windows-Firewall

Prüfen ob es funktioniert hat:

```powershell
# WinRM-Dienst läuft?
Get-Service WinRM

# Listener anzeigen
winrm enumerate winrm/config/listener
```

### Option A: HTTP (Port 5985) — einfach, nur im LAN

Nach `Enable-PSRemoting -Force` ist HTTP bereits aktiv. Nichts weiter zu tun.

Geeignet für: Interne Netzwerke, VPN-Verbindungen, gleiche Domain.

### Option B: HTTPS (Port 5986) — empfohlen für Produktion

```powershell
# Selbstsigniertes Zertifikat erstellen
$cert = New-SelfSignedCertificate -DnsName $env:COMPUTERNAME -CertStoreLocation Cert:\LocalMachine\My

# HTTPS-Listener anlegen
New-Item -Path WSMan:\localhost\Listener -Transport HTTPS -Address * -CertificateThumbPrint $cert.Thumbprint -Force

# Firewall-Regel für Port 5986
New-NetFirewallRule -DisplayName "WinRM HTTPS" -Direction Inbound -LocalPort 5986 -Protocol TCP -Action Allow
```

### Verbindung testen (vom Overseer-Server)

```bash
python3 -c "
import winrm
s = winrm.Session('http://WINDOWS-IP:5985/wsman', auth=('Administrator', 'PASSWORT'), transport='ntlm')
r = s.run_ps('hostname')
print(r.std_out.decode())
"
```

Bei HTTPS: `http://` durch `https://` und `5985` durch `5986` ersetzen.

---

## Schritt 2: Host in Overseer anlegen

1. Overseer öffnen → **Hosts** → **Host anlegen**
2. Ausfüllen:
   - **Hostname**: z.B. `srv-dc-01.domain.local`
   - **IP-Adresse**: IP des Windows-Rechners
   - **Typ**: `server`
   - **Tenant**: Kunde auswählen
3. Host speichern
4. Host öffnen → **Bearbeiten** (Stift-Icon)
5. WinRM-Felder ausfüllen:
   - **WinRM Benutzer**: `Administrator` (oder Domain: `DOMAIN\Benutzer`)
   - **WinRM Passwort**: Passwort des Benutzers
   - **WinRM Port**: `5985` (HTTP) oder `5986` (HTTPS)
   - **WinRM SSL**: Aus (HTTP) oder An (HTTPS)
   - **WinRM Transport**: `ntlm` (Standard, funktioniert mit lokalen und Domain-Accounts)

---

## Schritt 3: Checks hinzufügen

Host öffnen → **Check hinzufügen** und den gewünschten Check-Typ wählen:

| Check-Typ | Was wird geprüft | Schwellwerte |
|-----------|------------------|--------------|
| `winrm_cpu` | CPU-Auslastung (%) | warn: 80, crit: 95 |
| `winrm_mem` | RAM-Auslastung (%) | warn: 85, crit: 95 |
| `winrm_disk` | Festplatte (%) | warn: 80, crit: 90 |
| `winrm_service` | Windows-Dienst läuft? | — |
| `winrm_custom` | Eigenes PowerShell-Kommando | — |

### Beispiele

**CPU überwachen:**
- Typ: `winrm_cpu`
- Name: `CPU`
- Schwellwert Warning: `80`
- Schwellwert Critical: `95`
- Keine zusätzliche Konfiguration nötig

**Festplatte C: überwachen:**
- Typ: `winrm_disk`
- Name: `Disk C:`
- Schwellwert Warning: `80`
- Schwellwert Critical: `90`
- Konfiguration: `{"drive": "C:"}`

**Festplatte D: überwachen:**
- Typ: `winrm_disk`
- Name: `Disk D:`
- Konfiguration: `{"drive": "D:"}`

**Windows-Dienst prüfen (z.B. SQL Server):**
- Typ: `winrm_service`
- Name: `SQL Server`
- Konfiguration: `{"service": "MSSQLSERVER"}`

**Eigenes PowerShell-Kommando:**
- Typ: `winrm_custom`
- Name: `Anzahl Prozesse`
- Konfiguration:
```json
{
  "command": "(Get-Process).Count",
  "ok_pattern": ".",
  "crit_pattern": ""
}
```

---

## Schritt 4: Prüfen

1. Auf der Host-Detailseite den **Play-Button** neben einem Check klicken
2. Status sollte nach wenigen Sekunden von UNKNOWN auf OK/WARNING/CRITICAL wechseln
3. Bei Fehlern: Status-Meldung lesen (siehe Troubleshooting)

---

## Troubleshooting

**"Connection refused" oder Timeout:**
```powershell
# Auf dem Windows-Rechner prüfen:
Get-Service WinRM                                    # Läuft der Dienst?
winrm enumerate winrm/config/listener                # Gibt es einen Listener?
Get-NetFirewallRule -DisplayName "*WinRM*" | Select DisplayName, Enabled, Action
```
Vom Overseer-Server: `nc -zv WINDOWS-IP 5985`

**"401 Unauthorized":**
- Passwort korrekt?
- Benutzer ist lokaler Administrator?
- Bei Domain-Accounts: `DOMAIN\Benutzer` als Username verwenden
- TrustedHosts prüfen (wenn Rechner nicht in gleicher Domain):
  ```powershell
  # Auf dem Windows-Rechner:
  Set-Item WSMan:\localhost\Client\TrustedHosts -Value "OVERSEER-SERVER-IP" -Force
  ```

**"Access denied":**
```powershell
# Auf dem Windows-Rechner:
# Benutzer zur Remote Management Users Gruppe hinzufügen
Add-LocalGroupMember -Group "Remote Management Users" -Member "BENUTZERNAME"
```

**"WinRM: username und password erforderlich":**
- Host in Overseer bearbeiten und WinRM-Credentials eintragen

**"SSL certificate problem":**
- Overseer ignoriert selbstsignierte Zertifikate automatisch (verify_ssl ist standardmäßig aus)
- Sicherstellen dass WinRM SSL in Overseer auf "An" steht wenn HTTPS verwendet wird
