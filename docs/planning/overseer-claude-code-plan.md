# Overseer — Schritt-für-Schritt Implementierungsplan für Claude Code

## Wie dieses Dokument funktioniert

Dieses Dokument enthält nummerierte **Prompt-Blöcke**. Jeder Block ist ein eigenständiger Auftrag für Claude Code. Du (Lukas) kopierst einen Block, fügst ihn in Claude Code ein, lässt ihn arbeiten, prüfst das Ergebnis, und gehst zum nächsten Block.

### Regeln

1. **Ein Block = ein Arbeitsauftrag.** Nicht zwei Blöcke auf einmal einfügen.
2. **Nach jedem Block:** Ergebnis prüfen. Funktioniert es? Tests bestanden? Wenn ja → nächster Block. Wenn nein → Fehler in derselben Session fixen lassen.
3. **Compact-Punkte** sind mit `🔄 COMPACT` markiert. An diesen Stellen sagst du Claude Code: `/compact` und gibst ihm danach den nächsten Block. Der nächste Block nach einem Compact-Punkt enthält genug Kontext um ohne Vorwissen weiterzuarbeiten.
4. **Commits:** Nach jedem erfolgreich abgeschlossenen Block einen Commit machen. So kann man bei Problemen zurückrollen.
5. **Theming-Regel für alle Frontend-Arbeiten:** Keine Farben hardcoden. Alle Farben als CSS Custom Properties (`var(--color-primary)`, `var(--color-success)`, etc.). Logo-Pfade konfigurierbar, nicht hardcoded. Diese Regel gilt für JEDEN Block der Frontend-Code berührt.

### Compact-Strategie

Bei Opus 4.6 mit 200k Context füllt sich der Kontext schnell: Claude Code liest Codebase-Dateien (20-50k Tokens), schreibt Code, führt Tests aus, fixt Fehler. **Ein einziger Block kann 80-150k Tokens verbrauchen.** Deshalb: **nach jedem Block (oder maximal 2 kleinen zusammen) compacten.**

Wenn du `/compact` verwendest, geht der bisherige Gesprächsverlauf verloren. Claude Code behält nur eine Zusammenfassung. Damit die Qualität nicht leidet:
- **Compact an JEDER markierten `🔄 COMPACT` Stelle** — nicht überspringen
- Der Block nach einem Compact beginnt immer mit "Lies zuerst: [Dateien]" — damit Claude Code den aktuellen Stand der Codebase versteht
- Jeder Post-Compact-Block ist **vollständig selbsterklärend**
- Wenn du merkst dass Claude Code langsamer wird oder Dinge vergisst → sofort `/compact`, auch wenn noch kein Compact-Punkt markiert ist

---
---

# PHASE 1: Quick Wins

---

## Block 1.1 — SSL Certificate Check: Go-Implementierung

**Projekt:** github.com/lukas5001/Overseer — hol dir die aktuellste Version vom Repo.

**Lies zuerst:** Die bestehenden Check-Typen im Go-Agent-Code. Verstehe das Pattern: wie ein Check registriert wird, wie er konfiguriert wird, wie er sein Ergebnis zurückgibt. Folge exakt demselben Pattern für den neuen Check.

**Aufgabe:** Implementiere einen neuen Check-Typ `ssl_certificate` im Go-Agent/Collector.

**Was der Check tut:**

Der Check verbindet sich per TLS zu einem Host:Port, liest das Zertifikat aus, und prüft:

1. **Ablaufdatum**: Wie viele Tage bis das Zertifikat abläuft?
2. **Hostname-Verifikation**: Passt der Common Name oder ein SAN zum abgefragten Hostname?
3. **Chain-Validierung**: Ist die Zertifikatskette vollständig und vertrauenswürdig (gegen System Root CAs)?
4. **Self-Signed**: Ist Issuer == Subject?
5. **Algorithmus-Stärke**: SHA-1 oder MD5 → schwach
6. **Schlüssellänge**: RSA < 2048 Bit → schwach

**Check-Konfiguration (was der Benutzer pro Check einstellt):**
- `host` (string, required): Der Domain-Name, z.B. `api.example.com`
- `port` (int, default 443): Der Port
- `warning_days` (int, default 30): Ab wann Warning
- `critical_days` (int, default 14): Ab wann Critical
- `allow_self_signed` (bool, default false): Self-Signed als OK behandeln
- `check_ocsp` (bool, default false): OCSP Revocation Check durchführen
- `timeout` (duration, default 10s): Connection Timeout

**Check-Ergebnis (was an den Server gesendet wird):**

Das Ergebnis enthält sowohl den Status (OK/WARNING/CRITICAL) als auch strukturierte Zertifikatsdaten:
- `subject` (string): Common Name
- `issuer` (string): Issuer Common Name
- `sans` ([]string): Subject Alternative Names
- `not_before` (timestamp): Gültig ab
- `not_after` (timestamp): Gültig bis
- `days_until_expiry` (int)
- `is_self_signed` (bool)
- `hostname_valid` (bool)
- `chain_valid` (bool)
- `signature_algorithm` (string)
- `key_type` (string): RSA, ECDSA, Ed25519
- `key_size` (int): z.B. 2048, 4096
- `serial_number` (string)
- `ocsp_status` (string, optional): "good", "revoked", "unknown"

**Status-Logik:**
```
CRITICAL wenn:
  - Zertifikat abgelaufen (days_until_expiry <= 0)
  - days_until_expiry <= critical_days
  - hostname_valid == false
  - chain_valid == false
  - ocsp_status == "revoked"

WARNING wenn:
  - days_until_expiry <= warning_days
  - is_self_signed == true (und allow_self_signed == false)
  - Schwacher Algorithmus (SHA-1, MD5)
  - RSA Key < 2048 bit

OK wenn nichts davon zutrifft.
```

Die Status-Nachricht (der menschenlesbare Text) soll so aussehen:
- OK: `"Valid for 62 days (expires 2026-05-28), issued by Let's Encrypt"`
- WARNING: `"Expires in 28 days (2026-04-24), issued by DigiCert"`
- CRITICAL: `"Expires in 5 days (2026-04-01)! Immediate renewal required."`
- CRITICAL: `"Certificate hostname mismatch: expected api.example.com, got *.other.com"`
- CRITICAL: `"Certificate chain validation failed: unable to verify intermediate certificate"`

**Go-Hinweise:**
- Verwende `crypto/tls` mit `InsecureSkipVerify: true` um das Zertifikat zu lesen, dann eigene Validierung durchführen
- Verwende `crypto/x509` für Chain-Validierung mit `x509.VerifyOptions`
- Für OCSP: `golang.org/x/crypto/ocsp` — `CreateRequest`, dann HTTP POST an `cert.OCSPServer[0]`, dann `ParseResponseForCert`
- Das Check-Intervall ist höher als bei anderen Checks (empfohlen: 6-12 Stunden). Das muss der Benutzer konfigurieren können, default 6h.

**Tests:**

Schreibe Go-Tests für:
1. Gültiges Zertifikat von einer echten Domain (z.B. `google.com:443`) → OK
2. Zertifikat mit weniger als warning_days → WARNING
3. Hostname-Mismatch (verbinde zu einer IP aber prüfe gegen einen falschen Hostname) → CRITICAL
4. Self-Signed Zertifikat → WARNING (bzw. OK wenn allow_self_signed=true)
5. Connection Timeout (unerreichbarer Host) → CRITICAL mit sinnvoller Fehlermeldung
6. Ungültiger Port → Fehlerbehandlung
7. Status-Nachricht-Format prüfen (enthält Ablaufdatum und Issuer)

**Achtung — häufige Fehler:**
- Vergiss nicht `conn.Close()` nach dem TLS-Handshake (defer)
- `InsecureSkipVerify: true` heißt nicht "keine Validierung" — es heißt "ich mache die Validierung selbst nachher"
- Bei OCSP: Nicht alle Zertifikate haben einen OCSP-Server. Wenn `cert.OCSPServer` leer ist, OCSP überspringen, nicht abstürzen.
- Timeouts müssen den gesamten Check abdecken (Connection + TLS Handshake + OCSP Request), nicht nur die initiale Verbindung

---

### 🔄 COMPACT — Nach Block 1.1

**Compact jetzt** (`/compact`).

**Was gebaut wurde:** Neuer Go Check-Typ `ssl_certificate` im Agent/Collector. Prüft Ablaufdatum, Hostname, Chain, Self-Signed, Algorithmus, Key-Länge, OCSP. Config: host, port, warning_days, critical_days, allow_self_signed, check_ocsp. Ergebnis enthält strukturierte Zertifikatsdaten als JSON.

---

## Block 1.2 — SSL Certificate Check: Backend-Integration + Notification-Staffelung

**Projekt:** github.com/lukas5001/Overseer

**Lies zuerst:** Die bestehende Backend-Logik wie Check-Ergebnisse empfangen und verarbeitet werden (Receiver/Worker). Lies auch die bestehende Notification/Alert-Logik. Lies den neuen SSL-Check-Typ im Go Agent-Code um zu verstehen welche Daten er liefert.

**Aufgabe:** Integriere den SSL-Check ins Backend und implementiere die gestaffelte Notification-Logik.

**Backend-Integration:**

Das SSL-Check-Ergebnis kommt wie jedes andere Check-Ergebnis vom Agent/Collector. Das Backend muss:
1. Die strukturierten Zertifikatsdaten aus dem Check-Ergebnis extrahieren und speichern (damit das Frontend sie anzeigen kann)
2. Den Check-Status (OK/WARNING/CRITICAL) normal verarbeiten wie jeden anderen Check

Für die Zertifikatsdaten: Speichere sie in den bestehenden Metrik/Check-Result-Strukturen. Kein neues DB-Schema nötig wenn die Daten als JSON/JSONB in die bestehende Struktur passen. Prüfe wie andere Checks ihre Detail-Daten speichern und folge dem Pattern.

**Notification-Staffelung:**

SSL-Zertifikate brauchen eine besondere Notification-Logik. Bei einem normalen Alert wird bei jedem Check-Zyklus geprüft ob der Status sich geändert hat. Bei SSL-Checks läuft ein Zertifikat aber langsam ab — der Status ist tagelang "WARNING" und dann tagelang "CRITICAL". Der Benutzer soll nicht bei jedem Check (alle 6h) eine Notification bekommen, sondern gestaffelt:

| Situation | Notification-Verhalten |
|-----------|----------------------|
| Erstes Mal WARNING (≤30 Tage) | Einmalige Notification |
| 14 Tage bis Ablauf | Erneute Notification (Severity: High) |
| 7 Tage bis Ablauf | Ab jetzt tägliche Notification |
| 3 Tage bis Ablauf | Alle 12 Stunden |
| Abgelaufen | Sofort, dann alle 6 Stunden bis behoben |
| Zertifikat erneuert (neues Ablaufdatum erkannt) | Recovery-Notification |

**Wie die Staffelung funktioniert:**

Du brauchst ein Tracking welche Notification-Stufe bereits gesendet wurde. Ansatz:
- Pro SSL-Check ein State-Feld `last_cert_notification_stage` (z.B. "30d", "14d", "7d", "3d", "expired")
- Bei jedem Check-Ergebnis: Berechne aktuelle Stufe aus `days_until_expiry` → vergleiche mit `last_cert_notification_stage`
- Sende nur wenn die Stufe sich verschlechtert hat ODER wenn bei "7d" und "3d" das letzte Senden länger als 24h/12h her ist

**Erneuerungserkennung:**
- Wenn `days_until_expiry` im neuen Check-Ergebnis **höher** ist als im vorherigen (z.B. 62 statt 5) → Zertifikat wurde erneuert
- Sende Recovery-Notification: "Certificate for api.example.com has been renewed. New expiry: [date]."
- Reset `last_cert_notification_stage`

**Tests:**

1. Check-Ergebnis wird korrekt verarbeitet und gespeichert
2. Erste Warning-Notification wird gesendet bei 30 Tagen
3. Keine erneute Notification zwischen 30 und 15 Tagen (die Stufe hat sich nicht geändert)
4. Notification bei 14 Tagen
5. Tägliche Notification bei 7 Tagen: Prüfe dass nach 24h erneut gesendet wird, aber nicht nach 12h
6. 12-stündliche Notification bei 3 Tagen
7. Erneuerungserkennung: days_until_expiry springt von 5 auf 90 → Recovery
8. Staffelung-Reset nach Erneuerung

**Achtung:**
- Die Staffelung ist ZUSÄTZLICH zur normalen Alert-Logik, nicht stattdessen. Der Check-Status (OK/WARNING/CRITICAL) geht ganz normal durch das bestehende Alert-System. Die Staffelung kontrolliert nur die Re-Notification-Häufigkeit.
- Vergiss nicht den Edge Case: Was passiert wenn der Check selbst fehlschlägt (Host unreachable)? Das ist ein normaler CRITICAL Alert (Connection failed), kein Zertifikats-Problem. Die Staffelung greift hier nicht.

---

## Block 1.3 — SSL Certificate Check: Frontend

**Lies zuerst:** Die bestehende Frontend-Architektur. Wie sind Check-Detail-Seiten aufgebaut? Welche Component-Library wird verwendet? Welches Routing? Welches State Management? Folge den bestehenden Patterns.

**Aufgabe:** Baue die Frontend-Komponenten für den SSL-Check.

**Theming-Regel:** Alle Farben als CSS Custom Properties. Wenn es noch kein Theming-System gibt, erstelle eine zentrale CSS-Datei oder ein Theme-Objekt mit allen Farb-Variablen die im Projekt verwendet werden. Ersetze bestehende Hardcoded-Farben die du findest NICHT — nur deine neuen Komponenten sollen das Theming nutzen. Bestehenden Code nicht anfassen.

**1. Check-Konfigurationsformular**

Wenn ein Benutzer einen neuen Service/Check vom Typ `ssl_certificate` anlegt, braucht er ein Konfigurationsformular. Baue es analog zu den bestehenden Check-Config-Formularen.

Felder:
- Hostname (text input, required, placeholder: "api.example.com")
- Port (number input, default: 443)
- Warning Days (number input, default: 30, label: "Warn before expiry (days)")
- Critical Days (number input, default: 14, label: "Critical before expiry (days)")
- Allow Self-Signed (checkbox, default: off)
- Check OCSP (checkbox, default: off)
- Check Interval (dropdown oder number, default: 6 hours — aber zeige die Optionen in dem Format das bestehende Check-Intervall-Konfigurationen verwenden)

Validierung:
- Hostname darf keine `https://` enthalten (nur der Hostname, kein Protokoll, kein Pfad). Wenn der Benutzer `https://api.example.com/path` eingibt, zeige eine Fehlermeldung: "Enter only the hostname, without protocol or path."
- Port muss 1-65535 sein
- Warning Days muss > Critical Days sein
- Critical Days muss >= 1 sein

**2. Zertifikat-Detail-Ansicht**

Wenn der Benutzer auf einen SSL-Check klickt (in der Service/Check-Liste), sieht er die normalen Check-Informationen (Status, letzte Prüfung, etc.) PLUS einen zusätzlichen Bereich mit Zertifikatsdetails.

Zeige die Zertifikatsdaten aus dem letzten Check-Ergebnis in einer übersichtlichen Karte:

```
Certificate Details
─────────────────────────────────────────
Subject:           api.example.com
Issuer:            R3 (Let's Encrypt)
Valid From:        2026-01-28
Valid Until:       2026-05-28 (62 days remaining)    ← farbig: grün >30d, gelb 14-30d, rot <14d
Serial:            04:A3:B2:C1:...

SANs:              api.example.com, *.example.com
Signature:         SHA-256 with RSA  ✓
Key:               RSA 2048 bit  ✓
Chain:             Valid (3 certificates)  ✓
Hostname Match:    ✓
OCSP:              Good  ✓                           ← nur wenn check_ocsp aktiviert
```

Verwende Häkchen (✓) für bestandene Prüfungen, Warnzeichen für Probleme, X für Fehler. Die Farbe des "days remaining" Textes soll den Ernst der Lage sofort vermitteln:
- Grün: > 30 Tage
- Gelb/Orange: 14-30 Tage
- Rot: < 14 Tage
- Dunkelrot/blinkend: Abgelaufen

**3. History-Chart**

Unter den Zertifikatsdetails: Ein Line Chart der "Days until expiry" über die letzten 6 Monate zeigt. Das erzeugt ein Sägezahn-Muster: die Tage gehen runter (Zertifikat altert), dann springt die Linie hoch (Zertifikat erneuert). Wenn die Linie nicht hochspringt und gegen Null geht, sieht der Benutzer sofort: die automatische Erneuerung hat versagt.

Verwende die bestehende Chart-Library des Projekts. X-Achse: Zeit, Y-Achse: Days until expiry. Horizontale gestrichelte Linien bei warning_days und critical_days zur Orientierung.

**Tests:**
1. Formular-Validierung: Hostname mit https:// wird abgelehnt
2. Warning Days > Critical Days wird erzwungen
3. Detail-Ansicht zeigt alle Zertifikatsdaten korrekt
4. Farbkodierung des Ablaufdatums stimmt (>30d grün, 14-30d gelb, <14d rot)
5. History-Chart rendert mit Testdaten

---

### 🔄 COMPACT — Nach Block 1.3

**Compact jetzt** (`/compact`).

**Was gebaut wurde bisher:**
- Go Agent: Neuer Check-Typ `ssl_certificate` (TLS-Verbindung, Cert-Daten extrahieren, Status-Logik)
- Backend: SSL Check-Ergebnis-Verarbeitung + Notification-Staffelung (30d/14d/7d/3d gestaffelt, Erneuerungserkennung)
- Frontend: SSL Check Config-Formular (Hostname, Port, Warning/Critical Days), Zertifikat-Detail-Ansicht mit allen Cert-Feldern + Farbkodierung, History-Chart (Days until expiry über Zeit)
- DB: Staffelung-Tracking via `last_cert_notification_stage`

---

## Block 1.4 — Notification Plugin System

**Projekt:** github.com/lukas5001/Overseer

**Lies zuerst:** Die bestehende Notification/Alert-Logik im Backend. Wie werden Alerts aktuell versendet? Welche Channels gibt es (Email, Webhook)? Wie ist die Konfiguration gespeichert? Lies auch die bestehende Datenbank-Struktur und API-Patterns.

**Aufgabe:** Baue ein erweiterbares Notification-Channel-System. Bestehende Email- und Webhook-Funktionalität muss danach genauso funktionieren wie vorher.

