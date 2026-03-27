# Overseer — Implementierungsplan zur Marktdominanz

> Sortiert nach Relevanz und Impact. Jeder Punkt enthält Architekturentscheidungen,
> Technologiewahl, Datenbankschema, Code-Patterns, Integrationsdetails —
> **und vollständige Anwendungslogik: was der Benutzer sieht, wann, und warum.**
>
> Bezieht sich auf den bestehenden Stack: Python/FastAPI, PostgreSQL+TimescaleDB, Redis, Go (Agent/Collector), React/TypeScript/Vite.

---

## FEATURE 1: Custom Dashboards (Drag & Drop)

### Warum Priorität 1
Jeder einzelne Konkurrent hat konfigurierbare Dashboards. Ohne das wirkt ein Monitoring-Tool unfertig. Grafana, Datadog, Zabbix, CheckMK — alle bieten es. Overseer hat aktuell Mini-Graphs und eine Error-Übersicht, aber der User kann keine eigenen Views zusammenbauen.

### Anwendungslogik

#### Erster Kontakt: Was sieht ein neuer Tenant?

Wenn ein neuer Tenant erstellt wird, bekommt er automatisch ein **Default Dashboard** namens "Overview". Dieses Dashboard wird aus einem System-Template generiert und enthält:
- Stat-Widget "Hosts Total" (Anzahl aller Hosts)
- Stat-Widget "Services OK / Warning / Critical" (drei nebeneinander, farbcodiert)
- Gauge "Durchschnittliche CPU aller Hosts"
- Line Chart "Alerts letzte 24h" (Timeline)
- Table "Letzte 10 Alerts" (Host, Service, Severity, Zeitpunkt)

Das Default Dashboard ist **nicht löschbar** aber editierbar. Der Benutzer sieht es sofort nach dem Login als Startseite. Es zeigt auch ohne Konfiguration sofort Wert — sobald der erste Host Daten liefert, füllen sich die Widgets.

#### Dashboard erstellen

Der Benutzer klickt in der linken Navigation auf "Dashboards". Er sieht eine Liste aller Dashboards (Kacheln mit Titel, Beschreibung, letzter Änderung, Ersteller). Oben rechts: Button "+ New Dashboard".

Klick auf "+ New Dashboard" öffnet einen Dialog mit drei Optionen:
1. **Blank Dashboard** — leeres Grid, Benutzer baut von Null auf
2. **From Template** — Liste von System-Templates (z.B. "Linux Server Overview", "Network Devices", "Windows Server", "Web Service Health")
3. **Clone Existing** — ein bestehendes Dashboard kopieren und anpassen

Bei Option 1 und 2 wird nach Titel und optionaler Beschreibung gefragt. Das Dashboard wird sofort erstellt und der Benutzer landet im Edit-Modus.

#### Edit-Modus vs. View-Modus

**View-Modus** (Standard): Widgets zeigen Live-Daten, kein Drag/Drop möglich. Oben rechts ein "Edit"-Button (Bleistift-Icon). Time-Range-Picker und Variable-Dropdowns sind nutzbar.

**Edit-Modus**: Wird aktiviert durch Klick auf "Edit". Jetzt passiert folgendes:
- Das Grid wird sichtbar (leichte Rasterlinien)
- Jedes Widget bekommt einen blauen Rand und in der oberen rechten Ecke drei Icons: Verschieben (Drag-Handle), Konfigurieren (Zahnrad), Löschen (X)
- Unten rechts erscheint ein floating "+ Add Widget" Button
- Oben erscheint eine Toolbar: "Save", "Discard Changes", "Settings" (Dashboard-Einstellungen)
- Widgets können jetzt per Drag & Drop verschoben und an den Rändern resized werden

**Wichtig:** Während der Edit-Modus aktiv ist, aktualisieren sich die Widgets weiterhin mit Live-Daten. Der Benutzer sieht also immer echte Daten, auch beim Umbauen. Das ist bewusst so — er soll sehen ob das Layout mit echten Daten funktioniert.

#### Widget hinzufügen

Klick auf "+ Add Widget" öffnet einen **Widget-Picker** als Slide-Over-Panel von rechts:

Das Panel zeigt eine kategorisierte Liste:
- **Visualization**: Line Chart, Bar Chart, Gauge, Heatmap, Pie/Donut
- **Data**: Table, Stat/Single Value, Status Indicator
- **Information**: Text/Markdown, Alert List, Log Stream

Jeder Eintrag hat ein kleines Preview-Bild und einen Einzeiler was es tut. Klick auf einen Widget-Typ → es wird sofort ins Grid eingefügt an der **nächsten freien Position** (unterhalb des letzten Widgets) mit einer Standard-Größe. Der Widget-Konfigurationsdialog öffnet sich automatisch.

#### Widget konfigurieren

Der Konfigurationsdialog hat **drei Tabs**:

**Tab 1: Data (Datenquelle)**
- Dropdown "Metric": Zeigt alle verfügbaren Metriken (cpu_usage, memory_usage, disk_usage, etc.) — die Liste wird dynamisch aus den tatsächlich vorhandenen Metrik-Namen generiert
- Dropdown "Host": Alle Hosts des Tenants, oder "$host" um die Dashboard-Variable zu nutzen
- Dropdown "Service": Alle Services des gewählten Hosts
- Dropdown "Aggregation": Last, Average, Min, Max, Sum, Count
- Feld "Time Range": "Use dashboard time" (Default) oder eigene Range pro Widget

Was der Benutzer hier versteht: Er wählt einfach "welche Metrik von welchem Host". Kein Query-Editor, kein SQL. Die Dropdowns filtern sich gegenseitig — wählt man einen Host, zeigt das Service-Dropdown nur die Services dieses Hosts.

**Tab 2: Display (Darstellung)**
- Titel (Freitext, Default: automatisch generiert aus Metrik+Host)
- Farbe/Farbpalette
- Unit (Percent, Bytes, Milliseconds, Count, Custom)
- Dezimalstellen
- Min/Max-Achse (Auto oder manuell)
- Thresholds (Schwellwerte mit Farben): z.B. 0-70=grün, 70-90=orange, 90-100=rot
- Legende anzeigen ja/nein
- Stacked/Grouped (bei Bar Charts)

**Tab 3: Advanced**
- Eigenes Refresh-Intervall (überschreibt Dashboard-Default)
- "No data" Nachricht konfigurieren
- Link zu weiterführender Seite (Klick auf Widget öffnet z.B. Host-Detail)

Unten im Dialog: "Apply" (Vorschau aktualisiert sofort im Hintergrund) und "Done" (schließt Dialog).

**Wichtige UX-Regel:** Jede Änderung in den Konfigurationsfeldern aktualisiert das Widget **sofort live im Hintergrund**. Der Benutzer sieht also in Echtzeit wie sich z.B. ein Threshold-Farbwechsel auf das Gauge auswirkt, bevor er "Done" klickt.

#### Dashboard-Variablen (Dropdown-Filter oben)

Variablen erscheinen als Dropdowns in einer Leiste direkt unter dem Dashboard-Titel. Beispiel: Ein Dashboard hat die Variable "Host" — oben erscheint ein Dropdown mit allen Hosts. Wählt der Benutzer "web-01" aus, aktualisieren sich **alle Widgets** die `$host` referenzieren.

**Wie erstellt man eine Variable?**
Im Edit-Modus → Dashboard Settings (Zahnrad oben) → Tab "Variables" → "+ Add Variable":
- Name: `host` (wird als `$host` in Widgets referenziert)
- Label: "Host" (was im Dropdown-Label steht)
- Typ: "Query" (Werte aus der Datenbank) oder "Custom" (feste Werte wie "production,staging,development")
- Bei Query: Die Werte werden automatisch generiert aus den vorhandenen Hosts/Services des Tenants
- Multi-Select: Ja/Nein (darf der Benutzer mehrere Hosts gleichzeitig wählen?)
- "Include All": Zeigt eine "All" Option die alle Werte auf einmal auswählt

**Kaskadierung:** Variable B kann Variable A referenzieren. Beispiel:
- Variable "Environment" hat Werte: Production, Staging
- Variable "Host" zeigt nur Hosts aus dem gewählten Environment
- Ändert der Benutzer das Environment, aktualisiert sich der Host-Dropdown automatisch

**URL-Sync:** Die ausgewählten Variablenwerte werden in der URL gespeichert: `?var-host=web-01&var-env=production`. Das bedeutet: Dashboard-Links mit bestimmten Filtern können geteilt und gebookmarkt werden.

#### Time Range Picker

Oben rechts im Dashboard: Ein Time-Range-Picker mit zwei Teilen:
- **Quick Ranges**: "Last 15 min", "Last 1h", "Last 6h", "Last 24h", "Last 7d", "Last 30d"
- **Custom Range**: Von/Bis Datepicker für beliebige Zeiträume

Daneben: Auto-Refresh-Dropdown ("Off", "10s", "30s", "1min", "5min"). Im View-Modus ist 30s der Default.

Alle Widgets benutzen diese Time Range, es sei denn ein Widget hat in seinem "Advanced"-Tab eine eigene Range konfiguriert.

#### Speichern und Versionierung

Klickt der Benutzer im Edit-Modus auf "Save":
1. Das aktuelle Layout + alle Widget-Konfigurationen werden als JSON in der `config`-Spalte gespeichert
2. Eine Kopie wird in `dashboard_versions` gespeichert (automatisch)
3. Der Edit-Modus wird beendet, der Benutzer ist wieder im View-Modus

**Undo/Versionierung:** Im Edit-Modus gibt es unter "Settings" einen Tab "History" der die letzten 20 Versionen zeigt (Zeitstempel + wer hat gespeichert). Klick auf eine Version → Vorschau → "Restore this version".

**Concurrent Editing:** Wenn ein anderer Benutzer dasselbe Dashboard gerade editiert, zeigt das System beim Öffnen des Edit-Modus eine Warnung: "User X is currently editing this dashboard. Your changes might conflict." Es gibt kein Lock — Last-Write-Wins, aber mit Warnung.

#### Dashboard teilen

Im View-Modus: "Share"-Button (oben rechts neben Edit).

Drei Optionen:
1. **Internal Link**: Kopiert die URL mit aktuellen Variablen — nur für eingeloggte Benutzer desselben Tenants
2. **Public Link**: Generiert einen Token-basierten Link der ohne Login funktioniert. Optionen: Ablaufdatum, Variablen fixieren (der Public-Viewer kann Filter nicht ändern). Public Dashboards sind Read-Only, kein Edit-Button.
3. **Embed (iframe)**: Generiert einen `<iframe>` HTML-Snippet. Für Einbettung in andere Webseiten, Wikis, oder TV-Displays.

**TV-Modus Integration:** Overseer hat bereits einen TV-Mode. Dashboards sollten dort als Option erscheinen: Der Benutzer kann in der TV-Mode-Konfiguration auswählen welche Dashboards rotiert werden sollen, mit konfigurierbarer Verweildauer pro Dashboard (z.B. 30 Sekunden).

#### Responsive Verhalten

Das Grid hat Breakpoints: `lg` (≥1200px), `md` (≥996px), `sm` (≥768px), `xs` (<768px). Für jeden Breakpoint kann das Layout separat gespeichert werden. Beim ersten Erstellen wird nur das `lg`-Layout gesetzt — die kleineren Breakpoints werden **automatisch berechnet** (Widgets stapeln sich vertikal). Der Benutzer kann aber im Edit-Modus auf ein Tablet-Icon klicken und das Layout für kleinere Bildschirme manuell anpassen.

### Architekturentscheidung

**Grid Layout: react-grid-layout** (das was Grafana verwendet)
- 24-Spalten-Grid, Widgets mit `{x, y, w, h}` positioniert
- Built-in Drag, Drop, Resize, Collision Detection
- Responsive Breakpoints (lg/md/sm/xs)
- `onLayoutChange` Callback für Persistenz

Alternativen evaluiert und verworfen:
- `dnd-kit`: Kein Grid-Snapping, kein Resize — müsste man alles selbst bauen
- `gridstack.js`: jQuery-Basis, React-Integration hakelig
- `react-mosaic`: IDE-Style Tiling, nicht für Dashboards gedacht

**Charting: Apache ECharts (echarts-for-react) + Recharts behalten**
- Recharts ist bereits im Projekt — für einfache Stat-Widgets und Bars weiter nutzen
- ECharts für alles was Performance braucht: Echtzeit-Zeitreihen, Heatmaps, Gauges, große Datensätze
- Canvas-Rendering (vs. Recharts SVG) — deutlich besser bei häufigen Updates
- Tree-Shakable: nur benötigte Chart-Typen importieren (~10-15KB für Line + Gauge + Bar)
- WebGL-Modus für Millionen von Datenpunkten

### Widget-Typen

**Phase 1 (Essential):**

| Widget | Use Case | Datenformat |
|--------|----------|-------------|
| Stat / Single Value | Aktuelle CPU%, Uptime, Error Count | Einzelwert + optionale Sparkline |
| Gauge | CPU/Memory gegen Schwellwerte | Einzelwert + Min/Max/Thresholds |
| Line Chart (Time Series) | Metrik-Verlauf über Zeit | Array `{timestamp, value}` pro Serie |
| Bar Chart | Vergleiche (Errors per Service) | Array `{category, value}` |
| Table | Alerts, Logs, Host-Liste | Array von Rows mit Columns |
| Status Indicator | Host up/down, Service Health | Enum: ok/warning/critical/unknown |

**Phase 2:**
Heatmap, Pie/Donut, Status Map/Grid, Stacked Area, Alert List, Text/Markdown

**Phase 3:**
Histogram, Scatter Plot, Topology/Node Graph, Log Stream, Sparkline Table

### Datenbank-Schema

