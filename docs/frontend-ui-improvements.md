# Frontend UI Improvements & Dark Mode Plan

## Teil 1: UI/UX Probleme und Fixes

### Grundproblem: Inkonsistente Farbgebung

Das Frontend verwendet Tailwind-Farbklassen uneinheitlich. Zentrale Muster:

- **Zu heller Text auf hellem Hintergrund**: `bg-*-100` mit `text-*-600` oder `text-*-700` statt `text-*-800`
- **Zu dunkler Text auf weißem Hintergrund**: Hartes Schwarz (`text-gray-900`) wo `text-gray-700` reichen würde
- **Fehlende Rahmen**: Badges ohne Borders sehen flach und schlecht abgegrenzt aus

### Regel für konsistente Badges

| Hintergrund | Text | Border |
|-------------|------|--------|
| `bg-*-50` | `text-*-700` | `border border-*-200` |
| `bg-*-100` | `text-*-800` | optional `border-*-300` |

---

### 1. LogsPage — Severity-Badges

**Datei:** `frontend/src/pages/LogsPage.tsx` (Zeile 11-18)

**Problem:** Rot-Töne zu ähnlich zwischen Text und Hintergrund.

```
Vorher:  bg-red-200 text-red-900, bg-red-100 text-red-800, bg-red-100 text-red-700
Nachher: bg-red-100 text-red-800 (einheitlich für alle Rot-Stufen, mit border-red-200)
```

### 2. LogsPage — Filter-Pills & Message-Farben

**Datei:** `frontend/src/pages/LogsPage.tsx` (Zeile 340, 424)

**Problem:**
- Filter-Pills: `bg-blue-600/20 text-blue-300` — Fast unsichtbarer Text
- Nachrichten: `text-red-300`, `text-amber-300` auf dunklem Hintergrund zu blass

**Fix:**
- Filter-Pills: `bg-blue-100 text-blue-800 border border-blue-200`
- Nachrichten: `text-red-400`, `text-amber-400` (eine Stufe dunkler)

### 3. DiscoveryPage — Status-Badges

**Datei:** `frontend/src/pages/DiscoveryPage.tsx` (Zeile 28-45)

**Problem:** Alle Badges verwenden `text-*-700` statt `text-*-800`.

**Fix:** Alle auf `text-*-800` anheben:
- `new: 'bg-blue-100 text-blue-800'`
- `known: 'bg-green-100 text-green-800'`
- `pending: 'bg-yellow-100 text-yellow-800'`
- `failed: 'bg-red-100 text-red-800'`

### 4. ScriptsPage — Interpreter-Badges

**Datei:** `frontend/src/pages/ScriptsPage.tsx` (Zeile 180-182)

**Problem:** `text-*-700` zu hell auf `bg-*-100`.

**Fix:**
- `powershell: 'bg-blue-100 text-blue-800'`
- `bash: 'bg-green-100 text-green-800'`
- `python: 'bg-yellow-100 text-yellow-800'`

### 5. AuditLogPage — Action-Badges

**Datei:** `frontend/src/pages/AuditLogPage.tsx` (Zeile 35-61)

**Problem:** Mischt `text-*-700` und `text-*-800` ohne Logik.

**Fix:** Alle auf `text-*-800` vereinheitlichen.

### 6. HostsPage — Overflow-Indikatoren

**Datei:** `frontend/src/pages/HostsPage.tsx` (Zeile 571, 583, 641)

**Problem:** `text-red-700`, `text-orange-700`, `text-blue-700` auf `-100` Hintergrund.

**Fix:** Alle auf `-800` anheben.

### 7. HostTypesPage — Capability-Badges

**Datei:** `frontend/src/pages/HostTypesPage.tsx` (Zeile 160-169)

**Problem:** `bg-*-50 text-*-600` — zu wenig Kontrast.

**Fix:** Entweder `text-*-700` oder auf `bg-*-100` wechseln.

