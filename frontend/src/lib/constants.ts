import {
  Server, Monitor, Router, Printer, Shield, Wifi, Box,
  Network, HardDrive, Camera, Cloud, Database, Globe, Cpu, Laptop, Smartphone,
  type LucideIcon,
} from 'lucide-react'

/** Map icon name (from DB) to Lucide component */
const ICON_MAP: Record<string, LucideIcon> = {
  server: Server,
  monitor: Monitor,
  router: Router,
  printer: Printer,
  shield: Shield,
  wifi: Wifi,
  box: Box,
  network: Network,
  'hard-drive': HardDrive,
  camera: Camera,
  cloud: Cloud,
  database: Database,
  globe: Globe,
  cpu: Cpu,
  laptop: Laptop,
  smartphone: Smartphone,
}

/** Available icon names for the icon picker */
export const AVAILABLE_ICONS = Object.keys(ICON_MAP)

/** Resolve a host type icon name to a Lucide component */
export function getHostTypeIcon(iconName: string | null | undefined): LucideIcon {
  return (iconName && ICON_MAP[iconName]) || Server
}

// ══════════════════════════════════════════════════════════════════════════════
// CHECK TYPE REGISTRY — Single source of truth for all check types
// ══════════════════════════════════════════════════════════════════════════════

export interface ConfigFieldDef {
  key: string
  label: string
  type: 'text' | 'number' | 'password' | 'select' | 'checkbox' | 'script_selector' | 'disk_config'
  placeholder?: string
  options?: { value: string; label: string }[]
  required?: boolean
  default?: string
}

export interface CheckTypeDef {
  key: string
  label: string
  description: string
  category: 'network' | 'snmp' | 'ssh' | 'agent'
  mode: 'active' | 'passive' | 'agent'
  requires: { ip?: boolean; agent?: boolean; snmp?: boolean }
  os?: 'linux' | 'windows' | null
  fields: ConfigFieldDef[]
  defaults?: { interval?: number; warn?: number; crit?: number }
  managesOwnThresholds?: boolean
}

export const CHECK_CATEGORIES: { key: string; label: string; sort: number }[] = [
  { key: 'network', label: 'Netzwerk', sort: 0 },
  { key: 'snmp',    label: 'SNMP',     sort: 1 },
  { key: 'ssh',     label: 'SSH',      sort: 2 },
  { key: 'agent',   label: 'Agent',    sort: 3 },
]

const SSH_FIELDS: ConfigFieldDef[] = [
  { key: 'username', label: 'SSH-User', type: 'text', placeholder: 'root', default: 'root' },
  { key: 'password', label: 'SSH-Passwort', type: 'password', placeholder: '' },
]