```sql
CREATE TABLE dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    config JSONB NOT NULL DEFAULT '{}',
    is_default BOOLEAN DEFAULT false,
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

### Dashboard Config JSON-Struktur (in `config` JSONB)

```json
{
  "schemaVersion": 1,
  "timeSettings": {
    "from": "now-1h",
    "to": "now",
    "refreshInterval": 30,
    "timezone": "browser"
  },
  "variables": [
    {
      "name": "host",
      "type": "query",
      "label": "Host",
      "query": "SELECT DISTINCT hostname FROM hosts WHERE tenant_id = $tenant_id",
      "multi": true,
      "includeAll": true,
      "refresh": "on_dashboard_load"
    }
  ],
  "widgets": {
    "cpu-gauge": {
      "type": "gauge",
      "title": "CPU Usage",
      "dataSource": {
        "type": "metric",
        "metricQuery": {
          "metricNames": ["cpu_usage"],
          "hostFilter": "$host",
          "aggregation": "last"
        }
      },
      "options": {
        "unit": "percent",
        "min": 0,
        "max": 100,
        "thresholds": {
          "mode": "absolute",
          "steps": [
            { "value": 0, "color": "#73BF69" },
            { "value": 70, "color": "#FF9830" },
            { "value": 90, "color": "#F2495C" }
          ]
        }
      }
    }
  },
  "layout": {
    "breakpoints": {
      "lg": [
        { "i": "cpu-gauge", "x": 0, "y": 0, "w": 6, "h": 8, "minW": 4, "minH": 6 }
      ]
    }
  }
}
```

### Echtzeit-Updates

**Hybrid-Ansatz:**
- **Per-Widget Polling** für Metrik-Daten (jedes Widget steuert sein eigenes Refresh-Intervall)
- **WebSocket** für Alert-Notifications und Live-Status-Änderungen (über Redis Pub/Sub)
- **Visibility-Aware**: Polling pausiert wenn Browser-Tab hidden ist (`document.visibilityState`)
- **Debounce**: Variable-Änderungen 300ms debounced bevor alle Widgets refreshen
- **Stale-While-Revalidate**: Vorherige Daten anzeigen während neue laden

### Persistenz-Flow

```
User draggt Widget → onLayoutChange → debounce(500ms) →
  1. React State sofort updaten (optimistisch)
  2. PATCH /api/dashboards/:id { layout: newLayout }
  3. Server validiert + speichert in PostgreSQL JSONB
  4. Insert in dashboard_versions für Undo-History
```

---

## FEATURE 2: Scheduled PDF Reports (Branded)

### Warum Priorität 2
MSP-Killer-Feature. Kunden zahlen für professionelle Berichte die automatisch monatlich kommen. Zabbix, CheckMK und Nagios XI haben das alle. Overseer hat SLA-Tracking aber keine generierten Reports. Branded PDF-Reports mit Kundenlogo sind ein direkter Revenue-Driver.

### Anwendungslogik

#### Wer bekommt Reports und warum?

Die typische Situation: Ein MSP betreut 30 Kunden. Jeder Kunde hat einen IT-Verantwortlichen und einen Geschäftsführer. Der IT-Verantwortliche will technische Details (welche Systeme hatten Probleme, Auslastung, Trends). Der Geschäftsführer will eine Ampel (läuft alles? Geld gut investiert?).

Daraus ergeben sich **zwei Report-Typen** die das System von Anfang an mitbringen muss:

1. **Executive Summary** — eine Seite, große Zahlen, Ampelfarben, Vergleich zum Vormonat. Für Geschäftsführer.
2. **Technical Report** — mehrseitig, alle Metriken, Incident-Liste, SLA-Tabelle, Trend-Charts. Für IT-Verantwortliche.

Der MSP kann pro Kunde konfigurieren wer welchen Report bekommt.

#### Report-Schedule einrichten

Navigation: Settings → Reports → "+ New Report Schedule"

**Schritt 1: Report-Typ wählen**
- Executive Summary (1-2 Seiten)
- Technical Report (5-15 Seiten)
- SLA Report (nur SLA/Availability-Daten)
- Custom (eigene Sections zusammenstellen)

**Schritt 2: Zeitraum und Rhythmus**
- Rhythmus: Wöchentlich (Montag morgens), Monatlich (1. des Monats), Quartalsweise
- Zeitzone: Default aus Tenant-Settings, aber pro Schedule überschreibbar
- Versandzeit: Default 08:00 Uhr morgens — der Report soll im Postfach liegen wenn der Kunde ins Büro kommt

**Schritt 3: Scope — was wird berichtet?**
- Alle Hosts/Services des Tenants (Default)
- Nur bestimmte Host-Gruppen oder Tags (z.B. nur "Production"-Server)
- Nur bestimmte Services (z.B. nur die 5 wichtigsten)

Das ist wichtig: Ein MSP hat vielleicht 50 Hosts für einen Kunden, aber im Executive Report sollen nur die 10 wichtigsten erscheinen. Der Rest ist Rauschen für den Geschäftsführer.

**Schritt 4: Empfänger**
- E-Mail-Adressen eingeben (Freitext + Autovervollständigung aus bekannten Kontakten)
- Optional: CC-Adressen
- Der MSP-Techniker kann sich selbst als BCC hinzufügen (er will sehen was der Kunde sieht)

**Schritt 5: Branding**
- Logo hochladen (wird oben rechts auf jeder Seite platziert)
- Firmenname (erscheint in der Kopfzeile)
- Primärfarbe (wird für Überschriften und Akzente verwendet)
- Fußzeile (z.B. "Erstellt von Acme IT Services — www.acme-it.com")
- Optional: Anschreiben-Text (ein Absatz der über dem Report-Inhalt erscheint, z.B. "Sehr geehrter Herr Müller, anbei Ihr monatlicher Infrastruktur-Report...")

**Schritt 6: Vorschau und Aktivierung**
- Button "Generate Preview" → System erstellt den Report für den letzten verfügbaren Zeitraum und zeigt ihn als PDF im Browser an
- Der Benutzer prüft: Stimmt das Layout? Sind die richtigen Hosts drin? Passt das Logo?
- Button "Activate Schedule" → Der Schedule wird aktiv, nächster Versand wird angezeigt

#### Was steht in einem Report? (Section by Section)

**Executive Summary Report:**

*Seite 1: Deckblatt*
- Kundenlogo + MSP-Logo
- Titel: "Infrastructure Report — März 2026"
- Zeitraum: "01.03.2026 – 31.03.2026"
- Erstellt am: "01.04.2026 08:00 CET"

*Seite 2: Zusammenfassung*
- **Health Score** als große Zahl mit Ampelfarbe: z.B. "94%" in Grün (berechnet aus: gewichteter Durchschnitt der Verfügbarkeit aller Services)
- **Vergleich zum Vormonat**: Pfeil nach oben/unten mit Differenz ("↑ +2.3% gegenüber Februar")
- **KPI-Kästchen** (4 nebeneinander):
  - Hosts monitored: 47
  - Services monitored: 312
  - Incidents: 8 (davon 2 Critical)
  - Durchschn. Reaktionszeit: 4.2 min
- **Top 3 Positives**: "Kein einziger Datenbankausfall", "Webserver-Verfügbarkeit 99.98%", "Backup-Jobs 100% erfolgreich"
- **Top 3 Concerns**: "Disk-Auslastung Server DB-02 bei 87%", "SSL-Zertifikat api.kunde.de läuft am 15.04. ab", "3 ungeplante Neustarts von App-Server-01"

Das System generiert Positives und Concerns **automatisch** nach folgender Logik:
- Positives: Services mit 100% Uptime, Null Incidents für wichtige Services, Verbesserungen gegenüber Vormonat
- Concerns: Services mit niedrigster Verfügbarkeit, Hosts mit höchster Ressourcenauslastung, bevorstehende Ablaufdaten (SSL-Zertifikate), wiederkehrende Probleme (gleicher Alert >3x im Monat)

**Technical Report (zusätzliche Sections):**

*SLA / Availability Table:*
Tabelle mit einer Zeile pro Service:
| Service | SLA Target | Achieved | Downtime | Status |
|---------|-----------|----------|----------|--------|
| Webserver | 99.9% | 99.98% | 8 min | ✓ |
| Database | 99.95% | 99.87% | 56 min | ✗ |

Rot markiert wenn Target verfehlt, Grün wenn erreicht.

*Incident Timeline:*
Chronologische Liste aller Incidents mit: Zeitpunkt, Dauer, betroffener Service, Severity, ob Downtime angerechnet wurde (wenn geplante Wartung → nein).

*Performance Charts:*
Pro Host (oder pro Host-Gruppe): Line Charts für CPU, Memory, Disk über den gesamten Zeitraum. Farbige Bänder für Warning/Critical-Thresholds. Der Chart zeigt den Durchschnitt als Linie und Min/Max als schattierte Fläche.

*Trend Analysis:*
Monat-über-Monat-Vergleich als Bar Chart: z.B. "Incidents pro Monat" der letzten 6 Monate, "Durchschnittliche CPU" der letzten 6 Monate. Zeigt ob es besser oder schlechter wird.

*Capacity Planning:*
Tabelle mit Prognosen:
| Resource | Current | Trend | Projected Full | Action Required |
|----------|---------|-------|----------------|----------------|
| Disk /data (DB-02) | 87% | +2.1%/Monat | Juli 2026 | Ja |
| Memory (App-01) | 72% | +0.3%/Monat | Stabil | Nein |

#### On-Demand Reports

Nicht jeder Report muss scheduled sein. In der Report-Übersicht gibt es einen Button "Generate Now" der sofort einen Report für einen wählbaren Zeitraum erstellt. Use Case: Der Kunde ruft an und will wissen wie der letzte Monat war, aber es gibt noch keinen Schedule. Oder: Ein Incident ist gerade vorbei und der MSP will dem Kunden einen Incident-Report schicken.

#### Report-History

Unter Reports → Delivery History sieht der Benutzer eine Liste aller jemals versendeten Reports:
- Zeitstempel, Report-Typ, Empfänger, Status (Sent/Failed)
- Button "Download PDF" um den Report erneut herunterzuladen
- Button "Resend" um den Report erneut per E-Mail zu verschicken
- Bei Fehler: Fehlermeldung sichtbar (z.B. "SMTP connection refused")

Reports werden **30 Tage als PDF auf dem Server gespeichert**, danach gelöscht. Der Benutzer kann in den Settings eine längere Retention konfigurieren.

#### Was passiert wenn Daten fehlen?

Wenn für den Report-Zeitraum keine Daten vorhanden sind (z.B. neuer Tenant, Host erst seit 2 Tagen aktiv):
- Widgets zeigen "Insufficient data" statt leerer Charts
- Der Health Score wird mit "N/A" angezeigt statt einer irreführenden Zahl
- Trends zeigen "Not enough history" statt falscher Trendlinien
- Der Report wird trotzdem gesendet, aber mit einem Hinweis oben: "Note: Some metrics have limited data for this reporting period."

### Architekturentscheidung

**PDF-Engine: WeasyPrint + Jinja2**
- HTML/CSS → PDF, kein Browser nötig (kein Chromium-Dependency)
- Native SVG-Rendering (Charts bleiben scharf)
- Unterstützt `@page`-Rules (Kopfzeilen, Fußzeilen, Seitenzahlen)
- CSS Variables für Branding (Farben, Fonts pro Tenant)

Alternativen evaluiert:
- ReportLab: Kein HTML/CSS — alles programmatisch, Template-Änderungen erfordern Code-Änderungen
- xhtml2pdf: Nur CSS 2.1, kein Flexbox/Grid, sieht unprofessionell aus
- Playwright: Braucht Chromium (~400MB), Overkill wenn Charts server-seitig gerendert werden

**Chart-Rendering: Plotly + Kaleido**
- Plotly erzeugt professionelle Charts (Line, Bar, Gauge, Heatmap)
- Kaleido exportiert als SVG (Vektorgrafik, scharf bei jedem Zoom)
- Pipeline: `Plotly Figure → Kaleido → SVG → Jinja2 Template → WeasyPrint → PDF`

### Report-Scheduling: APScheduler

APScheduler mit `AsyncIOScheduler` — läuft in-process mit FastAPI, keine zusätzliche Infrastruktur nötig.

Warum nicht Celery Beat: Braucht separaten Beat-Prozess + separaten Worker-Prozess + Message Broker. Overkill für einen einzelnen VPS.

### Datenbank-Schema

```sql
CREATE TABLE report_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    report_type VARCHAR(50) NOT NULL,        -- 'executive_summary', 'technical', 'sla', 'custom'
    cron_expression VARCHAR(100) NOT NULL,    -- '0 8 1 * *'
    recipients JSONB NOT NULL,                -- {"to": ["cto@kunde.de"], "cc": [], "bcc": ["tech@msp.de"]}
    scope JSONB NOT NULL,                     -- {"host_ids": [...], "tags": [...], "all": false}
    sections JSONB NOT NULL,                  -- ["executive_summary", "sla_table", "incidents", "performance"]
    branding JSONB NOT NULL,                  -- {"logo_path": "...", "primary_color": "...", "company_name": "..."}
    cover_text TEXT,                          -- Anschreiben-Text
    timezone VARCHAR(50) DEFAULT 'Europe/Rome',
    enabled BOOLEAN DEFAULT true,
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE report_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID REFERENCES report_schedules(id),
    tenant_id UUID REFERENCES tenants(id),
    report_period_start DATE,
    report_period_end DATE,
    pdf_path VARCHAR(500),
    pdf_size_bytes BIGINT,
    recipients JSONB,
    status VARCHAR(20) DEFAULT 'pending',  -- pending, generating, sent, failed
    attempts INT DEFAULT 0,
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Daten-Aggregation: TimescaleDB Continuous Aggregates

Hierarchische Aggregation damit Report-Queries nie auf Rohdaten zugreifen:

```sql
-- Level 1: 5-Minuten (für Dashboards + Weekly Reports)
CREATE MATERIALIZED VIEW metrics_5m WITH (timescaledb.continuous) AS
SELECT time_bucket('5 minutes', recorded_at) AS bucket,
       host_id, metric_name,
       AVG(value) AS avg_value, MAX(value) AS max_value, MIN(value) AS min_value,
       COUNT(*) AS sample_count
FROM metrics_raw GROUP BY bucket, host_id, metric_name;

-- Level 2: Stündlich (für Monthly Reports)
CREATE MATERIALIZED VIEW metrics_hourly WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', bucket) AS bucket,
       host_id, metric_name,
       AVG(avg_value) AS avg_value, MAX(max_value) AS max_value
FROM metrics_5m GROUP BY 1, host_id, metric_name;

-- Level 3: Täglich (für Quarterly Reports)
CREATE MATERIALIZED VIEW metrics_daily WITH (timescaledb.continuous) AS
SELECT time_bucket('1 day', bucket) AS bucket,
       host_id, metric_name,
       AVG(avg_value) AS avg_value, MAX(max_value) AS max_value
FROM metrics_hourly GROUP BY 1, host_id, metric_name;

-- Compression für ältere Daten (10-20x Speicherersparnis)
ALTER MATERIALIZED VIEW metrics_hourly SET (timescaledb.compress_after = INTERVAL '30 days');
```

