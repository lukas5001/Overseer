# Overseer – Production Readiness Audit

Stand: 2026-03-24

---

## 1. KRITISCH — Logik-Fehler die zu kaputtem Monitoring führen

### 1.1 Agent-Checks können ohne Agent erstellt werden
**Problem:** Man kann `agent_cpu`, `agent_disk` etc. auf Hosts anlegen, die keinen Agent installiert haben (`agent_managed=false`). Die Checks landen im UNKNOWN und es gibt keinen Hinweis warum.

**Wo:** `api/app/routers/services.py` (POST), `frontend/src/pages/HostDetailPage.tsx` (AddCheckModal)

**Fix Backend:**
```python
# In POST /api/v1/services/ — vor dem Insert:
if body.check_mode == 'agent' or body.check_type.startswith('agent_'):
    host = await db.get(Host, body.host_id)
    if not host.agent_managed:
        raise HTTPException(400, "Agent-Checks erfordern einen installierten Agent. Bitte zuerst Agent einrichten.")
```

**Fix Frontend:**
- In AddCheckModal: Agent-Check-Typen nur anzeigen wenn `host.agent_managed === true`
- Alternativ: Hinweisbox "Dieser Host hat keinen Agent. Agent-Checks sind nicht verfügbar."

---

### 1.2 Passive Checks ohne Collector möglich
**Problem:** Man kann `check_mode='passive'` wählen, obwohl der Host keinen Collector hat. Passive Checks brauchen einen Collector der die Ergebnisse einschickt — ohne Collector passiert nichts.

**Wo:** `api/app/routers/services.py` (POST), `frontend/src/pages/HostDetailPage.tsx`

**Fix Backend:**
```python
if body.check_mode == 'passive':
    host = await db.get(Host, body.host_id)
    if not host.collector_id:
        raise HTTPException(400, "Passive Checks benötigen einen zugewiesenen Collector.")
```

**Fix Frontend:**
- `check_mode` Dropdown: "Passiv" nur anzeigen wenn Host einen Collector hat
- Oder: Hinweis "Kein Collector zugewiesen — passive Checks nicht möglich"

---

### 1.3 Netzwerk-Checks ohne IP-Adresse
**Problem:** `ping`, `port`, `snmp` Checks benötigen eine IP-Adresse auf dem Host. Man kann sie aber auch ohne IP anlegen → permanentes UNKNOWN.

**Wo:** `api/app/routers/services.py` (POST)

**Fix Backend:**
```python
IP_REQUIRED_TYPES = {'ping', 'port', 'snmp', 'snmp_interface', 'ssh_disk', 'ssh_cpu', 'ssh_mem', 'ssh_process', 'ssh_service', 'ssh_custom'}
if body.check_type in IP_REQUIRED_TYPES:
    host = await db.get(Host, body.host_id)
    if not host.ip_address:
        raise HTTPException(400, f"Check-Typ '{body.check_type}' benötigt eine IP-Adresse auf dem Host.")
```

---

### 1.4 check_type ist nach Erstellung änderbar
**Problem:** Die API erlaubt es, den `check_type` über PATCH zu ändern (z.B. von `ping` zu `agent_cpu`). Das Frontend zeigt ihn als read-only, aber per API geht es trotzdem. Das kann zu inkonsistenten Checks führen.

**Fix Backend:** `check_type` aus `ServiceUpdate` Schema entfernen (oder im PATCH Endpoint ignorieren):
```python
# In PATCH /api/v1/services/{service_id}:
if body.check_type is not None:
    raise HTTPException(400, "check_type kann nach Erstellung nicht geändert werden. Bitte Check löschen und neu anlegen.")
```

---

## 2. WICHTIG — UX-Probleme die Verwirrung stiften

### 2.1 SNMP-Felder werden immer angezeigt
**Problem:** Beim Host erstellen/bearbeiten sieht man immer "SNMP Community" und "SNMP Version", auch wenn:
- Der Host agent-managed ist (Agent braucht kein SNMP)
- Der Host-Typ "server" ist und keine SNMP-Checks geplant sind

**Fix Frontend:**
- SNMP-Felder nur anzeigen wenn `host_type` in `['switch', 'router', 'printer', 'firewall', 'access_point']`
- ODER: Ein Aufklappbereich "SNMP-Einstellungen (optional)" der standardmäßig eingeklappt ist
- Bei agent-managed Hosts: SNMP-Felder komplett ausblenden