### 8. HostDetailPage — Check-Mode-Badges

**Datei:** `frontend/src/pages/HostDetailPage.tsx` (Zeile 2549)

**Problem:** `bg-blue-100 text-blue-600` — Text zu hell.

**Fix:** `text-blue-800`

### 9. AlertRulesPage — Severity & Condition-Badges

**Datei:** `frontend/src/pages/AlertRulesPage.tsx` (Zeile 13, 545, 730)

**Problem:** Inkonsistente Verwendung von `-700` und `-800` Text-Farben.

**Fix:** Einheitlich `text-*-800` auf `bg-*-100`.

### 10. ErrorOverviewPage — Status-Cards

**Datei:** `frontend/src/pages/ErrorOverviewPage.tsx` (Zeile 517, 1032-1064)

**Problem:** Mischt `bg-*-50 text-*-700` und `bg-*-100 text-*-800` auf der gleichen Seite.

**Fix:** Konsistent `bg-*-100 text-*-800` oder `bg-*-50 text-*-700` — nicht beides.

### 11. ReportsPage — Delivery-Status

**Datei:** `frontend/src/pages/ReportsPage.tsx` (Zeile 43-46)

**Problem:** `text-*-700` Badges.

**Fix:**
- `generating: 'bg-blue-100 text-blue-800'`
- `failed: 'bg-red-100 text-red-800'`
- `sent: 'bg-green-100 text-green-800'`

### 12. SettingsPage — Feedback-Nachrichten

**Datei:** `frontend/src/pages/SettingsPage.tsx` (Zeile 90, 195)

**Problem:**
- Erfolg: `bg-emerald-50 text-emerald-700` — zu wenig Kontrast
- Fehler: `bg-red-50 text-red-600` — noch schlechter

**Fix:** `text-emerald-800` und `text-red-800`

### 13. NotificationLogPage — Status-Text

**Datei:** `frontend/src/pages/NotificationLogPage.tsx` (Zeile 149-154)

**Problem:** `text-emerald-600` und `text-red-500` ohne Hintergrund.

**Fix:** Badge-Style: `bg-emerald-50 text-emerald-800` und `bg-red-50 text-red-800`

### 14. AdminPage — SSO-Tab Badges

**Datei:** `frontend/src/pages/AdminPage.tsx` (Zeile 389)

**Problem:** `text-*-700` auf `bg-*-100`.

**Fix:** `text-*-800`

### 15. AnomalySection — Z-Score-Werte

**Datei:** `frontend/src/components/AnomalySection.tsx` (Zeile 346-349)

**Problem:** `text-red-600` und `text-amber-600` direkt auf weißem Hintergrund, keine visuelle Abgrenzung.

**Fix:** Hintergrund ergänzen: `bg-red-50 text-red-800 px-1.5 py-0.5 rounded`

### 16. TvPage — Dunkle Hintergründe

**Datei:** `frontend/src/pages/TvPage.tsx` (Zeile 75, 83)

**Problem:** `bg-red-900/30 border-red-800` — extrem dunkel und schwer lesbar.

**Fix:** `bg-red-900/50 border-red-700` (mehr Opacity, hellere Border)

### 17. DowntimesPage & DiskConfigEditor — Info-Boxen

**Dateien:** `DowntimesPage.tsx` (519), `DiskConfigEditor.tsx` (30)

**Problem:** `bg-blue-50 text-blue-700` — zu wenig Kontrast.

**Fix:** `text-blue-800`

### 18. StatusPagesAdminPage — Dark-Mode-Fragmente

**Datei:** `frontend/src/pages/StatusPagesAdminPage.tsx` (Zeile 701)

**Problem:** `dark:bg-green-900/30 dark:text-green-400` — existierende Dark-Mode-Klassen sind unlesbar.

**Fix:** Wird im Dark-Mode-Plan unten adressiert. Vorerst: `dark:bg-green-900/50 dark:text-green-300`