**Warum Plugin-System:**
Aktuell hat Overseer Email und Webhook. Wir wollen Slack, Teams, Telegram, PagerDuty, OpsGenie, SMS hinzufügen. Und in Zukunft weitere. Statt für jeden Channel den Core-Code zu ändern, soll jeder Channel ein eigenes Modul sein das automatisch erkannt wird.

**Architektur:**

```
notifications/
  base.py              # ABC + Datenklassen
  registry.py           # Auto-Discovery + Registry
  dispatcher.py         # Verteilt Notifications an Channels
  channels/
    __init__.py
    email.py            # bestehende Email-Logik hierhin migrieren
    webhook.py          # bestehende Webhook-Logik hierhin migrieren
    slack.py            # NEU (Block 1.5)
    teams.py            # NEU (Block 1.5)
    telegram.py         # NEU (Block 1.5)
```

**Base Class:**

```python
class NotificationChannel(ABC):
    """Jeder Channel muss diese Klasse implementieren."""

    @property
    @abstractmethod
    def channel_type(self) -> str:
        """Eindeutiger Typ-Name: 'slack', 'teams', 'email', etc."""
        ...

    @property
    @abstractmethod
    def display_name(self) -> str:
        """Anzeigename für die UI: 'Slack', 'Microsoft Teams', etc."""
        ...

    @property
    @abstractmethod
    def config_schema(self) -> dict:
        """JSON Schema das beschreibt welche Konfigurationsfelder der Channel braucht.
        Das Frontend nutzt dieses Schema um dynamisch ein Formular zu generieren."""
        ...

    @abstractmethod
    async def send(self, notification: Notification, channel_config: dict) -> SendResult:
        """Sende eine Notification. Muss NotificationResult zurückgeben mit success/failure."""
        ...

    async def validate_config(self, config: dict) -> list[str]:
        """Prüfe ob die Config gültig ist. Return: Liste von Fehlermeldungen (leer = OK)."""
        return []

    async def test_connection(self, config: dict) -> SendResult:
        """Sende eine Test-Notification. Default: send() mit Test-Daten aufrufen."""
        ...
```

**Notification Datenklasse:**
```python
@dataclass
class Notification:
    type: str           # 'alert', 'recovery', 'test'
    host_name: str
    host_ip: str
    service_name: str
    status: str         # 'ok', 'warning', 'critical', 'unknown'
    previous_status: str
    message: str        # Die Check-Ausgabe
    triggered_at: datetime
    duration: timedelta | None  # Wie lange der Alert schon aktiv ist
    tenant_name: str
    dashboard_url: str  # Deeplink zum Host/Service in Overseer
    alert_id: str | None
    # Zusätzliche Felder je nach Check-Typ (z.B. Zertifikatsdaten bei SSL)
    extra_data: dict | None = None
```

**Registry:**
Die Registry scannt beim Start das `channels/`-Verzeichnis und registriert alle Klassen die `NotificationChannel` implementieren. Neue Channels hinzufügen = neue Datei in `channels/` ablegen, fertig. Kein Core-Code ändern.

**Dispatcher:**
Der Dispatcher ist der zentrale Punkt der bei einem Alert aufgerufen wird:
1. Lade alle Notification-Channel-Konfigurationen die für diesen Alert relevant sind (basierend auf Alert Rule → Channel-Zuordnung)
2. Für jeden konfigurierten Channel: rufe `channel.send()` auf
3. Retry-Logik: Bei Fehler → 3 Versuche mit Backoff (5s, 30s, 60s)
4. Logging: Jeder Send-Versuch wird in einer `notification_log`-Tabelle protokolliert (Channel, Zeitpunkt, Erfolg/Fehler, Fehlermeldung)
5. Auto-Disable: Wenn ein Channel 5x hintereinander fehlschlägt (über verschiedene Alerts hinweg), wird er automatisch deaktiviert. Ein Event wird ausgelöst das den Tenant-Admin per Email informiert.

**Datenbank:**

```sql
-- Notification Channel Konfiguration
CREATE TABLE notification_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    channel_type VARCHAR(50) NOT NULL,     -- 'slack', 'teams', 'email', etc.
    name VARCHAR(255) NOT NULL,            -- Benutzer-definierter Name: "Slack #critical"
    config JSONB NOT NULL,                 -- Channel-spezifische Config (verschlüsselt wo nötig)
    enabled BOOLEAN DEFAULT true,
    consecutive_failures INTEGER DEFAULT 0,
    last_failure_at TIMESTAMPTZ,
    last_failure_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notification Log
CREATE TABLE notification_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    channel_id UUID REFERENCES notification_channels(id),
    channel_type VARCHAR(50) NOT NULL,
    notification_type VARCHAR(20) NOT NULL, -- 'alert', 'recovery', 'test'
    host_name VARCHAR(255),
    service_name VARCHAR(255),
    status VARCHAR(20),
    success BOOLEAN NOT NULL,
    error_message TEXT,
    sent_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_notification_log_tenant_time ON notification_log(tenant_id, sent_at DESC);
```

**Migration der bestehenden Email/Webhook-Logik:**
Die bestehende Email- und Webhook-Funktionalität muss in das neue System migriert werden. Erstelle `channels/email.py` und `channels/webhook.py` die die bestehende Logik wrappen. Nach der Migration müssen bestehende Konfigurationen weiterhin funktionieren — nichts darf kaputt gehen.

**API Endpoints:**

- `GET /api/notification-channels` — alle Channels des Tenants
- `POST /api/notification-channels` — neuen Channel erstellen
- `PUT /api/notification-channels/{id}` — Channel updaten
- `DELETE /api/notification-channels/{id}` — Channel löschen
- `POST /api/notification-channels/{id}/test` — Test-Notification senden
- `GET /api/notification-channels/types` — alle verfügbaren Channel-Typen mit config_schema (für dynamische Formulargenerierung im Frontend)
- `GET /api/notification-log` — Notification Log (paginiert, filterbar nach Channel, Status, Zeitraum)

**Zuordnung zu Alert Rules:**

Die bestehenden Alert Rules brauchen ein neues Feld: `notification_channel_ids` (Array von Channel-IDs). Wenn ein Alert ausgelöst wird, sendet der Dispatcher an alle zugeordneten Channels. Erweitere das Alert-Rule-Schema und die API entsprechend.

Wenn eine Alert Rule KEINE Channel-IDs hat → Fallback auf alle aktivierten Channels des Tenants (Abwärtskompatibilität).

**Tests:**
1. Registry entdeckt automatisch alle Channel-Klassen
2. Dispatcher sendet an alle konfigurierten Channels
3. Retry-Logik: Channel schlägt fehl → 3 Versuche → danach als failed geloggt
4. Auto-Disable: 5 aufeinanderfolgende Fehler → Channel disabled
5. Auto-Disable Reset: Erfolgreicher Send nach Fehler → consecutive_failures zurück auf 0
6. Bestehende Email/Webhook-Funktionalität funktioniert nach Migration identisch
7. API CRUD Endpoints funktionieren korrekt
8. Test-Endpoint sendet Test-Notification
9. Notification Log wird korrekt geschrieben

**Achtung:**
- Bestehende Email/Webhook-Konfigurationen dürfen NICHT verloren gehen. Schreibe eine Datenmigration die bestehende Configs in die neue `notification_channels`-Tabelle überführt.
- Channel-Configs können sensible Daten enthalten (API Tokens, Webhooks). Nutze das bestehende Encryption-System (Field-Level Encryption, AES-256-GCM) für sensible Felder in der JSONB-Config.
- Der Dispatcher muss asynchron arbeiten — Notifications dürfen den Check-Verarbeitungs-Flow nicht blockieren. Wenn ein Channel 30 Sekunden braucht (Timeout), darf das nicht den nächsten Channel aufhalten.

---

### 🔄 COMPACT — Nach Block 1.4

**Compact jetzt** (`/compact`).

**Was gebaut wurde bisher:**
- SSL Certificate Check komplett (Go + Backend + Frontend)
- Notification Plugin System: ABC `NotificationChannel` in `notifications/base.py`, Auto-Discovery Registry in `notifications/registry.py`, Dispatcher mit Retry + Auto-Disable in `notifications/dispatcher.py`
- DB-Tabellen: `notification_channels` (config JSONB, consecutive_failures, enabled), `notification_log` (success/failure tracking)
- API: CRUD `/api/notification-channels`, Test-Endpoint, `/api/notification-channels/types` (liefert config_schema pro Typ)
- Bestehende Email+Webhook migriert nach `notifications/channels/email.py` und `webhook.py`
- Alert Rules erweitert um `notification_channel_ids`

---

## Block 1.5 — Channel-Implementierungen: Slack, Teams, Telegram

**Projekt:** github.com/lukas5001/Overseer

**Lies zuerst:** Das Notification Plugin System im Backend: `notifications/base.py` (ABC NotificationChannel), `notifications/registry.py` (Auto-Discovery), `notifications/channels/email.py` und `webhook.py` (als Pattern-Vorlage). Lies auch die `Notification` Datenklasse in `base.py`.

**Aufgabe:** Implementiere drei neue Notification Channels: Slack, Microsoft Teams, Telegram.

### Slack (`channels/slack.py`)