**Wo:** `HostsPage.tsx` (Create Modal, Zeile ~154-169), `HostDetailPage.tsx` (Edit Modal, Zeile ~657-671)

---

### 2.2 IP-Adresse: Wann braucht man sie?
**Problem:** IP-Adresse ist immer optional. Aber:
- **Agent-Hosts:** IP wird NICHT benötigt (Agent verbindet sich selbst zum Server)
- **Collector-Hosts:** IP wird BENÖTIGT (Collector schickt Checks an die IP)
- **Aktive Checks:** IP wird BENÖTIGT (Server pingt/prüft die IP)

Es gibt keinen Hinweis wann sie nötig ist.

**Fix Frontend:**
- Wenn `agent_managed`: IP-Feld als "Optional (nur für Netzwerk-Checks nötig)" markieren
- Wenn Collector gesetzt: IP-Feld als "Erforderlich für passive Checks" markieren
- Hint-Text unter dem Feld anpassen je nach Kontext

---

### 2.3 Agent Setup für nicht-Server Hosts
**Problem:** Man kann einen Agent-Token für einen Drucker oder Switch generieren. Das ergibt keinen Sinn — darauf kann kein Agent installiert werden.

**Fix Frontend:** "Agent einrichten" Button nur für `host_type === 'server'` anzeigen.

**Fix Backend:**
```python
# In POST /hosts/{host_id}/agent-token:
if host_row.host_type not in ('server',):
    raise HTTPException(400, "Agent-Tokens können nur für Server generiert werden.")
```

**Wo:** `HostDetailPage.tsx` (Zeile ~1454), `api/app/routers/agent.py` (Zeile ~107)

---

### 2.4 Hardcodierte Server-URL im Agent Setup
**Problem:** Die Agent-Setup-Anleitung zeigt `https://overseer.dailycrust.it` als Server-URL. Bei Self-Hosted-Instanzen stimmt das nicht.

**Fix Frontend:**
```tsx
// Statt hardcodiert:
const serverUrl = window.location.origin
// Verwenden in der Anleitung:
<code>wget {serverUrl}/agent/overseer-agent-linux-amd64</code>
```

**Wo:** `HostDetailPage.tsx` (Zeile ~1567, ~1595)

---

### 2.5 Collector-Download wird für Agent-Hosts angezeigt
**Problem:** Wenn ein Host agent-managed ist, sollte man im Setup den Agent-Installer sehen, nicht den Collector-Download. Aktuell gibt es keine klare Trennung.

**Fix:** Im HostDetailPage den Setup-Bereich kontextabhängig machen:
- `agent_managed === true` → Agent-Setup (Installer/Binary Download)
- `collector_id !== null` → Collector ist bereits zugewiesen, Hinweis zeigen
- Sonst → Auswahl: "Agent installieren" oder "Collector zuweisen"

---

### 2.6 Check-Typen nicht nach Kontext gefiltert
**Problem:** Beim Erstellen eines Checks sieht man ALLE 19 Check-Typen, egal ob sie für den Host passen oder nicht. Ein Agent-Host sieht SSH-Checks, ein Drucker sieht Agent-Checks.

**Fix Frontend:** Check-Typen im Dropdown filtern:
```tsx
const availableCheckTypes = CHECK_TYPES.filter(ct => {
  // Agent-Checks nur für agent-managed Hosts
  if (ct.startsWith('agent_') && !host.agent_managed) return false
  // SSH-Checks nur wenn IP vorhanden
  if (ct.startsWith('ssh_') && !host.ip_address) return false
  // SNMP-Checks nur wenn SNMP community gesetzt
  if (ct.startsWith('snmp') && !host.snmp_community) return false
  // Ping/Port nur wenn IP vorhanden
  if ((ct === 'ping' || ct === 'port') && !host.ip_address) return false
  return true
})
```

Alternativ: Alle anzeigen, aber nicht-verfügbare ausgegraut mit Tooltip warum.

**Wo:** `HostDetailPage.tsx` (Zeile ~262-267, und AddCheckModal)

---

### 2.7 Templates nicht nach Host-Typ/Agent gefiltert
**Problem:** Beim Template-Anwenden sieht man alle Templates — auch "Generic Linux Server" für einen Windows-Agent-Host, oder "Cisco Router" für einen normalen Server.