---

## FEATURE 3: Erweiterte Notification Channels

### Warum Priorität 3
Overseer hat Webhook + Email. Das ist zu wenig. Uptime Kuma allein hat 95+ Channels. Slack, Teams und Telegram sind Quick Wins mit hohem Impact. PagerDuty/OpsGenie für Enterprise-Kunden.

### Anwendungslogik

#### Notification Channel einrichten

Navigation: Settings → Notification Channels → "+ Add Channel"

**Schritt 1: Channel-Typ wählen**
Eine Liste mit Icons und kurzer Beschreibung:
- Slack — "Send alerts to Slack channels"
- Microsoft Teams — "Send alerts to Teams channels"
- Telegram — "Send alerts to Telegram chats"
- PagerDuty — "Create incidents in PagerDuty"
- OpsGenie — "Create alerts in OpsGenie"
- SMS (Twilio) — "Send SMS for critical alerts"
- Webhook — "HTTP POST to any endpoint" (bereits vorhanden)
- Email — "Send email notifications" (bereits vorhanden)

**Schritt 2: Channel konfigurieren (je nach Typ)**

*Slack:*
Der Benutzer hat zwei Optionen:
1. **Webhook URL** (einfach): Klick auf "Add to Slack" → OAuth-Flow → Slack-Workspace und Channel wählen → fertig. Oder: manuell eine Webhook-URL aus Slack's App-Einstellungen einfügen.
2. **Bot Token** (für interaktive Features): Erlaubt "Acknowledge"-Buttons direkt in Slack. Braucht Bot-Token + Channel-ID. Der Benutzer sieht eine Anleitung: "1. Go to api.slack.com/apps → 2. Create New App → 3. Enable Incoming Webhooks → 4. Copy Bot Token".

Wichtige Konfiguration: **Channel auswählen** — in welchen Slack-Channel sollen die Alerts? Der Benutzer kann verschiedene Channels für verschiedene Severity-Level einrichten: Warnings → #monitoring-warnings, Criticals → #monitoring-critical.

*Microsoft Teams:*
Der Benutzer fügt eine Teams Workflow-URL ein. Anleitung im UI: "In Teams → Channel → ... → Workflows → 'Post to a channel when a webhook request is received' → Copy URL".

*Telegram:*
1. Der Benutzer erstellt einen Telegram-Bot via @BotFather (Anleitung mit Screenshots im UI)
2. Fügt das Bot-Token ein
3. Gibt die Chat-ID ein (oder: es gibt einen "Find Chat ID" Button — der Bot sendet eine Testnachricht, der Benutzer antwortet, und das System extrahiert die Chat-ID)

*PagerDuty:*
1. Integration Key (Routing Key) aus PagerDuty einfügen
2. Service auswählen in PagerDuty
3. Severity-Mapping konfigurieren (Default: CRITICAL→critical, WARNING→warning)

*SMS (Twilio):*
1. Twilio Account SID + Auth Token einfügen
2. "From" Telefonnummer (die Twilio-Nummer)
3. Empfänger-Nummern eingeben (mit Landesvorwahl)
4. **Kosten-Warnung**: "SMS notifications cost ~$0.01-0.15 per message depending on destination. Consider using SMS only for Critical alerts."

**Schritt 3: Test**
Jeder Channel hat einen "Send Test Notification" Button. Das System sendet eine Test-Notification mit echten (aber harmlosen) Beispieldaten:
- Subject: "[TEST] Overseer Test Notification"
- Body: "This is a test notification from Overseer. If you see this, your channel is configured correctly."

Der Benutzer sieht sofort ob die Nachricht angekommen ist. Wenn nicht, zeigt das System die Fehlermeldung (z.B. "401 Unauthorized — check your token" oder "Channel not found").

**Schritt 4: Zuordnung zu Alert Rules**

Hier kommt die entscheidende Logik: Welcher Channel bekommt welche Alerts?

Das wird **nicht** am Channel konfiguriert, sondern an den **Alert Rules** (bestehende Overseer-Funktionalität). In jeder Alert Rule gibt es ein neues Feld "Notification Channels" wo der Benutzer einen oder mehrere Channels auswählt. Zusätzlich konfigurierbar:
- **Severity-Filter pro Channel**: "Send to Slack for all severities, but SMS only for Critical"
- **Time-based Routing**: "Send to PagerDuty only outside business hours (18:00-08:00)"
- **Escalation**: "If not acknowledged within 15min, also send to SMS"

#### Wie sieht eine Notification aus?

Notifications sind nicht nur Text — sie sind **actionable**. Der Empfänger muss sofort verstehen was los ist und reagieren können.

**Slack-Nachricht:**
```
🔴 CRITICAL: CPU Usage on web-prod-01
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Service: cpu_check
Current Value: 98.2%
Threshold: > 90%
Duration: 5 minutes (Hard State)
Since: 2026-03-27 14:23 CET

Host: web-prod-01 (10.0.1.15)
Tenant: Acme Corp

[Acknowledge]  [View in Overseer]  [Mute 1h]
```

Die Buttons funktionieren so:
- **Acknowledge**: Markiert den Alert in Overseer als acknowledged. Der Slack-User sieht eine Bestätigung: "Acknowledged by @lukas". Andere Benutzer die denselben Channel sehen, wissen sofort dass sich jemand drum kümmert.
- **View in Overseer**: Deeplink direkt zum Host/Service in der Overseer-UI.
- **Mute 1h**: Unterdrückt Re-Notifications für diesen Alert für 1 Stunde. Nützlich wenn man gerade dran arbeitet und keine weiteren Pings will.

**Recovery-Nachricht:**
Wenn der Alert sich auflöst, kommt eine grüne Nachricht im selben Channel:
```
✅ RECOVERED: CPU Usage on web-prod-01
Was critical for 23 minutes.
Current value: 42.1%
```

**Telegram:**
Ähnlich wie Slack, aber mit Inline-Keyboard-Buttons (Telegram-native). Markdown-formatiert.

**SMS:**
Kurz und prägnant (160 Zeichen Limit beachten):
```
CRITICAL: CPU 98.2% on web-prod-01 (Acme Corp). Ack: reply ACK. View: https://overseer.example.com/a/xyz
```

SMS-Acknowledge funktioniert über Reply: Der Benutzer antwortet "ACK" auf die SMS → Twilio-Webhook empfängt die Antwort → Overseer markiert den Alert als acknowledged.

**PagerDuty:**
Kein eigenes Nachrichtenformat — PagerDuty hat sein eigenes UI. Overseer sendet die Daten über Events API v2, PagerDuty rendert sie nach seinen eigenen Regeln. Wichtig ist nur: `dedup_key` = `{host_id}:{service_id}` damit PagerDuty weiß wann ein Alert resolved ist (gleicher dedup_key, Action "resolve").

#### Notification Templates anpassen

Unter Settings → Notification Channels → Templates kann der Benutzer die Nachrichtenformate pro Channel anpassen. Default-Templates werden mitgeliefert, aber der Benutzer kann:
- Den Text ändern (Jinja2-Syntax mit Variablen wie `{{ host.name }}`, `{{ service.name }}`, `{{ status }}`)
- Felder hinzufügen/entfernen
- Eigene Felder aus Service-Metadaten einbauen (z.B. `{{ service.metadata.responsible_team }}`)

Die Vorschau aktualisiert sich live während der Benutzer das Template editiert — mit echten Beispieldaten aus einem zufälligen aktuellen Alert.

#### Fehlerbehandlung und Retry-Logik

Was passiert wenn eine Notification fehlschlägt?
1. **Erster Versuch** schlägt fehl → sofort Retry nach 5 Sekunden
2. **Zweiter Versuch** schlägt fehl → Retry nach 30 Sekunden
3. **Dritter Versuch** schlägt fehl → Notification als "failed" markiert

Bei fehlgeschlagener Notification:
- Im Notification Log (Settings → Notification Log) erscheint ein roter Eintrag mit dem Fehlergrund
- Wenn ein Channel 5x hintereinander fehlschlägt, wird er automatisch **deaktiviert** und der Tenant-Admin bekommt eine Email: "Your Slack notification channel has been disabled due to repeated failures. Last error: 401 Unauthorized."
- Der Benutzer kann den Channel in den Settings wieder aktivieren nachdem er das Problem behoben hat

### Architekturentscheidung: Plugin-basiertes System

Abstract Base Class Pattern — neue Channels hinzufügen erfordert nur eine neue Datei, kein Core-Code-Änderung:

```python
class NotificationChannel(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    async def send_alert(self, alert: Alert, config: dict) -> NotificationResult: ...

    @abstractmethod
    async def send_recovery(self, alert: Alert, config: dict) -> NotificationResult: ...

    async def acknowledge(self, alert, config, user) -> NotificationResult: ...
    async def validate_config(self, config: dict) -> bool: ...
    async def test_connection(self, config: dict) -> bool: ...
```

Auto-Discovery via `pkgutil.iter_modules()` — alle Klassen in `notifications/channels/` werden automatisch registriert.

### Channel-Implementierungen

**Slack** — `slack-sdk` + `slack-bolt`
- Webhooks für fire-and-forget, Bot-Token für interaktive Buttons
- Block Kit für Rich Formatting
- Bolt hat einen built-in FastAPI Adapter (`AsyncSlackRequestHandler`)

**Microsoft Teams** — HTTP POST mit Adaptive Cards
- Office 365 Connectors sind deprecated → Workflows (Power Automate) verwenden
- Rate Limits: Max 4 req/s → Backoff implementieren

**Telegram** — `python-telegram-bot` v21+ (fully async)
- `InlineKeyboardButton` mit `callback_data="ack:{alert_id}"`
- Webhook-Modus für FastAPI-Integration

**PagerDuty** — Events API v2
- Actions: `trigger`, `acknowledge`, `resolve`
- `dedup_key` = `f"{host}:{service}"` für automatische Deduplizierung

**SMS via Twilio** — `twilio` SDK
- Nur für Critical Alerts (Kosten-Warnung in der UI)
- Status Callback für Delivery Receipts

### Projekt-Struktur

```
overseer/notifications/
  base.py              # NotificationChannel ABC, Alert, NotificationResult
  dispatcher.py        # NotificationDispatcher (Fan-out + Grouping + Inhibition)
  grouper.py           # AlertGrouper
  inhibitor.py         # InhibitionEngine
  registry.py          # ChannelRegistry (Auto-Discovery)
  channels/
    slack.py
    teams.py
    telegram.py
    pagerduty.py
    opsgenie.py
    twilio_sms.py
    email.py
```

---

## FEATURE 4: Alert Grouping, Suppression & Dependencies

### Warum hier und nicht als separates Feature
Alert Fatigue ist eines der größten Probleme in Monitoring-Systemen. Ohne Grouping und Suppression wird Overseer bei größeren Deployments unbenutzbar. Dieses Feature gehört logisch zu den Notifications, wird aber separat geplant wegen der Komplexität.

### Anwendungslogik

#### Das Problem das gelöst wird

Stell dir vor: Ein Switch fällt aus. Hinter dem Switch hängen 10 Server. Auf jedem Server laufen 5 Services. Ohne Grouping und Suppression bekommt der Admin **50 Notifications in 30 Sekunden**: "Host unreachable" × 10, "Service timeout" × 40. Sein Handy vibriert ununterbrochen. Er weiß nicht wo er anfangen soll. Das ist Alert Fatigue — und es führt dazu, dass Admins Notifications irgendwann ignorieren.

Mit Grouping und Suppression bekommt er **eine einzige Notification**:
```
🔴 CRITICAL: Switch-01 is DOWN
10 hosts and 40 services are affected.
Suppressed 50 individual alerts.

Affected hosts: web-01, web-02, db-01, db-02, ...
[View Dependency Map]  [Acknowledge All]
```

#### Dependencies konfigurieren

Navigation: Hosts → Host Detail → Tab "Dependencies"

Hier sieht der Benutzer eine einfache Baumansicht:
```
Switch-01 (network device)
├── web-01
│   ├── nginx
│   └── app-backend
├── web-02
│   ├── nginx
│   └── app-backend
├── db-01
│   └── postgresql
└── db-02
    └── postgresql
```

**Wie fügt man eine Dependency hinzu?**
Auf der Host-Detail-Seite: Dropdown "Parent Host" → den Switch (oder Router, Firewall) auswählen von dem dieser Host abhängt. Das war's.

Für Services: Auf der Service-Detail-Seite: Dropdown "Depends on" → den Service auswählen von dem dieser Service abhängt. Beispiel: "app-backend" depends on "postgresql" — wenn die Datenbank down ist, wird der Alert für den App-Backend unterdrückt.

**Auto-Suggestion:** Wenn ein Host per Auto-Discovery (Feature 5) entdeckt wird, schlägt das System automatisch Dependencies vor basierend auf Netzwerk-Topologie (gleicher Switch/Router) und bekannten Patterns (Web-App → Database).

**Dependency Map Visualisierung:** Unter einer dedizierten Seite "Infrastructure → Dependency Map" gibt es eine interaktive Baumansicht der gesamten Infrastruktur. Jeder Knoten ist farbcodiert nach aktuellem Status (grün/gelb/rot). Der Benutzer kann Knoten draggen um das Layout anzupassen, und auf einen Knoten klicken um zum Host/Service zu navigieren.

#### Alert Grouping konfigurieren

Navigation: Settings → Alert Policies → Grouping

Der Benutzer konfiguriert globale Grouping-Regeln:

**Group By:** Wonach werden Alerts gruppiert?
- `host` (Default): Alle Alerts desselben Hosts werden gebündelt. Der Admin bekommt eine Nachricht: "3 problems on web-01: CPU critical, Disk warning, Memory warning"
- `host, severity`: Gruppiert nach Host UND Severity. Also eine Nachricht für alle Criticals von web-01, eine separate für alle Warnings.
- `service_template`: Alle Alerts des gleichen Check-Typs. z.B. "5 hosts have disk_usage warnings"