**Config-Schema (was der Benutzer konfiguriert):**
- `webhook_url` (string, required): Die Slack Webhook URL
- `channel` (string, optional): Channel-Override (#channel-name)
- `username` (string, optional, default: "Overseer"): Bot-Anzeigename
- `icon_emoji` (string, optional, default: ":warning:"): Bot-Icon

**Nachrichtenformat:**

Alert-Nachricht als Slack Block Kit (JSON Blocks, nicht Plain Text):

```
🔴 CRITICAL: CPU Usage on web-prod-01

Service:    cpu_check
Value:      98.2%
Threshold:  > 90%
Duration:   5 minutes
Since:      2026-03-27 14:23 CET

Host:       web-prod-01 (10.0.1.15)
Tenant:     Acme Corp

[View in Overseer]
```

- Severity-Emoji: 🔴 CRITICAL, 🟠 WARNING, ✅ OK/RECOVERED, 🔵 INFO
- "View in Overseer" ist ein Button/Link der zum Host/Service in Overseer führt
- Recovery-Nachrichten sind kürzer: "✅ RECOVERED: CPU Usage on web-prod-01 — Was critical for 23 minutes. Current value: 42.1%"

**Implementierungsdetails:**
- Verwende `httpx` (async) für den HTTP POST, nicht `slack-sdk` (unnötige Dependency für reines Webhook)
- Payload-Format: Slack Block Kit `{"blocks": [...]}` — nicht das alte `{"text": "..."}` Format
- Timeout: 10 Sekunden
- Bei HTTP 429 (Rate Limit): Retry-After Header beachten

### Microsoft Teams (`channels/teams.py`)

**Config-Schema:**
- `webhook_url` (string, required): Die Teams Workflow/Webhook URL
- `title_prefix` (string, optional): Prefix für den Titel, z.B. "[Production]"

**Nachrichtenformat:**

Teams verwendet Adaptive Cards. Das Payload-Format:
```json
{
  "type": "message",
  "attachments": [{
    "contentType": "application/vnd.microsoft.card.adaptive",
    "content": {
      "type": "AdaptiveCard",
      "version": "1.4",
      "body": [
        {"type": "TextBlock", "text": "🔴 CRITICAL: CPU Usage on web-prod-01", "size": "medium", "weight": "bolder"},
        {"type": "FactSet", "facts": [
          {"title": "Service", "value": "cpu_check"},
          {"title": "Value", "value": "98.2%"},
          {"title": "Host", "value": "web-prod-01 (10.0.1.15)"}
        ]},
        {"type": "TextBlock", "text": "Since: 2026-03-27 14:23 CET", "isSubtle": true}
      ],
      "actions": [
        {"type": "Action.OpenUrl", "title": "View in Overseer", "url": "https://..."}
      ]
    }
  }]
}
```

**Implementierungsdetails:**
- Verwende `httpx` (async)
- Teams Rate Limits: Max 4 req/s — implementiere einfaches Rate Limiting (sleep zwischen Sends wenn nötig)
- Timeout: 15 Sekunden (Teams Webhooks sind manchmal langsam)

### Telegram (`channels/telegram.py`)

**Config-Schema:**
- `bot_token` (string, required): Telegram Bot Token von @BotFather
- `chat_id` (string, required): Die Chat-ID (User, Group, oder Channel)

**Nachrichtenformat:**

Telegram unterstützt Markdown (MarkdownV2). Format:

```
🔴 *CRITICAL: CPU Usage on web\-prod\-01*

*Service:* cpu\_check
*Value:* 98\.2%
*Threshold:* > 90%
*Duration:* 5 minutes
*Since:* 2026\-03\-27 14:23 CET

*Host:* web\-prod\-01 \(10\.0\.1\.15\)

[View in Overseer](https://overseer.example.com/...)
```

**Implementierungsdetails:**
- Verwende `httpx` direkt gegen die Telegram Bot API: `POST https://api.telegram.org/bot{token}/sendMessage`
- `parse_mode: "MarkdownV2"` — ACHTUNG: MarkdownV2 erfordert Escaping von speziellen Zeichen (`.`, `-`, `(`, `)`, `!`, etc.). Baue eine Helper-Funktion `escape_markdown_v2(text)` die das korrekt macht.
- Timeout: 10 Sekunden
- Für den Test-Endpoint: Sende eine einfache Testnachricht an die konfigurierte chat_id

**Für alle drei Channels:**

- `validate_config()`: Prüfe ob die erforderlichen Felder vorhanden sind und grundsätzlich das richtige Format haben (z.B. Slack Webhook URL beginnt mit `https://hooks.slack.com/` oder `https://discord.com/api/webhooks/`, Telegram Token hat das Format `123456:ABC-DEF`)
- `test_connection()`: Sende eine Test-Nachricht: "This is a test notification from Overseer. If you see this, your notification channel is configured correctly. ✅"
- Jeder Channel muss mit der `Notification`-Datenklasse aus `base.py` arbeiten

**Tests:**
1. Slack: Nachricht wird korrekt als Block Kit formatiert
2. Slack: Severity-Emoji stimmt (critical=rot, warning=orange, recovery=grün)
3. Teams: Adaptive Card Payload ist valides JSON und enthält alle Felder
4. Telegram: MarkdownV2 Escaping funktioniert (teste mit Sonderzeichen im Hostname: `web-01.example.com`)
5. Telegram: Bot Token Validierung
6. Alle Channels: `validate_config()` erkennt fehlende Pflichtfelder
7. Alle Channels: `test_connection()` generiert eine valide Test-Nachricht
8. Alle Channels: Timeout wird eingehalten

**Achtung:**
- Telegram MarkdownV2 Escaping ist der häufigste Bug. Teste mit Hostnamen die `-`, `.`, `_`, `(`, `)` enthalten.
- Slack Block Kit hat ein Limit von 50 Blocks pro Nachricht. Für gruppierte Alerts (kommt in Block 1.7) muss man bei vielen Alerts die Liste kürzen: "... and 15 more alerts".
- Keine externen SDKs wenn nicht nötig. `httpx` reicht für alle drei Channels. Das spart Dependencies und Maintenance.

---

### 🔄 COMPACT — Nach Block 1.5

**Compact jetzt** (`/compact`).

**Was gebaut wurde bisher:**
- SSL Certificate Check komplett
- Notification Plugin System mit Registry, Dispatcher, Retry, Auto-Disable
- Channel-Implementierungen: `notifications/channels/slack.py` (Block Kit, httpx), `teams.py` (Adaptive Cards), `telegram.py` (MarkdownV2 + escape). Alle verwenden `httpx` async, kein externes SDK.
- DB: `notification_channels`, `notification_log`. API: CRUD + Test + Types-Endpoint
- Nachrichtenformat: Severity-Emoji (🔴/🟠/✅), Host/Service/Value/Threshold Felder, "View in Overseer" Link
- Alert Rules haben `notification_channel_ids` Feld

---

## Block 1.6 — Notification Frontend: Channel-Verwaltung

**Projekt:** github.com/lukas5001/Overseer

**Lies zuerst:** Die bestehende Frontend-Architektur (Routing, Components, State Management, API-Call-Patterns). Lies auch die API Endpoints: `GET/POST/PUT/DELETE /api/notification-channels`, `POST /api/notification-channels/{id}/test`, `GET /api/notification-channels/types` (liefert verfügbare Channel-Typen mit JSON config_schema pro Typ für dynamische Formular-Generierung).

**Aufgabe:** Baue die UI für Notification-Channel-Verwaltung.

**Theming:** Alle Farben via CSS Custom Properties. Wenn in diesem Projekt noch keine Theme-Variablen existieren, erstelle jetzt eine zentrale Stelle (CSS-Datei oder Theme-Config) wo Farben definiert werden. Alle neuen Komponenten nutzen diese Variablen.

**1. Channel-Liste (Settings → Notification Channels)**

Eine Tabelle/Liste aller konfigurierten Channels:

| Name | Type | Status | Last Used | Actions |
|------|------|--------|-----------|---------|
| Slack #critical | Slack | ✅ Active | 2h ago | Test · Edit · Delete |
| Teams Ops | Microsoft Teams | ✅ Active | 1d ago | Test · Edit · Delete |
| SMS Emergency | Telegram | ❌ Disabled (5 failures) | 3d ago | Test · Edit · Enable · Delete |

- Status zeigt "Active" in grün oder "Disabled" in rot mit dem Grund
- "Last Used" zeigt wann die letzte erfolgreiche Notification gesendet wurde
- "Test" Button sendet sofort eine Test-Notification und zeigt das Ergebnis inline: "✅ Test sent successfully" oder "❌ Failed: 401 Unauthorized"

Oben rechts: "+ Add Channel" Button.

**2. Channel hinzufügen/bearbeiten**

Klick auf "+ Add Channel" → Dialog oder eigene Seite:

**Schritt 1:** Channel-Typ auswählen. Zeige alle verfügbaren Typen als Kacheln mit Icon und Name. Die Typen kommen vom `/api/notification-channels/types` Endpoint.

**Schritt 2:** Konfigurationsformular. Das Formular wird **dynamisch aus dem config_schema** des gewählten Channel-Typs generiert. Das heißt: Das Frontend muss ein JSON Schema in Formularfelder übersetzen können. Jedes Feld im Schema → ein Formularfeld. Typen: string → Textfeld, boolean → Checkbox, number → Nummernfeld. Felder mit `format: "password"` → Passwort-Feld (Wert verdeckt).

Zusätzlich:
- Name (Freitext, required): z.B. "Slack #critical-alerts"

**Schritt 3:** Speichern → API Call → Channel wird erstellt.

Danach: Automatisch den "Test" Button anbieten: "Channel created. Send a test notification?"

**3. Channel-Zuordnung in Alert Rules**

Die bestehende Alert-Rule-Erstellungs/Bearbeitungs-UI muss erweitert werden um ein Feld "Notification Channels":
- Multi-Select Dropdown mit allen aktivierten Channels des Tenants
- Default: Alle Channels ausgewählt (oder leer = an alle senden, je nach Backend-Logik)
- Label: "Send notifications to"

**4. Notification Log**

Eine neue Seite unter Settings → Notification Log.

Tabelle mit Spalten:
- Zeitpunkt
- Channel (Name + Typ-Icon)
- Type (Alert / Recovery / Test)
- Host + Service
- Status (✅ Sent / ❌ Failed)
- Fehlermeldung (nur bei Failed, als expandierbares Detail)

Filter:
- Zeitraum (letzte 24h, 7d, 30d)
- Channel
- Status (Alle, Nur Fehler)

Paginierung: 50 pro Seite.

**Tests:**
1. Channel-Liste lädt und zeigt alle Channels korrekt
2. Neuer Channel erstellen → Formular-Validierung → Speichern → erscheint in der Liste
3. Test-Button sendet Test-Notification und zeigt Ergebnis
4. Channel bearbeiten → Werte werden vorausgefüllt → Speichern aktualisiert den Channel
5. Channel löschen → Bestätigungsdialog → Channel verschwindet aus der Liste
6. Disabled Channel zeigt den Grund und hat einen "Enable" Button
7. Dynamische Formular-Generierung: verschiedene config_schemas erzeugen verschiedene Formulare
8. Notification Log zeigt Einträge korrekt, Filter funktionieren
9. Alert Rule Editor zeigt Channel-Auswahl

**Achtung:**
- Passwörter/Tokens im Config-Formular: Beim Bearbeiten eines Channels kommt das Passwort/Token NICHT vom Server zurück (Sicherheit). Zeige stattdessen "••••••••" und erlaube es nur zu überschreiben. Wenn das Feld nicht geändert wird, sende es nicht mit im PUT Request.
- Der "Test" Button muss während des Sendens einen Loading-Zustand zeigen (nicht doppelt klicken möglich).

---

### 🔄 COMPACT — Nach Block 1.6

**Compact jetzt** (`/compact`).

**Was gebaut wurde bisher:**
- SSL Certificate Check komplett (Go + Backend + Frontend)
- Notification Plugin System komplett (Backend: Plugin ABC, Registry, Dispatcher mit Retry/Auto-Disable; Channels: Email, Webhook, Slack, Teams, Telegram)
- Notification Frontend: Channel-Liste mit Status, Add/Edit/Delete/Test, dynamisches Config-Formular aus JSON Schema, Notification Log Seite, Channel-Zuordnung in Alert Rules
- DB: `notification_channels`, `notification_log`

---

## Block 1.7 — Alert Grouping

**Projekt:** github.com/lukas5001/Overseer

**Lies zuerst:** Die bestehende Alert-Verarbeitungslogik im Backend (Worker, Alert-Erstellung). Lies den Notification Dispatcher (`notifications/dispatcher.py`) — die Grouping-Logik wird ZWISCHEN Alert-Erkennung und Dispatcher eingebaut. Lies auch die Redis-Konfiguration.

**Aufgabe:** Implementiere Alert Grouping — Alerts mit gleichen Eigenschaften werden zu einer einzigen Notification gebündelt statt einzeln gesendet.

**Das Problem das gelöst wird:**

Ein Switch fällt aus. 10 Server dahinter sind unreachable. Auf jedem laufen 5 Services. Ohne Grouping: 60 Notifications in 30 Sekunden. Mit Grouping: Eine Notification: "3 problems on web-01, 2 problems on db-01, ..."

**Konfiguration (global pro Tenant):**

In den Tenant-Settings (oder ein neuer Bereich Settings → Alert Policies → Grouping):

- **Group By** (Dropdown): `host` (Default) | `host + severity` | `service_template`
  - `host`: Alle Alerts desselben Hosts werden gebündelt. Ergebnis: "3 problems on web-01: CPU critical, Disk warning, Memory warning"
  - `host + severity`: Getrennt nach Host UND Severity. Ergebnis: Separate Notifications für Criticals und Warnings desselben Hosts
  - `service_template`: Alle Alerts des gleichen Check-Typs über alle Hosts. Ergebnis: "5 hosts have disk_usage warnings"

- **Group Wait** (Sekunden, Default: 30): Nach dem ersten Alert einer neuen Gruppe, warte so lange bevor die erste Notification gesendet wird. In dieser Zeit sammeln sich weitere Alerts in der Gruppe.
  - UI-Hilfetext: "Wait this long before sending the first notification for a group. Alerts arriving during this window will be bundled."

- **Group Interval** (Sekunden, Default: 300): Minimale Zeit zwischen zwei Notifications für dieselbe Gruppe. Wenn neue Alerts zu einer bestehenden Gruppe kommen, wird maximal alle X Sekunden ein Update gesendet.
  - UI-Hilfetext: "Minimum time between updates for the same group."

- **Repeat Interval** (Sekunden, Default: 14400 = 4h): Wie lange bis eine Notification erneut gesendet wird wenn der Alert immer noch aktiv ist und niemand reagiert hat.
  - UI-Hilfetext: "Re-send the notification if alerts are still active and not acknowledged."

**Backend-Logik:**

```
Alert kommt rein
  → Berechne Group Key: z.B. "host:web-01" (bei group_by=host)
  → Ist die Gruppe neu?
    JA:
      → Erstelle neue Gruppe
      → Starte Timer (group_wait Sekunden)
      → Wenn Timer abläuft: Sende gebündelte Notification mit allen Alerts die sich in der Zwischenzeit angesammelt haben
    NEIN (Gruppe existiert bereits):
      → Füge Alert zur Gruppe hinzu
      → Ist group_interval seit letztem Send vergangen?
        JA: Sende Update-Notification ("2 new alerts added to group")
        NEIN: Nichts senden, Alert ist in der Gruppe gespeichert und wird beim nächsten Update mitgesendet
```

**Gruppierte Notification (Format):**

Wenn die Gruppe gesendet wird, sieht die Nachricht so aus (Beispiel Slack):

```
🔴 3 problems on web-prod-01

CRITICAL  cpu_check      CPU at 98.2% (> 90%)              Since 14:23
WARNING   disk_check     Disk /data at 88% (> 85%)         Since 14:20
WARNING   memory_check   Memory at 82.4% (> 80%)           Since 14:22

[View Host in Overseer]  [Acknowledge All]
```

Wenn die Gruppe mehr als 10 Alerts hat, zeige die 10 mit der höchsten Severity und dann: "... and 5 more alerts."

**Recovery in Gruppen:**
Wenn ein Alert in einer Gruppe recovered:
- Wenn es der einzige Alert war → Recovery-Notification für die Gruppe
- Wenn andere Alerts noch aktiv sind → Update-Notification (unterliegt group_interval): "1 of 3 problems on web-01 resolved: disk_check recovered."
- Wenn alle Alerts recovered → Recovery-Notification: "All problems on web-01 resolved."

**State Management:**
Der Grouper-State (aktive Gruppen, Timer) muss persistiert werden weil der Server neustarten könnte:
- Option A: Redis (HSET für Gruppen, Timer als Redis TTL-basierte Jobs)
- Option B: PostgreSQL Tabelle + APScheduler für Timer
- Empfehlung: Redis da bereits im Stack und für solche kurzlebigen States ideal

**Frontend:**

1. **Settings-Seite** für Grouping-Konfiguration (die 4 Felder oben)
2. **Alert-Ansicht anpassen**: Gruppierte Alerts sollten in der Alert-Liste zusammen angezeigt werden. Zeige eine Gruppe als eine erweiterbare Zeile: Klick → klappt die einzelnen Alerts auf.

**Tests:**
1. Zwei Alerts desselben Hosts innerhalb von group_wait → eine Notification mit beiden
2. Alert kommt nach group_wait → eigene neue Gruppe, eigene Notification
3. Dritter Alert kommt zu bestehender Gruppe, aber group_interval ist noch nicht abgelaufen → keine neue Notification
4. group_interval läuft ab → Update-Notification wird gesendet
5. repeat_interval: Alert ist 4h aktiv, nicht acknowledged → Re-Notification
6. Recovery eines von drei Alerts → Update-Notification
7. Recovery aller Alerts → finale Recovery-Notification
8. Server-Neustart: Gruppen-State wird aus Redis wiederhergestellt
9. Verschiedene group_by Konfigurationen erzeugen verschiedene Gruppierungen

**Achtung:**
- Der group_wait Timer ist KRITISCH. Wenn er zu früh feuert (Timing Bug), bekommt man einzelne Notifications statt gebündelter. Wenn er nie feuert, bekommt man gar keine Notifications. Teste das sorgfältig.
- Race Condition: Zwei Alerts kommen gleichzeitig rein für denselben Host. Beide prüfen "Gruppe existiert?" → Nein. Beide erstellen eine neue Gruppe. → Zwei Notifications statt einer. Verwende Redis SETNX oder einen Lock um das zu verhindern.
- Die Grouping-Logik sitzt ZWISCHEN der Alert-Erkennung und dem Notification-Dispatch. Sie ersetzt den direkten Dispatch, sie kommt nicht zusätzlich dazu.

---

### 🔄 COMPACT — Nach Block 1.7 (Ende Phase 1)

**Compact jetzt** (`/compact`).

**Was in Phase 1 gebaut wurde:**
- SSL Certificate Check komplett (Go Check-Typ `ssl_certificate`, Backend Staffelung 30d/14d/7d/3d, Frontend Detail-Ansicht + History-Chart)
- Notification Plugin System (ABC, Registry, Dispatcher mit Retry/Auto-Disable, DB: `notification_channels` + `notification_log`)
- Channels: Slack (Block Kit), Teams (Adaptive Cards), Telegram (MarkdownV2) — alle via httpx
- Notification Frontend (Channel CRUD, Test, dynamisches Config-Formular, Log-Seite, Alert-Rule-Integration)
- Alert Grouping (AlertGrouper mit group_by/group_wait/group_interval/repeat_interval, Redis State, Grouped Notification Format, Frontend Config + grouped Alert-Ansicht)

---
---

# PHASE 2: Custom Dashboards

---

## Block 2.1 — Dashboard Grundgerüst: Datenbank + API + Grid

**Projekt:** github.com/lukas5001/Overseer

**Lies zuerst:**
1. Die gesamte Frontend-Architektur: Routing, Component-Patterns, State Management, API-Call-Patterns
2. Die bestehende Datenbank-Struktur (alle Tabellen, besonders `tenants`, `hosts`, `services`, und wo/wie Metrikdaten gespeichert werden)
3. Die bestehende API-Struktur (Endpoint-Patterns, Auth, Tenant-Isolation)
4. CLAUDE.md im Projekt-Root für Konventionen und Architektur-Entscheidungen

**Kontext:** Overseer hat aktuell Mini-Graphs und eine Error-Übersicht. Es gibt keine frei konfigurierbaren Dashboards. Dieses Feature ist das größte UI-Feature des gesamten Plans.

**Aufgabe:** Erstelle die Grundstruktur für Custom Dashboards: Datenbank-Schema, API-Endpoints, und das Grid-Layout im Frontend.

### Datenbank

```sql
CREATE TABLE dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    config JSONB NOT NULL DEFAULT '{}',  -- Widgets, Layout, Variables, Time Settings
    is_default BOOLEAN DEFAULT false,    -- Ein Dashboard pro Tenant ist das Default/Start-Dashboard
    is_shared BOOLEAN DEFAULT false,
    share_token VARCHAR(64) UNIQUE,
    share_expires_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, title)
);

CREATE TABLE dashboard_versions (
    id SERIAL PRIMARY KEY,
    dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    config JSONB NOT NULL,
    changed_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Die `config` JSONB Spalte enthält ALLES: Widget-Definitionen, Layout-Positionen, Variablen, Time-Settings. Ein Dashboard ist ein einzelnes JSON-Dokument. Kein Normalisieren in separate Widget-Tabellen — das macht die API einfacher und das Laden schneller.

### API Endpoints

- `GET /api/dashboards` — Alle Dashboards des Tenants (ohne `config`, nur id, title, description, is_default, created_at, updated_at)
- `GET /api/dashboards/{id}` — Ein Dashboard mit vollständiger `config`
- `POST /api/dashboards` — Neues Dashboard erstellen (Body: title, description, optional config)
- `PUT /api/dashboards/{id}` — Dashboard updaten (ganzes config-Objekt)
- `PATCH /api/dashboards/{id}` — Partielles Update (z.B. nur Layout ändern, nur Title ändern)
- `DELETE /api/dashboards/{id}` — Dashboard löschen (nicht erlaubt für is_default=true)
- `POST /api/dashboards/{id}/share` — Share-Token generieren, Body: `{expires_in_days: 30}`
- `DELETE /api/dashboards/{id}/share` — Share-Token widerrufen
- `GET /api/public/dashboards/{share_token}` — Dashboard ohne Auth laden (Public)
- `GET /api/dashboards/{id}/versions` — Versionshistorie
- `POST /api/dashboards/{id}/restore/{version}` — Version wiederherstellen

Bei jedem Save (`PUT`/`PATCH`): Automatisch neue Version in `dashboard_versions` anlegen. Maximal 50 Versionen pro Dashboard behalten, älteste löschen.

### Frontend: Dashboard-Liste

Neuer Menüpunkt "Dashboards" in der Hauptnavigation.

Die Dashboard-Liste zeigt Kacheln:
```
┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
│  Overview           │ │  Network Devices     │ │  + New Dashboard    │
│  Default Dashboard  │ │  Updated 2h ago      │ │                     │
│  Updated just now   │ │  by lukas            │ │                     │
└─────────────────────┘ └─────────────────────┘ └─────────────────────┘
```

"+ New Dashboard" Kachel → Dialog: Titel + Beschreibung eingeben → Dashboard wird erstellt → Redirect zum neuen Dashboard im Edit-Modus.

### Frontend: Dashboard-Ansicht mit Grid

Installiere `react-grid-layout` (npm Paket).

Das Dashboard hat zwei Modi:

**View-Modus (Default):**
- Widgets zeigen Daten an
- Kein Drag/Drop
- Oben: Dashboard-Titel, Time-Range-Picker (rechts), Buttons: Edit, Share
- Widgets aktualisieren sich automatisch (alle 30 Sekunden, konfigurierbar)

**Edit-Modus (nach Klick auf "Edit"):**
- Grid-Rasterlinien werden sichtbar
- Widgets sind draggable und resizable
- Jedes Widget hat oben rechts: Konfigurieren (Zahnrad), Löschen (X)
- Floating Button unten rechts: "+ Add Widget"
- Toolbar oben: "Save" (grün), "Discard" (grau), "Settings" (Zahnrad)
- Save speichert das Layout + Config an die API
- Discard verwirft alle Änderungen und lädt den letzten gespeicherten Stand

**Grid-Konfiguration:**
- 24 Spalten
- Row-Height: 30px
- Breakpoints: lg (1200px+), md (996px+), sm (768px+)
- Jedes Widget hat `minW`, `minH` um zu verhindern dass Widgets zu klein werden (Charts unlesbar)
- Collision Detection: Widgets können nicht überlappen

**Config JSON Struktur:**

```json
{
  "schemaVersion": 1,
  "timeSettings": {
    "from": "now-1h",
    "to": "now",
    "refreshInterval": 30
  },
  "widgets": {
    "widget-1": {
      "type": "stat",
      "title": "Total Hosts",
      "dataSource": { ... },
      "options": { ... }
    }
  },
  "layout": {
    "lg": [
      {"i": "widget-1", "x": 0, "y": 0, "w": 6, "h": 4, "minW": 3, "minH": 3}
    ]
  }
}
```

### Default Dashboard

Wenn ein Tenant noch keine Dashboards hat: Erstelle automatisch ein "Overview" Dashboard mit:
- 1 Stat Widget: "Hosts Total"
- 3 Stat Widgets nebeneinander: "OK", "Warning", "Critical" (Anzahl Services pro Status, farbcodiert)
- Placeholder für weitere Widgets

Dieses Default Dashboard dient als Demonstration des Systems und als Startpunkt. Es ist editierbar aber nicht löschbar.

### Time-Range Picker

Oben rechts im Dashboard. Zwei Teile:
1. **Quick Ranges** (Buttons): 15min, 1h, 6h, 24h, 7d, 30d
2. **Auto-Refresh** (Dropdown): Off, 10s, 30s, 1min, 5min

Die gewählte Time Range wird in der URL gespeichert (`?from=now-1h&to=now`) damit Links mit Time Range geteilt werden können.

Alle Widgets nutzen diese Time Range, es sei denn ein Widget hat eine eigene.

**Tests:**
1. Dashboard CRUD via API funktioniert (erstellen, lesen, updaten, löschen)
2. Tenant-Isolation: Tenant A sieht nicht die Dashboards von Tenant B
3. Default Dashboard wird für neuen Tenant automatisch erstellt
4. Default Dashboard kann nicht gelöscht werden
5. Versionierung: Nach Save existiert eine neue Version in `dashboard_versions`
6. Frontend: Dashboard-Liste lädt und zeigt alle Dashboards
7. Frontend: Neues Dashboard erstellen → Redirect zum Dashboard
8. Frontend: Edit-Modus → Widgets können gedraggt und resized werden
9. Frontend: Save speichert das Layout korrekt → Reload → Layout ist gleich
10. Frontend: Discard verwirft Änderungen
11. Time-Range-Picker ändert die URL und alle Widgets bekommen die neue Range

**Achtung:**
- react-grid-layout muss das CSS importiert werden (`react-grid-layout/css/styles.css` und `react-resizable/css/styles.css`). Ohne das CSS funktioniert Drag/Drop nicht.
- Die `config` JSONB Spalte hat kein festes Schema in der DB. Die Validierung passiert im Backend-Code (Pydantic Model).
- Noch KEINE Widgets mit echten Daten in diesem Block. Nur die Grid-Infrastruktur. Echte Widgets kommen in Block 2.2.

---

### 🔄 COMPACT — Nach Block 2.1

**Compact jetzt** (`/compact`).

**Was gebaut wurde:** Dashboard-Grundgerüst. DB: `dashboards` (config JSONB, share_token) + `dashboard_versions`. API: CRUD `/api/dashboards`, Versionierung, Share-Token. Frontend: Dashboard-Liste als Kacheln, Dashboard-Ansicht mit react-grid-layout (24-Spalten Grid), Edit/View Modus Toggle, Time Range Picker mit URL-Sync, Auto-Refresh. Default "Overview" Dashboard wird pro Tenant auto-erstellt. Config-Struktur: `{schemaVersion, timeSettings, widgets, layout}`.

---

## Block 2.2 — Widget-System + Erste Widgets

**Projekt:** github.com/lukas5001/Overseer

**Lies zuerst:** Den Dashboard-Code: DB Schema (`dashboards`, `dashboard_versions`), API Endpoints (`/api/dashboards`), Frontend Grid (react-grid-layout). Lies auch wie Metrik-Daten in der Datenbank gespeichert sind und wie die bestehende API sie ausliefert. Lies die Dashboard Config JSON-Struktur in der `config` JSONB Spalte.

**Aufgabe:** Baue das Widget-Framework und implementiere die ersten 4 Widget-Typen: Stat, Gauge, Line Chart, Table.

### Widget-Framework

**Widget Registry (Frontend):**
Jeder Widget-Typ ist eine React-Komponente die ein Standard-Interface implementiert:

```typescript
interface WidgetProps {
  config: WidgetConfig;       // Widget-spezifische Konfiguration
  timeRange: TimeRange;       // Dashboard Time Range
  variables: Record<string, string[]>;  // Dashboard Variables (kommt später)
  isEditing: boolean;         // true im Edit-Modus
  onConfigChange: (config: WidgetConfig) => void;
}

interface WidgetType {
  type: string;              // 'stat', 'gauge', 'line_chart', 'table'
  displayName: string;       // 'Single Value', 'Gauge', etc.
  icon: ReactNode;           // Icon für den Widget-Picker
  defaultSize: { w: number; h: number };  // Default Grid-Größe
  minSize: { w: number; h: number };
  component: React.FC<WidgetProps>;
  configComponent: React.FC<WidgetConfigProps>;  // Config-Dialog Inhalt
}
```

Neue Widget-Typen registrieren = ein neues Objekt in die Registry eintragen + eine Komponente schreiben. Kein Core-Code ändern.

**Widget-Picker (UI):**
Im Edit-Modus: Button "+ Add Widget" → Slide-Over Panel von rechts:

Zeigt alle registrierten Widget-Typen als Kacheln:
```
📊 Line Chart        📈 Stat / Single Value
   Time series data     Current metric value

📉 Gauge             📋 Table
   Value with range     Tabular data
```

Klick auf einen Typ → Widget wird ins Grid eingefügt an der nächsten freien Position → Config-Dialog öffnet sich automatisch.

**Widget Config Dialog:**
Öffnet sich als Slide-Over oder Modal. Hat immer mindestens zwei Tabs:

Tab "Data": Was wird angezeigt?
- Metrik auswählen (Dropdown, gefüllt aus `/api/metrics/names` oder ähnlich — welche Metriken existieren für diesen Tenant)
- Host filtern (Dropdown aller Hosts, oder "All")
- Service filtern (Dropdown, gefiltert nach gewähltem Host)
- Aggregation (Last, Avg, Min, Max, Sum)

Tab "Display": Wie wird es angezeigt?
- Titel (Freitext, Default: auto-generiert aus Metrik + Host)
- Unit (Dropdown: Percent, Bytes, Milliseconds, Count, Custom)
- Dezimalstellen (0, 1, 2)
- Thresholds (für Gauge/Stat): Wertebereiche mit Farben

Jede Änderung im Config-Dialog aktualisiert das Widget **sofort live** im Hintergrund (optimistisches Update, kein "Apply" Button nötig — oder "Apply" Button der den Effekt zeigt ohne den Dialog zu schließen).

### Data Layer: Metriken-API für Widgets

Widgets brauchen eine API die Metriken basierend auf einem Query liefert. Erstelle einen Endpoint:

`POST /api/dashboards/query`
```json
{
  "metric_names": ["cpu_usage"],
  "host_ids": [123],         // optional, null = alle
  "service_ids": [456],      // optional
  "from": "2026-03-27T13:00:00Z",
  "to": "2026-03-27T14:00:00Z",
  "aggregation": "avg",      // avg, min, max, last, sum
  "interval": "5m"           // Aggregations-Intervall für Time Series, null = einzelner Wert
}
```

Response:
```json
{
  "series": [
    {
      "metric": "cpu_usage",
      "host": "web-01",
      "data": [
        {"time": "2026-03-27T13:00:00Z", "value": 42.3},
        {"time": "2026-03-27T13:05:00Z", "value": 45.1}
      ]
    }
  ]
}
```

Wenn `interval` null ist: Liefere einen einzelnen aggregierten Wert (für Stat/Gauge Widgets).
Wenn `interval` gesetzt: Liefere Zeitreihen-Daten (für Line Chart Widgets).

### Widget-Implementierungen

**1. Stat Widget** — Zeigt einen einzelnen großen Wert.
- Anzeige: Große Zahl zentriert, darunter der Titel, optional: Sparkline (kleiner Mini-Chart der letzten Stunde)
- Farbkodierung: Wenn Thresholds konfiguriert → Hintergrundfarbe oder Zahlenfarbe wechselt je nach Wert
- Beispiel: "42.3%" in Grün, oder "98.2%" in Rot
- Wenn kein Wert vorhanden: "N/A" in Grau

**2. Gauge Widget** — Halbrunder Tachometer.
- Verwende ECharts (echarts-for-react) für das Gauge
- Konfigurierbar: Min, Max, Thresholds mit Farben
- Beispiel: Halbkreis von 0-100%, grüner Bereich 0-70, gelb 70-90, rot 90-100, Nadel bei 42%
- Zeigt den aktuellen Wert als große Zahl unter dem Gauge

**3. Line Chart Widget** — Zeitreihen.
- Verwende ECharts für Performance
- X-Achse: Zeit, Y-Achse: Wert
- Smooth Line, keine Symbole (Datenpunkte), Animation deaktiviert (für Echtzeit)
- Scroll-to-Zoom aktiviert (ECharts `dataZoom: [{type: 'inside'}]`)
- Legende zeigt Metrik-Name + Host
- Mehrere Serien im gleichen Chart möglich (z.B. CPU von 3 Hosts übereinander)
- Konfigurierbar: Stacked ja/nein, Fill/Line, Farben

**4. Table Widget** — Tabellarische Daten.
- Zeigt Hosts, Services, Alerts, oder Metriken als Tabelle
- Data Source Optionen:
  - "Hosts" → Tabelle aller Hosts mit Status
  - "Alerts" → Aktive Alerts
  - "Metrics" → Aktuelle Metrikwerte pro Host
- Spalten konfigurierbar (welche Felder anzeigen)
- Sortierung per Klick auf Spaltenüberschrift
- Paginierung bei vielen Zeilen (oder virtualisiertes Scrolling)

### Widget Refresh

Jedes Widget hat einen eigenen Refresh-Timer:
- Default: Dashboard-globaler Refresh (30s)
- Konfigurierbar pro Widget
- Wenn Browser-Tab nicht sichtbar (`document.visibilityState === 'hidden'`): Refresh pausieren
- Stale-While-Revalidate: Widget zeigt vorherige Daten an während neue laden (kein Flackern)

**Tests:**
1. Widget-Picker zeigt alle 4 Widget-Typen
2. Widget hinzufügen → erscheint im Grid mit Default-Größe
3. Widget Config Dialog öffnet sich beim Hinzufügen
4. Metrik-Dropdown im Config zeigt verfügbare Metriken
5. Host/Service Filter filtert korrekt
6. Stat Widget zeigt einen einzelnen Wert korrekt an
7. Gauge Widget rendert mit korrekten Threshold-Farben
8. Line Chart zeigt Zeitreihendaten
9. Line Chart: Zoom funktioniert (Scroll-Zoom)
10. Table Widget zeigt Host/Alert-Daten
11. Table Widget: Sortierung funktioniert
12. Widget Refresh: Daten aktualisieren sich nach Refresh-Intervall
13. Tab-Visibility: Refresh pausiert wenn Tab hidden
14. Dashboard Query API liefert korrekte Daten basierend auf Time Range
15. Widget löschen → verschwindet aus dem Grid
16. Widget Config ändern → Widget aktualisiert sich sofort

**Achtung:**
- ECharts muss tree-shaked importiert werden: nicht `import * as echarts from 'echarts'` sondern einzelne Komponenten importieren. Sonst wird das Bundle unnötig groß.
- Die Dashboard Query API muss performant sein. Nutze die bestehenden Aggregate/Indizes. Wenn es `metrics_5m` Continuous Aggregates gibt (aus dem Report-Feature), nutze die.
- Wenn noch keine Continuous Aggregates existieren, query die Rohdaten. Die Aggregates werden in Phase 3 gebaut.

---

### 🔄 COMPACT — Nach Block 2.2

**Compact jetzt** (`/compact`).

**Was gebaut wurde:** Dashboard-System mit Widget-Framework. Widget Registry (React): jeder Widget-Typ registriert component + configComponent + defaultSize. Widget-Picker UI (Slide-Over). Widget Config Dialog mit Tabs Data/Display. 4 Widget-Typen: Stat (große Zahl + Sparkline), Gauge (ECharts Halbkreis mit Thresholds), Line Chart (ECharts Zeitreihe mit Zoom), Table (sortierbar). Dashboard Query API: `POST /api/dashboards/query` (metric_names, host_ids, from/to, aggregation, interval). Per-Widget Refresh mit Visibility-Aware Polling.

---

## Block 2.3 — Template Variables + Dashboard Sharing + TV-Mode

**Projekt:** github.com/lukas5001/Overseer

**Lies zuerst:** Das Dashboard-System: DB (`dashboards`, `dashboard_versions`), API (`/api/dashboards`, `/api/dashboards/query`), Frontend (react-grid-layout Grid, Widget Registry, Widget-Picker, Config Dialog, 4 Widget-Typen). Lies auch wie der bestehende TV-Mode funktioniert.

**Aufgabe:** Implementiere Dashboard-Variablen (Dropdown-Filter), Sharing (Public Links), und TV-Mode-Integration.

### Template Variables

Variablen erscheinen als Dropdowns in einer Leiste unter dem Dashboard-Titel. Sie filtern alle Widgets gleichzeitig.

**Wie der Benutzer eine Variable erstellt:**
Im Edit-Modus → Dashboard Settings (Zahnrad oben) → Tab "Variables" → "+ Add Variable":

- **Name**: z.B. `host` — wird als `$host` in Widget-Queries referenziert
- **Label**: z.B. "Host" — was im Dropdown-Label steht
- **Type**: "Query" oder "Custom"
  - Query: Werte kommen aus der Datenbank. z.B. "alle Hostnamen des Tenants". Die möglichen Queries sind vordefiniert (kein freies SQL!):
    - "All Hosts" → liefert alle Hostnamen
    - "All Services" → alle Service-Namen
    - "All Host Tags" → alle verwendeten Tags
    - "Hosts with tag: [tag]" → Hosts gefiltert nach Tag
  - Custom: Feste Werte, komma-separiert. z.B. "production,staging,development"
- **Multi-Select**: Darf der Benutzer mehrere Werte auswählen? (Default: Nein)
- **Include All**: Zeigt eine "All" Option die alle Werte auswählt (Default: Ja)
- **Default**: Welcher Wert ist vorausgewählt (Default: "All")

**Wie Variablen in Widgets wirken:**
Im Widget Config → Data Tab → Host Filter: Der Benutzer kann statt eines festen Hosts `$host` auswählen. Der Dropdown zeigt sowohl feste Hosts als auch definierte Variablen (mit `$` Prefix).

Wenn der Benutzer im Dashboard den Host-Dropdown ändert → alle Widgets die `$host` referenzieren laden ihre Daten neu mit dem neuen Host.

**URL-Sync:** Variablenwerte werden in der URL gespeichert: `?var-host=web-01`. Dashboard-Links mit bestimmten Filtern können geteilt und gebookmarkt werden. Beim Laden des Dashboards: URL-Parameter haben Vorrang vor Default-Werten.

**Variable Cascading (einfache Version):**
Wenn Variable B von Variable A abhängt (z.B. B="Services" abhängig von A="Host"):
- Ändert sich A → B wird neu geladen mit den Services des neuen Hosts
- B's aktuelle Auswahl wird resettet auf "All"

Implementiere Cascading nur für den einfachen Fall: Variable B hat in ihrem Query einen Filter der Variable A referenziert. Nicht rekursiv, maximal 2 Stufen tief (A → B, nicht A → B → C).

### Dashboard Sharing

**Share Dialog** (View-Modus, Button "Share"):

Drei Tabs:

**Tab 1: Internal Link**
- Kopiert die aktuelle URL mit Time Range und Variable-Werten
- "Copy to Clipboard" Button
- Funktioniert nur für eingeloggte Benutzer desselben Tenants

**Tab 2: Public Link**
- Button "Create Public Link" → generiert einen `share_token` (32 Bytes, URL-safe Base64)
- Die URL: `https://overseer.example.com/public/d/{token}`
- Optionen:
  - Ablaufdatum (Dropdown: 1 Tag, 7 Tage, 30 Tage, Kein Ablauf)
  - Variablen fixieren: Checkboxen pro Variable — wenn angehakt, kann der Public-Viewer den Filter nicht ändern
- "Revoke Link" Button → löscht den share_token → alter Link funktioniert nicht mehr

**Tab 3: Embed**
- Zeigt `<iframe>` Code-Snippet zum Kopieren
- Selbe URL wie Public Link, aber mit `?embed=true` Parameter → das Dashboard wird ohne Navigation/Header gerendert (nur Grid + Widgets)

**Public Dashboard Route:**
- `GET /public/d/{token}` → Prüfe Token, lade Dashboard, liefere aus OHNE Auth
- Read-Only: Kein Edit-Button, kein Widget-Konfigurieren
- Variablen-Dropdowns nur wenn nicht fixiert
- Time Range Picker ist nutzbar
- Kein Zugriff auf andere API-Endpoints (die Public-Route liefert Dashboard + Daten in einem Call, oder die Widget-Data-API akzeptiert den share_token als Alternative zu Auth)

### TV-Mode Integration

Overseer hat bereits einen TV-Mode. Erweitere ihn:

In der TV-Mode-Konfiguration: Der Benutzer kann Dashboards zur Rotation hinzufügen:
- Liste von Dashboards auswählen (Multi-Select)
- Pro Dashboard: Verweildauer (Sekunden, Default: 60)
- Die Dashboards rotieren automatisch

Auf dem Dashboard: Im View-Modus ein Button "TV Mode" → öffnet das Dashboard im Vollbild-Modus (kein Header, keine Navigation, nur Grid + Widgets, schwarzer Hintergrund optional).

**Tests:**
1. Variable erstellen → Dropdown erscheint unter dem Dashboard-Titel
2. Variable ändern → Widgets die `$variable` referenzieren laden neue Daten
3. Multi-Select Variable: mehrere Werte auswählen → Widgets filtern entsprechend
4. URL-Sync: Variable-Änderung aktualisiert URL → Reload → gleiche Auswahl
5. Variable Cascading: Host-Variable ändern → Service-Variable aktualisiert ihre Optionen
6. Public Link: Token generieren → Link aufrufen ohne Login → Dashboard wird angezeigt
7. Public Link: Fixierte Variablen können nicht geändert werden
8. Public Link: Abgelaufener Token → Fehlermeldung "This link has expired"
9. Public Link: Revoked Token → Fehlermeldung
10. Embed: iframe mit `?embed=true` → nur Grid, keine Navigation
11. TV Mode: Dashboard zeigt im Vollbild ohne UI-Chrome

**Achtung:**
- Public Dashboards dürfen KEINE Daten leaken die nicht zum Dashboard gehören. Die Data-API für Public Dashboards muss prüfen dass nur Metriken abgefragt werden die in den Widgets des Dashboards referenziert sind. Kein freies Querying über den Public-Token.
- Variable Cascading kann Endlos-Loops erzeugen wenn Variable A von B abhängt und B von A. Verhindere das: Beim Speichern prüfen ob der Dependency-Graph azyklisch ist.

---

### 🔄 COMPACT — Nach Block 2.3 (Ende Phase 2)

**Compact jetzt** (`/compact`).

**Was in Phase 2 gebaut wurde:** Vollständiges Dashboard-System. DB: `dashboards` (config JSONB) + `dashboard_versions`. API: CRUD, Query, Share, Versions. Frontend: react-grid-layout 24-Spalten Grid, Edit/View Modus, Widget-Picker, Config Dialog. 4 Widget-Typen (Stat, Gauge, Line Chart, Table). Dashboard Query API für Metrik-Daten. Template Variables als Dropdowns (Query/Custom, Multi-Select, Cascading, URL-Sync). Sharing (Internal Link, Public Token, iframe Embed). TV-Mode Integration mit Dashboard-Rotation.

---
---

# PHASE 3: Reports & Status Pages

---

## Block 3.1 — TimescaleDB Continuous Aggregates + PDF Report Engine

**Projekt:** github.com/lukas5001/Overseer

**Lies zuerst:**
1. Die Datenbank-Struktur, besonders wo und wie Metrik-Rohdaten gespeichert werden (Tabellenname, Spalten, ob TimescaleDB Hypertables bereits existieren)
2. Die bestehende Python-Backend-Struktur (wie Datenbankmigrationen gehandhabt werden)
3. Die bestehende SLA-Tracking Logik (Overseer hat bereits SLA-Tracking)

**Aufgabe:** Erstelle die Daten-Aggregationsschicht für Reports UND die PDF-Generierungs-Engine.

### TimescaleDB Continuous Aggregates

Reports dürfen NICHT auf Rohdaten querien — das wäre zu langsam und würde die DB belasten. Stattdessen: Voraggregierte Views die TimescaleDB automatisch pflegt.

Erstelle drei Aggregations-Level. WICHTIG: Die Quell-Tabelle und Spaltennamen müssen zu dem passen was tatsächlich in der Datenbank existiert. Lies die bestehende Metrik-Tabelle und passe die folgenden SQL-Statements entsprechend an:

```sql
-- Level 1: 5-Minuten Aggregation
CREATE MATERIALIZED VIEW metrics_5m WITH (timescaledb.continuous) AS
SELECT time_bucket('5 minutes', <timestamp_column>) AS bucket,
       <host_id_column>, <metric_name_column>,
       AVG(<value_column>) AS avg_val,
       MAX(<value_column>) AS max_val,
       MIN(<value_column>) AS min_val,
       COUNT(*) AS samples
FROM <metrics_table>
GROUP BY bucket, <host_id_column>, <metric_name_column>;

-- Level 2: Stündlich (für Monthly Reports)
CREATE MATERIALIZED VIEW metrics_hourly WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', bucket) AS bucket,
       <host_id_column>, <metric_name_column>,
       AVG(avg_val) AS avg_val,
       MAX(max_val) AS max_val,
       MIN(min_val) AS min_val,
       SUM(samples) AS samples
FROM metrics_5m
GROUP BY 1, <host_id_column>, <metric_name_column>;

-- Level 3: Täglich (für Quarterly Reports + Trends)
CREATE MATERIALIZED VIEW metrics_daily WITH (timescaledb.continuous) AS
SELECT time_bucket('1 day', bucket) AS bucket,
       <host_id_column>, <metric_name_column>,
       AVG(avg_val) AS avg_val,
       MAX(max_val) AS max_val,
       MIN(min_val) AS min_val,
       SUM(samples) AS samples
FROM metrics_hourly
GROUP BY 1, <host_id_column>, <metric_name_column>;

-- Automatische Refresh-Policies
SELECT add_continuous_aggregate_policy('metrics_5m', '1 hour', '5 minutes', '5 minutes');
SELECT add_continuous_aggregate_policy('metrics_hourly', '1 day', '1 hour', '1 hour');
SELECT add_continuous_aggregate_policy('metrics_daily', '1 month', '1 day', '1 day');

-- Compression für ältere Aggregate
ALTER MATERIALIZED VIEW metrics_hourly SET (timescaledb.compress_after = INTERVAL '30 days');
ALTER MATERIALIZED VIEW metrics_daily SET (timescaledb.compress_after = INTERVAL '90 days');
```

Passe die Dashboard Query API (Block 2.2) an: Wenn der Query-Zeitraum > 6 Stunden ist, verwende `metrics_5m`. Wenn > 3 Tage: `metrics_hourly`. Wenn > 30 Tage: `metrics_daily`. So werden Dashboards und Reports automatisch schneller.

### PDF Report Engine

Installiere die Python-Pakete: `weasyprint`, `jinja2`, `plotly`, `kaleido`.

**Report Generation Pipeline:**

```
1. Report-Daten sammeln (DB Queries gegen Aggregat-Views)
2. Charts generieren (Plotly → SVG via Kaleido)
3. HTML rendern (Jinja2 Template + Daten + Charts)
4. PDF generieren (WeasyPrint)
5. PDF speichern (Dateisystem)
```

**Erstelle folgende Struktur:**

```
overseer/reports/
  engine.py           # ReportEngine Klasse (orchestriert alles)
  data_collector.py   # Sammelt Report-Daten aus der DB
  chart_generator.py  # Generiert SVG Charts mit Plotly
  templates/
    base.html         # Basis-Template mit Kopf/Fußzeile, CSS, Seitenzahlen
    executive.html    # Executive Summary Template
    technical.html    # Technischer Report Template
    sections/
      health_score.html
      sla_table.html
      incidents.html
      performance_charts.html
      capacity.html
```

**Basis-Template (base.html):**
HTML mit CSS das auf Druck optimiert ist:
- `@page` Rules für Seitengröße (A4), Ränder, Kopf/Fußzeile
- Kopfzeile: Logo (links) + Report-Titel (rechts)
- Fußzeile: Firmenname (links) + Seitenzahl "Seite X von Y" (rechts)
- CSS Custom Properties für Branding-Farben (werden pro Tenant befüllt)
- Professionelle Typografie (Inter oder Roboto als Fallback)

**Health Score Berechnung:**
Der Health Score ist eine einzelne Zahl (0-100%) die den Gesamtzustand der Infrastruktur zusammenfasst:
- Berechnung: Gewichteter Durchschnitt der Availability aller Services
  - Services mit SLA-Target werden nach ihrem Target gewichtet
  - Services ohne Target werden gleichgewichtet
- Farbe: >= 99% = Grün, >= 95% = Gelb, < 95% = Rot
- Vergleich zum Vormonat: Differenz berechnen, Pfeil hoch/runter anzeigen

**Automatische Highlights und Concerns:**
Das System generiert automatisch "Top 3 Positives" und "Top 3 Concerns":

Positives (in dieser Reihenfolge priorisieren):
1. Services mit 100% Uptime im Berichtszeitraum
2. Services deren Uptime sich gegenüber Vormonat verbessert hat
3. Null Incidents für wichtige Services (die ein SLA-Target haben)

Concerns (in dieser Reihenfolge priorisieren):
1. Services die ihr SLA-Target verfehlt haben
2. Hosts mit höchster Ressourcenauslastung (>80% avg)
3. Wiederkehrende Probleme (gleicher Alert >3x im Berichtszeitraum)
4. Bevorstehende SSL-Zertifikatsabläufe (<30 Tage)

**Tests:**
1. Continuous Aggregates werden erstellt und enthalten Daten
2. `metrics_5m` wird automatisch refreshed (prüfe nach Daten-Insert)
3. Dashboard Query API wählt das richtige Aggregat-Level basierend auf Zeitraum
4. PDF Generation: Erstelle einen Test-Report mit Beispieldaten → PDF Datei wird erzeugt
5. PDF enthält Logo, Titel, Seitenzahlen
6. Charts im PDF sind scharf (SVG, nicht pixelige Bilder)
7. Health Score Berechnung ist korrekt
8. Highlights/Concerns werden generiert (nicht leer wenn Daten vorhanden)
9. Branding-Farben werden korrekt angewendet

---

### 🔄 COMPACT — Nach Block 3.1

**Compact jetzt** (`/compact`).

**Was gebaut wurde:** TimescaleDB Continuous Aggregates (`metrics_5m`, `metrics_hourly`, `metrics_daily`) mit automatischen Refresh-Policies und Compression. Dashboard Query API nutzt jetzt Aggregates basierend auf Zeitraum. PDF Report Engine in `reports/`: `engine.py` (Orchestrierung), `data_collector.py` (DB Queries), `chart_generator.py` (Plotly → SVG via Kaleido). Jinja2 Templates in `reports/templates/` (base.html mit @page Rules, Kopf/Fußzeile, Seitenzahlen). Health Score Berechnung (gewichteter Availability-Durchschnitt). Automatische Highlights/Concerns Generierung.

---

## Block 3.2 — Report Scheduling, Branding, Delivery

**Projekt:** github.com/lukas5001/Overseer

**Lies zuerst:** Die Report Engine in `reports/` (engine.py, data_collector.py, chart_generator.py, templates/). Lies auch die bestehende Email-Logik, die Tenant-Konfiguration, und die APScheduler-Nutzung (falls schon vorhanden, sonst: apscheduler ist noch zu installieren).

**Aufgabe:** Baue Report-Scheduling (automatische periodische Reports), Branding-System, Email-Delivery, und die Frontend-UI für Report-Verwaltung.

### Datenbank

```sql
CREATE TABLE report_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL,             -- "Monthly Executive Report"
    report_type VARCHAR(50) NOT NULL,       -- 'executive', 'technical', 'sla'
    cron_expression VARCHAR(100) NOT NULL,  -- '0 8 1 * *' = 1. des Monats, 8 Uhr
    recipients JSONB NOT NULL,              -- {"to": ["cto@example.com"], "cc": [], "bcc": []}
    scope JSONB,                            -- {"host_ids": [...], "tags": [...]} oder null = alle
    branding JSONB NOT NULL DEFAULT '{}',   -- Logo, Farben, Firmenname
    cover_text TEXT,                        -- Anschreiben oberhalb des Reports
    timezone VARCHAR(50) DEFAULT 'Europe/Rome',
    enabled BOOLEAN DEFAULT true,
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE report_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID REFERENCES report_schedules(id),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    report_type VARCHAR(50) NOT NULL,
    report_period_start DATE NOT NULL,
    report_period_end DATE NOT NULL,
    pdf_path VARCHAR(500),
    pdf_size_bytes BIGINT,
    recipients JSONB,
    status VARCHAR(20) DEFAULT 'pending',  -- pending, generating, sent, failed
    error_message TEXT,
    generated_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Scheduling mit APScheduler

Verwende `apscheduler` mit `AsyncIOScheduler` — läuft in-process mit FastAPI.

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

scheduler = AsyncIOScheduler()

# Beim Start: Alle aktiven Schedules aus DB laden und als Jobs registrieren
for schedule in active_schedules:
    scheduler.add_job(
        generate_and_send_report,
        trigger=CronTrigger.from_crontab(schedule.cron_expression, timezone=schedule.timezone),
        id=f"report_{schedule.id}",
        args=[schedule.id],
        replace_existing=True
    )
```

### Branding

Pro Report-Schedule konfigurierbar:
- `logo_path`: Pfad zum hochgeladenen Logo (Upload-Endpoint nötig)
- `company_name`: Name für Kopfzeile und Fußzeile
- `primary_color`: Hex-Farbcode für Überschriften und Akzente
- `footer_text`: z.B. "Created by Acme IT Services — www.acme-it.com"

Logo-Upload: `POST /api/reports/upload-logo` → speichert die Datei, gibt den Pfad zurück. Validierung: nur PNG/JPG/SVG, max 2MB.

### Email Delivery

Verwende die bestehende Email-Logik (oder smtplib direkt):
- PDF als Attachment
- Email-Body: Kurze Zusammenfassung + "Please find your monthly infrastructure report attached."
- Retry: 3 Versuche mit Backoff (5s, 30s, 60s)
- Status-Tracking in `report_deliveries`

### Frontend

**Reports-Seite** (neuer Menüpunkt):

**Tab 1: Schedules**
Tabelle aller Report-Schedules:
| Name | Type | Frequency | Recipients | Next Run | Last Run | Status | Actions |
|------|------|-----------|-----------|----------|----------|--------|---------|
| Monthly Executive | Executive | Monthly (1st, 8:00) | cto@... | Apr 1 | Mar 1 | Active | Edit · Disable · Delete |

"+ New Schedule" Button → Wizard-Dialog:
1. Report-Typ wählen (Executive / Technical / SLA)
2. Frequenz wählen (Wöchentlich / Monatlich / Quartalsweise) → generiert cron_expression
3. Scope wählen (Alle Hosts / Bestimmte Hosts/Tags)
4. Empfänger eingeben
5. Branding konfigurieren (Logo, Farben, Firmenname)
6. Vorschau: "Generate Preview" Button → erstellt den Report für den letzten verfügbaren Zeitraum, zeigt ihn als PDF im Browser

**Tab 2: History**
Tabelle aller gesendeten/fehlgeschlagenen Reports:
| Date | Schedule | Period | Recipients | Status | Size | Actions |
|------|----------|--------|-----------|--------|------|---------|
| Mar 1 | Monthly Executive | Feb 2026 | cto@... | ✅ Sent | 2.4 MB | Download · Resend |
| Feb 1 | Monthly Executive | Jan 2026 | cto@... | ❌ Failed: SMTP timeout | — | Retry |

"Download" lädt das PDF herunter. "Resend" sendet es erneut. "Retry" generiert es neu und sendet.

**"Generate Now" Button** (oben rechts auf der Reports-Seite):
Erstellt sofort einen Report ohne Schedule:
- Report-Typ wählen
- Zeitraum manuell wählen (Von/Bis Datepicker)
- Empfänger eingeben
- "Generate & Send" → Report wird erstellt und gesendet, erscheint in der History

### Fehlende Daten

Wenn für den Report-Zeitraum keine oder wenige Daten vorhanden sind:
- Charts zeigen "Insufficient data" statt leerer Fläche
- Health Score zeigt "N/A" statt einer irreführenden Zahl
- Trends zeigen "Not enough history"
- Der Report wird trotzdem gesendet, mit einem Hinweis oben: "Note: Some metrics have limited data for this reporting period."

### Report Retention

PDFs werden 90 Tage auf dem Server gespeichert, danach automatisch gelöscht (Cron-Job oder APScheduler-Job). Der Eintrag in `report_deliveries` bleibt bestehen (für Audit), nur die PDF-Datei wird gelöscht.

**Tests:**
1. Report-Schedule erstellen → APScheduler Job wird registriert
2. Schedule deaktivieren → Job wird aus APScheduler entfernt
3. Report Generation: Executive Summary enthält Health Score, KPIs, Highlights, Concerns
4. Report Generation: Technischer Report enthält SLA-Tabelle, Performance-Charts, Incidents
5. Branding: Logo erscheint im PDF, Farben stimmen
6. Email-Versand funktioniert mit PDF-Attachment
7. Email-Retry bei SMTP-Fehler
8. Preview generiert einen Report ohne ihn zu senden
9. "Generate Now" erstellt und sendet sofort
10. Report mit fehlenden Daten: zeigt "N/A" / "Insufficient data", stürzt nicht ab
11. History zeigt alle vergangenen Reports mit korrektem Status
12. Download funktioniert
13. Resend sendet denselben Report erneut
14. Alte PDFs werden nach 90 Tagen gelöscht

---

### 🔄 COMPACT — Nach Block 3.2

**Compact jetzt** (`/compact`).

**Was gebaut wurde:** Report-Scheduling und -Delivery. DB: `report_schedules` (cron_expression, recipients JSONB, scope, branding, cover_text) + `report_deliveries` (status tracking). APScheduler AsyncIOScheduler für periodische Report-Generierung. Branding-System: Logo-Upload, Primary Color, Company Name, Footer Text — alles als CSS Custom Properties in Jinja2 Templates. Email-Delivery mit smtplib + Retry (3 Versuche, Backoff). Frontend: Reports-Seite mit Schedule-Verwaltung (Wizard: Typ→Frequenz→Scope→Empfänger→Branding→Preview), Delivery History (Download/Resend), "Generate Now" für On-Demand Reports. Report-Typen: Executive Summary (1-2 Seiten, Health Score, KPIs) und Technical (mehrseitig, SLA-Tabelle, Performance Charts, Incidents). PDF Retention: 90 Tage.

---

## Block 3.3 — Public Status Pages

**Projekt:** github.com/lukas5001/Overseer

**Lies zuerst:** Die bestehende Datenbank-Struktur (Tenants, Hosts, Services, Service-Status). Lies auch die bestehende Check-Status-Logik (wie wird OK/WARNING/CRITICAL bestimmt). Lies die Frontend-Architektur für das Routing (Status Pages brauchen eine öffentliche Route ohne Auth).

**Aufgabe:** Implementiere öffentliche Status Pages die MSPs für ihre Kunden anbieten können.

### Konzept

Eine Status Page ist eine öffentliche Webseite die den Zustand von "Komponenten" zeigt. Komponenten sind eine ABSTRAKTION — sie sind nicht 1:1 Hosts oder Services, sondern benutzerfreundliche Gruppierungen. Beispiel:

| Öffentliche Komponente | Interne Checks (für den Besucher unsichtbar) |
|----------------------|----------------------------------------------|
| "Website" | web-01:http_check, web-02:http_check |
| "Email" | mail-01:imap_check, mail-01:smtp_check |
| "ERP System" | erp-01:http_check, erp-01:process_check |

Der Besucher sieht nie interne Hostnamen, IPs, oder technische Details. Er sieht nur: "Website — Operational ✓".

### Datenbank

```sql
CREATE TABLE status_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    slug VARCHAR(63) UNIQUE NOT NULL,       -- URL-Pfad: /status/{slug}
    title VARCHAR(255) NOT NULL,
    description TEXT,
    logo_url TEXT,
    primary_color VARCHAR(7) DEFAULT '#22c55e',
    favicon_url TEXT,
    custom_css TEXT,
    timezone VARCHAR(50) DEFAULT 'UTC',
    is_public BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE status_page_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status_page_id UUID NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    position INTEGER DEFAULT 0,
    group_name VARCHAR(255),             -- Optional: Gruppe wie "Infrastructure"
    current_status VARCHAR(20) DEFAULT 'operational',
    status_override BOOLEAN DEFAULT false,
    show_uptime BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE component_check_mappings (
    component_id UUID NOT NULL REFERENCES status_page_components(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id),
    PRIMARY KEY (component_id, service_id)
);

CREATE TABLE status_page_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status_page_id UUID NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'investigating',
    impact VARCHAR(20) NOT NULL DEFAULT 'minor',
    is_auto_created BOOLEAN DEFAULT false,
    scheduled_start TIMESTAMPTZ,
    scheduled_end TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE TABLE incident_updates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES status_page_incidents(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL,
    body TEXT NOT NULL,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE component_daily_uptime (
    component_id UUID NOT NULL REFERENCES status_page_components(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    uptime_percentage FLOAT,
    worst_status VARCHAR(20),
    outage_minutes INTEGER DEFAULT 0,
    PRIMARY KEY (component_id, date)
);

CREATE TABLE status_page_subscribers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status_page_id UUID NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
    type VARCHAR(10) NOT NULL,
    endpoint VARCHAR(512) NOT NULL,
    confirmed BOOLEAN DEFAULT false,
    confirmation_token UUID DEFAULT gen_random_uuid(),
    component_ids UUID[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Automatische Status-Berechnung

Ein Background-Job (jede Minute) berechnet den Status jeder Komponente aus ihren zugeordneten Checks:
- **Operational**: Alle Checks OK
- **Degraded Performance**: Mindestens ein Check WARNING, keiner CRITICAL
- **Partial Outage**: Mindestens ein Check CRITICAL, aber nicht alle
- **Major Outage**: Alle Checks CRITICAL oder UNKNOWN

AUSNAHME: Wenn `status_override = true`, wird der manuelle Status beibehalten (nicht automatisch überschrieben).

### Automatische Incident-Erstellung

Wenn eine Komponente von "Operational" auf "Partial Outage" oder "Major Outage" wechselt:
1. Erstelle automatisch einen Incident: Titel = "[Component Name] — [Status]", Status = "investigating"
2. Erstelle ein initiales Update: "We are currently investigating an issue with [Component Name]."
3. `is_auto_created = true`

Wenn alle Checks der Komponente wieder OK sind UND 5 Minuten stabil bleiben:
1. Setze Incident-Status auf "resolved"
2. Erstelle ein Update: "This incident has been resolved. All systems are operating normally."
3. `resolved_at = NOW()`

### Tägliche Uptime-Berechnung

Ein täglicher Job (Mitternacht UTC) berechnet für jede Komponente:
- `uptime_percentage`: Prozent der Zeit die die Komponente "operational" oder "degraded" war
- `worst_status`: Der schlimmste Status des Tages
- `outage_minutes`: Minuten mit "partial_outage" oder "major_outage"

Diese Daten füllen die 90-Tage Uptime-Balken auf der öffentlichen Seite.

### Öffentliche Status-Seite (Frontend)

Route: `/status/{slug}` — KEIN Login erforderlich.

Die Seite muss **schnell laden** (< 1 Sekunde) und **einfach** sein:

```
┌──────────────────────────────────────────────┐
│  [Logo]   Müller GmbH System Status          │
│                                              │
│  ╔══════════════════════════════════════════╗ │
│  ║  ✅ All Systems Operational              ║ │
│  ╚══════════════════════════════════════════╝ │
│                                              │
│  Website              Operational        ●   │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 99.99%   │
│                                              │
│  Email                Operational        ●   │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 100.0%   │
│                                              │
│  ERP System           Partial Outage     ●   │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░ 99.72%   │
│                                              │
│  ─────────────────────────────────────────── │
│  Current Incidents                           │
│                                              │
│  🔴 ERP System — Partial Outage             │
│     Investigating — 14:30                    │
│     We are investigating slow response       │
│     times in the ERP system.                 │
│                                              │
│     Update 14:45 — Identified                │
│     Database connection pool exhaustion.     │
│  ─────────────────────────────────────────── │
│  Past Incidents (last 14 days)               │
│  Mar 20 — Email Delivery Delays (resolved)   │
│                                              │
│  [Subscribe to Updates]                      │
└──────────────────────────────────────────────┘
```

Die 90-Tage Uptime-Balken: 90 kleine Rechtecke, farbcodiert:
- Grün: 100% Uptime
- Hellgrün: >99.5%
- Gelb: >99%
- Orange: >95%
- Rot: <95%
- Grau: Keine Daten

Hover über einen Balken → Tooltip: "March 15 — 99.7% uptime (8 min downtime)"

### Admin-UI für Status Pages (innerhalb Overseer)

Neuer Menüpunkt: Status Pages

**Status Page erstellen/bearbeiten:**
- Titel, Slug, Logo, Farben
- Komponenten hinzufügen: Name + zugeordnete Checks (Multi-Select)
- Komponenten ordnen (Drag & Drop Reihenfolge)
- Gruppen definieren

**Incident Management:**
- Liste aller Incidents (aktiv und vergangen)
- Incident erstellen: Titel, Impact (minor/major/critical), betroffene Komponenten
- Update hinzufügen: Status (investigating/identified/monitoring/resolved), Text
- Manueller Status-Override: Komponente manuell auf einen Status setzen

**Geplante Wartung:**
- Maintenance erstellen: Titel, Zeitfenster (Von/Bis), betroffene Komponenten, Beschreibung
- Erscheint auf der Status-Seite als blaues Banner BEVOR sie beginnt
- Während der Wartung: Status wechselt auf "Under Maintenance" (blau, nicht rot)

### Subscriber

"Subscribe to Updates" auf der öffentlichen Seite:
- Email eingeben → Bestätigungs-Mail (Double Opt-In) → bei jedem Incident-Update Email
- Optional: Nur bestimmte Komponenten abonnieren

**Tests:**
1. Status Page erstellen → öffentlich erreichbar unter /status/{slug}
2. Komponente zuordnen → Status wird automatisch berechnet
3. Alle Checks OK → "All Systems Operational"
4. Ein Check CRITICAL → Komponente wechselt auf "Partial Outage", Incident wird auto-erstellt
5. Check recovered + 5min stabil → Incident wird auto-resolved
6. Manueller Status-Override → automatische Berechnung wird pausiert
7. 90-Tage Uptime-Balken zeigen korrekte Farben
8. Subscriber erhält Email bei Incident-Update
9. Geplante Wartung erscheint als blaues Banner vor dem Termin
10. Tenant A sieht nicht die Status Pages von Tenant B

---

### 🔄 COMPACT — Nach Block 3.3 (Ende Phase 3)

**Compact jetzt** (`/compact`).

**Was in Phase 3 gebaut wurde:** Continuous Aggregates (`metrics_5m`, `metrics_hourly`, `metrics_daily`). PDF Report Engine (WeasyPrint + Plotly/Kaleido + Jinja2) mit Health Score, auto Highlights/Concerns. Report Scheduling (APScheduler + DB `report_schedules`/`report_deliveries`) mit Branding und Email-Delivery. Report Frontend (Schedule-Wizard, History, Preview, Generate Now). Public Status Pages: DB (`status_pages`, `status_page_components`, `component_check_mappings`, `status_page_incidents`, `incident_updates`, `component_daily_uptime`, `status_page_subscribers`). Automatische Status-Berechnung aus zugeordneten Checks. Auto-Incident bei Outage + Auto-Resolve nach 5min Stabilität. 90-Tage Uptime-Balken. Subscriber-System (Email Double Opt-In). Admin UI für Komponenten, Incidents, geplante Wartung.

---
---

# PHASE 4: Auto-Discovery & Dependencies

---

## Block 4.1 — Auto-Discovery: Go-Implementierung (Agent + Collector)

**Projekt:** github.com/lukas5001/Overseer

**Lies zuerst:**
1. Den Go-Agent-Code: wie Checks registriert und ausgeführt werden
2. Den Go-Collector-Code: wie der Collector mit dem Backend kommuniziert
3. Die bestehende SNMP-Logik (Overseer hat bereits SNMP Checks)

**Aufgabe:** Implementiere Service Discovery im Agent und Network Discovery im Collector.

### Agent: Service Discovery

Der Agent erkennt automatisch welche Services auf seinem Host laufen.

**Linux:**
1. **Systemd Services**: Alle aktiven Services auflisten via `go-systemd/dbus`:
   - Name, Status (active/inactive), PID
   - Nur Services die enabled sind (auto-start) oder gerade laufen
   - Filter: Ignoriere systemd-interne Services (systemd-*, dbus.service, etc.)
2. **Listening Ports**: Via `gopsutil/net.Connections("tcp")`:
   - Alle TCP-Ports im LISTEN-Status
   - PID → Prozessname auflösen
   - Bekannte Ports zuordnen: 22→SSH, 80→HTTP, 443→HTTPS, 3306→MySQL, 5432→PostgreSQL, 6379→Redis, 8080→HTTP-Alt, 27017→MongoDB

**Windows:**
1. **Windows Services**: Via `golang.org/x/sys/windows/svc/mgr`:
   - Name, Display Name, Status, Start Type (automatic/manual/disabled)
   - Nur Automatic-Start-Services oder laufende Services
2. **Listening Ports**: Gleich wie Linux via gopsutil

**Output-Format (was der Agent an den Server sendet):**
```json
{
  "type": "service_discovery",
  "hostname": "web-prod-01",
  "timestamp": "2026-03-27T14:00:00Z",
  "services": [
    {
      "name": "nginx",
      "type": "systemd",
      "status": "running",
      "pid": 1234,
      "ports": [80, 443],
      "suggested_checks": ["http", "process", "ssl_certificate"]
    },
    {
      "name": "postgresql",
      "type": "systemd",
      "status": "running",
      "pid": 5678,
      "ports": [5432],
      "suggested_checks": ["process", "port"]
    }
  ]
}
```

**Check-Vorschläge (suggested_checks):**
Basierend auf erkanntem Service-Typ und offenen Ports:
- Port 80/443 offen → `http`, `ssl_certificate`
- PostgreSQL erkannt → `process`, `port`
- MySQL erkannt → `process`, `port`
- Redis erkannt → `process`, `port`
- Docker erkannt → `process`
- SSH (Port 22) → `port` (SSH-Check)
- Nginx/Apache → `http`, `process`
- Immer: `ping` für den Host

Der Agent sendet Discovery-Daten periodisch (alle 10 Minuten, konfigurierbar). Nicht bei jedem Check-Zyklus.

### Collector: Network Discovery

Der Collector führt Netzwerk-Scans durch.

**Implementierung:**
Verwende `github.com/Ullaakut/nmap/v3` als nmap-Wrapper:

```go
func NetworkScan(targets string, ports string) (*ScanResult, error) {
    scanner, err := nmap.NewScanner(
        nmap.WithTargets(targets),       // "192.168.1.0/24"
        nmap.WithPorts(ports),           // "22,80,443,161,3306,5432,8080,3389"
        nmap.WithPingScan(),             // ICMP Sweep zuerst
        nmap.WithServiceInfo(),          // Service-Version-Detection
        nmap.WithTimingTemplate(nmap.TimingNormal),
    )
    result, warnings, err := scanner.Run()
    // Parse result.Hosts → eigene Datenstruktur
}
```

**Device-Typ-Erkennung:**
Für jedes gefundene Gerät:
1. **Port-Fingerprinting:**
   - 161 (SNMP) → wahrscheinlich Netzwerkgerät oder managed Switch
   - 80+443 (ohne 22) → Netzwerkgerät oder IoT
   - 22+80+443 → Server
   - 3389 → Windows Server
   - 631/9100 → Drucker
2. **SNMP Query** (wenn Port 161 offen und Community String bekannt):
   - `sysObjectID` → Vendor/Modell
   - `sysDescr` → OS/Firmware
   - Verwende bestehende SNMP-Logik
3. **MAC OUI** (wenn verfügbar, nur im lokalen Netzwerk):
   - Erste 3 Bytes der MAC → Hersteller (HP, Cisco, Dell, etc.)
   - OUI-Lookup-Tabelle einbetten (es gibt kleine/kompakte Listen)

**Output-Format:**
```json
{
  "type": "network_discovery",
  "scan_id": "uuid",
  "collector_id": "uuid",
  "timestamp": "2026-03-27T14:00:00Z",
  "target": "192.168.1.0/24",
  "hosts_found": [
    {
      "ip": "192.168.1.10",
      "hostname": "web-prod-01",
      "mac": "AA:BB:CC:DD:EE:FF",
      "vendor": "Dell Inc.",
      "os_guess": "Linux 5.x",
      "device_type": "server",
      "open_ports": [
        {"port": 22, "protocol": "tcp", "service": "ssh", "version": "OpenSSH 8.9"},
        {"port": 80, "protocol": "tcp", "service": "http", "version": "nginx 1.22"},
        {"port": 443, "protocol": "tcp", "service": "https"}
      ],
      "snmp": {
        "sys_descr": "Linux web-prod-01 5.15.0",
        "sys_object_id": "1.3.6.1.4.1.8072.3.2.10"
      },
      "suggested_checks": ["ping", "cpu", "memory", "disk", "http", "ssl_certificate"]
    }
  ]
}
```

Network Scans werden on-demand ausgeführt (API-Call vom Backend) und optional periodisch (konfigurierbar).

**Tests:**
1. Agent Service Discovery: Auf einem Linux-System → erkennt laufende Services
2. Agent Service Discovery: Suggested Checks passen zum erkannten Service-Typ
3. Agent sendet Discovery-Daten im korrekten Format
4. Collector Network Scan: Scannt eine IP-Range und findet Hosts
5. Device-Typ-Erkennung: Server mit Port 22+80 wird als "server" klassifiziert
6. Device-Typ-Erkennung: Gerät mit nur Port 161 wird als "network_device" klassifiziert
7. SNMP-Query funktioniert wenn Community String bekannt
8. Scan mit unerreichbarer Range → leeres Ergebnis, kein Crash

**Achtung:**
- nmap muss auf dem System installiert sein auf dem der Collector läuft. Dokumentiere das als Voraussetzung.
- Network Scans können in manchen Netzwerken Sicherheitsalarme auslösen. Der Scan muss von einem Admin bewusst gestartet werden, nie automatisch ohne Konfiguration.
- SNMP Community Strings sind sensibel. Verwende die bestehende Encryption für deren Speicherung.

---

### 🔄 COMPACT — Nach Block 4.1

**Compact jetzt** (`/compact`).

**Was gebaut wurde:** Go Agent: Service Discovery — erkennt laufende Services via systemd (Linux) / Windows Service Manager, Listening Ports via gopsutil, generiert `suggested_checks` basierend auf Service-Typ. Sendet Ergebnisse als `service_discovery` JSON alle 10 Minuten. Go Collector: Network Discovery — nmap-Wrapper (`Ullaakut/nmap/v3`), Device-Typ-Erkennung (Port-Fingerprinting + SNMP sysObjectID + MAC OUI), generiert `network_discovery` JSON mit ip, hostname, vendor, device_type, open_ports, suggested_checks.

---

## Block 4.2 — Auto-Discovery: Backend + Frontend

**Projekt:** github.com/lukas5001/Overseer

**Lies zuerst:** Die Go-Discovery-Implementierung im Agent (Service Discovery) und Collector (Network Discovery). Lies das Format der Discovery-Daten die sie senden. Lies auch die bestehende Host/Service-Erstellungs-API und das Frontend dafür.

**Aufgabe:** Baue das Backend (Discovery Results verarbeiten, Rules Engine, Approval-Flow) und das Frontend (Discovery UI).

### Backend

**API Endpoints:**

- `POST /api/discovery/network-scan` — Starte einen Netzwerk-Scan. Body: `{target: "192.168.1.0/24", ports: "22,80,443,...", collector_id: "uuid"}`. Response: `{scan_id: "uuid", status: "running"}`
- `GET /api/discovery/scans/{scan_id}` — Scan-Status und Ergebnisse
- `GET /api/discovery/results` — Alle Discovery-Ergebnisse (gefundene Geräte), paginiert, filterbar
- `POST /api/discovery/results/{id}/add` — Gerät als Host hinzufügen. Body: `{hostname, display_name, tags, checks: [{type, config}]}`
- `POST /api/discovery/results/{id}/ignore` — Gerät ignorieren (erscheint nicht mehr)
- `POST /api/discovery/results/bulk-add` — Mehrere Geräte auf einmal hinzufügen
- `GET /api/discovery/ignored` — Ignorierte Geräte
- `DELETE /api/discovery/ignored/{id}` — Gerät un-ignorieren

**Discovery Results Tabelle:**

```sql
CREATE TABLE discovery_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    scan_id UUID,
    source VARCHAR(30) NOT NULL,           -- 'network_scan', 'agent_discovery'
    ip_address INET,
    hostname VARCHAR(255),
    mac_address VARCHAR(17),
    vendor VARCHAR(255),
    device_type VARCHAR(50),               -- 'server', 'network_device', 'printer', 'unknown'
    os_guess VARCHAR(255),
    open_ports JSONB,
    snmp_data JSONB,
    suggested_checks JSONB,
    matched_host_id UUID REFERENCES hosts(id),  -- NULL wenn neu, Host-ID wenn bekannt
    status VARCHAR(20) DEFAULT 'new',       -- 'new', 'added', 'ignored'
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, ip_address)
);
```

**Abgleich mit bestehenden Hosts:**
Wenn ein Discovery-Ergebnis reinkommt, prüfe ob es bereits einen Host mit derselben IP gibt:
- JA → `matched_host_id` setzen, Status = "known". Prüfe ob es Änderungen gibt (neue Ports, neue Services) → markiere als "updated"
- NEIN → Status = "new"

**Discovery Rules (optional, Phase 2 der Discovery):**

```sql
CREATE TABLE discovery_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL,
    priority INTEGER DEFAULT 50,
    enabled BOOLEAN DEFAULT true,
    conditions JSONB NOT NULL,  -- [{"field": "ip_address", "op": "in_subnet", "value": "10.0.0.0/8"}]
    action VARCHAR(20) NOT NULL, -- 'auto_add', 'pending', 'ignore'
    template_id UUID,
    auto_tags JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Rules werden nach Priorität evaluiert. Erste Regel die matcht bestimmt die Aktion. Implementiere mindestens die Conditions: `in_subnet`, `port_open`, `device_type_is`.