---

## Teil 2: Allgemeine Verbesserungen

### 19. Zentraler Badge-Utility

Statt in jeder Datei eigene Badge-Farben zu definieren, eine gemeinsame Funktion in `lib/constants.ts`:

```tsx
export function getBadgeClasses(color: 'red' | 'amber' | 'green' | 'blue' | 'purple' | 'gray' | 'orange') {
  const map = {
    red:    'bg-red-100 text-red-800 border border-red-200',
    amber:  'bg-amber-100 text-amber-800 border border-amber-200',
    green:  'bg-green-100 text-green-800 border border-green-200',
    blue:   'bg-blue-100 text-blue-800 border border-blue-200',
    purple: 'bg-purple-100 text-purple-800 border border-purple-200',
    gray:   'bg-gray-100 text-gray-800 border border-gray-200',
    orange: 'bg-orange-100 text-orange-800 border border-orange-200',
  }
  return map[color]
}
```

### 20. StatusBadge als einzige Quelle für Status-Darstellung

`StatusBadge.tsx` existiert bereits und definiert korrekte Farben. Alle Seiten die Status-Badges manuell rendern sollten `StatusBadge` oder `getStatusConfig()` verwenden statt eigene Farben.

---

## Teil 3: Dark Mode — Implementierungsplan

### Übersicht

Der Dark Mode wird über Tailwinds `dark:` Präfix und eine CSS-Klasse `dark` auf `<html>` implementiert. Die Einstellung wird in localStorage und in den User-Preferences (API) gespeichert.

### Schritt 1: Tailwind-Konfiguration

**Datei:** `tailwind.config.js`

```js
module.exports = {
  darkMode: 'class',  // Aktiviert class-basiertes Dark Mode
  // ...
}
```

### Schritt 2: CSS-Variablen für Kernfarben

**Datei:** `index.css`

```css
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f9fafb;    /* gray-50 */
  --bg-tertiary: #f3f4f6;     /* gray-100 */
  --border-primary: #e5e7eb;  /* gray-200 */
  --border-secondary: #d1d5db; /* gray-300 */
  --text-primary: #111827;    /* gray-900 */
  --text-secondary: #6b7280;  /* gray-500 */
  --text-muted: #9ca3af;      /* gray-400 */
}

.dark {
  --bg-primary: #111827;      /* gray-900 */
  --bg-secondary: #1f2937;    /* gray-800 */
  --bg-tertiary: #374151;     /* gray-700 */
  --border-primary: #374151;  /* gray-700 */
  --border-secondary: #4b5563; /* gray-600 */
  --text-primary: #f9fafb;    /* gray-50 */
  --text-secondary: #9ca3af;  /* gray-400 */
  --text-muted: #6b7280;      /* gray-500 */
}
```

### Schritt 3: Theme-Provider & Toggle-Logik

**Neue Datei:** `frontend/src/lib/theme.ts`

```ts
type Theme = 'light' | 'dark'

const STORAGE_KEY = 'overseer-theme'

export function getTheme(): Theme {
  return (localStorage.getItem(STORAGE_KEY) as Theme) || 'light'
}

export function setTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme)
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export function initTheme() {
  setTheme(getTheme())
}
```

**Integration in `main.tsx`:**
```ts
import { initTheme } from './lib/theme'
initTheme()
```

### Schritt 4: Settings-Page — Präferenz-Toggle

**Datei:** `frontend/src/pages/SettingsPage.tsx`

Neuer Abschnitt "Darstellung" mit Radio-Buttons:

```
[Light]  [Dark]
```

Speichert in localStorage sofort und optional in der API (`PATCH /api/v1/auth/preferences`).

### Schritt 5: Globale Layout-Elemente anpassen

**Priorität 1 — Grundgerüst:**