**Timing:**
- **Group Wait** (Default 30s): Wie lange wartet das System bevor es die erste Notification für eine neue Gruppe sendet. In diesen 30 Sekunden können weitere Alerts in die Gruppe fließen. Der Benutzer sieht eine Erklärung: "After the first alert in a group, wait this long before sending the notification. More alerts arriving during this window will be included."
- **Group Interval** (Default 5min): Wie lange zwischen Update-Notifications für eine bestehende Gruppe. "If new alerts join an existing group, wait at least this long before sending another notification."
- **Repeat Interval** (Default 4h): Wie lange bis der Alert erneut gesendet wird wenn er immer noch aktiv ist und niemand reagiert hat. "Re-send the notification if the alert is still active and not acknowledged after this time."

**Wichtig für den Benutzer:** Diese Werte haben direkte Auswirkungen auf die Reaktionszeit:
- Group Wait zu kurz (5s) = Fast wie ohne Grouping, viele einzelne Nachrichten
- Group Wait zu lang (5min) = Man erfährt erst nach 5 Minuten von einem Problem
- 30 Sekunden ist ein guter Kompromiss: schnell genug für Kritisches, lang genug um Kaskaden zu sammeln

#### Alert Suppression in der Praxis

Wenn der Switch ausfällt und die 50 Alerts reinkommen, passiert Folgendes:

1. **T+0s**: Alert "Switch-01 CRITICAL" kommt rein. Keine Suppression nötig (kein Parent).
2. **T+2s**: Alert "web-01 unreachable" kommt rein. System prüft Dependencies: web-01 hat Parent Switch-01. Switch-01 hat einen aktiven Critical Alert. → **Suppressed.** Der Alert wird in der DB gespeichert, aber keine Notification wird gesendet.
3. **T+3-15s**: 49 weitere Alerts kommen rein. Alle haben Switch-01 als (direkten oder indirekten) Ancestor. Alle werden suppressed.
4. **T+30s** (Group Wait abgelaufen): Die Notification für Switch-01 wird gesendet. Sie enthält die Info: "50 dependent alerts suppressed."

Was der Benutzer in der Overseer-UI sieht:
- Auf der Alert-Seite: Der Switch-01 Alert ist prominent sichtbar. Die 50 suppressed Alerts sind **sichtbar aber visuell gedämpft** (grauer Text, eingeklappt). Ein Badge zeigt "50 suppressed".
- Klick auf "50 suppressed" → Klappt die Liste auf: alle 50 Alerts mit Host, Service, Severity.
- Wichtig: Suppressed Alerts werden **nicht gelöscht oder ignoriert**. Sie sind da, trackbar, und gehen in die Statistiken ein. Sie werden nur nicht als Notification gesendet.

#### Was passiert wenn der Switch wieder online kommt?

1. Switch-01 recovered → Recovery-Notification: "Switch-01 is back online."
2. Die suppressed Hosts werden automatisch neu gecheckt (nächster Check-Zyklus).
3. Hosts die jetzt auch recovered sind → ihre suppressed Alerts werden als "resolved" markiert, keine separate Recovery-Notification (weil die originale Alert-Notification auch unterdrückt wurde).
4. Hosts die trotz Switch-Recovery immer noch down sind → **jetzt** wird eine Notification gesendet, weil der Suppression-Grund (Parent down) nicht mehr gilt. Das bedeutet: "web-05 is still unreachable even though Switch-01 is back." Das ist ein echtes Problem, kein Kaskadeneffekt.

#### Wie interagiert das mit Escalation Policies?

Overseer hat bereits Escalation Policies. Die Reihenfolge der Logik ist:

1. Alert kommt rein
2. **Suppression-Check**: Ist ein Parent down? Wenn ja → speichern, aber nicht notifizieren. Ende.
3. **Grouping**: Alert wird in eine Gruppe einsortiert. Wenn die Gruppe neu ist, startet der Group-Wait-Timer.
4. **Group-Wait abgelaufen**: Die Notification wird an die Escalation Policy übergeben.
5. **Escalation Policy**: Bestimmt wer benachrichtigt wird (Level 1 → Level 2 → Level 3 basierend auf Acknowledge-Timeout).
6. **Channel-Dispatch**: Die Notification wird an alle konfigurierten Channels gesendet.

### Datenbank: Dependency-Beziehungen

```sql
-- Flexible N:M-Tabelle für alle Dependency-Typen
CREATE TABLE dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type VARCHAR(20),     -- 'host' oder 'service'
    source_id UUID,
    depends_on_type VARCHAR(20),
    depends_on_id UUID,
    tenant_id UUID REFERENCES tenants(id)
);

-- Für schnellen Tree-Walk
CREATE INDEX idx_dependencies_source ON dependencies(source_type, source_id);
CREATE INDEX idx_dependencies_target ON dependencies(depends_on_type, depends_on_id);
```

### Alert Grouping (wie Prometheus AlertManager)

```python
class AlertGrouper:
    def __init__(
        self,
        group_by: list[str] = ["host"],
        group_wait: float = 30.0,
        group_interval: float = 300.0,
        repeat_interval: float = 14400.0
    ):
        self.groups: dict[str, AlertGroup] = {}

    async def add_alert(self, alert: dict):
        key = self._make_group_key(alert)  # z.B. "host:db-01"
        if key not in self.groups:
            self.groups[key] = AlertGroup(group_key=key)
            asyncio.create_task(self._wait_and_notify(key, self.group_wait))
        self.groups[key].alerts.append(alert)
```

### Alert Suppression / Inhibition

```python
class InhibitionEngine:
    def __init__(self, dependencies: dict[str, DependencyNode]):
        self.dependencies = dependencies
        self.active_alerts: dict[str, dict] = {}

    def get_ancestors(self, node_id: str) -> list[str]:
        """Walk up the dependency tree."""
        ancestors = []
        current = self.dependencies.get(node_id)
        while current and current.parent_id:
            ancestors.append(current.parent_id)
            current = self.dependencies.get(current.parent_id)
        return ancestors

    def should_suppress(self, alert: dict) -> bool:
        node_id = alert["node_id"]
        for ancestor_id in self.get_ancestors(node_id):
            if ancestor_id in self.active_alerts:
                if self.active_alerts[ancestor_id]["severity"] == "critical":
                    return True
        return False
```

---

## FEATURE 5: Auto-Discovery

### Warum Priorität 4
Spart Stunden beim Kunden-Onboarding. Manuelles Anlegen von Hosts und Services ist der größte Zeitfresser für MSPs. Zabbix, CheckMK und Dynatrace haben alle Auto-Discovery.

### Anwendungslogik

#### Der Onboarding-Moment: Neuen Kunden einrichten

Heute: Der MSP-Techniker richtet einen neuen Kunden ein. Er muss jeden Host manuell anlegen, jede IP eingeben, jeden Service konfigurieren. Bei einem Kunden mit 50 Geräten dauert das einen halben Tag.

Mit Auto-Discovery: Der Techniker installiert den Collector auf einem Server im Kundennetzwerk, klickt "Discover Network" — und 10 Minuten später hat er eine Liste aller Geräte mit Vorschlägen welche Services überwacht werden sollten.

#### Discovery starten

Navigation: Infrastructure → Discovery

**Erster Discovery Run (manuell):**
Der Benutzer sieht eine leere Seite mit einem prominenten "Start Discovery" Button und einer kurzen Erklärung: "Discover hosts and services in your network automatically."

Klick auf "Start Discovery" → Dialog:

**Netzwerk-Scan:**
- IP-Range eingeben: z.B. "192.168.1.0/24" oder "10.0.0.0/16"
- Ports: Default-Auswahl bereits vorausgewählt (22, 80, 443, 161, 3306, 5432, 1433, 8080, 8443, 3389) — der Benutzer kann Ports hinzufügen/entfernen
- Scan-Geschwindigkeit: "Normal" (Default) oder "Aggressive" (schneller, aber auffälliger im Netzwerk) oder "Stealth" (langsam, unauffällig)
- Welcher Collector soll den Scan durchführen? (Dropdown der verfügbaren Collectors)

Klick auf "Run Scan" → Fortschrittsanzeige: "Scanning 254 addresses... 47/254 complete. Found 23 hosts so far."

Der Scan läuft im Hintergrund. Der Benutzer kann die Seite verlassen und zurückkommen. Sobald der Scan fertig ist, erscheint eine Notification (im Overseer-UI, nicht per Email).

#### Discovery-Ergebnisse bewerten

Nach Abschluss des Scans sieht der Benutzer die **Discovery Results** Seite:

Eine Tabelle mit allen gefundenen Geräten:

| Status | IP | Hostname | Type | OS | Open Ports | Suggested Checks | Action |
|--------|-----|----------|------|-------|-----------|-------------------|--------|
| 🆕 New | 192.168.1.1 | gateway | Router | — | 22, 80, 161 | ping, snmp_interface | [Add] [Ignore] |
| 🆕 New | 192.168.1.10 | web-prod | Linux Server | Ubuntu 22.04 | 22, 80, 443 | ping, cpu, memory, disk, http | [Add] [Ignore] |
| ✅ Known | 192.168.1.20 | db-01 | Linux Server | Debian 12 | 22, 5432 | — | Already monitored |
| 🆕 New | 192.168.1.100 | HP-LaserJet | Printer | — | 9100, 631 | ping, snmp_printer | [Add] [Ignore] |
| 🆕 New | 192.168.1.200 | unknown | Unknown | — | 80 | ping | [Add] [Ignore] |

**Intelligenz hinter den Ergebnissen:**

Jedes gefundene Gerät wird automatisch klassifiziert:

1. **Typ-Erkennung:**
   - Port 161 offen + SNMP sysObjectID abfragbar → Router/Switch/Printer (je nach OID)
   - Port 22 + 80 + hohe Portnummern → Linux Server
   - Port 3389 → Windows Server
   - Port 9100/631 → Drucker
   - MAC-Adresse OUI → Hersteller (z.B. "HP", "Cisco", "Dell")

2. **Check-Vorschläge:**
   Das System schlägt automatisch passende Checks vor basierend auf dem erkannten Typ:
   - Linux Server → ping, cpu_usage, memory_usage, disk_usage, load_average
   - Windows Server → ping, cpu_usage, memory_usage, disk_usage, windows_services
   - Webserver (Port 80/443 offen) → zusätzlich: http_check, ssl_certificate
   - Datenbank (Port 5432/3306) → zusätzlich: process_check (postgresql/mysql)
   - Netzwerkgerät (SNMP) → snmp_interface (alle Interfaces), snmp_uptime
   - Drucker → ping, snmp_printer_supplies (Toner-Level)

3. **Abgleich mit bereits bekannten Hosts:**
   Geräte die bereits in Overseer monitored werden, sind als "Known" markiert. Sie erscheinen in der Liste, aber ohne "Add"-Button. Wenn sich etwas geändert hat (z.B. neuer Port offen, der auf einen neuen Service hindeutet), wird das als Badge angezeigt: "1 new service detected".

#### Einzelne Hosts hinzufügen

Der Benutzer klickt "Add" bei einem gefundenen Gerät. Ein Dialog öffnet sich:

- **Hostname**: Vorausgefüllt (kann geändert werden)
- **Display Name**: Optional, für eine lesbare Bezeichnung
- **Tags**: z.B. "production", "customer-acme", "floor-2"
- **Checks**: Die vorgeschlagenen Checks sind bereits angehakt. Der Benutzer kann einzelne abwählen oder weitere hinzufügen.
- **Monitoring via**: "Agent" (wenn ein Agent installiert wird) oder "Remote" (Collector prüft von außen)

Klick auf "Add Host" → Der Host wird sofort erstellt mit allen ausgewählten Checks. Innerhalb von Sekunden beginnt das Monitoring.

#### Bulk-Hinzufügen

Oben in der Discovery-Tabelle: Checkboxen für Mehrfachauswahl + Button "Add Selected (12)". Öffnet einen Bulk-Dialog:
- Gemeinsame Tags setzen (werden auf alle gewählten Hosts angewendet)
- Check-Vorschläge werden automatisch pro Host individuell angewendet
- "Add All 12 Hosts" → Bestätigungsdialog: "This will create 12 hosts with 67 service checks. Proceed?"

#### "Ignore" und die Ignore-Liste

Wenn der Benutzer "Ignore" klickt, wird das Gerät markiert als bewusst ignoriert. Es erscheint bei zukünftigen Scans nicht mehr in den Ergebnissen. Unter Discovery → Ignored Devices kann der Benutzer die Ignore-Liste einsehen und Geräte wieder "un-ignoren".

**Warum ist das wichtig?** In einem typischen /24-Netz gibt es 20 Server, aber auch 50 Arbeitsplatz-PCs, Drucker, WLAN-APs und IoT-Geräte die niemand monitoren will. Ohne Ignore-Liste wäre die Discovery-Ergebnis-Seite jedes Mal voller Rauschen.

#### Laufende Discovery (Scheduled)

Nach dem initialen Scan will man fortlaufend neue Geräte entdecken. Unter Discovery → Settings:

- **Scheduled Network Scan**: Alle 6 Stunden (konfigurierbar). Scannt die konfigurierten IP-Ranges erneut.
- **Agent Service Discovery**: Alle 10 Minuten. Jeder installierte Agent prüft ob neue Services auf seinem Host laufen.

**Was passiert bei einer Änderung?**
- **Neues Gerät im Netzwerk**: Erscheint unter Discovery → New Discoveries mit Datum wann es erstmals gesehen wurde. Der Benutzer entscheidet ob er es hinzufügt oder ignoriert.
- **Neuer Service auf bestehendem Host**: z.B. jemand installiert Docker auf einem Server. Der Agent erkennt den Docker-Daemon. Unter dem Host erscheint eine Notification: "New service detected: docker (port 2375)". Der Benutzer kann einen Check dafür anlegen.
- **Gerät verschwunden**: Wenn ein Gerät in 3 aufeinanderfolgenden Scans nicht mehr gesehen wird → Warning-Event im Discovery Log: "Device 192.168.1.42 (printer-floor2) not seen for 18 hours." Kein automatisches Löschen — vielleicht ist das Gerät nur ausgeschaltet.

#### Discovery Rules (Automatisierung)

Für MSPs die viele Kunden betreuen: Statt jedes Gerät manuell zu bestätigen, können Regeln definiert werden.

Navigation: Discovery → Rules → "+ Add Rule"

Beispiel-Regel:
- **Name**: "Auto-add production servers"
- **Condition**: IP in subnet 10.0.1.0/24 AND (Port 22 open OR Port 3389 open)
- **Action**: Auto-Add (ohne manuelle Bestätigung)
- **Template**: "Linux Server Standard" (vordefiniertes Check-Set)
- **Tags**: auto-add: ["production", "auto-discovered"]