### Frontend

**Discovery Seite** (neuer Menüpunkt unter Infrastructure):

**Oben:** "Start Network Scan" Button (falls noch nie gescannt) oder "Last scan: 2 hours ago. Found 23 hosts."

**Wenn noch nie gescannt:** Prominenter "Start Discovery" Bereich:
- IP Range eingeben (mit Hilfetext: "Enter CIDR notation, e.g., 192.168.1.0/24")
- Collector auswählen (Dropdown)
- "Scan" Button → Fortschrittsanzeige während der Scan läuft

**Discovery Results Tabelle:**

| Status | IP | Hostname | Type | OS | Ports | Suggested Checks | Actions |
|--------|-----|----------|------|-------|-------|-----------------|---------|
| 🆕 New | 192.168.1.10 | web-prod | Server | Ubuntu 22.04 | 22, 80, 443 | ping, http, ssl | [Add] [Ignore] |
| ✅ Known | 192.168.1.20 | db-01 | Server | Debian 12 | 22, 5432 | — | Already monitored |
| 🆕 New | 192.168.1.100 | — | Printer | — | 9100 | ping | [Add] [Ignore] |

Filter: Status (New / Known / Ignored), Device Type, Subnet

**Add Dialog:**
Klick auf [Add] → Dialog:
- Hostname (vorausgefüllt)
- Display Name (optional)
- Tags (Multi-Input)
- Checks: Vorgeschlagene Checks sind angehakt. Der Benutzer kann einzelne abwählen oder weitere hinzufügen.
- "Add Host" → Host wird in Overseer erstellt mit den ausgewählten Checks