export const CHECK_TYPE_REGISTRY: CheckTypeDef[] = [
  // ── Netzwerk ───────────────────────────────────────────────────────────────
  {
    key: 'ping', label: 'Ping', description: 'ICMP-Ping zum Host',
    category: 'network', mode: 'active', requires: { ip: true },
    fields: [],
    defaults: { interval: 60, warn: 100, crit: 500 },
  },
  {
    key: 'port', label: 'Port-Check', description: 'Prüft ob ein TCP-Port erreichbar ist',
    category: 'network', mode: 'active', requires: { ip: true },
    fields: [{ key: 'port', label: 'Port', type: 'number', placeholder: '443', required: true }],
    defaults: { interval: 60 },
  },
  {
    key: 'http', label: 'HTTP/HTTPS', description: 'HTTP(S)-Request mit Status-Code-Prüfung',
    category: 'network', mode: 'active', requires: {},
    fields: [{ key: 'url', label: 'URL', type: 'text', placeholder: 'https://example.com/', required: true }],
    defaults: { interval: 60, warn: 1000, crit: 5000 },
  },
  {
    key: 'ssl_certificate', label: 'SSL-Zertifikat', description: 'SSL/TLS-Zertifikat prüfen und Ablauf überwachen',
    category: 'network', mode: 'passive', requires: {},
    fields: [
      { key: 'hostname', label: 'Hostname', type: 'text', placeholder: 'api.example.com', required: true },
      { key: 'port', label: 'Port', type: 'number', placeholder: '443', default: '443' },
      { key: 'warning_days', label: 'Warn before expiry (days)', type: 'number', placeholder: '30', default: '30' },
      { key: 'critical_days', label: 'Critical before expiry (days)', type: 'number', placeholder: '14', default: '14' },
      { key: 'allow_self_signed', label: 'Allow Self-Signed', type: 'checkbox' },
      { key: 'check_ocsp', label: 'Check OCSP', type: 'checkbox' },
    ],
    managesOwnThresholds: true,
    defaults: { interval: 21600 },
  },

  // ── SNMP ───────────────────────────────────────────────────────────────────
  {
    key: 'snmp', label: 'SNMP-Abfrage', description: 'Einzelne OID abfragen und Wert überwachen',
    category: 'snmp', mode: 'active', requires: { ip: true, snmp: true },
    fields: [
      { key: 'oid', label: 'OID', type: 'text', placeholder: '1.3.6.1.2.1.1.3.0', required: true },
      { key: 'community', label: 'Community', type: 'text', placeholder: 'public' },
      { key: 'scale', label: 'Scale', type: 'text', placeholder: '1' },
      { key: 'unit', label: 'Einheit', type: 'text', placeholder: '' },
    ],
    defaults: { interval: 60 },
  },
  {
    key: 'snmp_interface', label: 'SNMP Interface', description: 'Netzwerk-Interface über SNMP überwachen',
    category: 'snmp', mode: 'active', requires: { ip: true, snmp: true },
    fields: [
      { key: 'interface_index', label: 'Interface-Index', type: 'text', placeholder: '1', required: true },
      { key: 'community', label: 'Community', type: 'text', placeholder: 'public' },
    ],
    defaults: { interval: 60 },
  },

  // ── SSH ────────────────────────────────────────────────────────────────────
  {
    key: 'ssh_cpu', label: 'CPU (SSH)', description: 'CPU-Auslastung über SSH abfragen',
    category: 'ssh', mode: 'active', requires: { ip: true }, os: 'linux',
    fields: [...SSH_FIELDS],
    defaults: { interval: 60, warn: 80, crit: 95 },
  },
  {
    key: 'ssh_mem', label: 'RAM (SSH)', description: 'Speicherauslastung über SSH abfragen',
    category: 'ssh', mode: 'active', requires: { ip: true }, os: 'linux',
    fields: [...SSH_FIELDS],
    defaults: { interval: 60, warn: 80, crit: 95 },
  },
  {
    key: 'ssh_disk', label: 'Festplatte (SSH)', description: 'Festplattenbelegung über SSH prüfen',
    category: 'ssh', mode: 'active', requires: { ip: true }, os: 'linux',
    fields: [
      { key: 'mount', label: 'Mountpoint', type: 'text', placeholder: '/' },
      ...SSH_FIELDS,
    ],
    defaults: { interval: 300, warn: 80, crit: 90 },
  },
  {
    key: 'ssh_process', label: 'Prozess (SSH)', description: 'Prüft ob ein Prozess läuft',
    category: 'ssh', mode: 'active', requires: { ip: true }, os: 'linux',
    fields: [
      { key: 'process', label: 'Prozessname', type: 'text', placeholder: 'nginx', required: true },
      ...SSH_FIELDS,
    ],
    defaults: { interval: 60 },
  },
  {
    key: 'ssh_service', label: 'Service (SSH)', description: 'Prüft ob ein systemd-Service aktiv ist',
    category: 'ssh', mode: 'active', requires: { ip: true }, os: 'linux',
    fields: [
      { key: 'service', label: 'Servicename', type: 'text', placeholder: 'nginx', required: true },
      ...SSH_FIELDS,
    ],
    defaults: { interval: 60 },
  },
  {
    key: 'ssh_custom', label: 'Custom (SSH)', description: 'Eigenes Kommando über SSH ausführen',
    category: 'ssh', mode: 'active', requires: { ip: true }, os: 'linux',
    fields: [
      { key: 'command', label: 'Kommando', type: 'text', placeholder: 'echo OK', required: true },
      ...SSH_FIELDS,
    ],
    defaults: { interval: 60 },
  },

  // ── Agent ──────────────────────────────────────────────────────────────────
  {
    key: 'agent_cpu', label: 'CPU', description: 'CPU-Auslastung auf dem Host',
    category: 'agent', mode: 'agent', requires: { agent: true },
    fields: [],
    defaults: { interval: 60, warn: 80, crit: 95 },
  },
  {
    key: 'agent_memory', label: 'RAM', description: 'Speicherauslastung auf dem Host',
    category: 'agent', mode: 'agent', requires: { agent: true },
    fields: [],
    defaults: { interval: 60, warn: 80, crit: 95 },
  },
  {
    key: 'agent_disk', label: 'Festplatten', description: 'Alle Partitionen automatisch überwachen',
    category: 'agent', mode: 'agent', requires: { agent: true },
    fields: [{ key: '_disk', label: '', type: 'disk_config' }],
    managesOwnThresholds: true,
    defaults: { interval: 300 },
  },
  {
    key: 'agent_service', label: 'Service', description: 'Prüft ob ein Dienst/Service läuft',
    category: 'agent', mode: 'agent', requires: { agent: true },
    fields: [{ key: 'service', label: 'Servicename', type: 'text', placeholder: 'MSSQLSERVER', required: true }],
    defaults: { interval: 60 },
  },
  {
    key: 'agent_process', label: 'Prozess', description: 'Prüft ob ein Prozess läuft',
    category: 'agent', mode: 'agent', requires: { agent: true },
    fields: [{ key: 'process', label: 'Prozessname', type: 'text', placeholder: 'nginx', required: true }],
    defaults: { interval: 60 },
  },
  {
    key: 'agent_eventlog', label: 'Eventlog', description: 'Windows Eventlog auf Fehler prüfen',
    category: 'agent', mode: 'agent', requires: { agent: true }, os: 'windows',
    fields: [
      { key: 'log', label: 'Log', type: 'text', placeholder: 'System', default: 'System' },
      { key: 'level', label: 'Level', type: 'select', options: [
        { value: 'Error', label: 'Error' },
        { value: 'Warning', label: 'Warning' },
        { value: 'Critical', label: 'Critical' },
      ], default: 'Error' },
      { key: 'minutes', label: 'Minuten', type: 'number', placeholder: '30', default: '30' },
    ],
    defaults: { interval: 300 },
  },
  {
    key: 'agent_custom', label: 'Custom-Befehl', description: 'Eigenes Kommando auf dem Host ausführen',
    category: 'agent', mode: 'agent', requires: { agent: true },
    fields: [
      { key: 'command', label: 'Kommando', type: 'text', placeholder: 'Get-Process | Measure', required: true },
      { key: 'ok_pattern', label: 'OK Pattern', type: 'text', placeholder: '.', default: '.' },
      { key: 'crit_pattern', label: 'Critical Pattern', type: 'text', placeholder: '' },
    ],
    defaults: { interval: 60 },
  },
  {
    key: 'agent_script', label: 'Script', description: 'Server-verwaltetes oder lokales Script ausführen',
    category: 'agent', mode: 'agent', requires: { agent: true },
    fields: [{ key: '_script', label: '', type: 'script_selector' }],
    defaults: { interval: 300 },
  },
  {
    key: 'agent_services_auto', label: 'Services (Auto)', description: 'Alle laufenden Dienste automatisch überwachen',
    category: 'agent', mode: 'agent', requires: { agent: true },
    fields: [
      { key: 'exclude', label: 'Ausschließen (kommagetrennt)', type: 'text', placeholder: 'gupdate,gupdatem,sppsvc,RemoteRegistry' },
    ],
    defaults: { interval: 300 },
  },
]