Weitere Action-Optionen:
- **Pending Approval**: Gerät erscheint in einer Approval-Queue. Schneller als manuelles Discovery-Reviewing weil die Checks bereits vorausgefüllt sind.
- **Ignore**: Automatisch ignorieren (z.B. "Alles in Subnet 192.168.100.0/24 sind Gast-WLAN-Geräte → ignorieren")

Rules werden nach Priorität (1-100) evaluiert. Erste Regel die matcht bestimmt die Aktion.

#### Agent Auto-Registration

Alternative zu Netzwerk-Scans: Der Agent meldet sich selbst an.

**Flow:**
1. MSP generiert in Overseer ein **Registration Token** (unter Settings → Agents → Registration Tokens). Das Token ist an einen Tenant gebunden und optional zeitlich begrenzt.
2. Bei der Agent-Installation gibt der Techniker das Token mit: `overseer-agent install --registration-token=xxx --server=https://overseer.example.com`
3. Der Agent sendet `POST /api/v1/agents/register` mit dem Token + seinen eigenen Daten (Hostname, OS, IP, erkannte Services).
4. **Ohne Auto-Approve:** Der Host erscheint in der Overseer-UI als "Pending Approval". Ein Admin muss ihn bestätigen.
5. **Mit Auto-Approve:** (konfigurierbar pro Registration Token) Der Host wird sofort erstellt. Der Agent bekommt seinen eigenen API Key zurück und beginnt sofort Checks auszuführen.

**Sicherheit:** Registration Tokens können jederzeit widerrufen werden. Jeder Token hat ein Audit-Log: welche Agents haben sich damit registriert?

### Drei Discovery-Typen (technisch)

#### A) Network Scan Discovery (Collector-seitig, Go)

**nmap-Wrapper** via `github.com/Ullaakut/nmap/v3`:

```go
scanner, _ := nmap.NewScanner(
    nmap.WithTargets("192.168.1.0/24"),
    nmap.WithPorts("22,80,443,161,3306,5432"),
    nmap.WithPingScan(),
    nmap.WithServiceInfo(),
    nmap.WithTimingTemplate(nmap.TimingAggressive),
)
result, _, _ := scanner.Run()
```

#### B) Service Auto-Discovery (Agent-seitig, Go)

**Linux — systemd + Listening Ports:**
```go
conn, _ := dbus.NewSystemdConnectionContext(ctx)
units, _ := conn.ListUnitsByPatternsContext(ctx, []string{"active"}, []string{"*.service"})
```

**Windows — Services:**
```go
m, _ := mgr.Connect()
services, _ := m.ListServices()
```

#### C) Agent Auto-Registration

```
POST /api/v1/agents/register
Authorization: Bearer <registration_token>
Body: {
  "hostname": "web-prod-01",
  "os": "linux",
  "ip_addresses": ["10.0.1.5"],
  "labels": {"environment": "production"},
  "discovery_data": { ... }
}
```

### Discovery Rules Engine (Datenbank)

```sql
CREATE TABLE discovery_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    name VARCHAR(255),
    priority INTEGER,
    enabled BOOLEAN DEFAULT true,
    source_type VARCHAR(30),  -- 'network_scan', 'agent_registration', 'snmp_discovery'
    conditions JSONB,         -- [{"field": "ip_address", "op": "in_subnet", "value": "10.0.0.0/8"}]
    action VARCHAR(20),       -- 'auto_add', 'pending_approval', 'ignore'
    template_id UUID REFERENCES service_templates(id),
    tags JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Go-Bibliotheken

| Zweck | Library |
|-------|---------|
| Netzwerk-Scanning | `github.com/Ullaakut/nmap/v3` |
| SNMP | `github.com/gosnmp/gosnmp` |
| Systemd | `github.com/coreos/go-systemd/v22/dbus` |
| Windows Services | `golang.org/x/sys/windows/svc/mgr` |
| Process/Port-Listing | `github.com/shirou/gopsutil/v3` |

---

## FEATURE 6: Zentrales Log Management

### Warum Priorität 5
Einer der häufigsten Gründe warum Leute zu Datadog/Splunk/Elastic greifen. Overseer hat `agent_eventlog` für Windows/Linux, aber kein zentrales Log-Sammeln, -Suchen und -Alerting.

### Anwendungslogik

#### Warum Logs im Monitoring-Tool?

Heute muss ein Techniker bei einem Problem Folgendes tun:
1. Alert in Overseer sehen: "App-Server HTTP 500 Rate hoch"
2. SSH auf den Server
3. `journalctl -u app-backend --since "10 minutes ago"` oder `tail -f /var/log/nginx/error.log`
4. Log-Einträge lesen, Fehler finden
5. Vielleicht auf einen zweiten Server wechseln um dort auch zu schauen

Mit zentralem Log Management:
1. Alert in Overseer sehen: "App-Server HTTP 500 Rate hoch"
2. Klick auf den Alert → Tab "Logs" → Alle relevanten Logs des betroffenen Hosts/Services sind sofort da, filterbar, durchsuchbar
3. Kein SSH nötig. Alle Server gleichzeitig durchsuchbar.

#### Log Collection aktivieren

**Schritt 1: Agent konfigurieren**

Der Agent bekommt in seiner Konfiguration eine neue Sektion `log_collection`:

```yaml
log_collection:
  enabled: true
  sources:
    - type: file
      path: /var/log/nginx/error.log
      service: nginx
      severity_parse: true       # Versuche Severity aus dem Log-Format zu erkennen
    - type: file
      path: /var/log/app/backend.log
      service: app-backend
      multiline:
        pattern: "^\\d{4}-\\d{2}-\\d{2}"  # Neue Zeile beginnt mit Datum
    - type: journald
      units: ["nginx", "postgresql", "app-backend"]
    - type: windows_eventlog
      channels: ["Application", "System", "Security"]
      severity_filter: warning    # Nur Warning und höher
```

**Wie konfiguriert der Benutzer das?**

Option A: **Über die Overseer-UI** (bevorzugt): Host Detail → Tab "Log Collection" → Button "Add Log Source". Dropdown: File, Journald, Windows Event Log. Felder ausfüllen. Speichern → die Config wird an den Agent gepusht (wie bestehende Check-Config).

Option B: **Über die Agent-Config-Datei** direkt auf dem Host (für Automatisierung/Ansible).

**Auto-Detection von Log-Quellen:** Wenn Service Discovery (Feature 5) aktiv ist und z.B. Nginx erkennt, schlägt das System automatisch vor: "Nginx detected. Would you like to collect logs from /var/log/nginx/error.log and /var/log/nginx/access.log?" Der Benutzer muss nur bestätigen.

**Schritt 2: Logs fließen**

Sobald Log Collection aktiviert ist, beginnt der Agent:
1. Die konfigurierten Dateien zu tail-en (neue Zeilen lesen)
2. Jede Zeile zu parsen: Timestamp extrahieren, Severity erkennen, strukturierte Felder extrahieren (falls JSON-Format)
3. Zeilen zu batchen (1000 Zeilen oder alle 5 Sekunden, was zuerst eintritt)
4. Den Batch zstd-komprimiert an den Collector/Receiver zu senden

**Buffering und Resilience:**
- Wenn der Server nicht erreichbar ist: Logs werden lokal auf Disk gequeued (bis 500MB)
- Wenn der Agent neu startet: Er setzt am letzten Checkpoint fort (weiß welche Zeilen er schon gesendet hat)
- Keine Daten gehen verloren bei kurzen Ausfällen

#### Log Viewer in der UI

Navigation: Logs (neuer Hauptmenü-Punkt)

Der Log Viewer ist das Herzstück des Features. Er muss schnell, durchsuchbar und ergonomisch sein.

**Layout:**
- Oben: **Such-Leiste** (prominent, volle Breite) — wie eine Google-Suche für Logs
- Darunter: **Filter-Chips**: Host-Dropdown, Service-Dropdown, Severity-Dropdown, Zeitraum
- Darunter: **Log-Stream** — eine scrollbare Liste von Log-Einträgen, neueste zuerst

**Jeder Log-Eintrag zeigt:**
```
14:23:45.123  web-01 / nginx  [ERROR]
  2026/03/27 14:23:45 [error] 1234#0: *5678 connect() failed (111: Connection refused)
  while connecting to upstream, client: 10.0.1.50, server: api.example.com
```
- Timestamp (links, monospaced, mit Millisekunden)
- Host + Service (farbcodiert nach Severity)
- Severity-Badge (DEBUG=grau, INFO=blau, WARNING=gelb, ERROR=rot, CRITICAL=dunkelrot)
- Die eigentliche Log-Nachricht (kann mehrzeilig sein)

**Suche:**
Die Such-Leiste unterstützt natürliche Suche:
- Einfache Begriffe: `connection refused` → findet alle Logs die beide Wörter enthalten
- Exakte Phrasen: `"connection refused"` → findet die exakte Phrase
- OR: `timeout OR "connection refused"` → findet eins von beiden
- Negation: `-debug` → schließt Debug-Logs aus

Die Suche funktioniert **sofort** (innerhalb von Sekunden für Millionen von Einträgen) dank PostgreSQL tsvector + GIN Index.

**Ergebnis-Highlighting:** Suchbegriffe werden in den Ergebnissen **gelb markiert** (highlighted), damit der Benutzer sofort sieht wo der Treffer ist.

**Live-Tail Modus:**
Oben rechts ein Toggle "Live" — wenn aktiviert, scrollt der Log-Stream automatisch nach unten und zeigt neue Logs in Echtzeit (via WebSocket). Wie `tail -f`, nur im Browser. Nützlich bei der Fehlersuche: "Ich reproduziere jetzt den Fehler und schaue live was in den Logs passiert."

#### Log-Korrelation mit Checks

**Das mächtigste Feature:** Wenn ein Alert aktiv ist, kann der Benutzer auf dem Alert-Detail direkt die zugehörigen Logs sehen.

Auf der Alert-Detail-Seite gibt es einen Tab "Logs" der automatisch zeigt:
- Alle Logs des betroffenen Hosts
- Gefiltert auf den Zeitraum um den Alert herum (5 Minuten vor bis jetzt)
- Severity-Filter auf WARNING+ (Informational Logs sind ausgeblendet, können eingeblendet werden)

Der Benutzer muss nicht einmal suchen — die relevanten Logs sind automatisch da, kontextuell zum Problem das er gerade untersucht.

Außerdem: In den Dashboards (Feature 1) gibt es einen Widget-Typ **"Log Stream"** der Live-Logs für einen bestimmten Host oder Service zeigt. So kann der Benutzer auf einem Dashboard gleichzeitig Metriken und Logs desselben Servers sehen.

#### Log-basierte Alerts

Navigation: Alert Rules → "+ New Rule" → Typ "Log-based"

Der Benutzer definiert Regeln die Alerts auslösen wenn bestimmte Log-Patterns auftreten:

**Typ 1: Pattern Match**
- "Alert when a log matching `ERROR.*OutOfMemoryException` appears on any host"
- Severity: Critical
- Action: Sofort alertieren

**Typ 2: Threshold**
- "Alert when more than 50 ERROR logs appear within 5 minutes on the same host"
- Severity: Warning
- Action: Grouping abwarten, dann alertieren

**Typ 3: Absence**
- "Alert when no heartbeat log (`"Application started successfully"`) appears within 10 minutes after a deployment"
- Nützlich für: Sicherstellen dass eine App nach einem Restart wirklich hochgefahren ist

Konfiguration im UI:
- Pattern: Freitext oder Regex
- Scope: Alle Hosts, bestimmte Hosts, bestimmte Services
- Time Window: 1min, 5min, 15min, 1h
- Threshold: Anzahl der Matches im Time Window
- Severity: Warning / Critical
- Notification Channels: Welche Channels benachrichtigt werden

#### Log Retention und Speicher-Management

Unter Settings → Logs → Retention:
- Default Retention: 30 Tage (konfigurierbar pro Tenant: 7, 14, 30, 60, 90 Tage)
- Geschätzter Speicherverbrauch wird angezeigt: "Current: 12.3 GB compressed. Projected at 90 days: ~37 GB."
- Ältere Logs werden automatisch gelöscht (TimescaleDB chunk-basiert, instant drop — keine langsamen DELETE-Queries)

**Compression-Anzeige:** Der Benutzer sieht in den Settings: "Raw: 124 GB → Compressed: 12.3 GB (90% reduction)". Das vermittelt: Log Management braucht nicht endlos Speicher.

### Log Collection Architecture

```
[Host: Go Agent] ──── tail files ────┐
                 ──── journald ──────├── HTTP POST (batch, zstd) ──→ [FastAPI]
                 ──── Win Event Log ─┘                                 │
                                                                 ├──→ [TimescaleDB]
[Network Devices] ──── syslog (RFC 5424) ──────────────────────→ │
                                                                 └──→ [Redis] (Alerting)
```

### Kernentscheidung: TimescaleDB statt Elasticsearch

Overseer läuft auf einem einzelnen VPS. Elasticsearch braucht 4GB+ RAM nur im Idle. TimescaleDB ist bereits da:
- Write Performance: 50K-100K rows/sec (Overseer braucht typisch <5K EPS)
- Compression: 90-95% (100GB → 5-10GB)
- Full-Text Search: PostgreSQL tsvector + GIN Index — "good enough" für Monitoring-Scale
- Retention: Built-in `add_retention_policy()` — chunk-basiert, instant Drop

### Datenbank-Schema

```sql
CREATE TABLE logs (
    time            TIMESTAMPTZ     NOT NULL,
    host_id         INTEGER         NOT NULL REFERENCES hosts(id),
    source          TEXT            NOT NULL,  -- 'file', 'journal', 'eventlog', 'syslog'
    source_path     TEXT,                      -- '/var/log/nginx/error.log'
    service         TEXT,                      -- 'nginx', 'postgresql'
    severity        SMALLINT        NOT NULL,  -- 0=emergency..7=debug (syslog levels)
    message         TEXT            NOT NULL,
    fields          JSONB,                     -- extrahierte strukturierte Felder
    search_vector   TSVECTOR        GENERATED ALWAYS AS (
                        to_tsvector('english', message)
                    ) STORED
);

SELECT create_hypertable('logs', 'time', chunk_time_interval => INTERVAL '1 day');