**Bulk Add:**
Checkboxen in der Tabelle + "Add Selected (5)" Button oben → Bulk-Dialog:
- Gemeinsame Tags eingeben
- Checks werden pro Gerät individuell angewendet (die Vorschläge)
- Bestätigungsdialog: "This will create 5 hosts with 23 service checks. Proceed?"

**Tests:**
1. Netzwerk-Scan starten → Ergebnisse erscheinen in der Tabelle
2. Neues Gerät → Status "New"
3. Bekanntes Gerät → Status "Known" mit Link zum Host
4. Add → Host wird in Overseer erstellt
5. Ignore → Gerät verschwindet aus der Tabelle (aber sichtbar unter "Ignored")
6. Un-Ignore → Gerät erscheint wieder
7. Bulk Add → mehrere Hosts auf einmal erstellt
8. Agent Discovery Daten erscheinen ebenfalls in der Tabelle
9. Wiederholter Scan → `last_seen_at` aktualisiert, keine Duplikate

---

### 🔄 COMPACT — Nach Block 4.2

**Compact jetzt** (`/compact`).

**Was gebaut wurde:** Discovery Backend: DB `discovery_results` (ip, hostname, device_type, open_ports, suggested_checks, status new/added/ignored, matched_host_id). API: `POST /api/discovery/network-scan` (startet Scan), `GET /api/discovery/results`, `POST .../add` + `.../ignore` + `.../bulk-add`. Discovery Rules Engine: DB `discovery_rules` (conditions JSONB, action auto_add/pending/ignore). Abgleich mit bestehenden Hosts via IP. Frontend: Discovery-Seite mit Scan-Start, Results-Tabelle (New/Known/Ignored), Add-Dialog (Hostname, Tags, Checks vorausgewählt), Bulk-Add, Ignore-Liste.

