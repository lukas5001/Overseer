import { useState } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Server, ArrowLeft, Play, Search,
  CheckCircle, Clock, Plus, X, Trash2, TrendingUp, Pencil, Settings2, Power, Copy,
  Monitor, ClipboardCopy, KeyRound, Download,
} from 'lucide-react'
import { HOST_TYPE_ICONS, HOST_TYPES, HOST_TYPE_LABELS, NETWORK_DEVICE_TYPES } from '../lib/constants'
import { getStatusConfig } from '../components/StatusBadge'
import clsx from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'
import { api } from '../api/client'
import { formatDateTime } from '../lib/format'
import ConfirmDialog from '../components/ConfirmDialog'

interface Host {
  id: string
  tenant_id: string
  collector_id: string | null
  hostname: string
  display_name: string | null
  ip_address: string | null
  host_type: string
  snmp_community: string | null
  snmp_version: string | null
  tags: string[]
  agent_managed: boolean
  active: boolean
  created_at: string
}

interface AgentTokenInfo {
  active: boolean
  last_seen_at: string | null
  agent_version: string | null
  agent_os: string | null
  created_at: string
}

interface ServiceStatus {
  service_id: string
  host_id: string
  tenant_id: string
  status: 'OK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN'
  state_type: 'SOFT' | 'HARD'
  current_attempt: number
  status_message: string | null
  value: number | null
  unit: string | null
  last_check_at: string | null
  last_state_change_at: string | null
  acknowledged: boolean
  in_downtime: boolean
  service_name: string | null
}

interface ServiceItem {
  id: string
  name: string
  check_type: string
  check_config: Record<string, unknown>
  interval_seconds: number
  threshold_warn: number | null
  threshold_crit: number | null
  max_check_attempts: number
  check_mode: string
  active: boolean
}


const statusOrder = { CRITICAL: 0, WARNING: 1, UNKNOWN: 2, OK: 3 }

// ── Sparkline (inline SVG, no dependencies) ────────────────────────────────────