CREATE INDEX idx_logs_search ON logs USING GIN (search_vector);
CREATE INDEX idx_logs_host_time ON logs (host_id, time DESC);
CREATE INDEX idx_logs_severity_time ON logs (severity, time DESC);
CREATE INDEX idx_logs_fields ON logs USING GIN (fields);

ALTER TABLE logs SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'host_id, service',
    timescaledb.compress_orderby = 'time DESC'
);
SELECT add_compression_policy('logs', compress_after => INTERVAL '2 hours');
SELECT add_retention_policy('logs', drop_after => INTERVAL '30 days');
```

### Volume-Schätzungen

| Deployment | EPS | Raw/Tag | Nach Compression | 30-Tage Retention |
|------------|-----|---------|-------------------|--------------------|
| Klein (10-20 Hosts) | ~500 | ~4.5 GB | ~0.45 GB | ~13.5 GB |
| Mittel (100 Hosts) | ~2,800 | ~24 GB | ~2.4 GB | ~72 GB |
| Groß (1000+ Hosts) | ~50,000 | ~430 GB | ~43 GB | Hier ClickHouse erwägen |

---

## FEATURE 7: Public Status Pages

### Warum Priorität 6
MSPs können ihren Kunden Status-Seiten anbieten. Jeder Statuspage.io-Klon kostet $29-399/mo — wenn Overseer das built-in hat, ist das ein starkes Verkaufsargument.

### Anwendungslogik

#### Wer nutzt Status Pages und warum?

**Szenario 1: MSP für seine Kunden**
Der MSP betreut die IT von "Müller GmbH". Müller GmbH hat eine Webseite, ein ERP-System und eine VoIP-Anlage. Wenn etwas ausfällt, rufen die Mitarbeiter von Müller beim MSP an: "Geht das Internet nicht oder liegt es an unserem Server?" Der MSP will eine Status-Seite unter `status.mueller-gmbh.de` wo die Mitarbeiter selbst nachschauen können bevor sie anrufen.

**Szenario 2: SaaS-Anbieter für seine Nutzer**
Ein SaaS-Anbieter der Overseer zur internen Überwachung nutzt, will eine öffentliche Status-Seite für seine Endkunden: `status.saas-app.com`.

#### Status Page einrichten

Navigation: Status Pages → "+ Create Status Page"

**Schritt 1: Grundeinstellungen**
- Titel: "Müller GmbH System Status"
- Slug: `mueller-gmbh` → ergibt URL `{slug}.status.overseer.example.com`
- Optional: Custom Domain `status.mueller-gmbh.de` (CNAME auf Overseer → automatisches Let's Encrypt Zertifikat)

**Schritt 2: Branding**
- Logo hochladen (wird oben auf der Status-Seite angezeigt)
- Primary Color (für den Header und Akzente)
- Favicon
- Optional: Custom CSS (für fortgeschrittene Anpassungen)

**Schritt 3: Komponenten definieren**

Hier entscheidet der Benutzer **was auf der Status-Seite sichtbar ist**. Die internen Hosts/Services werden auf öffentliche "Komponenten" gemappt. Die öffentliche Seite zeigt nie interne Hostnamen oder IPs.

Beispiel:

| Öffentliche Komponente | Interne Checks (Hidden) |
|----------------------|----------------------|
| Website | web-01:http_check, web-02:http_check |
| Email | mail-01:imap_check, mail-01:smtp_check |
| ERP System | erp-01:http_check, erp-01:process_check |
| VoIP/Telefonie | voip-01:sip_check |

**Wie erstellt man eine Komponente?**
- Name eingeben: "Website"
- Beschreibung (optional): "Firmenhomepage und Kundenportal"
- Checks zuordnen: Dropdown/Multi-Select aus allen verfügbaren Services des Tenants
- Gruppe: Optional kann man Komponenten in Gruppen organisieren (z.B. "Infrastruktur", "Kommunikation", "Business Apps")

**Status-Logik:**
Der Status einer Komponente wird automatisch aus den zugeordneten Checks berechnet:
- **Operational** (grün): Alle zugeordneten Checks sind OK
- **Degraded Performance** (gelb): Mindestens ein Check ist WARNING, aber keiner CRITICAL
- **Partial Outage** (orange): Einer von mehreren Checks ist CRITICAL (z.B. 1 von 2 Webservern down → Service läuft noch, aber eingeschränkt)
- **Major Outage** (rot): Alle Checks sind CRITICAL oder unreachable

Der Benutzer kann den Status auch **manuell überschreiben**. Beispiel: Das automatische Monitoring zeigt "Operational", aber der Benutzer weiß dass die Performance degraded ist wegen eines Problems das der Check nicht erkennt. Er setzt manuell "Degraded Performance" mit einer Notiz.

**Schritt 4: Vorschau und Aktivierung**
- Live-Vorschau der Status-Seite im Browser
- "Publish" → Die Seite ist öffentlich erreichbar

#### Was sieht der Besucher der Status-Seite?

Die Status-Seite ist **absichtlich simpel und schnell ladend**. Keine Login-Anforderung, minimales CSS, lädt in unter 1 Sekunde.

**Aufbau:**

*Header:* Logo + Titel + Gesamt-Status-Banner
- Wenn alles OK: Großes grünes Banner "All Systems Operational" ✓
- Wenn etwas degraded: Gelbes Banner "Some Systems Experiencing Issues"
- Wenn Major Outage: Rotes Banner "Major System Outage"

*Komponentenliste:*
Jede Komponente als Zeile:
```
Website                    Operational       ●
Email                      Operational       ●
ERP System                 Partial Outage    ●
VoIP/Telefonie             Operational       ●
```
Farbiger Punkt rechts, Name links. Simpel.

*90-Tage Uptime-Balken:*
Unter jeder Komponente (oder als separate Section): 90 kleine Balken, einer pro Tag. Jeder Balken ist farbcodiert:
- Grün: 100% Uptime an diesem Tag
- Hellgrün: >99.5% Uptime
- Gelb: >99% Uptime
- Orange: >95% Uptime
- Rot: <95% Uptime
- Grau: Keine Daten

Hover über einen Balken zeigt: "March 15, 2026 — 99.7% uptime (8 min downtime)".

Unten: Gesamt-Uptime der letzten 90 Tage: "99.94% uptime"

*Aktuelle Incidents:*
Wenn gerade ein Incident läuft, erscheint er prominent:
```
─────────────────────────────────────
🔴 ERP System — Partial Outage
   Investigating — 14:30 CET
   We are investigating reports of slow response times
   in the ERP system. Some users may experience delays.

   Update 14:45 CET — Identified
   The issue has been traced to a database
   connection pool exhaustion. A fix is being deployed.
─────────────────────────────────────
```

*Vergangene Incidents:*
Unterhalb der aktuellen Incidents eine chronologische Liste der Incidents der letzten 14 Tage. Ältere sind unter "Incident History" erreichbar.

#### Incident Management

**Automatische Incidents:**
Wenn das Monitoring einen Ausfall erkennt (Komponente wechselt auf "Partial Outage" oder "Major Outage"), wird automatisch ein Incident erstellt:
- Titel: "ERP System — Partial Outage"
- Status: "Investigating"
- Initialer Text: "We are currently investigating an issue with [Component Name]. We will provide updates as we learn more."

**Manuelle Updates:**
Der MSP-Techniker fügt Updates über die Overseer-UI hinzu:
- Status-Dropdown: Investigating → Identified → Monitoring → Resolved
- Update-Text: Freitext (Markdown), z.B. "The database server has been restarted. We are monitoring for stability."
- Jedes Update erscheint sofort auf der öffentlichen Status-Seite mit Zeitstempel.

**Automatische Resolution:**
Wenn alle Checks der Komponente wieder OK sind und 5 Minuten stabil bleiben → der Incident wird automatisch resolved mit dem Text: "This incident has been resolved. All systems are operating normally." Der Techniker kann danach noch ein manuelles Update hinzufügen mit mehr Details.

**Geplante Wartung (Maintenance):**
Der Benutzer kann geplante Wartungen vorab anlegen:
- Titel: "Planned Database Maintenance"
- Zeitfenster: "2026-04-05 02:00 – 04:00 CET"
- Betroffene Komponenten: "ERP System", "Website"
- Beschreibung: "We will be performing a database upgrade. The ERP system and website will be unavailable during this window."

Das Wartungsfenster erscheint auf der Status-Seite **vor** dem Termin als blaues Banner: "Upcoming Maintenance: April 5, 02:00-04:00 CET". Während der Wartung wechselt der Status auf "Under Maintenance" (blaues Icon, nicht rot — der Besucher weiß: das ist geplant, nicht kaputt).

#### Subscriber-System

Auf der Status-Seite unten: "Subscribe to Updates" Button.

Optionen:
- **Email**: E-Mail eingeben → Bestätigungs-Mail → Double Opt-In. Bei jedem Incident-Update bekommt der Subscriber eine E-Mail.
- **Webhook**: URL eingeben → bei jedem Status-Update wird ein JSON-Payload gesendet (für interne Systeme die den Status weiterverarbeiten wollen).
- **RSS Feed**: Link zum RSS Feed der Incidents.

Der Subscriber kann wählen **welche Komponenten** ihn interessieren. Beispiel: Der Buchhaltungs-Mitarbeiter abonniert nur "ERP System", nicht "Website" oder "VoIP".

#### Unabhängigkeit vom Monitoring-System

Die Status-Seite muss auch funktionieren wenn Overseer selbst down ist. Lösung:

1. Bei jedem Status-Update generiert Overseer eine **statische JSON-Datei** mit dem aktuellen Status aller Komponenten.
2. Die Status-Seite ist eine **statische Single-Page-App** (HTML + JS) die diese JSON-Datei lädt.
3. Die JSON-Datei kann auf einem CDN (Cloudflare R2, S3) gehostet werden — getrennt vom Overseer-Server.
4. Fallback: Wenn die JSON-Datei nicht aktualisiert wurde (>10 Minuten alt), zeigt die Status-Seite: "Status information may be outdated. Last updated: X minutes ago."

### Datenbank-Schema

```sql
CREATE TABLE status_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    public_token UUID UNIQUE DEFAULT gen_random_uuid(),
    slug VARCHAR(63) UNIQUE,
    custom_domain VARCHAR(255),
    title VARCHAR(255),
    description TEXT,
    logo_url TEXT,
    primary_color VARCHAR(7),
    favicon_url TEXT,
    custom_css TEXT,
    timezone VARCHAR(50) DEFAULT 'UTC',
    is_public BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE status_page_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status_page_id UUID REFERENCES status_pages(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    position INTEGER DEFAULT 0,
    group_name VARCHAR(255),
    current_status VARCHAR(20) DEFAULT 'operational',
    status_override BOOLEAN DEFAULT false,   -- true wenn manuell gesetzt
    show_uptime BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE component_check_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    component_id UUID REFERENCES status_page_components(id),
    service_id UUID REFERENCES services(id)
);

CREATE TABLE status_page_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status_page_id UUID REFERENCES status_pages(id),
    title VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL,     -- investigating | identified | monitoring | resolved
    impact VARCHAR(20) NOT NULL,     -- none | minor | major | critical | maintenance
    is_auto_created BOOLEAN DEFAULT false,
    scheduled_start TIMESTAMPTZ,     -- für geplante Wartung
    scheduled_end TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE TABLE incident_updates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID REFERENCES status_page_incidents(id),
    status VARCHAR(20) NOT NULL,
    body TEXT NOT NULL,               -- Markdown
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID
);

CREATE TABLE component_daily_uptime (
    component_id UUID REFERENCES status_page_components(id),
    date DATE NOT NULL,
    uptime_percentage FLOAT,
    worst_status VARCHAR(20),
    major_outage_minutes INTEGER DEFAULT 0,
    partial_outage_minutes INTEGER DEFAULT 0,
    UNIQUE(component_id, date)
);

CREATE TABLE status_page_subscribers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status_page_id UUID REFERENCES status_pages(id),
    type VARCHAR(10) NOT NULL,        -- email | webhook | rss
    endpoint VARCHAR(512) NOT NULL,
    confirmed BOOLEAN DEFAULT false,
    confirmation_token UUID DEFAULT gen_random_uuid(),
    component_ids UUID[],             -- NULL = alle Komponenten
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## FEATURE 8: SSL/TLS Certificate Monitoring

### Warum Priorität 7
Fast kein Aufwand zu implementieren, jeder braucht es. Einfacher Quick Win mit hohem Kundennutzen.

### Anwendungslogik

#### Das Problem

SSL-Zertifikate laufen ab. Let's Encrypt erneuert automatisch — meistens. Aber manchmal schlägt die Erneuerung fehl (DNS-Problem, Webserver-Misconfiguration, Firewall-Regel). Und viele Kunden haben noch manuelle Zertifikate. Der MSP will vorgewarnt werden, nicht erst wenn der Kunde anruft weil sein Browser "Verbindung nicht sicher" zeigt.

#### SSL Check einrichten

Es gibt zwei Wege:

**Weg 1: Automatisch via Auto-Discovery**
Wenn Auto-Discovery (Feature 5) einen Host mit offenem Port 443 findet, schlägt es automatisch einen SSL-Check vor. Der Benutzer muss nur bestätigen.

**Weg 2: Manuell**
Host Detail → Add Service → Check Type "SSL Certificate"

Konfiguration:
- **Hostname**: Der Domain-Name (z.B. `api.example.com`) — wichtig: nicht die IP, weil Hostname-Verifikation nötig ist
- **Port**: Default 443, aber auch 8443, 993 (IMAPS), 995 (POP3S), 465 (SMTPS) wählbar
- **Warning-Tage**: Ab wie vielen Tagen vor Ablauf warnen? Default: 30
- **Critical-Tage**: Ab wie vielen Tagen vor Ablauf critical alertieren? Default: 14
- **Check-Intervall**: Default alle 6 Stunden (Zertifikate ändern sich selten, häufiger checken verschwendet nur Ressourcen)
- **Selbst-signierte erlauben**: Ja/Nein (Default: Nein)

#### Was wird geprüft?

Jeder Check prüft automatisch **alle** diese Punkte:

| Prüfung | Was es bedeutet | Wann es alertiert |
|---------|----------------|-------------------|
| Ablaufdatum | Zertifikat läuft in X Tagen ab | ≤30d = Warning, ≤14d = High, ≤7d = Critical, abgelaufen = Critical |
| Hostname-Match | Der Common Name oder SAN passt zum abgefragten Hostname | Sofort Critical wenn mismatch |
| Chain-Validierung | Die Zertifikatskette ist vollständig und vertrauenswürdig | Sofort Critical wenn ungültig |
| Selbst-signiert | Zertifikat ist self-signed (kein CA) | Warning (es sei denn explizit erlaubt) |
| Schwacher Algorithmus | SHA-1 oder MD5 Signatur | Warning |
| Schlüssellänge | RSA-Key unter 2048 Bit | Warning |
| OCSP-Revocation | Zertifikat wurde widerrufen | Critical (optional, da OCSP manchmal langsam/unzuverlässig) |

#### Was sieht der Benutzer?

**In der Service-Liste des Hosts:**
Der SSL-Check erscheint wie jeder andere Check:
```
ssl_certificate   api.example.com:443   OK   "Valid for 62 days (expires 2026-05-28)"
```

**Bei Klick auf den Check — Detail-Ansicht:**

```
Certificate Details
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Subject:        api.example.com
Issuer:         R3 (Let's Encrypt)
Valid From:     2026-01-28
Valid Until:    2026-05-28 (62 days remaining)
Serial:         04:a3:b2:c1:...

SANs:           api.example.com, *.example.com
Signature:      SHA-256 with RSA ✓
Key Size:       2048 bit ✓
Chain Valid:     ✓ (3 certificates)
OCSP Status:    Good ✓
Hostname Match: ✓

History
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Line chart showing "Days until expiry" over time]
```

Der History-Chart ist besonders nützlich: Man sieht ein Sägezahn-Muster — Tage bis Ablauf gehen runter, dann springt es wieder hoch (Zertifikat wurde erneuert). Wenn die Säge plötzlich nicht mehr hochspringt, weiß man: die automatische Erneuerung funktioniert nicht mehr.

#### Notification-Timeline

Die Benachrichtigungs-Logik ist gestaffelt und eskalierend:

- **30 Tage vorher**: Einmalige Warning-Notification: "Certificate for api.example.com expires in 30 days (May 28, 2026)." Danach nur noch im Overseer-UI sichtbar, keine weitere Notification.
- **14 Tage vorher**: Erneute Notification mit höherer Severity: "Certificate for api.example.com expires in 14 days. Action required."
- **7 Tage vorher**: Tägliche Notifications: "Certificate for api.example.com expires in 7 days!"
- **3 Tage vorher**: Notification alle 12 Stunden.
- **Abgelaufen**: Sofort Critical + Notification an alle konfigurierten Channels.

**Nach Erneuerung**: Wenn das Zertifikat erneuert wird (der Check erkennt ein neues Ablaufdatum), sendet das System eine Recovery-Notification: "Certificate for api.example.com has been renewed. New expiry: September 26, 2026."

#### Dashboard-Widget: Certificate Overview

Ein optionales Dashboard-Widget "Certificate Overview" zeigt eine Tabelle aller überwachten Zertifikate sortiert nach Ablaufdatum (dringendste zuerst):

| Domain | Expires | Days Left | Issuer | Status |
|--------|---------|-----------|--------|--------|
| api.example.com | 2026-05-28 | 62 | Let's Encrypt | ✓ OK |
| shop.example.com | 2026-04-10 | 14 | DigiCert | ⚠ Warning |
| old.example.com | 2026-03-20 | EXPIRED | Manual | ✗ Critical |

Dieses Widget gehört auf das Default-Dashboard jedes MSPs.

### Go-Implementierung

```go
func CheckCertificate(host, port string, timeout time.Duration) (*CertificateInfo, error) {
    conn, err := tls.DialWithDialer(
        &net.Dialer{Timeout: timeout}, "tcp",
        net.JoinHostPort(host, port),
        &tls.Config{InsecureSkipVerify: true},
    )
    if err != nil { return nil, err }
    defer conn.Close()

    leaf := conn.ConnectionState().PeerCertificates[0]
    now := time.Now()

    info := &CertificateInfo{
        Subject:         leaf.Subject.CommonName,
        Issuer:          leaf.Issuer.CommonName,
        SANs:            leaf.DNSNames,
        NotAfter:        leaf.NotAfter,
        DaysUntilExpiry: int(leaf.NotAfter.Sub(now).Hours() / 24),
        IsSelfSigned:    leaf.Issuer.CommonName == leaf.Subject.CommonName,
        SignatureAlg:    leaf.SignatureAlgorithm.String(),
    }

    info.HostnameValid = (leaf.VerifyHostname(host) == nil)

    opts := x509.VerifyOptions{DNSName: host, Intermediates: x509.NewCertPool()}
    for _, cert := range conn.ConnectionState().PeerCertificates[1:] {
        opts.Intermediates.AddCert(cert)
    }
    _, chainErr := leaf.Verify(opts)
    info.ChainValid = (chainErr == nil)

    return info, nil
}
```

### Integration
- Neuer Check-Typ: `ssl_certificate` im Agent/Collector
- Check-Intervall: Alle 6-12 Stunden
- Konfiguration: Host, Port, Expiry-Warning-Tage, CheckOCSP, AllowSelfSigned

---

## FEATURE 9: SSO (SAML/OIDC) + LDAP

### Warum Priorität 8
Enterprise-Blocker. Ohne SSO kein Enterprise-Deal. Aber auch für MSPs relevant: deren Kunden nutzen Azure AD oder Okta.

### Anwendungslogik

#### Warum braucht man das?

**Szenario 1: Enterprise-Kunde**
Ein Unternehmen mit 500 Mitarbeitern nutzt Azure AD. Der IT-Chef sagt: "Wir erstellen keine separaten Accounts in jedem Tool. Unsere Mitarbeiter loggen sich einmal mit ihrem Firmen-Account ein und haben Zugriff auf alles." Ohne SSO kauft dieses Unternehmen Overseer nicht.

**Szenario 2: MSP mit mehreren Kunden**
Jeder Kunde hat seinen eigenen Identity Provider (Azure AD, Google Workspace, Okta). Der MSP will nicht für jeden Kunden manuell Benutzer in Overseer anlegen. SSO + automatische User-Provisioning löst das.

#### Login-Flow aus Benutzersicht

**Heute (ohne SSO):**
1. Benutzer geht auf `overseer.example.com`
2. Sieht Login-Formular (Email + Passwort)
3. Gibt Credentials ein
4. Optional: 2FA Code eingeben
5. Ist eingeloggt

**Mit SSO:**
1. Benutzer geht auf `overseer.example.com`
2. Sieht Login-Seite mit zwei Optionen:
   - "Sign in with SSO" (großer Button)
   - "Sign in with Email & Password" (kleiner Link darunter — für lokale Accounts und Fallback)
3. Klick auf "Sign in with SSO" → Eingabefeld: "Enter your work email"
4. Benutzer gibt ein: `hans@mueller-gmbh.de`
5. System extrahiert die Domain `mueller-gmbh.de`, schaut in der Datenbank nach: Welcher Tenant hat einen IdP für diese Domain konfiguriert? → Findet: Tenant "Müller GmbH" hat Azure AD konfiguriert.
6. Redirect zu Azure AD Login-Seite von Microsoft
7. Benutzer gibt sein Microsoft-Passwort ein (oder ist bereits eingeloggt → Single Sign-On, keine erneute Passworteingabe)
8. Microsoft redirected zurück zu Overseer mit einem Token
9. Overseer validiert das Token, extrahiert User-Informationen (Name, Email, Gruppen)
10. Benutzer ist eingeloggt. Wenn es sein erster Login ist, wird automatisch ein Overseer-Account erstellt (JIT Provisioning).

**Das Entscheidende:** Schritt 6-9 dauern weniger als 2 Sekunden und erfordern **null Konfiguration vom Endbenutzer**. Er gibt nur seine Email ein und wird zum richtigen IdP geleitet.

#### SSO einrichten (Admin-Sicht)

Navigation: Settings → Authentication → SSO / Identity Providers → "+ Add Identity Provider"

**Option 1: OIDC (empfohlen, einfacher)**
Die meisten IdPs (Azure AD, Google, Okta, Keycloak) unterstützen OIDC.

Schritt-für-Schritt im UI:
1. **Provider wählen**: Dropdown mit Icons: "Azure AD", "Google Workspace", "Okta", "Keycloak", "Other OIDC"
   - Bei Auswahl eines bekannten Providers füllt das System automatisch Felder vor und zeigt eine Provider-spezifische Anleitung
2. **Discovery URL**: z.B. `https://login.microsoftonline.com/{tenant-id}/v2.0/.well-known/openid-configuration` — bei Azure AD hilft das UI: "Enter your Azure Tenant ID" und baut die URL selbst
3. **Client ID + Client Secret**: Aus dem IdP kopieren. Anleitung im UI mit Screenshots: "Go to Azure Portal → App Registrations → New Registration → ..."
4. **Redirect URI**: Wird automatisch angezeigt: `https://overseer.example.com/auth/oidc/callback` — "Copy this URI and add it to your IdP's allowed redirect URIs"
5. **Email-Domain**: `mueller-gmbh.de` — damit Overseer weiß welche Benutzer zu diesem IdP gehören
6. **Rollen-Mapping**: Welche IdP-Gruppen welchen Overseer-Rollen entsprechen?
   - Azure AD Gruppe "IT-Admins" → Overseer Rolle "Admin"
   - Azure AD Gruppe "IT-Support" → Overseer Rolle "Operator"
   - Alle anderen → Overseer Rolle "Viewer"
7. **Test**: Button "Test SSO Connection" → öffnet den SSO-Flow in einem Popup. Wenn erfolgreich: "Connected successfully. User: Hans Müller (hans@mueller-gmbh.de). Mapped role: Admin."
8. **Activate**: "Enable SSO for this tenant"

**Option 2: SAML 2.0**
Für ältere IdPs die kein OIDC unterstützen:
- IdP Metadata URL oder XML-Upload
- Entity ID
- Attribute Mapping (NameID → Email, welche Attribute für Name, Gruppen)

**Option 3: LDAP/Active Directory**
Für On-Premise AD ohne Cloud-IdP:
- Server URL: `ldaps://dc.mueller-gmbh.local:636`
- Base DN: `DC=mueller-gmbh,DC=local`
- Bind DN + Passwort (für den LDAP-Lookup)
- User-Filter: `(objectClass=user)`
- Gruppen-Mapping: AD Security Groups → Overseer Rollen

LDAP unterscheidet sich von OIDC/SAML: Bei LDAP gibt der Benutzer sein Passwort in der Overseer-UI ein, und Overseer authentifiziert es gegen den LDAP-Server. Kein Redirect, kein SSO im eigentlichen Sinne — aber zentrale Benutzerverwaltung.

#### Automatische User-Provisioning (JIT)

Beim ersten SSO-Login wird automatisch ein Overseer-User erstellt:
- Name: Aus IdP-Attributen (displayName, givenName + surname)
- Email: Aus IdP-Attributen
- Rolle: Aus Gruppen-Mapping
- Tenant: Aus der Domain-Zuordnung

Bei **jedem weiteren Login** werden die Attribute aktualisiert:
- Hat der Benutzer die AD-Gruppe gewechselt? → Rolle in Overseer wird automatisch angepasst
- Hat sich der Name geändert (Heirat)? → Name wird aktualisiert
- Wurde der Benutzer im AD deaktiviert? → Beim nächsten SSO-Versuch schlägt die Authentifizierung fehl. Der Overseer-Account wird **nicht automatisch gelöscht** (könnte Audit-Daten haben), aber der Login wird verweigert.

**Optional: LDAP-Sync-Job**
Für LDAP-Anbindungen kann ein periodischer Sync konfiguriert werden (z.B. alle 6 Stunden):
- Neue AD-User → werden in Overseer erstellt (wenn sie in den konfigurierten Gruppen sind)
- Deaktivierte AD-User → werden in Overseer deaktiviert
- Gruppen-Änderungen → Rollen werden aktualisiert

Der Benutzer sieht den Sync-Status unter Settings → Authentication: "Last LDAP sync: 2 hours ago. 47 users synced, 2 new, 1 deactivated."

#### Fallback und Notfall

**Was passiert wenn der IdP down ist?**
Azure AD hat einen Ausfall (kommt vor). Kein Benutzer kann sich einloggen. Lösung:

1. Auf der Login-Seite gibt es immer den kleinen Link "Sign in with Email & Password"
2. Lokale Admin-Accounts (die nicht über SSO erstellt wurden) können sich immer einloggen
3. Für SSO-User: Der Admin kann in den Settings vorübergehend "Allow password fallback for SSO users" aktivieren — dann können SSO-User ihre E-Mail + ein lokal gesetztes Passwort nutzen
4. **Emergency Bypass**: URL-Parameter `?auth_fallback=local` erzwingt das lokale Login-Formular. Diese URL sollte der MSP-Admin kennen und griffbereit haben.

Jeder Fallback-Login wird **separat im Audit-Log** vermerkt: "User hans@mueller-gmbh.de logged in via local fallback (SSO IdP unreachable)."

#### Multi-Tenant SSO (für MSPs)

Ein MSP hat mehrere Kunden. Jeder Kunde hat seinen eigenen IdP. Das muss alles parallel funktionieren:

- Tenant "Müller GmbH" → Azure AD (Tenant-ID: abc123)
- Tenant "Schmidt AG" → Google Workspace
- Tenant "Weber KG" → Lokale Accounts (kein SSO)
- MSP-Tenant "Acme IT" → Eigenes Azure AD

Wenn sich ein Benutzer einloggt, bestimmt die **Email-Domain** automatisch den richtigen Tenant und IdP. Der Benutzer muss nie seinen Tenant-Namen kennen oder auswählen.

### Datenbank-Schema