---

## Block 4.3 — Alert Suppression & Dependencies

**Projekt:** github.com/lukas5001/Overseer

**Lies zuerst:** Die bestehende Alert/Notification-Logik im Backend. Lies den Alert Grouper (`notifications/grouper.py`) — die Suppression kommt VOR dem Grouper. Lies auch die bestehende Host/Service Datenstruktur (wie Hosts und Services referenziert werden).

**Aufgabe:** Implementiere Alert Suppression basierend auf Host/Service Dependencies.

### Konzept

Wenn ein Parent-Device ausfällt, werden alle Alerts seiner Children unterdrückt. Statt 50 Notifications bekommt der Admin eine: "Switch-01 is DOWN, 50 dependent alerts suppressed."

### Datenbank

```sql
CREATE TABLE dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    source_type VARCHAR(20) NOT NULL,    -- 'host' oder 'service'
    source_id UUID NOT NULL,
    depends_on_type VARCHAR(20) NOT NULL,
    depends_on_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_type, source_id, depends_on_type, depends_on_id)
);

CREATE INDEX idx_deps_source ON dependencies(source_type, source_id);
CREATE INDEX idx_deps_target ON dependencies(depends_on_type, depends_on_id);
```

### Suppression-Logik

Die Inhibition Engine wird in den Alert-Verarbeitungs-Flow eingebaut, VOR dem Grouper:

```
Alert kommt rein
  → Inhibition Check:
    1. Bestimme das source-Entity (Host oder Service)
    2. Finde alle Ancestors (Parent, Grandparent, ...) über die Dependencies-Tabelle
    3. Für jeden Ancestor: Hat er gerade einen aktiven CRITICAL Alert?
       JA → Alert wird SUPPRESSED. Speichere ihn, aber sende keine Notification.
       NEIN → Weiter zum Grouper
  → Grouper (wie bisher)
  → Notification Dispatch
```

**Ancestor-Walk:**
Die Dependency-Tabelle ist ein DAG (Directed Acyclic Graph). Walk up:
```
Service "nginx" auf web-01
  → depends_on: Host "web-01"
    → depends_on: Host "switch-01"
      → depends_on: nichts (Root-Node)
```

Wenn `switch-01` einen CRITICAL Alert hat → `web-01` und alle seine Services werden suppressed.

**Zyklen-Schutz:** Beim Speichern einer neuen Dependency: Prüfe ob ein Zyklus entstehen würde (A depends on B depends on A). Wenn ja, ablehnen mit Fehlermeldung.

**Was passiert bei Recovery des Parent:**
1. Parent recovered → alle suppressed Alerts seiner Children werden überprüft
2. Für jeden suppressed Child-Alert: Ist der Alert noch aktiv?
   - JA → Jetzt wird die Notification gesendet (der Suppression-Grund ist weg)
   - NEIN → Alert wird als "resolved" markiert, keine Notification nötig
3. Eine zusammenfassende Notification: "Switch-01 recovered. 3 dependent hosts still have issues: web-03, db-02, ..."

### Frontend

**Host Detail → Tab "Dependencies":**
- Dropdown "Depends on": Alle Hosts des Tenants. Der Benutzer wählt den Parent-Host.
- Anzeige der aktuellen Dependencies als einfache Liste: "This host depends on: Switch-01"
- Anzeige der Children: "Dependent hosts: web-01, web-02, db-01"

**Service Detail:** Gleich, aber für Service-Dependencies.

**Dependency Map** (optional, nice-to-have):
Eine dedizierte Seite "Infrastructure → Dependencies" mit einer Baumansicht:
```
Switch-01 ●
├── web-01 ●
│   ├── nginx ●
│   └── app-backend ●
├── web-02 ●
└── db-01 ●
    └── postgresql ●
```
Farbkodiert nach aktuellem Status. Wenn ein Knoten rot ist, sind alle Children-Verbindungen gestrichelt dargestellt (= suppressed).

**Alert-Ansicht:**
Suppressed Alerts werden in der Alert-Liste angezeigt, aber visuell anders:
- Grauer Text, eingerückt, mit Label "Suppressed (parent: Switch-01 is down)"
- Klappbar: Default eingeklappt, Badge zeigt Anzahl: "12 suppressed alerts"
- Suppressed Alerts gehen NICHT in die Zählungen auf dem Dashboard ein (nicht in "Critical: 15" gezählt)

**Tests:**
1. Dependency erstellen: Host A depends on Host B
2. Zyklen-Erkennung: A→B→A wird abgelehnt
3. Parent (B) wird CRITICAL → Child (A) Alert wird suppressed
4. Suppressed Alert: Keine Notification gesendet
5. Suppressed Alert: Im UI sichtbar aber als "suppressed" markiert
6. Parent recovered → suppressed Child-Alert wird jetzt notifiziert (wenn noch aktiv)
7. Parent recovered → suppressed Child-Alert der inzwischen resolved ist → keine Notification
8. Mehrstufige Dependencies: A→B→C, C fällt aus → A und B suppressed
9. Notification-Text enthält Info über suppressed Alerts: "50 dependent alerts suppressed"
10. Suppressed Alerts werden NICHT in Dashboard-Zählungen mitgezählt

---

### 🔄 COMPACT — Nach Block 4.3 (Ende Phase 4)

**Compact jetzt** (`/compact`).

**Was in Phase 4 gebaut wurde:** Auto-Discovery: Go Agent Service Discovery (systemd/Windows Services + Listening Ports + suggested_checks), Go Collector Network Discovery (nmap + SNMP + MAC OUI + Device-Typ-Erkennung). Backend: DB `discovery_results` + `discovery_rules`, API für Scan-Start/Results/Add/Ignore/Bulk-Add, Rules Engine. Frontend: Discovery-Seite mit Scan-UI, Results-Tabelle, Add/Ignore/Bulk-Add. Alert Suppression: DB `dependencies` (source→depends_on), InhibitionEngine (Ancestor-Walk, should_suppress), integriert VOR dem Grouper. Recovery-Logik: Parent recovered → suppressed Children werden reevaluiert. Frontend: Dependencies-Tab auf Host/Service Detail, Dependency Map Visualisierung, suppressed Alerts grau + eingeklappt in Alert-Liste.

---
---

# PHASE 5: Enterprise Features

---

## Block 5.1 — Log Collection (Go Agent) + Log Ingestion (Backend)

**Projekt:** github.com/lukas5001/Overseer

**Lies zuerst:**
1. Go Agent Code: wie der Agent konfiguriert wird und wie er Daten an den Server sendet
2. Backend Receiver: wie Check-Daten empfangen werden (HTTP Endpoint, Authentifizierung)
3. Bestehende TimescaleDB-Tabellen und Hypertables

**Aufgabe:** Implementiere Log Collection im Go Agent und Log Ingestion im Python Backend.

### Go Agent: Log Collection

**Neue Config-Sektion `log_collection`:**
Der Agent bekommt in seiner Konfiguration eine neue Sektion:
```yaml
log_collection:
  enabled: true
  batch_size: 1000        # Max Einträge pro Batch
  flush_interval: 5s      # Max Zeit bis Batch gesendet wird
  sources:
    - type: file
      path: /var/log/nginx/error.log
      service: nginx
    - type: journald
      units: [nginx, postgresql]
    - type: windows_eventlog
      channels: [Application, System]
      min_level: warning
```

**File Tailing:**
- Verwende `fsnotify/fsnotify` für Filesystem-Events
- Offset-Checkpointing: Speichere den zuletzt gelesenen Offset in einer lokalen Datei (`/var/lib/overseer-agent/log-offsets.json`). Bei Neustart: Ab dem letzten Offset weiterlesen.
- Datei-Rotation erkennen: Wenn die Inode sich ändert (logrotate), neue Datei von Anfang lesen
- Multiline-Support: Zeilen die nicht mit einem konfigurierbaren Pattern beginnen gehören zur vorherigen Zeile (z.B. Java Stack Traces)

**journald (Linux):**
- Via `coreos/go-systemd/v22/sdjournal`
- Cursor-Checkpointing (journald hat eigene Cursor)
- Filtern nach Units

**Windows Event Log:**
- Via Windows API (`wevtutil` oder `wevtapi.dll`)
- Bookmark-basiertes Checkpointing
- Filtern nach Channel und Level

**Batching und Transport:**
1. Log-Zeilen sammeln in Memory-Buffer
2. Wenn Buffer voll (batch_size) ODER flush_interval abgelaufen → Batch senden
3. Batch komprimiert mit zstd senden: `POST /api/logs/ingest`
4. Content-Type: `application/json` (Body ist zstd-compressed JSON Array)
5. Bei Fehler: Logs in lokale Disk-Queue schreiben (bis max 500MB)
6. Bei Recovery: Disk-Queue zuerst abarbeiten (FIFO)

**Log Entry Format (was gesendet wird):**
```json
[
  {
    "timestamp": "2026-03-27T14:23:45.123Z",
    "source": "file",
    "source_path": "/var/log/nginx/error.log",
    "service": "nginx",
    "severity": 3,      // syslog level: 0=emergency..7=debug
    "message": "2026/03/27 14:23:45 [error] connect() failed (111: Connection refused)",
    "fields": {}        // Extrahierte strukturierte Felder (optional)
  }
]
```

**Severity-Erkennung:**
Versuche aus dem Log-Text die Severity zu erkennen:
- Enthält "ERROR", "ERR", "[error]", "CRITICAL", "FATAL" → Severity 3 (Error)
- Enthält "WARN", "WARNING", "[warn]" → Severity 4 (Warning)
- Enthält "INFO", "[info]" → Severity 6 (Info)
- Enthält "DEBUG", "[debug]" → Severity 7 (Debug)
- Sonst: Severity 6 (Info) als Default

### Backend: Log Ingestion

**Endpoint:** `POST /api/logs/ingest`
- Auth: Agent-API-Key (wie bestehende Check-Daten)
- Body: zstd-komprimiertes JSON Array
- Response: `200 OK` oder `429 Too Many Requests` (mit Retry-After Header)

**Verarbeitung:**
1. Dekomprimieren
2. Validieren (Timestamp, Host zuordnen über Agent-API-Key)
3. Bulk-Insert in TimescaleDB Logs-Tabelle
4. Für Log-Alerting: Jeden Eintrag gegen aktive Log-Alert-Rules prüfen (via Redis für Performance)

**Datenbank:**

```sql
CREATE TABLE logs (
    time            TIMESTAMPTZ     NOT NULL,
    tenant_id       UUID            NOT NULL,
    host_id         INTEGER         NOT NULL,
    source          VARCHAR(20)     NOT NULL,
    source_path     TEXT,
    service         VARCHAR(255),
    severity        SMALLINT        NOT NULL,
    message         TEXT            NOT NULL,
    fields          JSONB,
    search_vector   TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', message)) STORED
);

SELECT create_hypertable('logs', 'time', chunk_time_interval => INTERVAL '1 day');

CREATE INDEX idx_logs_search ON logs USING GIN (search_vector);
CREATE INDEX idx_logs_host_time ON logs (host_id, time DESC);
CREATE INDEX idx_logs_severity ON logs (severity, time DESC);
CREATE INDEX idx_logs_service ON logs (service, time DESC);
CREATE INDEX idx_logs_tenant ON logs (tenant_id, time DESC);

-- Compression nach 2 Stunden
ALTER TABLE logs SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'tenant_id, host_id, service',
    timescaledb.compress_orderby = 'time DESC'
);
SELECT add_compression_policy('logs', compress_after => INTERVAL '2 hours');

-- Retention: 30 Tage default
SELECT add_retention_policy('logs', drop_after => INTERVAL '30 days');
```

**Log Search API:**

`POST /api/logs/search`
```json
{
  "query": "connection refused",
  "host_ids": [123],
  "services": ["nginx"],
  "severity_min": 3,
  "from": "2026-03-27T13:00:00Z",
  "to": "2026-03-27T14:00:00Z",
  "limit": 200,
  "offset": 0
}
```

Response mit Highlighting:
```json
{
  "total": 42,
  "logs": [
    {
      "time": "2026-03-27T14:23:45.123Z",
      "host": "web-01",
      "service": "nginx",
      "severity": 3,
      "message": "connect() failed (111: <mark>Connection refused</mark>)",
      "source_path": "/var/log/nginx/error.log"
    }
  ]
}
```

Verwende `ts_headline()` für Highlighting und `websearch_to_tsquery()` für natürliche Suchsyntax.

**Tests:**
1. Agent: File Tailing liest neue Zeilen
2. Agent: Checkpoint → Neustart → liest ab letztem Offset weiter
3. Agent: Batch wird nach batch_size oder flush_interval gesendet
4. Agent: Server nicht erreichbar → Disk Queue → Server wieder da → Queue abgearbeitet
5. Agent: Severity-Erkennung aus Log-Text
6. Backend: Ingest Endpoint nimmt zstd-komprimierte Daten an
7. Backend: Logs werden in TimescaleDB gespeichert
8. Backend: Search API findet Logs nach Freitext
9. Backend: Search API filtert nach Host, Service, Severity, Zeitraum
10. Backend: Highlighting funktioniert in Suchergebnissen
11. Backend: Retention Policy löscht Logs nach 30 Tagen

---

### 🔄 COMPACT — Nach Block 5.1

**Compact jetzt** (`/compact`).

**Was gebaut wurde:** Go Agent Log Collection: File Tailing (fsnotify + Offset-Checkpointing), journald (go-systemd/sdjournal), Windows Event Log. Batching (1000 Zeilen oder 5s), zstd-Kompression, Disk Queue bei Ausfall (500MB max), Severity-Erkennung aus Log-Text. Backend Log Ingestion: `POST /api/logs/ingest` (zstd-komprimiertes JSON Array), Bulk-Insert in TimescaleDB. DB: `logs` Hypertable (time, tenant_id, host_id, source, service, severity, message, fields JSONB, search_vector TSVECTOR), GIN Indexes, Compression nach 2h, Retention 30 Tage. Log Search API: `POST /api/logs/search` mit websearch_to_tsquery + ts_headline Highlighting.

---

## Block 5.2 — Log Viewer Frontend + Log-basierte Alerts

**Projekt:** github.com/lukas5001/Overseer

**Lies zuerst:** Die Log Search API: `POST /api/logs/search` (query, host_ids, services, severity_min, from/to, limit, offset → returns logs mit highlighted message). Lies auch die bestehende Alert-Rule-Konfiguration und die Frontend-Architektur. Lies die `logs` Tabelle im DB-Schema.

**Aufgabe:** Baue den Log Viewer im Frontend und Log-basierte Alert Rules.

### Log Viewer

Neuer Hauptmenü-Punkt: "Logs"

**Layout:**
```
┌──────────────────────────────────────────────────────┐
│  🔍 [Search: connection refused          ] [Search]  │
│                                                      │
│  Filters: [Host ▾] [Service ▾] [Severity ▾] [Time ▾]│
│                                            [Live 🔴] │
│  ─────────────────────────────────────────────────── │
│  14:23:45.123  web-01 / nginx    ERROR               │
│    connect() failed (111: Connection refused)        │
│    while connecting to upstream                      │
│                                                      │
│  14:23:44.891  web-01 / nginx    WARNING              │
│    upstream timed out (110: Connection timed out)     │
│                                                      │
│  14:23:44.234  db-01 / postgresql INFO               │
│    checkpoint complete: wrote 1234 buffers            │
│  ─────────────────────────────────────────────────── │
│  Showing 200 of 1,423 results            [Load More] │
└──────────────────────────────────────────────────────┘
```

**Suche:**
- Freitext-Suche: "connection refused" → findet alle Logs mit diesen Wörtern
- Exakte Phrase: `"connection refused"` (in Anführungszeichen)
- OR: `timeout OR "connection refused"`
- Ergebnis-Highlighting: Suchbegriffe gelb markiert im Text

**Filter:**
- Host: Dropdown aller Hosts (Multi-Select)
- Service: Dropdown aller Services (Multi-Select, filtert sich nach gewähltem Host)
- Severity: Checkboxen oder Dropdown (Emergency, Alert, Critical, Error, Warning, Notice, Info, Debug)
- Time Range: Quick Ranges (15min, 1h, 6h, 24h, 7d) + Custom

**Log Entry Darstellung:**
- Timestamp (monospace, mit Millisekunden): links
- Host + Service: nach dem Timestamp, farbig nach Severity
- Severity Badge: DEBUG=grau, INFO=blau, WARNING=gelb, ERROR=rot, CRITICAL=dunkelrot
- Message: darunter, kann mehrzeilig sein (Stack Traces)
- Bei Klick auf einen Eintrag: Expand → zeigt `source_path`, `fields` (strukturierte Daten), Context-Link "Show surrounding logs" (lädt Logs ±30 Sekunden um diesen Timestamp)

**Live-Tail Modus:**
Toggle "Live" oben rechts. Wenn aktiviert:
- Neue Logs erscheinen oben (neuste zuerst) und schieben sich automatisch rein
- Via WebSocket (oder Server-Sent Events)
- Suchfilter bleiben aktiv (nur passende Logs werden gestreamt)
- Rotes Pulsieren neben "Live" zeigt an dass es aktiv ist
- Pause-Modus: Klick auf "Live" wieder → Stream pausiert, man kann scrollen ohne dass es wegspringt

**Log-Korrelation mit Alerts:**
Auf der Alert-Detail-Seite: Neuer Tab "Logs". Zeigt automatisch:
- Logs des betroffenen Hosts
- Gefiltert auf Zeitraum: 5 Minuten vor dem Alert bis jetzt
- Severity-Filter auf WARNING+ (Info/Debug ausgeblendet, einblendbar)
- Der Benutzer muss nicht suchen — die relevanten Logs sind kontextbezogen da

### Log-basierte Alert Rules

In der Alert-Rule-Konfiguration: Neuer Rule-Typ "Log Pattern".

