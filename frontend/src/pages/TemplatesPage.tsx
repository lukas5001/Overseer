import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Layers, Plus, Pencil, Trash2, X, Copy } from 'lucide-react'
import { api } from '../api/client'
import ConfirmDialog from '../components/ConfirmDialog'

// ── Types ────────────────────────────────────────────────────────────────────

interface TemplateCheck {
  name: string
  check_type: string
  check_config: Record<string, unknown>
  interval_seconds: number
  threshold_warn: number | null
  threshold_crit: number | null
  check_mode: string
}

interface ServiceTemplate {
  id: string
  name: string
  description: string
  checks: TemplateCheck[]
  created_at: string
}

const CHECK_TYPES = [
  'ping', 'port', 'http',
  'snmp', 'snmp_interface',
  'ssh_disk', 'ssh_cpu', 'ssh_mem', 'ssh_process', 'ssh_service', 'ssh_custom',
]

const CHECK_TYPE_LABELS: Record<string, string> = {
  ping: 'Ping', port: 'Port', http: 'HTTP',
  snmp: 'SNMP', snmp_interface: 'SNMP Interface',
  ssh_disk: 'SSH Disk', ssh_cpu: 'SSH CPU', ssh_mem: 'SSH Memory',
  ssh_process: 'SSH Prozess', ssh_service: 'SSH Service', ssh_custom: 'SSH Custom',
}

// ── Config field definitions per check type ──────────────────────────────────

function ConfigFields({ checkType, config, onChange }: {
  checkType: string
  config: Record<string, string>
  onChange: (k: string, v: string) => void
}) {
  const field = (label: string, key: string, placeholder = '') => (
    <div key={key} className="flex-1 min-w-0">
      <label className="block text-xs text-gray-500 mb-0.5">{label}</label>
      <input value={config[key] ?? ''} onChange={e => onChange(key, e.target.value)}
        placeholder={placeholder}
        className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:ring-1 focus:ring-overseer-500 outline-none" />
    </div>
  )

  switch (checkType) {
    case 'port':    return <div className="flex gap-2">{field('Port', 'port', '443')}</div>
    case 'http':    return <div className="flex gap-2">{field('URL', 'url', 'https://example.com/')}</div>
    case 'snmp':    return <div className="flex gap-2">{field('OID', 'oid', '1.3.6.1.2.1.1.3.0')}{field('Scale', 'scale', '1')}{field('Einheit', 'unit', '')}</div>
    case 'snmp_interface': return <div className="flex gap-2">{field('Interface-Index', 'interface_index', '1')}</div>
    case 'ssh_disk':    return <div className="flex gap-2">{field('Mountpoint', 'mount', '/')}{field('SSH-User', 'username', 'root')}</div>
    case 'ssh_cpu':     return <div className="flex gap-2">{field('SSH-User', 'username', 'root')}</div>
    case 'ssh_mem':     return <div className="flex gap-2">{field('SSH-User', 'username', 'root')}</div>
    case 'ssh_process': return <div className="flex gap-2">{field('Prozessname', 'process', 'nginx')}{field('SSH-User', 'username', 'root')}</div>
    case 'ssh_service': return <div className="flex gap-2">{field('Servicename', 'service', 'nginx')}{field('SSH-User', 'username', 'root')}</div>
    case 'ssh_custom':  return <div className="flex gap-2">{field('Kommando', 'command', 'echo OK')}{field('SSH-User', 'username', 'root')}</div>
    default: return null
  }
}

// ── Empty check row ──────────────────────────────────────────────────────────

function emptyCheck(): TemplateCheck & { _key: number } {
  return {
    _key: Date.now() + Math.random(),
    name: '',
    check_type: 'ping',
    check_config: {},
    interval_seconds: 60,
    threshold_warn: null,
    threshold_crit: null,
    check_mode: 'active',
  }
}

// ── Edit/Create Modal ────────────────────────────────────────────────────────

