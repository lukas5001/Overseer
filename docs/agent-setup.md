# Overseer Agent — Einrichtungsanleitung

## Überblick

Der Overseer Agent ist ein leichtgewichtiges Go-Binary, das auf Windows- und Linux-Servern läuft.
Er führt Monitoring-Checks lokal aus und sendet die Ergebnisse an den Overseer-Server.

**Vorteile gegenüber WinRM/SSH-basiertem Monitoring:**
- Kein Inbound-Port nötig — nur ausgehend HTTPS (Port 443)
- Keine Firewall-Konfiguration am Zielserver
- Kein Credential-Management (nur ein Token)
- Single Binary (~10 MB), keine Runtime-Dependencies

---

## Schritt 1: Host in Overseer anlegen

1. Overseer-Weboberfläche öffnen
2. **Hosts** → **Host anlegen**
3. Hostname, IP-Adresse und Typ ausfüllen
4. Tenant zuweisen
5. Speichern

## Schritt 2: Agent-Token generieren

1. Den soeben angelegten Host in der Host-Übersicht anklicken
2. Im Bereich **Agent** auf **"Agent einrichten"** klicken
3. Ein Token wird generiert und **einmalig** angezeigt
4. **Token sofort kopieren!** Er wird danach nicht mehr angezeigt.

## Schritt 3: Agent installieren

### Windows

1. `overseer-agent-windows-amd64.exe` herunterladen von:
   `https://overseer.dailycrust.it/agent/overseer-agent-windows-amd64.exe`

2. Eingabeaufforderung **als Administrator** öffnen:
   ```
   overseer-agent.exe install
   ```

3. Config-Datei bearbeiten:
   `C:\ProgramData\Overseer\Agent\config.yaml`
   ```yaml
   server: "https://overseer.dailycrust.it"
   token: "overseer_agent_DEIN_TOKEN_HIER"
   log_level: "info"
   ```

4. Service starten:
   ```
   net start OverseerAgent
   ```

### Linux

1. Agent herunterladen:
   ```bash
   wget https://overseer.dailycrust.it/agent/overseer-agent-linux-amd64
   chmod +x overseer-agent-linux-amd64
   sudo mv overseer-agent-linux-amd64 /usr/local/bin/overseer-agent
   ```

2. Config erstellen:
   ```bash
   sudo mkdir -p /etc/overseer-agent
   sudo tee /etc/overseer-agent/config.yaml <<EOF
   server: "https://overseer.dailycrust.it"
   token: "overseer_agent_DEIN_TOKEN_HIER"
   log_level: "info"
   EOF
   sudo chmod 600 /etc/overseer-agent/config.yaml
   ```

3. systemd-Service einrichten (install.sh nutzen oder manuell):
   ```bash
   # Option A: install.sh (empfohlen)
   sudo ./install.sh

   # Option B: manuell
   sudo systemctl enable --now overseer-agent
   ```

## Schritt 4: Checks konfigurieren

1. Zurück zur Host-Detailseite in Overseer
2. **Service hinzufügen** → Check-Typ wählen (z.B. `agent_cpu`, `agent_memory`, `agent_disk`)
3. Schwellwerte und Intervall einstellen
4. Der Agent holt die neue Konfiguration automatisch (alle 5 Minuten)

### Verfügbare Agent-Check-Typen

| Check-Typ | Beschreibung | Config-Optionen |
|-----------|-------------|-----------------|
| `agent_cpu` | CPU-Auslastung (%) | – |
| `agent_memory` | RAM-Auslastung (%) | – |
| `agent_disk` | Festplattenauslastung (%) | `path`: Laufwerk/Mount (z.B. `C:`, `/`) |
| `agent_service` | Windows-Service / systemd-Unit Status | `service`: Service-Name |
| `agent_process` | Prüft ob ein Prozess läuft | `process`: Prozessname |
| `agent_eventlog` | Windows Event Log Einträge | `log`: Log-Name, `level`: Error/Warning, `minutes`: Zeitraum |
| `agent_custom` | Eigener Befehl ausführen | `command`: Befehl, `ok_pattern`/`warn_pattern`/`crit_pattern`: Regex |

## Schritt 5: Prüfen

- Auf der Host-Detailseite erscheint der Agent-Status:
  - **Grüner Punkt** + "Agent online" = Agent verbunden
  - **Roter Punkt** + "Agent offline" = Agent meldet sich nicht (>3 Minuten)
- Check-Ergebnisse erscheinen in der Services-Tabelle

---

## Troubleshooting

### Agent meldet sich nicht

1. **Firewall prüfen**: Der Agent braucht ausgehend HTTPS (Port 443) zum Overseer-Server
2. **Token prüfen**: Token in `config.yaml` muss exakt dem generierten Token entsprechen
3. **Server-URL prüfen**: Muss mit `https://` beginnen und erreichbar sein
4. **Logs prüfen**:
   - Windows: Event Viewer → Application → OverseerAgent
   - Linux: `journalctl -u overseer-agent -f`

### Token ungültig

- Token können nur einmal angezeigt werden
- Falls verloren: Token widerrufen und neu generieren (Host-Detailseite → "Token widerrufen")

### Agent startet nicht (Windows)

```
# Status prüfen
overseer-agent.exe status

# Service-Logs prüfen
eventvwr.msc → Application → OverseerAgent
```

### Agent startet nicht (Linux)

```bash
# Status prüfen
sudo systemctl status overseer-agent

# Logs prüfen
sudo journalctl -u overseer-agent -n 50

# Manuell testen (Vordergrund)
overseer-agent --config /etc/overseer-agent/config.yaml
```

### DNS-Auflösung / Proxy

Falls der Server über einen Proxy erreichbar ist, muss die Umgebungsvariable `HTTPS_PROXY` gesetzt sein:
```bash
# Linux: in /etc/systemd/system/overseer-agent.service.d/override.conf
[Service]
Environment="HTTPS_PROXY=http://proxy:8080"
```