| Element | Light | Dark |
|---------|-------|------|
| `<body>` | `bg-white` | `dark:bg-gray-900` |
| Sidebar | `bg-white border-gray-200` | `dark:bg-gray-900 dark:border-gray-700` |
| Cards | `bg-white border-gray-200` | `dark:bg-gray-800 dark:border-gray-700` |
| Tables | `bg-white` Header `bg-gray-50` | `dark:bg-gray-800` Header `dark:bg-gray-900` |
| Inputs | `bg-white border-gray-300` | `dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100` |
| Modals | `bg-white` | `dark:bg-gray-800` |
| Dropdowns | `bg-white` | `dark:bg-gray-700` |

**Priorität 2 — Text:**

| Element | Light | Dark |
|---------|-------|------|
| Überschriften | `text-gray-900` | `dark:text-gray-100` |
| Fließtext | `text-gray-700` | `dark:text-gray-300` |
| Muted | `text-gray-500` | `dark:text-gray-400` |
| Links | `text-overseer-600` | `dark:text-overseer-400` |

**Priorität 3 — Status-Badges (Dark-Varianten):**

| Status | Light | Dark |
|--------|-------|------|
| OK | `bg-emerald-100 text-emerald-800` | `dark:bg-emerald-900/40 dark:text-emerald-300` |
| Warning | `bg-amber-100 text-amber-800` | `dark:bg-amber-900/40 dark:text-amber-300` |
| Critical | `bg-red-100 text-red-800` | `dark:bg-red-900/40 dark:text-red-300` |
| Unknown | `bg-gray-100 text-gray-800` | `dark:bg-gray-700 dark:text-gray-300` |
| No Data | `bg-orange-100 text-orange-800` | `dark:bg-orange-900/40 dark:text-orange-300` |

### Schritt 6: Seiten-Migration (Reihenfolge)

1. **Layout.tsx / App.tsx** — Sidebar, Header, Grundstruktur
2. **DashboardPage.tsx** — Cards, Status-Karten
3. **ErrorOverviewPage.tsx** — Tabelle, Status-Badges, Filter
4. **HostsPage.tsx** — Host-Tabelle, Tags, Filter
5. **HostDetailPage.tsx** — Service-Tabelle, Charts, SSL-Panel, Anomaly-Section
6. **LogsPage.tsx** — Log-Tabelle, Severity-Badges, Live-Tail
7. **AlertRulesPage.tsx** — Regel-Tabelle, Modals
8. **NotificationChannelsPage.tsx** — Channel-Liste, Config-Forms
9. **CustomDashboardViewPage.tsx** — Widgets, Grid, Variable-Bar
10. **AdminPage.tsx** — Tabs, User-Tabelle, SSO-Config
11. **SettingsPage.tsx** — Forms, 2FA-Section
12. **Alle restlichen Seiten** — Discovery, Reports, StatusPages, Downtimes, Audit, Scripts, etc.
13. **Komponenten** — StatusBadge, AnomalySection, ConfirmDialog, LoadingSpinner
14. **TV-Mode** — TvPage, TvDashboardPage (bereits dunkler Hintergrund, anpassen)
15. **Public Pages** — PublicDashboardPage, PublicStatusPage (eigenes Farbschema beibehalten)

### Schritt 7: Charts & Widgets

- **ECharts**: Theme-Option `dark` im Init
- **SVG-Sparklines**: Stroke/Fill-Farben über CSS-Variablen
- **Gauge-Widget**: Hintergrundfarbe anpassen

### Schritt 8: Übergangsanimation

```css
html {
  transition: background-color 0.2s ease, color 0.2s ease;
}
```

### Geschätzter Umfang

| Schritt | Dateien | Beschreibung |
|---------|---------|--------------|
| 1-3 | 3 | Config, CSS-Variablen, Theme-Provider |
| 4 | 1 | Settings-Toggle |
| 5 | ~5 | Layout-Grundgerüst |
| 6 | ~15 | Seiten-Migration |
| 7 | ~10 | Charts & Widgets |
| **Gesamt** | ~34 | |