**Fix Frontend:**
```tsx
// Template-Query mit Filtern:
const { data: templates } = useQuery({
  queryKey: ['service-templates', host.host_type, host.agent_managed],
  queryFn: () => {
    const params = new URLSearchParams()
    if (host.agent_managed) params.set('tag', 'agent')
    // Oder nach Kategorie filtern
    return api.get(`/api/v1/service-templates/?${params}`).then(r => r.data)
  }
})
```

**Fix Backend:** Neuer Query-Parameter `compatible_host_id` der Templates nach Kompatibilität filtert.

---

## 3. VERBESSERUNGEN — Fehlende Features für Produktionsreife

### 3.1 Kein Onboarding-Flow für neue Hosts
**Problem:** Nach dem Erstellen eines Hosts gibt es keinen Wizard der durch die Einrichtung führt. User müssen selbst herausfinden:
1. Agent oder Collector?
2. Token generieren / Collector zuweisen
3. Checks anlegen oder Template anwenden

**Fix:** Nach Host-Erstellung direkt auf HostDetailPage weiterleiten mit einem Banner:
```
"Host erstellt! Nächster Schritt: Agent installieren oder Collector zuweisen"
[Agent einrichten]  [Collector zuweisen]  [Template anwenden]
```

---

### 3.2 Keine Anzeige der Host-Bereitschaft in der Host-Liste
**Problem:** In der Host-Übersicht sieht man nicht ob ein Host "bereit" ist:
- Hat er eine IP?
- Hat er einen Agent/Collector?
- Sind Checks konfiguriert?

**Fix:** Status-Icons in der Host-Tabelle:
- 🟢 Agent online / Collector online
- 🟡 Agent/Collector zugewiesen aber offline
- ⚪ Kein Agent und kein Collector

---

### 3.3 Host-Kopie verliert Agent-Status
**Problem:** Beim Kopieren eines Hosts wird `agent_managed` nicht übernommen und kein Agent-Token erstellt.

**Fix:** Beim Kopieren:
1. `agent_managed` mit kopieren
2. Hinweis: "Agent-Token muss separat generiert werden"
3. Oder: Agent-Token automatisch generieren und einmalig anzeigen

---

### 3.4 Intervall-Validierung fehlt
**Problem:** Man kann ein Check-Intervall von 0 oder 1 Sekunde setzen. Das überlastet den Agent/Server.

**Fix Backend:**
```python
if body.interval_seconds < 10:
    raise HTTPException(400, "Minimales Intervall: 10 Sekunden")
if body.interval_seconds > 604800:
    raise HTTPException(400, "Maximales Intervall: 7 Tage (604800 Sekunden)")
```

---

### 3.5 SNMP Walk ohne Community-Validierung
**Problem:** Man kann den SNMP Walk starten obwohl keine Community gesetzt ist → Timeout nach 30 Sekunden ohne hilfreiche Fehlermeldung.

**Fix Frontend:**
```tsx
if (!host.snmp_community) {
  setError("Bitte SNMP Community in den Host-Einstellungen setzen bevor Sie einen Walk starten.")
  return
}
```

---

### 3.6 Agent-Token Regenerierung umständlich
**Problem:** Um einen Token zu erneuern muss man erst widerrufen, dann neu generieren (2 Klicks + Bestätigung).

**Fix:** Ein Button "Token erneuern" der beides in einem Schritt macht (alter Token wird automatisch deaktiviert).

---

## 4. PRIORISIERTE REIHENFOLGE

### Sofort (vor Go-Live):
1. ✅ 1.1 — Agent-Checks ohne Agent verhindern
2. ✅ 1.2 — Passive Checks ohne Collector verhindern
3. ✅ 1.3 — Netzwerk-Checks ohne IP verhindern
4. ✅ 1.4 — check_type nach Erstellung sperren
5. ✅ 2.6 — Check-Typen nach Kontext filtern

### Nächste Woche:
6. ✅ 2.1 — SNMP-Felder kontextabhängig
7. ✅ 2.2 — IP-Adresse Hinweistexte
8. ✅ 2.3 — Agent nur für Server
9. ✅ 2.4 — Server-URL dynamisch
10. ✅ 2.5 — Collector/Agent Display kontextabhängig
11. ✅ 2.7 — Templates filtern

### Danach:
11. ✅ 3.1 — Onboarding-Flow
12. ✅ 3.2 — Host-Bereitschaft in Liste
13. ✅ 3.3 — Host-Kopie Agent-Status
14. ✅ 3.4 — Intervall-Validierung
15. ✅ 3.5 — SNMP Walk Validierung
16. ✅ 3.6 — Token Regenerierung
