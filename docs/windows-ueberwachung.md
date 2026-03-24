# Windows-Rechner mit Overseer überwachen

## Voraussetzungen

- Windows 10/11 Pro oder Windows Server 2016+
- Ein Benutzer mit Administrator-Rechten auf dem Windows-Rechner
- Netzwerkzugriff vom Overseer-Server auf den Windows-Rechner (Port 5985 oder 5986)

---

## Schritt 1: WinRM auf dem Windows-Rechner aktivieren

PowerShell **als Administrator** öffnen und folgende Befehle ausführen:

```powershell
# WinRM aktivieren und Firewall-Regel anlegen
winrm quickconfig -y

# Basic-Auth erlauben (für NTLM)
winrm set winrm/config/service/auth @{Basic="true"}

# Unverschlüsselten Traffic erlauben (nur für HTTP/Port 5985)
winrm set winrm/config/service @{AllowUnencrypted="true"}

# Prüfen ob WinRM läuft
winrm enumerate winrm/config/listener
```

### Option A: HTTP (einfacher, nur im LAN)

Port **5985**, kein Zertifikat nötig. Geeignet für interne Netzwerke / VPN.

```powershell
# Listener sollte nach quickconfig bereits auf HTTP/5985 laufen
# Prüfen:
winrm enumerate winrm/config/listener
# Erwartung: Transport = HTTP, Port = 5985
```

### Option B: HTTPS (empfohlen für Produktion)

Port **5986**, braucht ein SSL-Zertifikat.

```powershell
# Selbstsigniertes Zertifikat erstellen
$cert = New-SelfSignedCertificate -DnsName $env:COMPUTERNAME -CertStoreLocation Cert:\LocalMachine\My

# HTTPS-Listener anlegen
winrm create winrm/config/Listener?Address=*+Transport=HTTPS "@{Hostname=`"$($env:COMPUTERNAME)`"; CertificateThumbprint=`"$($cert.Thumbprint)`"}"

# Firewall-Regel für Port 5986
New-NetFirewallRule -DisplayName "WinRM HTTPS" -Direction Inbound -LocalPort 5986 -Protocol TCP -Action Allow
```

### Verbindung testen (vom Overseer-Server)

```bash
# Vom Overseer-Server aus:
python3 -c "
import winrm
s = winrm.Session('http://WINDOWS-IP:5985/wsman', auth=('Administrator', 'PASSWORT'), transport='ntlm')
r = s.run_ps('hostname')
print(r.std_out.decode())
"
```

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
   - **WinRM Benutzer**: `Administrator` (oder ein anderer Admin-Account)
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
| `winrm_service` | Windows-Dienst läuft? | - |
| `winrm_custom` | Eigenes PowerShell-Kommando | - |

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
- Name: `Offene Sessions`
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

Nach dem Anlegen der Checks:
1. Auf der Host-Detailseite den **Play-Button** neben einem Check klicken → führt den Check sofort aus
2. Status sollte nach wenigen Sekunden von UNKNOWN auf OK/WARNING/CRITICAL wechseln
3. Bei Fehlern: Status-Meldung lesen — häufige Probleme:
   - `WinRM: username und password erforderlich` → WinRM-Credentials im Host nicht eingetragen
   - `Connection refused` → WinRM auf dem Windows-Rechner nicht aktiviert oder Firewall blockiert
   - `401 Unauthorized` → Falscher Benutzername/Passwort oder NTLM nicht aktiviert

---

## Häufige Probleme

**"Connection refused" oder Timeout:**
- WinRM-Dienst auf Windows prüfen: `Get-Service WinRM`
- Firewall-Regel prüfen: `Get-NetFirewallRule -DisplayName "*WinRM*"`
- Port erreichbar? Vom Server: `nc -zv WINDOWS-IP 5985`

**"401 Unauthorized":**
- Passwort korrekt?
- Benutzer ist lokaler Administrator?
- Bei Domain-Accounts: `DOMAIN\Benutzer` als Username verwenden

**"SSL certificate problem":**
- Bei selbstsignierten Zertifikaten: WinRM SSL auf `An` und der Server ignoriert die Zertifikatsvalidierung automatisch

**"Access denied":**
- PowerShell-Remoting für den Benutzer erlauben:
  ```powershell
  Set-PSSessionConfiguration -Name Microsoft.PowerShell -ShowSecurityDescriptorUI
  ```
  Dort den Benutzer hinzufügen und "Execute" erlauben.