**Konfiguration:**
- **Pattern**: Regex oder einfacher Text. z.B. `OutOfMemoryError` oder `error.*connection.*refused`
- **Scope**: Alle Hosts, bestimmte Hosts, bestimmte Services
- **Severity-Filter**: Nur Logs mit mindestens dieser Severity matchen
- **Condition Type:**
  - "Any match" → Sofort alertieren beim ersten Treffer
  - "Threshold" → Alertieren wenn >N Treffer in X Minuten. z.B. ">50 errors in 5 minutes"
  - "Absence" → Alertieren wenn ein Pattern NICHT erscheint in X Minuten (z.B. Heartbeat-Monitoring)
- **Alert Severity**: Warning / Critical
- **Notification Channels**: Welche Channels benachrichtigt werden

**Backend-Implementierung für Log Alerts:**
- Bei jedem Log-Ingest: Prüfe gegen aktive Log-Alert-Rules
- Für Performance: Halte aktive Rules in Redis gecacht
- Für Threshold-Regeln: Verwende Redis Sorted Sets als Sliding Window Counter
- Für Absence-Regeln: Timer in Redis der resettet wird wenn das Pattern gesehen wird

**Tests:**
1. Log Viewer lädt und zeigt Logs
2. Suche findet relevante Logs und highlighted Treffer
3. Filter nach Host/Service/Severity funktioniert
4. Live-Tail: Neue Logs erscheinen automatisch
5. Live-Tail: Pause stoppt den Stream
6. Log-Korrelation: Alert-Detail zeigt relevante Logs
7. Log Alert Rule "Any match": Pattern im Log → Alert wird erstellt
8. Log Alert Rule "Threshold": 51 Fehler in 5 Min → Alert, 49 → kein Alert
9. Log Alert Rule "Absence": Kein Heartbeat in 10 Min → Alert

---

### 🔄 COMPACT — Nach Block 5.2

**Compact jetzt** (`/compact`).

**Was gebaut wurde:** Log Viewer Frontend: Neuer Menüpunkt "Logs", Such-Leiste (Freitext mit websearch-Syntax), Filter (Host/Service/Severity/Time), Log-Stream mit Severity-Badges und farbkodiertem Text, Ergebnis-Highlighting, klappbare mehrzeilige Einträge. Live-Tail Modus (WebSocket/SSE, Pause-Funktion). Log-Korrelation: Alert-Detail hat Tab "Logs" mit automatisch gefilterten Logs (Host + Zeitraum um den Alert). Log-basierte Alert Rules: Neuer Rule-Typ "Log Pattern" mit 3 Condition-Typen (Any match, Threshold, Absence), Pattern/Regex, Scope, Time Window. Backend: Redis Sliding Windows für Threshold-Rules, Redis Timer für Absence-Rules.

---

## Block 5.3 — SSO (OIDC + SAML + LDAP)

**Projekt:** github.com/lukas5001/Overseer

**Lies zuerst:** Die bestehende Authentifizierungs-Logik (Login-Endpoint, JWT-Erstellung, Session/Token Management, User-Tabelle, 2FA). Lies auch die Tenant-Tabelle und wie Tenant-Isolation funktioniert. Lies CLAUDE.md für Sicherheitsarchitektur-Details.

**Aufgabe:** Implementiere Single Sign-On mit OIDC, SAML und LDAP. Bestehende lokale Authentifizierung muss weiterhin funktionieren.

### Datenbank

```sql
CREATE TABLE tenant_idp_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    auth_type VARCHAR(20) NOT NULL,       -- 'oidc', 'saml', 'ldap'
    email_domains TEXT[] NOT NULL,         -- ['mueller-gmbh.de']
    -- OIDC
    oidc_discovery_url TEXT,
    oidc_client_id TEXT,
    oidc_client_secret_encrypted TEXT,
    -- SAML
    saml_metadata_url TEXT,
    saml_entity_id TEXT,
    saml_attribute_mapping JSONB,
    -- LDAP
    ldap_url TEXT,
    ldap_base_dn TEXT,
    ldap_bind_dn TEXT,
    ldap_bind_password_encrypted TEXT,
    ldap_user_filter TEXT DEFAULT '(objectClass=user)',
    -- Common
    role_mapping JSONB DEFAULT '{"*": "viewer"}',
    jit_provisioning BOOLEAN DEFAULT true,
    allow_password_fallback BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index für Home Realm Discovery (Domain → IdP Lookup)
CREATE INDEX idx_idp_domains ON tenant_idp_config USING GIN (email_domains);
```

### Login-Flow

**Schritt 1: Home Realm Discovery**
- Benutzer gibt Email ein auf der Login-Seite
- Backend: `POST /api/auth/discover` mit `{"email": "hans@mueller-gmbh.de"}`
- Backend extrahiert Domain `mueller-gmbh.de`, sucht in `tenant_idp_config` nach `email_domains @> ARRAY['mueller-gmbh.de']`
- Gefunden → Response: `{"auth_type": "oidc", "redirect_url": "https://overseer.example.com/auth/oidc/start?idp=<idp_id>"}`
- Nicht gefunden → Response: `{"auth_type": "local"}` → normales Login-Formular

**Schritt 2: OIDC Flow**
```
GET /auth/oidc/start?idp={idp_id}
  → Lade IdP Config aus DB
  → Generiere state + nonce, speichere in Redis (TTL 10min)
  → Redirect zu IdP Authorization Endpoint

IdP authenticates user, redirects back:
GET /auth/oidc/callback?code={code}&state={state}
  → Validiere state (gegen Redis)
  → Tausche code gegen access_token + id_token beim IdP Token Endpoint
  → Extrahiere Claims aus id_token (email, name, groups)
  → JIT Provisioning: User erstellen/updaten in DB
  → Rollen-Mapping: IdP Groups → Overseer Roles
  → JWT erstellen → Redirect zum Frontend mit JWT
```

Verwende `authlib` für den OIDC Flow:
```python
from authlib.integrations.httpx_client import AsyncOAuth2Client

client = AsyncOAuth2Client(client_id=idp.oidc_client_id, client_secret=decrypted_secret)
```

**Schritt 3: SAML Flow (ähnlich)**
```
GET /auth/saml/start?idp={idp_id}
  → Generiere AuthnRequest mit python3-saml
  → Redirect zu IdP SSO URL

POST /auth/saml/acs  (Assertion Consumer Service)
  → Validiere SAML Response (Signatur, Zeitstempel)
  → Extrahiere Attribute (NameID, Email, Groups)
  → JIT Provisioning + Rollen-Mapping
  → JWT erstellen → Redirect zum Frontend
```

**Schritt 4: LDAP (kein Redirect)**
```
POST /api/auth/login
  {"email": "hans@mueller-gmbh.de", "password": "..."}
  → Home Realm Discovery → auth_type = "ldap"
  → LDAP Bind mit User-Credentials
  → LDAP Search für User-Attribute (cn, mail, memberOf)
  → Rollen-Mapping
  → JWT erstellen
```

### JIT Provisioning

Beim ersten SSO-Login: User wird automatisch erstellt:
- `auth_source`: 'oidc', 'saml', 'ldap' (neues Feld in User-Tabelle)
- `external_id`: Die eindeutige ID vom IdP (sub claim bei OIDC, NameID bei SAML)
- Tenant: Aus der IdP-Config
- Rolle: Aus dem Rollen-Mapping
- Passwort: NULL (SSO-User haben kein lokales Passwort, es sei denn allow_password_fallback=true)

Bei jedem weiteren Login: Attribute aktualisieren (Name, Email, Gruppen/Rollen).

### Rollen-Mapping

`role_mapping` in der IdP-Config ist ein JSON Object:
```json
{
  "IT-Admins": "admin",
  "IT-Support": "operator",
  "Monitoring-Viewers": "viewer",
  "*": "viewer"
}
```

Bei OIDC: Groups kommen aus dem `groups` Claim.
Bei SAML: Groups kommen aus einem konfigurierbaren Attribut.
Bei LDAP: Groups kommen aus `memberOf`.

Erste Gruppe die matcht bestimmt die Rolle. `*` ist der Fallback.

### Sicherheit

- OIDC state Parameter gegen CSRF
- SAML Response Signatur-Validierung
- Client Secrets verschlüsselt speichern (bestehendes AES-256-GCM)
- LDAP: Nur über TLS (ldaps://) oder StartTLS
- Token Blacklist: Bei Logout → JWT in Redis Blacklist (SETEX mit TTL = JWT Remaining Lifetime)

### Frontend

**Login-Seite anpassen:**
1. Email-Feld → bei Eingabe (onBlur oder nach Enter): `/api/auth/discover` aufrufen
2. Wenn SSO → "Continue with [Provider Name]" Button → Redirect zum SSO-Flow
3. Wenn local → Passwort-Feld einblenden → normaler Login

**Admin UI: Settings → Authentication**
- Liste aller konfigurierten IdPs pro Tenant
- "+ Add Identity Provider" → Wizard:
  1. Typ wählen (OIDC / SAML / LDAP)
  2. Provider-spezifische Felder ausfüllen
  3. Email-Domains eingeben
  4. Rollen-Mapping konfigurieren
  5. "Test Connection" → öffnet SSO-Flow in Popup
  6. Aktivieren

**Tests:**
1. Home Realm Discovery: Email mit bekannter Domain → SSO-Redirect
2. Home Realm Discovery: Email mit unbekannter Domain → lokales Login
3. OIDC: Vollständiger Flow (mit einem Test-IdP wie Keycloak oder Auth0 Dev-Account)
4. JIT Provisioning: Neuer SSO-User wird automatisch erstellt
5. Rollen-Mapping: IdP-Gruppe wird korrekt auf Overseer-Rolle gemappt
6. Wiederholter Login: Attribute werden aktualisiert
7. Password Fallback: Wenn aktiviert → SSO-User kann auch mit lokalem Passwort einloggen
8. Sicherheit: Ungültiger state Parameter → Fehler
9. Sicherheit: LDAP ohne TLS → Fehler/Warnung
10. Bestehende lokale Logins funktionieren weiterhin unverändert

---

### 🔄 COMPACT — Nach Block 5.3

**Compact jetzt** (`/compact`).

**Was gebaut wurde:** SSO System. DB: `tenant_idp_config` (auth_type oidc/saml/ldap, email_domains, oidc_discovery_url + client_id/secret, saml_metadata_url, ldap_url + base_dn + bind_dn, role_mapping JSONB, jit_provisioning, allow_password_fallback). Home Realm Discovery: `POST /api/auth/discover` → Email-Domain → IdP Lookup. OIDC Flow: `/auth/oidc/start` → IdP Redirect → `/auth/oidc/callback` (authlib). SAML Flow: `/auth/saml/start` → `/auth/saml/acs` (python3-saml). LDAP: Direct bind via ldap3. JIT Provisioning: User auto-erstellt bei erstem Login, Attribute bei jedem Login aktualisiert. Rollen-Mapping: IdP Groups → Overseer Roles. Frontend: Login-Seite mit SSO-Button + Home Realm Discovery, Admin UI für IdP-Konfiguration (Settings → Authentication).

---

## Block 5.4 — Anomaly Detection & Predictive Alerts

**Projekt:** github.com/lukas5001/Overseer

**Lies zuerst:** Die Metrik-Datenstrukturen (wo und wie Metriken gespeichert werden, Tabellennamen). Lies die Continuous Aggregates (`metrics_5m`, `metrics_hourly`, `metrics_daily`). Lies den bestehenden AI-Service (Ollama-Integration) falls vorhanden. Lies die bestehende Alert-Erstellungs-Logik.

**Aufgabe:** Implementiere Anomaly Detection (lernt was normal ist, alertiert bei Abweichungen) und Predictive Alerts (sagt voraus wann Ressourcen erschöpft sind).

### Anomaly Detection: Baseline Learning

**Baselines:**
Für jede Metrik jedes Hosts werden Normalwerte gelernt, aufgeteilt in 168 Buckets (7 Tage × 24 Stunden). So weiß das System: "Montag um 14 Uhr ist CPU von 45% normal, Sonntag um 3 Uhr sind 10% normal."

```sql
CREATE TABLE metric_baselines (
    host_id INTEGER NOT NULL,
    metric_name VARCHAR(255) NOT NULL,
    day_of_week SMALLINT NOT NULL,     -- 0=Montag
    hour_of_day SMALLINT NOT NULL,     -- 0-23
    mean DOUBLE PRECISION NOT NULL,
    std_dev DOUBLE PRECISION NOT NULL,
    median DOUBLE PRECISION,
    sample_count INTEGER NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (host_id, metric_name, day_of_week, hour_of_day)
);

CREATE TABLE anomaly_config (
    host_id INTEGER NOT NULL,
    metric_name VARCHAR(255) NOT NULL,
    enabled BOOLEAN DEFAULT false,
    sensitivity DOUBLE PRECISION DEFAULT 3.0,  -- Z-Score Threshold
    min_training_days INTEGER DEFAULT 7,
    status VARCHAR(20) DEFAULT 'disabled',    -- disabled, learning, active
    learning_started_at TIMESTAMPTZ,
    activated_at TIMESTAMPTZ,
    PRIMARY KEY (host_id, metric_name)
);

CREATE TABLE anomaly_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id INTEGER NOT NULL,
    metric_name VARCHAR(255) NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    expected_mean DOUBLE PRECISION NOT NULL,
    expected_std DOUBLE PRECISION NOT NULL,
    z_score DOUBLE PRECISION NOT NULL,
    is_false_positive BOOLEAN DEFAULT false,
    feedback_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Baseline Berechnung (Background Job, täglich):**
1. Für jede aktive Anomaly-Config:
2. Query die letzten 14-28 Tage Metriken aus `metrics_hourly` Continuous Aggregate
3. Gruppiere nach (day_of_week, hour_of_day)
4. Berechne Mean, Std Dev, Median pro Bucket
5. Upsert in `metric_baselines`

**Anomaly Detection (Background Job, alle 5 Minuten):**
1. Für jede Metrik mit `anomaly_config.status = 'active'`:
2. Lade den aktuellen Wert
3. Lade die Baseline für den aktuellen Wochentag und Stunde
4. Berechne Z-Score: `z = (value - mean) / std_dev`
5. Wenn `|z| > sensitivity` → Anomalie!
6. Anomalie-Event in `anomaly_events` speichern
7. Optional: Alert erstellen (wenn der Benutzer Anomaly-Alerts aktiviert hat)

### Predictive Alerts

**Vorhersage wann eine Ressource erschöpft ist.**

Funktioniert für: Disk Usage, Database Size, jede Metrik die monoton steigt.

**Background Job (täglich):**
1. Für relevante Metriken (disk_usage, db_size, etc.):
2. Query die letzten 30 Tage aus `metrics_daily`
3. Lineare Regression: `sklearn.linear_model.LinearRegression`
4. Berechne:
   - `rate_per_day`: Wie schnell wächst die Metrik?
   - `days_until_full`: (capacity - current) / rate_per_day
   - `confidence`: R² Score der Regression (>0.8 = zuverlässig)
5. Wenn `days_until_full < 30` UND `confidence > 0.7` → Prediction Event

```sql
CREATE TABLE predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id INTEGER NOT NULL,
    metric_name VARCHAR(255) NOT NULL,
    current_value DOUBLE PRECISION NOT NULL,
    capacity DOUBLE PRECISION NOT NULL,
    rate_per_day DOUBLE PRECISION NOT NULL,
    days_until_full DOUBLE PRECISION,
    predicted_date DATE,
    confidence DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Capacity Werte:** Woher weiß das System was "100%" ist?
- Disk: Der Agent sendet bereits Disk-Kapazität in den Check-Daten
- Memory: Ebenso
- Custom: Der Benutzer kann manuell eine Kapazität setzen

**Alert-Logik für Predictions:**
- >30 Tage → Info (nur im UI)
- 14-30 Tage → Warning
- 7-14 Tage → High
- <7 Tage → Critical

### Frontend

**Host/Service Detail → Tab "Anomaly Detection":**

```
Anomaly Detection: [Toggle ON/OFF]
Status: Active (learning complete)
Sensitivity: [Low ○] [Normal ●] [High ○]

Baseline Chart:
[Line Chart: Actual values (blue) + Expected range (green band) + Anomaly markers (red dots)]

Recent Anomalies:
| Time | Value | Expected | Z-Score | Status |
| Mar 27 14:00 | 78.3% | 28-47% | 4.2 | ⚡ Anomaly |
| Mar 25 03:00 | 2.1% | 8-15% | -3.8 | 🚫 False Positive |
```

"Mark as False Positive" Button bei jeder Anomalie → speichert Feedback in `anomaly_events`.

**Host/Service Detail → Prediction Card:**
Wenn eine aktive Prediction existiert:
```
⏰ Disk /data — Predicted full in 24 days
Current: 87% (435 GB / 500 GB)
Growth: 1.2 GB/day
Full by: April 20, 2026
Confidence: High (94%)
[View Trend]
```

**Dashboard Widget:** "Predictions" Widget zeigt eine Tabelle aller aktiven Predictions sortiert nach Dringlichkeit.

**Tests:**
1. Anomaly Config aktivieren → Status wechselt auf "learning"
2. Nach min_training_days → Status wechselt auf "active"
3. Baseline Berechnung: Mean/StdDev werden korrekt berechnet
4. Z-Score Berechnung: Wert außerhalb des Normalbereichs → Anomalie erkannt
5. Z-Score Berechnung: Wert innerhalb → keine Anomalie
6. Sensitivity Low/Normal/High: Mehr/weniger Anomalien je nach Einstellung
7. False Positive markieren → Event wird aktualisiert
8. Predictive Alert: Linear wachsende Disk → korrektes Erschöpfungsdatum
9. Predictive Alert: Nicht-linearer Verlauf → niedrige Confidence → kein Alert
10. Predictive Alert: Rate ≤ 0 (Metrik sinkt) → "will not exhaust"
11. Frontend: Baseline Chart zeigt expected range + anomaly markers
12. Frontend: Prediction Card zeigt korrekte Daten

---

### 🔄 COMPACT — Nach Block 5.4 (Ende Phase 5)

**Alles ist fertig.** Alle 10 Features sind implementiert.

**Gesamtübersicht aller Features:**
1. SSL Certificate Monitoring
2. Notification Plugin System (Slack, Teams, Telegram)
3. Alert Grouping
4. Custom Dashboards (Grid, Widgets, Variables, Sharing)
5. PDF Reports (Scheduling, Branding, Delivery)
6. Public Status Pages (Incidents, Uptime, Subscribers)
7. Auto-Discovery (Network Scan, Service Discovery, Agent Registration)
8. Alert Suppression / Dependencies
9. Log Management (Collection, Ingestion, Viewer, Log-Alerts)
10. SSO (OIDC, SAML, LDAP)
11. Anomaly Detection + Predictive Alerts