interface ModalProps {
  template: ServiceTemplate | null  // null = create new
  onClose: () => void
  onSaved: () => void
}

function TemplateModal({ template, onClose, onSaved }: ModalProps) {
  const [name, setName] = useState(template?.name ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [checks, setChecks] = useState<(TemplateCheck & { _key: number })[]>(
    template?.checks.map((c, i) => ({ ...c, _key: i, check_config: { ...c.check_config } })) ?? [emptyCheck()]
  )
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name,
        description,
        checks: checks.map(({ _key, ...c }) => c),
      }
      return template
        ? api.put(`/api/v1/service-templates/${template.id}`, payload)
        : api.post('/api/v1/service-templates/', payload)
    },
    onSuccess: () => { onSaved(); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler beim Speichern'),
  })

  const updateCheck = (key: number, field: string, value: unknown) => {
    setChecks(prev => prev.map(c => c._key === key ? { ...c, [field]: value } : c))
  }

  const updateCheckConfig = (key: number, k: string, v: string) => {
    setChecks(prev => prev.map(c => c._key === key
      ? { ...c, check_config: { ...c.check_config, [k]: v } }
      : c
    ))
  }

  const removeCheck = (key: number) => {
    setChecks(prev => prev.filter(c => c._key !== key))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">
            {template ? 'Vorlage bearbeiten' : 'Neue Vorlage'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {/* Name + Description */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="Linux Server"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Beschreibung</label>
            <input value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Ping, CPU, RAM, Disk"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
          </div>
        </div>

        {/* Checks */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">Checks ({checks.length})</h3>
            <button onClick={() => setChecks(prev => [...prev, emptyCheck()])}
              className="flex items-center gap-1 text-xs text-overseer-600 hover:text-overseer-700 font-medium">
              <Plus className="w-3.5 h-3.5" /> Check hinzufügen
            </button>
          </div>

          <div className="space-y-3">
            {checks.map(check => (
              <div key={check._key} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <div className="flex items-start gap-3">
                  {/* Name + Type */}
                  <div className="flex-1 grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Name *</label>
                      <input value={check.name} onChange={e => updateCheck(check._key, 'name', e.target.value)}
                        placeholder="cpu_usage"
                        className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:ring-1 focus:ring-overseer-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Typ</label>
                      <select value={check.check_type}
                        onChange={e => updateCheck(check._key, 'check_type', e.target.value)}
                        className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:ring-1 focus:ring-overseer-500 outline-none">
                        {CHECK_TYPES.map(t => <option key={t} value={t}>{CHECK_TYPE_LABELS[t] ?? t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Modus</label>
                      <select value={check.check_mode}
                        onChange={e => updateCheck(check._key, 'check_mode', e.target.value)}
                        className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:ring-1 focus:ring-overseer-500 outline-none">
                        <option value="active">Aktiv</option>
                        <option value="passive">Passiv</option>
                      </select>
                    </div>
                  </div>
                  <button onClick={() => removeCheck(check._key)}
                    className="mt-4 text-gray-400 hover:text-red-500 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Config fields */}
                <div className="mt-2">
                  <ConfigFields
                    checkType={check.check_type}
                    config={Object.fromEntries(Object.entries(check.check_config).map(([k, v]) => [k, String(v)]))}
                    onChange={(k, v) => updateCheckConfig(check._key, k, v)}
                  />
                </div>

                {/* Interval + Thresholds */}
                <div className="flex gap-2 mt-2">
                  <div className="w-24">
                    <label className="block text-xs text-gray-500 mb-0.5">Intervall (s)</label>
                    <input type="number" value={check.interval_seconds}
                      onChange={e => updateCheck(check._key, 'interval_seconds', parseInt(e.target.value) || 60)}
                      className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:ring-1 focus:ring-overseer-500 outline-none" />
                  </div>
                  <div className="w-24">
                    <label className="block text-xs text-gray-500 mb-0.5">Warn</label>
                    <input type="number" value={check.threshold_warn ?? ''}
                      onChange={e => updateCheck(check._key, 'threshold_warn', e.target.value ? parseFloat(e.target.value) : null)}
                      placeholder="80"
                      className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:ring-1 focus:ring-overseer-500 outline-none" />
                  </div>
                  <div className="w-24">
                    <label className="block text-xs text-gray-500 mb-0.5">Crit</label>
                    <input type="number" value={check.threshold_crit ?? ''}
                      onChange={e => updateCheck(check._key, 'threshold_crit', e.target.value ? parseFloat(e.target.value) : null)}
                      placeholder="95"
                      className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:ring-1 focus:ring-overseer-500 outline-none" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</p>
        )}

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            Abbrechen
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !name || checks.length === 0 || checks.some(c => !c.name)}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50">
            {mutation.isPending ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const queryClient = useQueryClient()
  const [editTarget, setEditTarget] = useState<ServiceTemplate | null | 'new'>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const { data: templates = [], isLoading } = useQuery<ServiceTemplate[]>({
    queryKey: ['service-templates'],
    queryFn: () => api.get('/api/v1/service-templates/').then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/service-templates/${id}`),
    onSuccess: () => { setDeleteTarget(null); queryClient.invalidateQueries({ queryKey: ['service-templates'] }) },
  })

  const duplicateMutation = useMutation({
    mutationFn: (tpl: ServiceTemplate) => api.post('/api/v1/service-templates/', {
      name: `${tpl.name} (Kopie)`,
      description: tpl.description,
      checks: tpl.checks,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['service-templates'] }),
  })

  return (
    <div className="p-8 max-w-5xl">
      {editTarget !== null && (
        <TemplateModal
          template={editTarget === 'new' ? null : editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['service-templates'] })}
        />
      )}

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Layers className="w-6 h-6 text-overseer-600" />
          <h1 className="text-2xl font-bold text-gray-900">Vorlagen</h1>
        </div>
        <button
          onClick={() => setEditTarget('new')}
          className="flex items-center gap-1.5 px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Neue Vorlage
        </button>
      </div>

      <p className="text-sm text-gray-500 mb-6">
        Vorlagen sind vorgefertigte Check-Pakete, die beim Hinzufügen von Checks auf einen Host angewendet werden können.
      </p>

      {isLoading ? (
        <p className="text-gray-400 py-8 text-center">Lade Vorlagen...</p>
      ) : templates.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Layers className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Noch keine Vorlagen vorhanden.</p>
          <button onClick={() => setEditTarget('new')}
            className="mt-3 text-sm text-overseer-600 hover:text-overseer-700 font-medium">
            Erste Vorlage erstellen
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {templates.map(tpl => (
            <div key={tpl.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{tpl.name}</h3>
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                      {tpl.checks.length} Check{tpl.checks.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {tpl.description && (
                    <p className="text-sm text-gray-500 mt-0.5">{tpl.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => duplicateMutation.mutate(tpl)}
                    className="p-2 rounded-lg text-gray-400 hover:text-overseer-600 hover:bg-gray-100 transition-colors"
                    title="Duplizieren">
                    <Copy className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditTarget(tpl)}
                    className="p-2 rounded-lg text-gray-400 hover:text-overseer-600 hover:bg-gray-100 transition-colors"
                    title="Bearbeiten">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => setDeleteTarget({ id: tpl.id, name: tpl.name })}
                    className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Löschen">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Check list */}
              <div className="mt-3 flex flex-wrap gap-2">
                {tpl.checks.map((check, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5">
                    <span className="font-medium text-gray-700">{check.name}</span>
                    <span className="text-gray-400">{CHECK_TYPE_LABELS[check.check_type] ?? check.check_type}</span>
                    {check.check_mode === 'active' && (
                      <span className="text-[10px] font-medium bg-blue-100 text-blue-600 px-1 py-0.5 rounded">aktiv</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Vorlage löschen"
        message={`Vorlage "${deleteTarget?.name}" wirklich löschen?`}
        confirmLabel="Löschen"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