```sql
CREATE TABLE tenant_idp_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    auth_type VARCHAR(20),            -- 'saml', 'oidc', 'ldap', 'local'
    email_domains TEXT[],             -- ['mueller-gmbh.de', 'mueller.com']
    -- OIDC
    oidc_discovery_url TEXT,
    oidc_client_id TEXT,
    oidc_client_secret_encrypted TEXT,
    -- SAML
    saml_idp_metadata_url TEXT,
    saml_entity_id TEXT,
    saml_attribute_mapping JSONB,
    -- LDAP
    ldap_server_url TEXT,
    ldap_base_dn TEXT,
    ldap_bind_dn TEXT,
    ldap_bind_password_encrypted TEXT,
    ldap_user_filter TEXT,
    ldap_sync_enabled BOOLEAN DEFAULT false,
    ldap_sync_interval_hours INTEGER DEFAULT 6,
    -- Common
    role_mapping JSONB,               -- {"IT-Admins": "admin", "IT-Support": "operator", "*": "viewer"}
    jit_provisioning BOOLEAN DEFAULT true,
    allow_password_fallback BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Tech-Stack

| Komponente | Wahl |
|------------|------|
| OIDC Client | Authlib |
| SAML SP | python3-saml |
| LDAP | ldap3 |
| Token Blacklist | Redis (SETEX mit TTL) |
| User Sync | APScheduler + ldap3 |

---

## FEATURE 10: Anomaly Detection & Predictive Alerts

### Warum Priorität 9
Differenzierung gegenüber Zabbix/CheckMK. Overseer hat bereits AI-Infrastruktur (Ollama). ML-basierte Anomalieerkennung ist die nächste Stufe.

### Anwendungslogik

#### Was ist Anomaly Detection im Monitoring-Kontext?

Heute: Der Admin setzt einen statischen Threshold: "Warnung wenn CPU > 80%". Das Problem: Manche Server haben immer 75% CPU (das ist normal für sie, z.B. Datenbank-Server). Der Threshold feuert ständig → Alert Fatigue. Oder: Ein Server hat normalerweise 10% CPU, springt plötzlich auf 45% → kein Alert, obwohl das verdoppelte Last ist und auf ein Problem hindeutet.

Anomaly Detection lernt was **normal** ist für jeden individuellen Server und alertiert wenn das Verhalten **ungewöhnlich** ist — unabhängig von festen Schwellwerten.

#### Wie erlebt der Benutzer das?

**Schritt 1: Anomaly Detection aktivieren**

Navigation: Host/Service Detail → Tab "Anomaly Detection"

Der Benutzer sieht:
```
Anomaly Detection: [ OFF | ON ]
Status: Learning (3 of 14 days complete)
Sensitivity: [Low | Normal | High]
```

Wenn er es zum ersten Mal aktiviert:
- **Lernphase:** Das System braucht mindestens 7 Tage Daten um eine Baseline zu berechnen. Empfohlen: 14 Tage. In dieser Zeit werden **keine Anomaly-Alerts** generiert. Der Benutzer sieht einen Fortschrittsbalken: "Learning: 3/14 days. Anomaly detection will become active on April 10."
- **Warum 14 Tage?** Das System muss lernen: "Montags ist die CPU höher als sonntags" (Wochenmuster). "Nachts ist der Netzwerk-Traffic geringer" (Tagesmuster). Dafür braucht es mindestens einen vollen Wochenzyklus, besser zwei.

**Schritt 2: Baselines verstehen**

Nach der Lernphase zeigt der "Anomaly Detection" Tab eine Visualisierung:

Ein Line Chart der letzten 7 Tage mit:
- Die tatsächlichen Werte (blaue Linie)
- Die gelernte Baseline (grüne gestrichelte Linie)
- Ein **Normalband** (hellgrüne Schattierung): der erwartete Bereich (z.B. Mean ± 3 Standardabweichungen)

Der Benutzer sieht auf einen Blick: "Aha, mein Server hat normalerweise 30-45% CPU tagsüber und 10-20% nachts. Alles was aus dem grünen Band rausfällt, ist ungewöhnlich."

**Anomalien werden als rote Punkte auf dem Chart markiert.** Hover über einen roten Punkt: "Anomaly detected: CPU at 78% (expected: 30-45%). Anomaly Score: 4.2"

**Schritt 3: Auf Anomalien reagieren**

Wenn eine Anomalie erkannt wird, passiert Folgendes:

1. **Im UI:** Der Host/Service bekommt ein kleines "A" Badge (wie das Alert-Badge, aber anders farbig — lila). In der Host-Liste sieht man sofort welche Hosts anomales Verhalten zeigen.

2. **Alert (optional):** Anomaly Detection generiert Alerts mit einer eigenen Severity "Anomaly" (zwischen Info und Warning). Der Benutzer kann in den Settings konfigurieren ob Anomaly-Alerts Notifications auslösen sollen. Default: Nein — Anomalien sind erstmal nur im UI sichtbar. Der Benutzer muss sich bewusst dafür entscheiden Anomaly-Notifications zu bekommen.

3. **Anomaly-Alert-Text:**
```
⚡ ANOMALY: Unusual CPU usage on db-prod-01
Current: 78.3%
Expected range: 28-47% (based on historical Thursday 14:00 pattern)
Anomaly score: 4.2 (threshold: 3.0)
Duration: 25 minutes

This is not a threshold alert — the system detected behavior that
deviates significantly from learned patterns.

[View Baseline]  [Mark as False Positive]  [Adjust Sensitivity]
```

#### False Positive Management

Anomaly Detection wird immer False Positives haben. Das ist normal. Der entscheidende Punkt ist: Es muss **einfach** sein, False Positives zu markieren, und das System muss **daraus lernen**.

**"Mark as False Positive" Button:**
Wenn der Benutzer auf einen Anomaly-Alert klickt und feststellt: "Das ist normal, der Server macht das jetzt jeden Donnerstag wegen des Backup-Jobs" → Klick auf "Mark as False Positive".

Was passiert dann:
1. Der Anomaly-Alert wird als False Positive gespeichert
2. Das System merkt sich: "Donnerstag 14:00-15:00 ist hohe CPU auf diesem Host normal"
3. Die Baseline wird bei der nächsten Berechnung angepasst
4. Der Benutzer sieht eine Bestätigung: "Marked as false positive. The system will learn from this."

**Sensitivity-Einstellungen:**
Pro Host oder pro Metrik konfigurierbar:
- **High** (Threshold 2.0): Erkennt mehr Anomalien, aber auch mehr False Positives. Für kritische Production-Server wo man lieber einmal zu viel alerted als einmal zu wenig.
- **Normal** (Threshold 3.0): Ausgewogener Default.
- **Low** (Threshold 4.0): Nur extreme Abweichungen. Für "noisy" Metriken oder weniger kritische Server.

Der Benutzer kann die Sensitivity jederzeit ändern. Die Änderung wirkt sofort.

#### Predictive Alerts: "Disk voll in X Tagen"

Unabhängig von Anomaly Detection gibt es Predictive Alerts. Diese sind leichter zu verstehen und sofort nützlich.

**Wie funktioniert das?**
Das System schaut sich die Disk-Usage der letzten 30 Tage an und berechnet den Trend: "Diese Festplatte wächst um 1.2 GB pro Tag. Bei aktuell 87% Auslastung (von 500 GB) ist sie in 24 Tagen voll."

**Was sieht der Benutzer?**

Auf der Host-Detail-Seite erscheint eine Warnung:
```
⏰ PREDICTION: Disk /data on db-prod-01
Current usage: 87% (435 GB / 500 GB)
Growth rate: 1.2 GB/day
Predicted full: April 20, 2026 (24 days)
Confidence: High (R² = 0.94)

[View Trend Chart]  [Configure Alert]
```

Der Trend-Chart zeigt:
- Die historische Disk-Usage als Linie (letzte 30 Tage)
- Eine gestrichelte Fortführungslinie (Prognose der nächsten 60 Tage)
- Eine rote horizontale Linie bei 100% Kapazität
- Der Schnittpunkt der beiden Linien = prognostiziertes Erschöpfungsdatum

**Alert-Logik:**
- Predicted full in >30 Tagen: Info (nur im UI sichtbar)
- Predicted full in 14-30 Tagen: Warning
- Predicted full in 7-14 Tagen: High
- Predicted full in <7 Tagen: Critical

**Confidence:**
Nicht jede Prognose ist gleich zuverlässig. Ein Server dessen Disk-Usage gleichmäßig wächst hat eine hohe Confidence (R² > 0.8). Ein Server dessen Usage stark schwankt (z.B. Logs die periodisch gelöscht werden) hat eine niedrige Confidence (R² < 0.5). Bei niedriger Confidence zeigt das System: "Prediction: Disk might fill up around May 2026, but usage is irregular. Confidence: Low." Und der Alert wird nicht gesendet — nur im UI als Info angezeigt.

**Für welche Metriken funktioniert Prediction?**
- **Gut geeignet:** Disk Usage, Database Size, Log Volume, Certificate Expiry (das ist quasi eine eingebaute Prediction)
- **Bedingt geeignet:** Memory Usage (wenn langsam steigend → Memory Leak), Connection Count
- **Nicht geeignet:** CPU (zu volatil), Network Traffic (zu zyklisch)

Der Benutzer kann Predictive Alerts per Metrik aktivieren/deaktivieren.

#### Integration mit dem AI-Service (Ollama)

Overseer hat bereits einen AI-Service. Anomaly Detection kann davon profitieren:

Wenn eine Anomalie erkannt wird, kann der AI-Service automatisch einen Kontext generieren:
```
⚡ ANOMALY: Unusual memory usage on app-prod-01

AI Analysis:
Memory has been steadily increasing for 3 hours (from 4.2 GB to 7.8 GB).
This pattern is consistent with a memory leak. The last deployment was
6 hours ago (commit abc123 by lukas). Consider checking the application
for unbounded caching or connection pool leaks.

Correlated events:
- Deployment detected 6h ago
- HTTP error rate increased 2h ago (from 0.1% to 2.3%)
- Response time P95 increased from 120ms to 890ms
```

Das ist kein Ersatz für menschliche Analyse — aber es gibt dem Techniker einen Startpunkt statt roher Zahlen.

### Algorithmen-Wahl

**Für einfache Metriken (CPU, Memory, Disk): Z-Score / MAD**
- Keine GPU nötig, Microsekunden pro Datenpunkt
- Modified Z-Score (MAD) ist robuster gegen existierende Outlier
- Schwellwert: |z| > 3 = Anomalie

**Für Multi-Metrik-Korrelation: Isolation Forest (scikit-learn)**
- Kein Training nötig (unsupervised)
- Skaliert zu Millionen Datenpunkten
- `contamination=0.01` (erwarte 1% Anomalien)

**Für saisonale Metriken (Traffic, Requests): Prophet oder STL**
- Lernt tägliche/wöchentliche/jährliche Muster
- Nur für Metriken mit klar erkennbaren Patterns sinnvoll

### Baseline Learning

Multi-Resolution Baselines: 7 Tage × 24 Stunden = 168 Buckets

```sql
CREATE TABLE metric_baselines (
    metric_id INTEGER NOT NULL,
    day_of_week SMALLINT NOT NULL,     -- 0=Montag, 6=Sonntag
    hour_of_day SMALLINT NOT NULL,     -- 0-23
    mean DOUBLE PRECISION,
    std_dev DOUBLE PRECISION,
    median DOUBLE PRECISION,
    p05 DOUBLE PRECISION,
    p95 DOUBLE PRECISION,
    sample_count INTEGER,
    updated_at TIMESTAMPTZ,
    PRIMARY KEY (metric_id, day_of_week, hour_of_day)
);
```

Training-Periode: Minimum 7 Tage, empfohlen 14 Tage.

### Predictive Alerts

```python
from sklearn.linear_model import LinearRegression

def predict_exhaustion(timestamps, values, capacity):
    X = np.array([(t - t0).total_seconds() / 3600 for t in timestamps]).reshape(-1, 1)
    model = LinearRegression().fit(X, np.array(values))

    rate_per_hour = model.coef_[0]
    if rate_per_hour <= 0:
        return {"will_exhaust": False}

    remaining = capacity - model.predict([[current_hours]])[0]
    hours_until_full = remaining / rate_per_hour

    return {
        "days_until_full": hours_until_full / 24,
        "exhaustion_date": now + timedelta(hours=hours_until_full),
        "confidence": model.score(X, y),  # R² > 0.8 = zuverlässig
    }
```

### False Positive Management (Datenbank)

```sql
CREATE TABLE metric_anomaly_config (
    metric_id INTEGER PRIMARY KEY,
    detection_enabled BOOLEAN DEFAULT TRUE,
    detection_method VARCHAR(50) DEFAULT 'zscore',
    sensitivity DOUBLE PRECISION DEFAULT 3.0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE anomaly_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_id INTEGER NOT NULL,
    anomaly_timestamp TIMESTAMPTZ NOT NULL,
    feedback VARCHAR(20) NOT NULL,   -- 'false_positive', 'confirmed_anomaly'
    feedback_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Python-Bibliotheken

| Bibliothek | Zweck |
|------------|-------|
| scikit-learn | Isolation Forest, Linear Regression |
| numpy | Z-Score, MAD, statistische Berechnungen |
| Prophet | Saisonale Forecasts (optional) |
| statsmodels | STL Decomposition (optional) |
| networkx | Dependency-Graph für Root Cause Analysis |

---

## Implementierungs-Reihenfolge: Empfohlene Roadmap

### Phase 1: Quick Wins
- **SSL Certificate Monitoring** (neuer Check-Typ im Agent, minimal Backend-Änderung)
- **Notification Channels** (Slack + Teams + Telegram — Plugin-System + 3 Implementierungen)
- **Alert Grouping basics** (group_wait + Deduplication)

### Phase 2: Dashboard Foundation
- **Custom Dashboards** (react-grid-layout + Widget-System + Persistenz)
- **Dashboard Sharing** (Public Links)

### Phase 3: Reporting & Status
- **PDF Reports** (WeasyPrint + Plotly + APScheduler + Branding)
- **TimescaleDB Continuous Aggregates** (Basis für Reports und Dashboards)
- **Status Pages** (Public-facing, Incidents, Uptime-Balken)

### Phase 4: Intelligence
- **Auto-Discovery** (Agent Service Discovery + Network Scan + Registration)
- **Alert Suppression / Dependencies** (Dependency Tree + Inhibition Engine)

### Phase 5: Enterprise Features
- **Log Management** (Agent Collection + TimescaleDB Storage + Search UI)
- **SSO/LDAP** (OIDC + SAML + Multi-Tenant IdP Config)
- **Anomaly Detection** (Baselines + Z-Score + Predictive Alerts)

### Phase 6: Advanced (ongoing)
- Cloud Resource Discovery (AWS/Azure)
- Dashboard Template Variables (Chaining, Multi-Value)
- SCIM User Provisioning
- CT Log Monitoring
- Prophet/STL für saisonale Anomalien