function Sparkline({ values, color = '#3b82f6' }: { values: number[]; color?: string }) {
  if (values.length < 2) return null
  const w = 80, h = 24
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

// ── History Modal ──────────────────────────────────────────────────────────────

interface HistoryPoint { time: string; status: string; value: number | null; unit: string | null; message: string | null }

interface HistoryModalProps {
  serviceId: string
  serviceName: string
  onClose: () => void
}

function HistoryModal({ serviceId, serviceName, onClose }: HistoryModalProps) {
  const [hours, setHours] = useState(24)

  const { data: history = [], isLoading } = useQuery<HistoryPoint[]>({
    queryKey: ['history', serviceId, hours],
    queryFn: () => api.get(`/api/v1/history/${serviceId}?hours=${hours}`).then(r => r.data),
  })

  const { data: summary } = useQuery<Record<string, number>>({
    queryKey: ['history-summary', serviceId, hours],
    queryFn: () => api.get(`/api/v1/history/${serviceId}/summary?hours=${hours}`).then(r => r.data),
  })

  const values = history.filter(p => p.value !== null).map(p => p.value as number)
  const unit = history.find(p => p.unit)?.unit ?? ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-overseer-600" />
            <h2 className="text-lg font-semibold text-gray-900">{serviceName}</h2>
          </div>
          <div className="flex items-center gap-3">
            <select value={hours} onChange={e => setHours(Number(e.target.value))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-overseer-500">
              <option value={1}>1h</option>
              <option value={6}>6h</option>
              <option value={24}>24h</option>
              <option value={168}>7 Tage</option>
              <option value={720}>30 Tage</option>
            </select>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* Summary stats */}
        {summary && summary.total > 0 && (
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Min', value: summary.min !== undefined ? `${summary.min}${unit}` : '–' },
              { label: 'Avg', value: summary.avg !== undefined ? `${summary.avg}${unit}` : '–' },
              { label: 'Max', value: summary.max !== undefined ? `${summary.max}${unit}` : '–' },
              { label: 'Checks', value: summary.total },
            ].map(s => (
              <div key={s.label} className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500">{s.label}</p>
                <p className="text-sm font-bold text-gray-800 mt-0.5">{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Sparkline (full-width) */}
        {values.length >= 2 && (
          <div className="bg-gray-50 rounded-lg p-4 mb-5">
            <svg width="100%" height="60" viewBox={`0 0 100 60`} preserveAspectRatio="none">
              {(() => {
                const min = Math.min(...values), max = Math.max(...values), range = max - min || 1
                const pts = values.map((v, i) => {
                  const x = (i / (values.length - 1)) * 100
                  const y = 58 - ((v - min) / range) * 55
                  return `${x},${y}`
                }).join(' ')
                return <polyline points={pts} fill="none" stroke="#3b82f6" strokeWidth="1" strokeLinejoin="round" />
              })()}
            </svg>
          </div>
        )}

        {/* Data table */}
        {isLoading ? (
          <p className="text-center text-gray-400 py-8">Lade…</p>
        ) : history.length === 0 ? (
          <p className="text-center text-gray-400 py-8">Keine Daten für diesen Zeitraum.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left">Zeit</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-right">Wert</th>
                  <th className="px-4 py-2 text-left">Meldung</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[...history].reverse().map((p, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-1.5 text-gray-400 font-mono">
                      {formatDateTime(p.time)}
                    </td>
                    <td className="px-4 py-1.5">
                      <span className={clsx('font-bold', {
                        'text-emerald-600': p.status === 'OK',
                        'text-amber-600': p.status === 'WARNING',
                        'text-red-600': p.status === 'CRITICAL',
                        'text-gray-400': p.status === 'UNKNOWN',
                      })}>{p.status}</span>
                    </td>
                    <td className="px-4 py-1.5 text-right font-mono text-gray-700">
                      {p.value !== null ? `${p.value}${p.unit ?? ''}` : '–'}
                    </td>
                    <td className="px-4 py-1.5 text-gray-500 truncate max-w-xs">{p.message ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── SparklineCell – fetches 2h history and renders inline ─────────────────────

function SparklineCell({ serviceId, onClick }: { serviceId: string; onClick: () => void }) {
  const { data: history = [] } = useQuery<{ value: number | null }[]>({
    queryKey: ['sparkline', serviceId],
    queryFn: () => api.get(`/api/v1/history/${serviceId}?hours=2`).then(r => r.data),
    staleTime: 60000,
  })
  const values = history.filter(p => p.value !== null).map(p => p.value as number)
  return (
    <button onClick={onClick} className="text-gray-300 hover:text-overseer-500 transition-colors flex items-center gap-1" title="Verlauf anzeigen">
      {values.length >= 2 ? <Sparkline values={values} /> : <TrendingUp className="w-4 h-4" />}
    </button>
  )
}

// ── Check type config fields ───────────────────────────────────────────────────

const CHECK_TYPES = [
  'ping', 'port', 'http',
  'snmp', 'snmp_interface',
  'ssh_disk', 'ssh_cpu', 'ssh_mem', 'ssh_process', 'ssh_service', 'ssh_custom',
  'agent_cpu', 'agent_memory', 'agent_disk', 'agent_service', 'agent_process', 'agent_eventlog', 'agent_custom',
  'agent_script', 'agent_services_auto',
]

function ConfigFields({ checkType, config, onChange }: {
  checkType: string
  config: Record<string, string>
  onChange: (k: string, v: string) => void
}) {
  const field = (label: string, key: string, placeholder = '') => (
    <div key={key}>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input value={config[key] ?? ''} onChange={e => onChange(key, e.target.value)}
        placeholder={placeholder}
        className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
    </div>
  )

  switch (checkType) {
    case 'port':    return <>{field('Port', 'port', '443')}</>
    case 'http':    return <>{field('URL', 'url', 'https://example.com/')}</>
    case 'snmp':    return <>{field('OID', 'oid', '1.3.6.1.2.1.1.3.0')}{field('Community', 'community', 'public')}{field('Scale', 'scale', '1')}{field('Einheit', 'unit', '')}</>
    case 'snmp_interface': return <>{field('Interface-Index', 'interface_index', '1')}{field('Community', 'community', 'public')}</>
    case 'ssh_disk':    return <>{field('Mountpoint', 'mount', '/')}{field('SSH-User', 'username', 'root')}{field('SSH-Passwort', 'password', '')}</>
    case 'ssh_cpu':     return <>{field('SSH-User', 'username', 'root')}{field('SSH-Passwort', 'password', '')}</>
    case 'ssh_mem':     return <>{field('SSH-User', 'username', 'root')}{field('SSH-Passwort', 'password', '')}</>
    case 'ssh_process': return <>{field('Prozessname', 'process', 'nginx')}{field('SSH-User', 'username', 'root')}{field('SSH-Passwort', 'password', '')}</>
    case 'ssh_service': return <>{field('Servicename', 'service', 'nginx')}{field('SSH-User', 'username', 'root')}{field('SSH-Passwort', 'password', '')}</>
    case 'ssh_custom':  return <>{field('Kommando', 'command', 'echo OK')}{field('SSH-User', 'username', 'root')}{field('SSH-Passwort', 'password', '')}</>
    case 'agent_cpu':     return null
    case 'agent_memory':  return null
    case 'agent_disk':    return <>{field('Pfad', 'path', 'C: oder /')}</>
    case 'agent_service': return <>{field('Servicename', 'service', 'MSSQLSERVER')}</>
    case 'agent_process': return <>{field('Prozessname', 'process', 'nginx')}</>
    case 'agent_eventlog': return <>{field('Log', 'log', 'System')}{field('Level', 'level', 'Error')}{field('Minuten', 'minutes', '30')}</>
    case 'agent_custom':  return <>{field('Kommando', 'command', 'Get-Process | Measure')}{field('OK Pattern', 'ok_pattern', '.')}{field('Critical Pattern', 'crit_pattern', '')}</>
    case 'agent_script':  return <>{field('Script-ID (Server)', 'script_id', 'UUID des Scripts aus der Scripts-Seite')}{field('Lokaler Pfad (alternativ)', 'script_path', 'C:\\Scripts\\check.ps1')}{field('Interpreter', 'script_interpreter', 'powershell / bash / python')}{field('Output-Format', 'expected_output', 'nagios / text / json')}</>
    case 'agent_services_auto': return <>{field('Exclude-Liste (kommagetrennt)', 'exclude', 'gupdate,gupdatem,sppsvc,RemoteRegistry')}</>
    default: return null
  }
}

// ── Add Check Modal ────────────────────────────────────────────────────────────

interface AddCheckModalProps {
  host: Host
  onClose: () => void
  onSaved: () => void
}

// ── Service Templates (loaded from API) ──────────────────────────────────────

interface TemplateCheck {
  name: string
  check_type: string
  check_config: Record<string, string>
  interval_seconds: number
  threshold_warn: number | null
  threshold_crit: number | null
  check_mode?: string
}

interface ServiceTemplate {
  id: string
  name: string
  description: string
  checks: TemplateCheck[]
}

function AddCheckModal({ host, onClose, onSaved }: AddCheckModalProps) {
  const { data: templates = [] } = useQuery<ServiceTemplate[]>({
    queryKey: ['service-templates'],
    queryFn: () => api.get('/api/v1/service-templates/').then(r => r.data),
  })

  // 2.6 Check-Typen nach Host-Kontext filtern
  const availableCheckTypes = CHECK_TYPES.filter(ct => {
    // Agent-Checks nur für agent-managed Hosts
    if (ct.startsWith('agent_') && !host.agent_managed) return false
    // SSH-Checks nur wenn IP vorhanden
    if (ct.startsWith('ssh_') && !host.ip_address) return false
    // SNMP-Checks nur wenn SNMP community gesetzt
    if (ct.startsWith('snmp') && !host.snmp_community) return false
    // Ping/Port/HTTP nur wenn IP vorhanden
    if ((ct === 'ping' || ct === 'port') && !host.ip_address) return false
    return true
  })
  const [mode, setMode] = useState<'choose' | 'manual' | 'template'>('choose')
  const [applyingTemplate, setApplyingTemplate] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    check_type: availableCheckTypes[0] ?? 'ping',
    interval_seconds: '60',
    threshold_warn: '',
    threshold_crit: '',
    max_check_attempts: '3',
    check_mode: 'active',
  })
  const [config, setConfig] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => {
      // Transform comma-separated fields to arrays where needed
      const finalConfig: Record<string, unknown> = { ...config }
      if (form.check_type === 'agent_services_auto' && typeof finalConfig.exclude === 'string') {
        finalConfig.exclude = (finalConfig.exclude as string).split(',').map(s => s.trim()).filter(Boolean)
      }
      return api.post('/api/v1/services/', {
        host_id: host.id,
        tenant_id: host.tenant_id,
        name: form.name,
        check_type: form.check_type,
        check_config: finalConfig,
        interval_seconds: parseInt(form.interval_seconds) || 60,
        threshold_warn: form.threshold_warn ? parseFloat(form.threshold_warn) : null,
        threshold_crit: form.threshold_crit ? parseFloat(form.threshold_crit) : null,
        max_check_attempts: parseInt(form.max_check_attempts) || 3,
        check_mode: form.check_type.startsWith('agent_') ? 'agent' : form.check_mode,
      })
    },
    onSuccess: () => { onSaved(); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler beim Speichern'),
  })

  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const applyTemplate = async (template: ServiceTemplate) => {
    setApplyingTemplate(template.id)
    setError(null)
    setSuccessMsg(null)
    let created = 0
    const skippedNames: string[] = []
    try {
      for (const check of template.checks) {
        try {
          await api.post('/api/v1/services/', {
            host_id: host.id,
            tenant_id: host.tenant_id,
            name: check.name,
            check_type: check.check_type,
            check_config: check.check_config,
            interval_seconds: check.interval_seconds,
            threshold_warn: check.threshold_warn,
            threshold_crit: check.threshold_crit,
            max_check_attempts: 3,
            check_mode: check.check_mode ?? 'active',
          })
          created++
        } catch (e: any) {
          if (e.response?.status === 409) {
            skippedNames.push(check.name)
          } else {
            throw e
          }
        }
      }
      onSaved()
      if (skippedNames.length > 0 && created === 0) {
        setError(`Alle Checks existieren bereits: ${skippedNames.join(', ')}`)
      } else if (skippedNames.length > 0) {
        setSuccessMsg(`${created} Check(s) erstellt. Übersprungen (existieren bereits): ${skippedNames.join(', ')}`)
      } else {
        setSuccessMsg(`${created} Check(s) erfolgreich erstellt!`)
      }
    } catch (e: any) {
      onSaved()
      setError(e.response?.data?.detail ?? 'Fehler beim Anwenden der Vorlage')
    } finally {
      setApplyingTemplate(null)
    }
  }

  const setF = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">
            {mode === 'choose' ? 'Check hinzufügen' : mode === 'template' ? 'Vorlage anwenden' : 'Einzelner Check'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm">
          <p className="font-medium text-gray-800">{host.display_name || host.hostname}</p>
        </div>

        {/* Step 1: Choose mode */}
        {mode === 'choose' && (
          <div className="space-y-3">
            <button onClick={() => setMode('template')}
              className="w-full text-left border border-gray-200 rounded-lg px-4 py-3 hover:bg-gray-50 transition-colors">
              <p className="font-medium text-gray-800 text-sm">Vorlage verwenden</p>
              <p className="text-xs text-gray-500 mt-0.5">Vorgefertigtes Check-Paket (Linux Server, Switch, etc.)</p>
            </button>
            <button onClick={() => setMode('manual')}
              className="w-full text-left border border-gray-200 rounded-lg px-4 py-3 hover:bg-gray-50 transition-colors">
              <p className="font-medium text-gray-800 text-sm">Einzelnen Check erstellen</p>
              <p className="text-xs text-gray-500 mt-0.5">Manuell konfigurieren</p>
            </button>
          </div>
        )}

        {/* Template picker */}
        {mode === 'template' && (() => {
          // 2.7 Templates nach Kompatibilität filtern
          const compatibleTemplates = templates.filter(tpl => {
            const types = tpl.checks.map(c => c.check_type)
            const hasAgent = types.some(t => t.startsWith('agent_'))
            const hasSnmp = types.some(t => t.startsWith('snmp'))
            const hasSsh = types.some(t => t.startsWith('ssh_'))
            const hasNetwork = types.some(t => ['ping', 'port'].includes(t))
            // Agent-Templates nur für agent-managed Hosts
            if (hasAgent && !host.agent_managed) return false
            // SNMP-Templates nur wenn SNMP konfiguriert
            if (hasSnmp && !host.snmp_community) return false
            // SSH-Templates nur wenn IP vorhanden
            if (hasSsh && !host.ip_address) return false
            // Netzwerk-Templates nur wenn IP vorhanden
            if (hasNetwork && !host.ip_address) return false
            return true
          })
          return (
          <div className="space-y-2">
            {compatibleTemplates.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">
                {templates.length === 0
                  ? <>Keine Vorlagen vorhanden. Erstelle welche unter <a href="/templates" className="text-overseer-600 hover:underline">Vorlagen</a>.</>
                  : 'Keine kompatiblen Vorlagen für diesen Host. Vorlagen erfordern passende Konfiguration (Agent, IP, SNMP).'}
              </p>
            )}
            {compatibleTemplates.map(tpl => (
              <button key={tpl.id} onClick={() => applyTemplate(tpl)}
                disabled={!!applyingTemplate}
                className={clsx(
                  'w-full text-left border rounded-lg px-4 py-3 transition-colors',
                  applyingTemplate === tpl.id ? 'border-overseer-400 bg-overseer-50' : 'border-gray-200 hover:bg-gray-50',
                  applyingTemplate && applyingTemplate !== tpl.id && 'opacity-50',
                )}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-800 text-sm">{tpl.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{tpl.description}</p>
                  </div>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                    {applyingTemplate === tpl.id ? 'Wird erstellt…' : `${tpl.checks.length} Checks`}
                  </span>
                </div>
              </button>
            ))}
            {successMsg && (
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{successMsg}</p>
            )}
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}
            <button onClick={successMsg ? onClose : () => setMode('choose')}
              className="w-full py-2 text-sm text-gray-500 hover:text-gray-700">
              {successMsg ? 'Schließen' : 'Zurück'}
            </button>
          </div>
          )
        })()}

        {/* Manual form */}
        {mode === 'manual' && (
          <>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                  <input value={form.name} onChange={setF('name')} placeholder="CPU-Auslastung"
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Check-Typ *</label>
                  <select value={form.check_type} onChange={setF('check_type')}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none">
                    {availableCheckTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Dynamic config fields */}
              <ConfigFields
                checkType={form.check_type}
                config={config}
                onChange={(k, v) => setConfig(prev => ({ ...prev, [k]: v }))}
              />

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Intervall (s)</label>
                  <input value={form.interval_seconds} onChange={setF('interval_seconds')} type="number"
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Warn-Schwelle</label>
                  <input value={form.threshold_warn} onChange={setF('threshold_warn')} type="number" placeholder="80"
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Crit-Schwelle</label>
                  <input value={form.threshold_crit} onChange={setF('threshold_crit')} type="number" placeholder="90"
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Check-Modus</label>
                {form.check_type.startsWith('agent_') ? (
                  <div className="text-sm text-gray-500 bg-gray-50 px-3 py-2 rounded-lg">
                    Agent <span className="text-xs text-gray-400">(wird automatisch gesetzt)</span>
                  </div>
                ) : (
                  <div className="flex gap-3 mt-1">
                    <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="radio" name="check_mode" value="active" checked={form.check_mode === 'active'}
                        onChange={setF('check_mode')} className="w-4 h-4 text-overseer-600 focus:ring-overseer-500" />
                      <span>Aktiv <span className="text-xs text-gray-400">(Server prüft)</span></span>
                    </label>
                    {host.collector_id ? (
                      <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
                        <input type="radio" name="check_mode" value="passive" checked={form.check_mode === 'passive'}
                          onChange={setF('check_mode')} className="w-4 h-4 text-overseer-600 focus:ring-overseer-500" />
                        <span>Passiv <span className="text-xs text-gray-400">(Collector sendet)</span></span>
                      </label>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-sm text-gray-300">
                        Passiv <span className="text-xs">(kein Collector zugewiesen)</span>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Hinweis wenn keine Check-Typen verfügbar */}
              {availableCheckTypes.length === 0 && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Keine Check-Typen für diesen Host verfügbar. Bitte zuerst IP-Adresse, Agent oder SNMP-Community konfigurieren.
                </p>
              )}

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setMode('choose')}
                className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
                Zurück
              </button>
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || !form.name}
                className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50">
                {mutation.isPending ? 'Speichern…' : 'Check anlegen'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Edit Host Modal ──────────────────────────────────────────────────────────

interface EditHostModalProps {
  host: Host
  onClose: () => void
  onSaved: () => void
}

function EditHostModal({ host, onClose, onSaved }: EditHostModalProps) {
  const [form, setForm] = useState({
    hostname: host.hostname,
    display_name: host.display_name ?? '',
    ip_address: host.ip_address ?? '',
    host_type: host.host_type,
    snmp_community: host.snmp_community ?? '',
    snmp_version: host.snmp_version ?? '2c',
  })
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.patch(`/api/v1/hosts/${host.id}`, {
      hostname: form.hostname,
      display_name: form.display_name || null,
      ip_address: form.ip_address || null,
      host_type: form.host_type,
      snmp_community: form.snmp_community || null,
      snmp_version: form.snmp_version || '2c',
    }),
    onSuccess: () => { onSaved(); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler beim Speichern'),
  })

  const setF = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Host bearbeiten</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Hostname *</label>
            <input value={form.hostname} onChange={setF('hostname')}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Anzeigename</label>
            <input value={form.display_name} onChange={setF('display_name')} placeholder="z.B. Webserver Produktion"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">IP-Adresse</label>
              <input value={form.ip_address} onChange={setF('ip_address')} placeholder="192.168.1.1"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
              <p className="text-[11px] text-gray-400 mt-0.5">
                {host.agent_managed
                  ? 'Optional — Agent verbindet sich selbst. Nur für Netzwerk-Checks nötig.'
                  : host.collector_id
                    ? 'Erforderlich für passive Checks über den Collector'
                    : 'Erforderlich für aktive Checks (Ping, SSH, Port)'}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Typ</label>
              <select value={form.host_type} onChange={setF('host_type')}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none">
                {HOST_TYPES.map(t => <option key={t} value={t}>{HOST_TYPE_LABELS[t] ?? t}</option>)}
              </select>
            </div>
          </div>
          {/* SNMP-Felder nur für Netzwerkgeräte oder wenn bereits konfiguriert */}
          {((NETWORK_DEVICE_TYPES as readonly string[]).includes(form.host_type) || host.snmp_community) && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">SNMP Community</label>
                <input value={form.snmp_community} onChange={setF('snmp_community')} placeholder="public"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">SNMP Version</label>
                <select value={form.snmp_version} onChange={setF('snmp_version')}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none">
                  <option value="1">v1</option>
                  <option value="2c">v2c</option>
                </select>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            Abbrechen
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.hostname}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50">
            {mutation.isPending ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit Service Modal ──────────────────────────────────────────────────────

interface EditServiceModalProps {
  service: ServiceItem
  onClose: () => void
  onSaved: () => void
}

function EditServiceModal({ service, onClose, onSaved }: EditServiceModalProps) {
  const [form, setForm] = useState({
    name: service.name,
    interval_seconds: String(service.interval_seconds),
    threshold_warn: service.threshold_warn !== null ? String(service.threshold_warn) : '',
    threshold_crit: service.threshold_crit !== null ? String(service.threshold_crit) : '',
    max_check_attempts: String(service.max_check_attempts),
    check_mode: service.check_mode ?? 'passive',
  })
  const [config, setConfig] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(service.check_config).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]))
  )
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => {
      const finalConfig: Record<string, unknown> = { ...config }
      if (service.check_type === 'agent_services_auto' && typeof finalConfig.exclude === 'string') {
        finalConfig.exclude = (finalConfig.exclude as string).split(',').map(s => s.trim()).filter(Boolean)
      }
      return api.patch(`/api/v1/services/${service.id}`, {
        name: form.name,
        check_config: finalConfig,
        interval_seconds: parseInt(form.interval_seconds) || 60,
        threshold_warn: form.threshold_warn ? parseFloat(form.threshold_warn) : null,
        threshold_crit: form.threshold_crit ? parseFloat(form.threshold_crit) : null,
        max_check_attempts: parseInt(form.max_check_attempts) || 3,
        check_mode: form.check_mode,
      })
    },
    onSuccess: () => { onSaved(); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler beim Speichern'),
  })

  const setF = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Service bearbeiten</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm flex items-center justify-between">
          <span className="font-medium text-gray-800">{service.name}</span>
          <span className="text-gray-500 font-mono text-xs">{service.check_type}</span>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
            <input value={form.name} onChange={setF('name')}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
          </div>

          {/* Dynamic config fields */}
          <ConfigFields
            checkType={service.check_type}
            config={config}
            onChange={(k, v) => setConfig(prev => ({ ...prev, [k]: v }))}
          />

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Intervall (s)</label>
              <input value={form.interval_seconds} onChange={setF('interval_seconds')} type="number"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Warn-Schwelle</label>
              <input value={form.threshold_warn} onChange={setF('threshold_warn')} type="number" placeholder="80"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Crit-Schwelle</label>
              <input value={form.threshold_crit} onChange={setF('threshold_crit')} type="number" placeholder="90"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Max. Versuche (SOFT→HARD)</label>
            <input value={form.max_check_attempts} onChange={setF('max_check_attempts')} type="number"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Check-Modus</label>
            {service.check_type.startsWith('agent_') ? (
              <div className="text-sm text-gray-500 bg-gray-50 px-3 py-2 rounded-lg">
                Agent <span className="text-xs text-gray-400">(wird automatisch gesetzt)</span>
              </div>
            ) : (
              <div className="flex gap-3 mt-1">
                <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="edit_check_mode" value="active" checked={form.check_mode === 'active'}
                    onChange={setF('check_mode')} className="w-4 h-4 text-overseer-600 focus:ring-overseer-500" />
                  <span>Aktiv <span className="text-xs text-gray-400">(Server prüft)</span></span>
                </label>
                <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="edit_check_mode" value="passive" checked={form.check_mode === 'passive'}
                    onChange={setF('check_mode')} className="w-4 h-4 text-overseer-600 focus:ring-overseer-500" />
                  <span>Passiv <span className="text-xs text-gray-400">(Collector sendet)</span></span>
                </label>
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            Abbrechen
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.name}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50">
            {mutation.isPending ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── SNMP Discovery Modal ─────────────────────────────────────────────────────

interface SnmpDiscoveryModalProps {
  host: Host
  onClose: () => void
  onSaved: () => void
}

interface SnmpResult {
  oid: string
  name: string
  value: string
  type: string
}

function SnmpDiscoveryModal({ host, onClose, onSaved }: SnmpDiscoveryModalProps) {
  const [baseOid, setBaseOid] = useState('1.3.6.1.2.1')
  const [results, setResults] = useState<SnmpResult[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [walking, setWalking] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  const startWalk = async () => {
    // 3.5 Validierung: SNMP Community prüfen
    if (!host.snmp_community) {
      setError('Bitte SNMP Community in den Host-Einstellungen setzen bevor Sie einen Walk starten.')
      return
    }
    if (!host.ip_address) {
      setError('Bitte IP-Adresse in den Host-Einstellungen setzen bevor Sie einen Walk starten.')
      return
    }
    setWalking(true)
    setError(null)
    setResults([])
    setSelected(new Set())
    setSuccessMsg(null)
    try {
      const res = await api.post(`/api/v1/hosts/${host.id}/snmp-walk`, {
        base_oid: baseOid,
        max_results: 500,
      })
      setResults(res.data.results)
      setTruncated(res.data.truncated)
    } catch (e: any) {
      setError(e.response?.data?.detail ?? 'SNMP Walk fehlgeschlagen')
    } finally {
      setWalking(false)
    }
  }

  const toggleSelect = (oid: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(oid)) next.delete(oid)
      else next.add(oid)
      return next
    })
  }

  const selectAll = () => {
    const numericResults = filtered.filter(r => {
      try { parseFloat(r.value); return true } catch { return false }
    })
    if (selected.size === numericResults.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(numericResults.map(r => r.oid)))
    }
  }

  const createChecks = async () => {
    setCreating(true)
    setError(null)
    setSuccessMsg(null)
    let created = 0
    const skipped: string[] = []
    const errors: string[] = []

    for (const oid of selected) {
      const result = results.find(r => r.oid === oid)
      if (!result) continue

      // Use readable name if available, otherwise sanitize OID
      const checkName = result.name !== result.oid
        ? result.name.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase()
        : `snmp_${oid.replace(/\./g, '_')}`

      try {
        await api.post('/api/v1/services/', {
          host_id: host.id,
          tenant_id: host.tenant_id,
          name: checkName,
          check_type: oid.startsWith('1.3.6.1.2.1.2.2.1.8.') ? 'snmp_interface' : 'snmp',
          check_config: {
            oid,
            community: host.snmp_community || 'public',
            version: host.snmp_version || '2c',
          },
          interval_seconds: 60,
          max_check_attempts: 3,
          check_mode: 'active',
        })
        created++
      } catch (e: any) {
        if (e.response?.status === 409) {
          skipped.push(checkName)
        } else {
          errors.push(checkName)
        }
      }
    }

    if (created > 0) onSaved()
    const parts: string[] = []
    if (created > 0) parts.push(`${created} Check(s) erstellt`)
    if (skipped.length > 0) parts.push(`${skipped.length} übersprungen (existieren bereits)`)
    if (errors.length > 0) parts.push(`${errors.length} fehlgeschlagen`)

    if (errors.length > 0 && created === 0) {
      setError(parts.join('. '))
    } else {
      setSuccessMsg(parts.join('. '))
    }
    setCreating(false)
  }

  const filtered = results.filter(r => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return r.oid.includes(q) || r.name.toLowerCase().includes(q) || r.value.toLowerCase().includes(q)
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl mx-4 p-6 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-overseer-600" />
            <h2 className="text-lg font-semibold text-gray-900">SNMP Discovery</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm flex items-center justify-between">
          <div>
            <span className="font-medium text-gray-800">{host.display_name || host.hostname}</span>
            <span className="text-gray-400 ml-2">{host.ip_address}</span>
          </div>
          <span className="text-xs text-gray-500">Community: {host.snmp_community || '–'}</span>
        </div>

        {/* Walk controls */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1">
            <input value={baseOid} onChange={e => setBaseOid(e.target.value)}
              placeholder="Base OID (z.B. 1.3.6.1.2.1)"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
          </div>
          <button onClick={startWalk} disabled={walking}
            className="px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700 disabled:opacity-50 whitespace-nowrap">
            {walking ? 'Scanne...' : 'Walk starten'}
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>
        )}
        {successMsg && (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">{successMsg}</p>
        )}

        {/* Results */}
        {results.length > 0 && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <input value={filter} onChange={e => setFilter(e.target.value)}
                placeholder="Filtern nach OID, Name oder Wert..."
                className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-overseer-500 outline-none" />
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {filtered.length} OIDs{truncated ? ' (abgeschnitten)' : ''}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg min-h-0">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left w-8">
                      <input type="checkbox" onChange={selectAll}
                        checked={selected.size > 0}
                        className="w-3.5 h-3.5" />
                    </th>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">OID</th>
                    <th className="px-3 py-2 text-left">Wert</th>
                    <th className="px-3 py-2 text-left">Typ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(r => (
                    <tr key={r.oid} className={clsx('hover:bg-gray-50 cursor-pointer', selected.has(r.oid) && 'bg-overseer-50')}
                      onClick={() => toggleSelect(r.oid)}>
                      <td className="px-3 py-1.5">
                        <input type="checkbox" checked={selected.has(r.oid)} onChange={() => toggleSelect(r.oid)}
                          className="w-3.5 h-3.5" />
                      </td>
                      <td className="px-3 py-1.5 font-medium text-gray-800">
                        {r.name !== r.oid ? r.name : <span className="text-gray-400">–</span>}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-gray-500">{r.oid}</td>
                      <td className="px-3 py-1.5 text-gray-700 max-w-xs truncate" title={r.value}>{r.value}</td>
                      <td className="px-3 py-1.5 text-gray-400">{r.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selected.size > 0 && (
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm text-gray-500">{selected.size} OID(s) ausgewählt</span>
                <button onClick={createChecks} disabled={creating}
                  className="px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700 disabled:opacity-50">
                  {creating ? 'Erstelle...' : `${selected.size} Check(s) erstellen`}
                </button>
              </div>
            )}
          </>
        )}

        {results.length === 0 && !walking && !error && (
          <p className="text-center text-gray-400 py-8 text-sm">
            Klicke "Walk starten" um verfügbare SNMP-OIDs zu entdecken.
          </p>
        )}
        {walking && (
          <p className="text-center text-gray-400 py-8 text-sm animate-pulse">
            SNMP Walk läuft...
          </p>
        )}
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function HostDetailPage() {
  const { hostId } = useParams<{ hostId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const isNewHost = searchParams.get('new') === '1'
  const queryClient = useQueryClient()
  const [showAddCheck, setShowAddCheck] = useState(false)
  const [showEditHost, setShowEditHost] = useState(false)
  const [showSnmpDiscovery, setShowSnmpDiscovery] = useState(false)
  const [editService, setEditService] = useState<ServiceItem | null>(null)
  const [historyTarget, setHistoryTarget] = useState<{ id: string; name: string } | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showAgentSetup, setShowAgentSetup] = useState(false)
  const [generatedToken, setGeneratedToken] = useState<string | null>(null)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [revokeConfirm, setRevokeConfirm] = useState(false)
  const [setupTab, setSetupTab] = useState<'windows' | 'linux'>('windows')

  const { data: host, isLoading: hostLoading } = useQuery<Host>({
    queryKey: ['host', hostId],
    queryFn: () => api.get(`/api/v1/hosts/${hostId}`).then(r => r.data),
    enabled: !!hostId,
  })

  const { data: services = [], isLoading: svcLoading } = useQuery<ServiceStatus[]>({
    queryKey: ['host-status', hostId],
    queryFn: () => api.get(`/api/v1/status/host/${hostId}`).then(r => r.data),
    enabled: !!hostId,
    refetchInterval: 10000,
  })

  const { data: serviceList = [] } = useQuery<ServiceItem[]>({
    queryKey: ['services', hostId],
    queryFn: () => api.get(`/api/v1/services/?host_id=${hostId}&include_inactive=true`).then(r => r.data),
    enabled: !!hostId,
  })

  // Agent token info (only fetched when host is agent_managed)
  const { data: agentTokenInfo } = useQuery<AgentTokenInfo>({
    queryKey: ['agent-token', hostId],
    queryFn: () => api.get(`/api/v1/hosts/${hostId}/agent-token`).then(r => r.data),
    enabled: !!hostId && !!host?.agent_managed,
    refetchInterval: 30000,
  })

  const generateTokenMutation = useMutation({
    mutationFn: () => api.post(`/api/v1/hosts/${hostId}/agent-token`),
    onSuccess: (resp) => {
      setGeneratedToken(resp.data.token)
      setShowAgentSetup(true)
      queryClient.invalidateQueries({ queryKey: ['host', hostId] })
      queryClient.invalidateQueries({ queryKey: ['agent-token', hostId] })
    },
  })

  const revokeTokenMutation = useMutation({
    mutationFn: () => api.delete(`/api/v1/hosts/${hostId}/agent-token`),
    onSuccess: () => {
      setRevokeConfirm(false)
      queryClient.invalidateQueries({ queryKey: ['host', hostId] })
      queryClient.invalidateQueries({ queryKey: ['agent-token', hostId] })
    },
  })

  const deleteServiceMutation = useMutation({
    mutationFn: (serviceId: string) => api.delete(`/api/v1/services/${serviceId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services', hostId] })
      queryClient.invalidateQueries({ queryKey: ['host-status', hostId] })
    },
  })

  const toggleServiceActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/api/v1/services/${id}`, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services', hostId] })
      queryClient.invalidateQueries({ queryKey: ['host-status', hostId] })
    },
  })

  const navigate = useNavigate()

  const deleteHostMutation = useMutation({
    mutationFn: () => api.delete(`/api/v1/hosts/${hostId}`),
    onSuccess: () => { setShowDeleteConfirm(false); navigate('/hosts') },
    onError: () => setShowDeleteConfirm(false),
  })

  const copyHostMutation = useMutation({
    mutationFn: (body: { hostname?: string; target_tenant_id?: string }) =>
      api.post(`/api/v1/hosts/${hostId}/copy`, body),
    onSuccess: (resp) => navigate(`/hosts/${resp.data.id}`),
  })

  const [showCopyHost, setShowCopyHost] = useState(false)
  const [copyHostname, setCopyHostname] = useState('')
  const [copyTenantId, setCopyTenantId] = useState('')
  const [copyHostError, setCopyHostError] = useState<string | null>(null)

  const { data: tenantsList = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['tenants-list'],
    queryFn: () => api.get('/api/v1/tenants/').then(r => r.data),
    enabled: showCopyHost,
  })

  const [checkingNow, setCheckingNow] = useState<Record<string, 'pending' | 'done' | 'error'>>({})
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const runCheckNow = async (serviceId: string) => {
    setCheckingNow(prev => ({ ...prev, [serviceId]: 'pending' }))
    try {
      await api.post(`/api/v1/services/${serviceId}/check-now`)
      setCheckingNow(prev => ({ ...prev, [serviceId]: 'done' }))
      queryClient.invalidateQueries({ queryKey: ['host-status', hostId] })
      setTimeout(() => setCheckingNow(prev => { const n = { ...prev }; delete n[serviceId]; return n }), 3000)
    } catch {
      setCheckingNow(prev => ({ ...prev, [serviceId]: 'error' }))
      setTimeout(() => setCheckingNow(prev => { const n = { ...prev }; delete n[serviceId]; return n }), 3000)
    }
  }

  const serviceNames: Record<string, { name: string; check_type: string; check_mode: string; active: boolean; max_check_attempts: number }> = {}
  serviceList.forEach(s => { serviceNames[s.id] = { name: s.name, check_type: s.check_type, check_mode: s.check_mode ?? 'passive', active: s.active, max_check_attempts: s.max_check_attempts ?? 3 } })

  // Merge: status data + services without status (inactive services may not have current_status)
  const statusServiceIds = new Set(services.map(s => s.service_id))
  const orphanServices: ServiceStatus[] = serviceList
    .filter(s => !statusServiceIds.has(s.id))
    .map(s => ({
      service_id: s.id,
      host_id: hostId!,
      tenant_id: host?.tenant_id ?? '',
      status: 'UNKNOWN' as const,
      state_type: 'SOFT' as const,
      current_attempt: 0,
      status_message: null,
      value: null,
      unit: null,
      last_check_at: null,
      last_state_change_at: null,
      acknowledged: false,
      in_downtime: false,
      service_name: s.name,
    }))
  const allServices = [...services, ...orphanServices]
  const sorted = allServices.sort((a, b) => {
    const metaA = serviceNames[a.service_id]
    const metaB = serviceNames[b.service_id]
    // Active services first, then by status severity
    if (metaA?.active !== false && metaB?.active === false) return -1
    if (metaA?.active === false && metaB?.active !== false) return 1
    return statusOrder[a.status] - statusOrder[b.status]
  })

  const counts = { OK: 0, WARNING: 0, CRITICAL: 0, UNKNOWN: 0 }
  services.forEach(s => {
    const meta = serviceNames[s.service_id]
    if (meta?.active !== false) counts[s.status]++
  })

  if (hostLoading) {
    return <div className="p-8 text-gray-500">Lade Host-Daten…</div>
  }
  if (!host) {
    return <div className="p-8 text-red-500">Host nicht gefunden.</div>
  }

  const HostIcon = HOST_TYPE_ICONS[host.host_type] ?? Server
  const activeSorted = sorted.filter(s => serviceNames[s.service_id]?.active !== false)
  const worstStatus = activeSorted[0]?.status ?? 'OK'
  const worstCfg = getStatusConfig(worstStatus)
  const WIcon = worstCfg.icon

  return (
    <div className="p-8">
      {showAddCheck && (
        <AddCheckModal
          host={host}
          onClose={() => setShowAddCheck(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['services', hostId] })
            queryClient.invalidateQueries({ queryKey: ['host-status', hostId] })
          }}
        />
      )}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Host löschen"
        message={`Host "${host?.display_name || host?.hostname}" endgültig löschen?\n\nAlle Services, Check-Ergebnisse und Downtimes werden unwiderruflich gelöscht.`}
        confirmLabel="Endgültig löschen"
        variant="danger"
        loading={deleteHostMutation.isPending}
        onConfirm={() => deleteHostMutation.mutate()}
        onCancel={() => setShowDeleteConfirm(false)}
      />
      {showEditHost && (
        <EditHostModal
          host={host}
          onClose={() => setShowEditHost(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['host', hostId] })}
        />
      )}
      {showSnmpDiscovery && (
        <SnmpDiscoveryModal
          host={host}
          onClose={() => setShowSnmpDiscovery(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['services', hostId] })
            queryClient.invalidateQueries({ queryKey: ['host-status', hostId] })
          }}
        />
      )}
      {editService && (
        <EditServiceModal
          service={editService}
          onClose={() => setEditService(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['services', hostId] })
            queryClient.invalidateQueries({ queryKey: ['host-status', hostId] })
          }}
        />
      )}
      {historyTarget && (
        <HistoryModal
          serviceId={historyTarget.id}
          serviceName={historyTarget.name}
          onClose={() => setHistoryTarget(null)}
        />
      )}

      {/* Copy Host Modal */}
      {showCopyHost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Host kopieren</h2>
              <button onClick={() => setShowCopyHost(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm">
              <p className="text-gray-500">Quelle:</p>
              <p className="font-medium text-gray-800">{host.display_name || host.hostname}</p>
              <p className="text-xs text-gray-400 mt-1">Alle Services werden mitkopiert.</p>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Neuer Hostname</label>
                <input
                  value={copyHostname}
                  onChange={e => setCopyHostname(e.target.value)}
                  placeholder={`${host.hostname}-copy`}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ziel-Tenant</label>
                <select
                  value={copyTenantId}
                  onChange={e => setCopyTenantId(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none"
                >
                  <option value="">Gleicher Tenant</option>
                  {tenantsList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
            {copyHostError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{copyHostError}</p>}
            <div className="flex gap-3">
              <button onClick={() => setShowCopyHost(false)}
                className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Abbrechen</button>
              <button
                onClick={() => {
                  setCopyHostError(null)
                  const body: { hostname?: string; target_tenant_id?: string } = {}
                  if (copyHostname) body.hostname = copyHostname
                  if (copyTenantId) body.target_tenant_id = copyTenantId
                  copyHostMutation.mutate(body, {
                    onError: (e: any) => setCopyHostError(e.response?.data?.detail ?? 'Fehler beim Kopieren'),
                  })
                }}
                disabled={copyHostMutation.isPending}
                className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50">
                {copyHostMutation.isPending ? 'Kopiere…' : 'Host kopieren'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Back link */}
      <Link
        to="/hosts"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Zurück zu Hosts
      </Link>

      {/* Host header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className={clsx('w-14 h-14 rounded-xl flex items-center justify-center', worstCfg.bg)}>
            <HostIcon className={clsx('w-7 h-7', worstCfg.color)} />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900">
              {host.display_name || host.hostname}
            </h1>
            <p className="text-gray-500 text-sm mt-0.5">{host.hostname}</p>
            <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
              {host.ip_address && (
                <span className="font-mono bg-gray-100 px-2 py-0.5 rounded">{host.ip_address}</span>
              )}
              <span>{HOST_TYPE_LABELS[host.host_type] ?? host.host_type}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowEditHost(true)}
              className="p-2 rounded-lg border border-gray-200 text-gray-400 hover:text-overseer-600 hover:border-overseer-300 transition-colors"
              title="Host bearbeiten"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={() => { setShowCopyHost(true); setCopyHostname(''); setCopyTenantId(''); setCopyHostError(null) }}
              className="p-2 rounded-lg border border-gray-200 text-gray-400 hover:text-blue-500 hover:border-blue-300 transition-colors"
              title="Host kopieren"
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="p-2 rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-300 transition-colors"
              title="Host endgültig löschen"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <div className={clsx('flex items-center gap-2 px-4 py-2 rounded-lg', worstCfg.bg)}>
              <WIcon className={clsx('w-5 h-5', worstCfg.color)} />
              <span className={clsx('font-bold text-sm', worstCfg.text)}>{worstStatus}</span>
            </div>
          </div>
        </div>

        {/* Mini stats */}
        <div className="grid grid-cols-4 gap-3 mt-5 pt-5 border-t border-gray-100">
          {(['CRITICAL', 'WARNING', 'UNKNOWN', 'OK'] as const).map(s => {
            const cfg = getStatusConfig(s)
            const Icon = cfg.icon
            return (
              <div key={s} className={clsx('rounded-lg px-3 py-2 flex items-center gap-2', cfg.bg)}>
                <Icon className={clsx('w-4 h-4', cfg.color)} />
                <span className={clsx('text-sm font-semibold', cfg.text)}>{counts[s]} {s}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* 3.1 Onboarding-Banner für neue Hosts */}
      {isNewHost && serviceList.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 mb-6">
          <p className="text-sm font-medium text-blue-800 mb-2">Host erstellt! Nächste Schritte:</p>
          <div className="flex flex-wrap gap-2">
            {host.host_type === 'server' && !host.agent_managed && (
              <button onClick={() => generateTokenMutation.mutate()}
                disabled={generateTokenMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors">
                <KeyRound className="w-3.5 h-3.5" />
                Agent einrichten
              </button>
            )}
            <button onClick={() => setShowAddCheck(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-blue-700 text-xs font-medium rounded-lg border border-blue-300 hover:bg-blue-50 transition-colors">
              <Plus className="w-3.5 h-3.5" />
              Checks / Template hinzufügen
            </button>
            <button onClick={() => { setSearchParams({}); }}
              className="px-3 py-1.5 text-xs text-blue-500 hover:text-blue-700 transition-colors">
              Hinweis ausblenden
            </button>
          </div>
        </div>
      )}

      {/* Agent section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Monitor className="w-5 h-5 text-gray-400" />
            <h2 className="font-semibold text-gray-800">Agent</h2>
          </div>
          {host.agent_managed && agentTokenInfo && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => generateTokenMutation.mutate()}
                disabled={generateTokenMutation.isPending}
                className="text-xs text-overseer-600 hover:text-overseer-800 transition-colors"
              >
                {generateTokenMutation.isPending ? 'Generiere…' : 'Token erneuern'}
              </button>
              <button
                onClick={() => setRevokeConfirm(true)}
                className="text-xs text-red-500 hover:text-red-700 transition-colors"
              >
                Token widerrufen
              </button>
            </div>
          )}
        </div>

        {!host.agent_managed ? (
          <div className="mt-3 flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
            <p className="text-sm text-gray-500">Kein Agent eingerichtet</p>
            {host.host_type === 'server' ? (
              <button
                onClick={() => generateTokenMutation.mutate()}
                disabled={generateTokenMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-overseer-600 text-white text-xs font-medium rounded-lg hover:bg-overseer-700 disabled:opacity-50 transition-colors"
              >
                <KeyRound className="w-3.5 h-3.5" />
                {generateTokenMutation.isPending ? 'Generiere…' : 'Agent einrichten'}
              </button>
            ) : (
              <span className="text-xs text-gray-400">Agent nur für Server verfügbar</span>
            )}
          </div>
        ) : agentTokenInfo ? (
          <div className="mt-3 flex items-center gap-4 bg-gray-50 rounded-lg px-4 py-3">
            <div className="flex items-center gap-2">
              <div className={clsx(
                'w-2.5 h-2.5 rounded-full',
                agentTokenInfo.last_seen_at && (Date.now() - new Date(agentTokenInfo.last_seen_at).getTime()) < 3 * 60 * 1000
                  ? 'bg-emerald-500' : 'bg-red-500'
              )} />
              <span className="text-sm font-medium text-gray-800">
                {agentTokenInfo.last_seen_at && (Date.now() - new Date(agentTokenInfo.last_seen_at).getTime()) < 3 * 60 * 1000
                  ? 'Agent online' : 'Agent offline'}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              {agentTokenInfo.agent_version && <span>v{agentTokenInfo.agent_version}</span>}
              {agentTokenInfo.agent_os && <span>{agentTokenInfo.agent_os}</span>}
              {agentTokenInfo.last_seen_at && (
                <span>Zuletzt: {formatDistanceToNow(new Date(agentTokenInfo.last_seen_at), { locale: de, addSuffix: true })}</span>
              )}
              {!agentTokenInfo.last_seen_at && <span className="text-amber-500">Noch nie verbunden</span>}
            </div>
          </div>
        ) : (
          <div className="mt-3 text-sm text-gray-400">Lade Agent-Status…</div>
        )}

        {/* Revoke confirmation */}
        {revokeConfirm && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-red-700">Token wirklich widerrufen? Der Agent wird sich nicht mehr verbinden können.</span>
            <div className="flex gap-2">
              <button onClick={() => setRevokeConfirm(false)} className="text-xs text-gray-500 hover:text-gray-700">Abbrechen</button>
              <button
                onClick={() => revokeTokenMutation.mutate()}
                disabled={revokeTokenMutation.isPending}
                className="text-xs text-red-600 font-medium hover:text-red-800"
              >
                {revokeTokenMutation.isPending ? 'Widerrufe…' : 'Ja, widerrufen'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Agent Setup Dialog (Token generated) */}
      {showAgentSetup && generatedToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Agent einrichten</h2>
              <button onClick={() => { setShowAgentSetup(false); setGeneratedToken(null); setTokenCopied(false) }}
                className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4">
              <p className="text-sm text-amber-800 font-medium">Token wird nur einmal angezeigt!</p>
              <p className="text-xs text-amber-600 mt-1">Kopiere den Token jetzt und trage ihn in die Agent-Konfiguration ein.</p>
            </div>

            <div className="bg-gray-900 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
              <code className="text-sm text-emerald-400 break-all select-all">{generatedToken}</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedToken)
                  setTokenCopied(true)
                  setTimeout(() => setTokenCopied(false), 3000)
                }}
                className={clsx('ml-3 flex-shrink-0 p-1.5 rounded transition-colors',
                  tokenCopied ? 'text-emerald-400' : 'text-gray-400 hover:text-white')}
                title="In Zwischenablage kopieren"
              >
                {tokenCopied ? <CheckCircle className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}
              </button>
            </div>

            {/* Tab selector */}
            <div className="flex border-b border-gray-200 mb-4">
              <button
                onClick={() => setSetupTab('windows')}
                className={clsx('px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
                  setupTab === 'windows' ? 'border-overseer-600 text-overseer-700' : 'border-transparent text-gray-500 hover:text-gray-700')}
              >Windows</button>
              <button
                onClick={() => setSetupTab('linux')}
                className={clsx('px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
                  setupTab === 'linux' ? 'border-overseer-600 text-overseer-700' : 'border-transparent text-gray-500 hover:text-gray-700')}
              >Linux</button>
            </div>

            <div className="text-sm text-gray-700">
              {setupTab === 'windows' ? (
                <div className="bg-gray-50 rounded-lg px-4 py-3 text-xs space-y-3">
                  <p className="font-sans"><span className="text-gray-400 font-mono">1.</span> Installer herunterladen:</p>
                  <a
                    href="/agent/overseer-agent-setup.exe"
                    download
                    className="flex items-center gap-2 px-3 py-2 bg-overseer-600 text-white rounded-lg text-xs font-medium hover:bg-overseer-700 transition-colors no-underline w-fit font-sans"
                  >
                    <Download className="w-3.5 h-3.5" />
                    overseer-agent-setup.exe (5.6 MB)
                  </a>
                  <p className="font-sans"><span className="text-gray-400 font-mono">2.</span> Setup als Administrator ausführen</p>
                  <p className="font-sans"><span className="text-gray-400 font-mono">3.</span> Server-URL und Token eingeben:</p>
                  <div className="bg-gray-900 rounded px-3 py-2 text-gray-300 font-mono">
                    <p><span className="text-blue-400">Server</span>: {window.location.origin}</p>
                    <p><span className="text-blue-400">Token</span>: <span className="text-emerald-400 break-all">{generatedToken}</span></p>
                  </div>
                  <p className="font-sans"><span className="text-gray-400 font-mono">4.</span> Weiter klicken — der Installer erledigt den Rest</p>
                  <p className="text-gray-400 font-sans">(Service wird automatisch installiert und gestartet)</p>
                </div>
              ) : (
                <div className="bg-gray-50 rounded-lg px-4 py-3 font-mono text-xs space-y-2">
                  <p><span className="text-gray-400">1.</span> Agent herunterladen:</p>
                  <a
                    href="/agent/overseer-agent-linux-amd64"
                    download
                    className="flex items-center gap-2 px-3 py-2 bg-overseer-600 text-white rounded-lg text-xs font-medium hover:bg-overseer-700 transition-colors no-underline w-fit font-sans"
                  >
                    <Download className="w-3.5 h-3.5" />
                    overseer-agent (Linux, 9.3 MB)
                  </a>
                  <p className="text-gray-400 text-[11px]">Oder per Terminal:</p>
                  <div className="bg-gray-900 rounded px-3 py-2 text-emerald-400 select-all break-all">wget {window.location.origin}/agent/overseer-agent-linux-amd64</div>
                  <p><span className="text-gray-400">2.</span> Installieren:</p>
                  <div className="bg-gray-900 rounded px-3 py-2 text-emerald-400 select-all space-y-0.5">
                    <p>chmod +x overseer-agent-linux-amd64</p>
                    <p>sudo mv overseer-agent-linux-amd64 /usr/local/bin/overseer-agent</p>
                    <p>sudo mkdir -p /etc/overseer-agent</p>
                  </div>
                  <p><span className="text-gray-400">3.</span> Config erstellen:</p>
                  <div className="bg-gray-900 rounded px-3 py-2 text-gray-300 select-all">
                    <p>sudo tee /etc/overseer-agent/config.yaml {'<<'}EOF</p>
                    <p><span className="text-blue-400">server</span>: {window.location.origin}</p>
                    <p><span className="text-blue-400">token</span>: <span className="text-emerald-400">{generatedToken}</span></p>
                    <p>EOF</p>
                  </div>
                  <p><span className="text-gray-400">4.</span> systemd-Service einrichten + starten:</p>
                  <div className="bg-gray-900 rounded px-3 py-2 text-emerald-400 select-all">sudo systemctl enable --now overseer-agent</div>
                </div>
              )}
            </div>

            <p className="text-xs text-gray-400 mt-3">Sobald der Agent sich meldet, erscheint der Status oben.</p>

            <button
              onClick={() => { setShowAgentSetup(false); setGeneratedToken(null); setTokenCopied(false) }}
              className="w-full mt-5 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700"
            >
              Verstanden
            </button>
          </div>
        </div>
      )}

      {/* Services table */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">
            Services ({serviceList.filter(s => s.active).length})
            {serviceList.some(s => !s.active) && (
              <span className="text-gray-400 font-normal text-sm ml-1">
                · {serviceList.filter(s => !s.active).length} inaktiv
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {host.snmp_community && host.ip_address && (
              <button
                onClick={() => setShowSnmpDiscovery(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Search className="w-3.5 h-3.5" />
                SNMP Discovery
              </button>
            )}
            <button
              onClick={() => setShowAddCheck(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-overseer-600 text-white text-xs font-medium rounded-lg hover:bg-overseer-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Check hinzufügen
            </button>
          </div>
        </div>

        {svcLoading ? (
          <div className="p-8 text-center text-gray-400">Lade Services…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-left">Check</th>
                <th className="px-6 py-3 text-left">Typ</th>
                <th className="px-6 py-3 text-left">Meldung</th>
                <th className="px-6 py-3 text-right">Wert</th>
                <th className="px-6 py-3 text-left">Verlauf</th>
                <th className="px-6 py-3 text-right">Letzte Änderung</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map(svc => {
                const meta = serviceNames[svc.service_id]
                const isInactive = meta?.active === false
                const cfg = getStatusConfig(svc.status)
                const Icon = cfg.icon
                return (
                  <tr key={svc.service_id} className={clsx('hover:bg-gray-50', isInactive && 'opacity-50')}>
                    <td className="px-6 py-3 whitespace-nowrap">
                      {isInactive ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold bg-gray-100 text-gray-400">
                          INAKTIV
                        </span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <span className={clsx(
                            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold',
                            cfg.bg, cfg.text
                          )}>
                            <Icon className="w-3 h-3" />
                            {cfg.label}
                          </span>
                          {svc.state_type === 'SOFT' && svc.status !== 'OK' && (
                            <span className="text-[10px] text-amber-600 font-medium px-1">
                              Attempt {svc.current_attempt}/{meta?.max_check_attempts ?? 3}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className={clsx('px-6 py-3 font-medium whitespace-nowrap', isInactive ? 'text-gray-400 line-through' : 'text-gray-800')}>
                      {meta?.name ?? '–'}
                    </td>
                    <td className="px-6 py-3 text-gray-500 font-mono text-xs whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        {meta?.check_type ?? '–'}
                        {meta?.check_mode === 'active' && (
                          <span className="text-[10px] font-sans font-medium bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">aktiv</span>
                        )}
                        {meta?.check_mode === 'agent' && (
                          <span className="text-[10px] font-sans font-medium bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded">agent</span>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-500">
                      <span
                        className="block break-words cursor-pointer hover:text-gray-800"
                        onClick={() => svc.status_message && navigator.clipboard.writeText(svc.status_message)}
                      >
                        {svc.status_message ?? '–'}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right font-mono text-xs text-gray-700 whitespace-nowrap">
                      {svc.value !== null ? `${svc.value}${svc.unit ?? ''}` : '–'}
                    </td>
                    <td className="px-4 py-3">
                      <SparklineCell serviceId={svc.service_id} onClick={() =>
                        setHistoryTarget({ id: svc.service_id, name: meta?.name ?? svc.service_id })
                      } />
                    </td>
                    <td className="px-6 py-3 text-right text-gray-400 text-xs whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 justify-end">
                        <Clock className="w-3 h-3" />
                        {svc.last_state_change_at
                          ? formatDistanceToNow(new Date(svc.last_state_change_at), { locale: de, addSuffix: true })
                          : '–'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        <button
                          onClick={() => runCheckNow(svc.service_id)}
                          disabled={checkingNow[svc.service_id] === 'pending'}
                          className={clsx(
                            'transition-colors',
                            checkingNow[svc.service_id] === 'pending' ? 'text-overseer-400 animate-pulse' :
                            checkingNow[svc.service_id] === 'done' ? 'text-emerald-500' :
                            checkingNow[svc.service_id] === 'error' ? 'text-red-500' :
                            'text-gray-300 hover:text-overseer-500',
                          )}
                          title="Jetzt prüfen"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                        {meta && (
                          <button
                            onClick={() => toggleServiceActiveMutation.mutate({ id: svc.service_id, active: !meta.active })}
                            className={clsx(
                              'transition-colors',
                              meta.active
                                ? 'text-gray-300 hover:text-red-500'
                                : 'text-emerald-500 hover:text-emerald-700',
                            )}
                            title={meta.active ? 'Deaktivieren' : 'Aktivieren'}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {meta?.active !== false && serviceList.find(s => s.id === svc.service_id) && (
                          <button
                            onClick={() => setEditService(serviceList.find(s => s.id === svc.service_id)!)}
                            className="text-gray-300 hover:text-overseer-500 transition-colors"
                            title="Service bearbeiten"
                          >
                            <Settings2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {confirmDelete === svc.service_id ? (
                          <span className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                deleteServiceMutation.mutate(svc.service_id)
                                setConfirmDelete(null)
                              }}
                              className="text-red-500 hover:text-red-700 transition-colors text-xs font-medium"
                              title="Löschen bestätigen"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="text-gray-400 hover:text-gray-600 transition-colors"
                              title="Abbrechen"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(svc.service_id)}
                            className="text-gray-300 hover:text-red-500 transition-colors"
                            title="Check löschen"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