// ══════════════════════════════════════════════════════════════════════════════
// BADGE UTILITY — Consistent badge colors across the app
// ══════════════════════════════════════════════════════════════════════════════

export function getBadgeClasses(color: 'red' | 'amber' | 'green' | 'blue' | 'purple' | 'gray' | 'orange' | 'emerald' | 'sky' | 'yellow') {
  const map: Record<string, string> = {
    red:     'bg-red-100 text-red-800 border border-red-200',
    amber:   'bg-amber-100 text-amber-800 border border-amber-200',
    green:   'bg-green-100 text-green-800 border border-green-200',
    blue:    'bg-blue-100 text-blue-800 border border-blue-200',
    purple:  'bg-purple-100 text-purple-800 border border-purple-200',
    gray:    'bg-gray-100 text-gray-800 border border-gray-200',
    orange:  'bg-orange-100 text-orange-800 border border-orange-200',
    emerald: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
    sky:     'bg-sky-100 text-sky-800 border border-sky-200',
    yellow:  'bg-yellow-100 text-yellow-800 border border-yellow-200',
  }
  return map[color] ?? map.gray
}

// ── Registry helpers ─────────────────────────────────────────────────────────

const _registryMap = new Map(CHECK_TYPE_REGISTRY.map(d => [d.key, d]))

/** Get the full definition for a check type key */
export function getCheckTypeDef(key: string): CheckTypeDef | undefined {
  return _registryMap.get(key)
}

/** Get the human-readable label for a check type key */
export function getCheckTypeLabel(key: string): string {
  const def = _registryMap.get(key)
  if (!def) return key
  // Prefix category for non-agent types to avoid ambiguity
  if (def.category !== 'agent') return def.label
  return def.label
}

/** Host-like shape for filtering */
interface HostLike {
  ip_address?: string | null
  host_type_agent_capable?: boolean
  host_type_snmp_enabled?: boolean
  snmp_community?: string | null
}

/** Return only check types compatible with a given host */
export function getAvailableCheckTypes(host: HostLike): CheckTypeDef[] {
  return CHECK_TYPE_REGISTRY.filter(ct => {
    if (ct.requires.agent && !host.host_type_agent_capable) return false
    if (ct.requires.ip && !host.ip_address) return false
    if (ct.requires.snmp && !host.host_type_snmp_enabled && !host.snmp_community) return false
    return true
  })
}

/** Group check types by category, sorted by CHECK_CATEGORIES order */
export function groupCheckTypesByCategory(types: CheckTypeDef[]): { category: string; label: string; types: CheckTypeDef[] }[] {
  const catOrder = new Map(CHECK_CATEGORIES.map(c => [c.key, c]))
  const groups = new Map<string, CheckTypeDef[]>()
  for (const t of types) {
    const list = groups.get(t.category) ?? []
    list.push(t)
    groups.set(t.category, list)
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => (catOrder.get(a)?.sort ?? 99) - (catOrder.get(b)?.sort ?? 99))
    .map(([key, items]) => ({
      category: key,
      label: catOrder.get(key)?.label ?? key,
      types: items,
    }))
}
