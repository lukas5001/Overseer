import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileCode2, Plus, X, Trash2, Play, ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '../api/client'
import type { ServiceTemplate, ServiceTemplateCreate, TemplateCheckItem, Host } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'
import RegistryConfigFields from '../components/RegistryConfigFields'
import { CHECK_TYPE_REGISTRY, getCheckTypeDef, getCheckTypeLabel, groupCheckTypesByCategory } from '../lib/constants'
import type { DiskConfig } from '../components/DiskConfigEditor'

// ── Template Check Card ─────────────────────────────────────────────────────

function TemplateCheckCard({ check, index, onUpdate, onRemove }: {
  check: TemplateCheckItem
  index: number
  onUpdate: (i: number, field: string, val: unknown) => void
  onRemove: (i: number) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const def = getCheckTypeDef(check.check_type)
  const grouped = groupCheckTypesByCategory(CHECK_TYPE_REGISTRY)
  const isDisk = def?.managesOwnThresholds === true

  // Config state for RegistryConfigFields
  const configRecord = Object.fromEntries(
    Object.entries(check.check_config ?? {}).map(([k, v]) => [k, String(v)])
  )
  const updateConfig = (key: string, value: string) => {
    const newConfig = { ...(check.check_config ?? {}), [key]: value }
    onUpdate(index, 'check_config', newConfig)
  }

  // Disk config state
  const cc = (check.check_config ?? {}) as any
  const diskConfig: DiskConfig = {
    warn: cc.warn != null ? String(cc.warn) : '80',
    crit: cc.crit != null ? String(cc.crit) : '90',
    overrides: Array.isArray(cc.overrides)
      ? cc.overrides.map((o: any) => ({ path: o.path ?? '', warn: o.warn != null ? String(o.warn) : '', crit: o.crit != null ? String(o.crit) : '' }))
      : [],
    exclude: Array.isArray(cc.exclude) ? cc.exclude.join(', ') : (cc.exclude ?? ''),
  }

  const handleTypeChange = (newType: string) => {
    const newDef = getCheckTypeDef(newType)
    onUpdate(index, 'check_type', newType)
    onUpdate(index, 'check_mode', newDef?.mode ?? 'active')
    onUpdate(index, 'check_config', {})
    if (newDef?.defaults?.interval) onUpdate(index, 'interval_seconds', newDef.defaults.interval)
    if (!newDef?.managesOwnThresholds) {
      onUpdate(index, 'threshold_warn', newDef?.defaults?.warn ?? null)
      onUpdate(index, 'threshold_crit', newDef?.defaults?.crit ?? null)
    }
    // Auto-suggest name from label
    if (!check.name) {
      onUpdate(index, 'name', newDef?.label ?? newType)
    }
  }

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-100" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
        <span className="text-sm font-medium text-gray-700 flex-1">
          {check.name || <span className="text-gray-400 italic">Unbenannt</span>}
          <span className="text-xs text-gray-400 ml-2">{def?.label ?? check.check_type}</span>
        </span>
        <button onClick={e => { e.stopPropagation(); onRemove(index) }} className="text-gray-400 hover:text-red-500 p-0.5">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-gray-200 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500">Name</label>
              <input type="text" value={check.name} onChange={e => onUpdate(index, 'name', e.target.value)}
                placeholder={def?.label ?? 'Check-Name'}
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 outline-none focus:ring-2 focus:ring-overseer-500" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Typ</label>
              <select value={check.check_type} onChange={e => handleTypeChange(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 outline-none focus:ring-2 focus:ring-overseer-500">
                {grouped.map(g => (
                  <optgroup key={g.category} label={g.label}>
                    {g.types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          {/* Config fields from registry */}
          <RegistryConfigFields
            checkType={check.check_type}
            config={configRecord}
            onChange={updateConfig}
            diskConfig={diskConfig}
            onDiskConfigChange={dc => {
              const newConfig: Record<string, unknown> = {}
              newConfig.warn = parseFloat(dc.warn) || 80
              newConfig.crit = parseFloat(dc.crit) || 90
              if (dc.overrides.length > 0) {
                newConfig.overrides = dc.overrides.filter(o => o.path.trim()).map(o => ({
                  path: o.path.trim(),
                  warn: parseFloat(o.warn) || null,
                  crit: parseFloat(o.crit) || null,
                }))
              }
              if (dc.exclude.trim()) {
                newConfig.exclude = dc.exclude.split(',').map(s => s.trim()).filter(Boolean)
              }
              onUpdate(index, 'check_config', newConfig)
            }}
          />

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-gray-500">Intervall (s)</label>
              <input type="number" min={10} value={check.interval_seconds ?? 60}
                onChange={e => onUpdate(index, 'interval_seconds', parseInt(e.target.value) || 60)}
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 outline-none" />
            </div>
            {!isDisk && (
              <>
                <div>
                  <label className="text-xs text-gray-500">Warn</label>
                  <input type="number" value={check.threshold_warn ?? ''}
                    onChange={e => onUpdate(index, 'threshold_warn', e.target.value ? parseFloat(e.target.value) : null)}
                    className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 outline-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Crit</label>
                  <input type="number" value={check.threshold_crit ?? ''}
                    onChange={e => onUpdate(index, 'threshold_crit', e.target.value ? parseFloat(e.target.value) : null)}
                    className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 outline-none" />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── New Template Modal ───────────────────────────────────────────────────────

function TemplateModal({ onClose, existing }: { onClose: () => void; existing?: ServiceTemplate }) {
  const qc = useQueryClient()
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [checks, setChecks] = useState<TemplateCheckItem[]>(existing?.checks ?? [])
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => {
      // Clean up _mode from check configs before saving
      const cleanedChecks = checks.map(c => ({
        ...c,
        check_config: c.check_config
          ? Object.fromEntries(Object.entries(c.check_config).filter(([k]) => !k.startsWith('_')))
          : {},
      }))
      const body: ServiceTemplateCreate = { name, description, checks: cleanedChecks }
      if (existing) return api.put(`/api/v1/service-templates/${existing.id}`, body).then(r => r.data)
      return api.post('/api/v1/service-templates/', body).then(r => r.data)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['service-templates'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler'),
  })

  const addCheck = () => {
    const def = getCheckTypeDef('ping')
    setChecks(prev => [...prev, {
      name: '', check_type: 'ping',
      check_config: {},
      interval_seconds: def?.defaults?.interval ?? 60,
      threshold_warn: def?.defaults?.warn ?? null,
      threshold_crit: def?.defaults?.crit ?? null,
      check_mode: def?.mode ?? 'active',
    }])
  }

  const updateCheck = (i: number, field: string, val: unknown) => {
    setChecks(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: val } : c))
  }

  const removeCheck = (i: number) => setChecks(prev => prev.filter((_, idx) => idx !== i))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">{existing ? 'Template bearbeiten' : 'Neues Template'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} required placeholder="Windows Server Basic"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Beschreibung</label>
              <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Standard-Checks für Windows"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
            </div>
          </div>

          {/* Checks */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">Checks ({checks.length})</label>
              <button onClick={addCheck} className="text-xs text-overseer-600 hover:text-overseer-700 font-medium inline-flex items-center gap-1">
                <Plus className="w-3 h-3" /> Check hinzufügen
              </button>
            </div>
            <div className="space-y-2">
              {checks.map((check, i) => (
                <TemplateCheckCard
                  key={i}
                  check={check}
                  index={i}
                  onUpdate={updateCheck}
                  onRemove={removeCheck}
                />
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Abbrechen</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-60">
            {mutation.isPending ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Apply Modal ──────────────────────────────────────────────────────────────

function ApplyModal({ templateId, onClose }: { templateId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [hostId, setHostId] = useState('')
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: hosts = [] } = useQuery<Host[]>({
    queryKey: ['hosts'],
    queryFn: () => api.get('/api/v1/hosts/').then(r => r.data),
  })

  const mutation = useMutation({
    mutationFn: () => api.post(`/api/v1/service-templates/${templateId}/apply`, { host_id: hostId }).then(r => r.data),
    onSuccess: (data: any) => { setResult(data); qc.invalidateQueries({ queryKey: ['services'] }) },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Template anwenden</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {result ? (
          <div>
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg mb-4">
              <p className="text-sm text-emerald-800 font-medium">{result.created} Services erstellt, {result.skipped} übersprungen</p>
            </div>
            <button onClick={onClose} className="w-full py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700">
              Schließen
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ziel-Host</label>
                <select value={hostId} onChange={e => setHostId(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500">
                  <option value="">– Host auswählen –</option>
                  {hosts.map(h => (
                    <option key={h.id} value={h.id}>
                      {h.display_name || h.hostname} ({h.ip_address ?? 'no IP'})
                    </option>
                  ))}
                </select>
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Abbrechen</button>
              <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !hostId}
                className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-60">
                {mutation.isPending ? 'Anwenden…' : 'Anwenden'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function ServiceTemplatesPage() {
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editTemplate, setEditTemplate] = useState<ServiceTemplate | undefined>()
  const [applyTemplateId, setApplyTemplateId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const { data: templates = [], isLoading } = useQuery<ServiceTemplate[]>({
    queryKey: ['service-templates'],
    queryFn: () => api.get('/api/v1/service-templates/').then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/service-templates/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['service-templates'] }); setDeleteTarget(null) },
  })

  return (
    <div className="p-8">
      {(showModal || editTemplate) && (
        <TemplateModal onClose={() => { setShowModal(false); setEditTemplate(undefined) }} existing={editTemplate} />
      )}
      {applyTemplateId && (
        <ApplyModal templateId={applyTemplateId} onClose={() => setApplyTemplateId(null)} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FileCode2 className="w-7 h-7 text-overseer-600" />
          <h1 className="text-2xl font-bold text-gray-900">Service-Templates</h1>
          <span className="text-sm text-gray-500 ml-2">{templates.length} Templates</span>
        </div>
        <button onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700">
          <Plus className="w-4 h-4" /> Neues Template
        </button>
      </div>

      {isLoading && <div className="text-gray-400 text-sm">Lade…</div>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-6 py-3 text-left">Name</th>
              <th className="px-6 py-3 text-left">Beschreibung</th>
              <th className="px-6 py-3 text-left">Checks</th>
              <th className="px-6 py-3 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {templates.map(t => (
              <tr key={t.id} className="hover:bg-gray-50">
                <td className="px-6 py-3 font-medium text-gray-900">{t.name}</td>
                <td className="px-6 py-3 text-gray-500 text-xs max-w-xs truncate">{t.description || '–'}</td>
                <td className="px-6 py-3 text-gray-600">
                  <div className="flex flex-wrap gap-1">
                    {t.checks.map((c, i) => (
                      <span key={i} className="inline-flex items-center text-[11px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                        {getCheckTypeLabel(c.check_type)}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-6 py-3 text-right">
                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => setApplyTemplateId(t.id)}
                      className="inline-flex items-center gap-1 text-xs text-overseer-600 hover:text-overseer-700 font-medium">
                      <Play className="w-3.5 h-3.5" /> Anwenden
                    </button>
                    <button onClick={() => setEditTemplate(t)} className="text-xs text-gray-500 hover:text-gray-700">
                      Bearbeiten
                    </button>
                    <button onClick={() => setDeleteTarget(t.id)}
                      className="text-gray-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {templates.length === 0 && !isLoading && (
          <div className="p-8 text-center text-gray-400 text-sm">Keine Templates vorhanden.</div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Template löschen"
        message="Soll dieses Template wirklich gelöscht werden?"
        confirmLabel="Löschen"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
