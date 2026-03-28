import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Globe, Plus, X, Trash2, Pencil } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import type { Tenant } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'
import { CHECK_TYPE_REGISTRY, groupCheckTypesByCategory } from '../lib/constants'

interface GlobalPolicy {
  id: string
  name: string
  description: string
  check_type: string
  merge_config: Record<string, unknown>
  merge_strategy: 'merge' | 'override'
  scope_mode: 'all' | 'include_tenants' | 'exclude_tenants'
  scope_tenant_ids: string[]
  scope_tenant_names?: string[]
  enabled: boolean
  priority: number
  created_at: string
  updated_at: string
}

interface PolicyForm {
  name: string
  description: string
  check_type: string
  merge_config_json: string
  merge_strategy: 'merge' | 'override'
  scope_mode: 'all' | 'include_tenants' | 'exclude_tenants'
  scope_tenant_ids: string[]
  enabled: boolean
  priority: number
}

const POLICY_GROUPED = groupCheckTypesByCategory(CHECK_TYPE_REGISTRY)

function emptyForm(): PolicyForm {
  return {
    name: '',
    description: '',
    check_type: 'agent_services_auto',
    merge_config_json: '{\n  "exclude": []\n}',
    merge_strategy: 'merge',
    scope_mode: 'all',
    scope_tenant_ids: [],
    enabled: true,
    priority: 0,
  }
}

function policyToForm(p: GlobalPolicy): PolicyForm {
  return {
    name: p.name,
    description: p.description,
    check_type: p.check_type,
    merge_config_json: JSON.stringify(p.merge_config, null, 2),
    merge_strategy: p.merge_strategy,
    scope_mode: p.scope_mode,
    scope_tenant_ids: p.scope_tenant_ids,
    enabled: p.enabled,
    priority: p.priority,
  }
}

// ── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps {
  onClose: () => void
  tenants: Tenant[]
  existing?: GlobalPolicy
}

function PolicyModal({ onClose, tenants, existing }: ModalProps) {
  const qc = useQueryClient()
  const [form, setForm] = useState<PolicyForm>(existing ? policyToForm(existing) : emptyForm())
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof PolicyForm>(key: K, value: PolicyForm[K]) =>
    setForm(f => ({ ...f, [key]: value }))

  const toggleTenant = (id: string) => {
    setForm(f => ({
      ...f,
      scope_tenant_ids: f.scope_tenant_ids.includes(id)
        ? f.scope_tenant_ids.filter(t => t !== id)
        : [...f.scope_tenant_ids, id],
    }))
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      let mergeConfig: Record<string, unknown>
      try {
        mergeConfig = JSON.parse(form.merge_config_json)
      } catch {
        throw new Error('merge_config ist kein gültiges JSON')
      }
      const body = {
        name: form.name,
        description: form.description,
        check_type: form.check_type,
        merge_config: mergeConfig,
        merge_strategy: form.merge_strategy,
        scope_mode: form.scope_mode,
        scope_tenant_ids: form.scope_tenant_ids,
        enabled: form.enabled,
        priority: form.priority,
      }
      if (existing) {
        return api.patch(`/api/v1/global-policies/${existing.id}`, body).then(r => r.data)
      }
      return api.post('/api/v1/global-policies/', body).then(r => r.data)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['global-policies'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? e.message ?? 'Fehler'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {existing ? 'Policy bearbeiten' : 'Neue Global Policy'}
          </h2>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name *</label>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="z.B. Windows Services global ausschließen"
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500 dark:bg-gray-700 dark:text-gray-200" />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Beschreibung</label>
            <input type="text" value={form.description} onChange={e => set('description', e.target.value)}
              placeholder="Optional"
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500 dark:bg-gray-700 dark:text-gray-200" />
          </div>

          {/* Check Type */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Check-Typ</label>
            <select value={form.check_type} onChange={e => set('check_type', e.target.value)}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500 dark:bg-gray-700 dark:text-gray-200">
              <option value="*">Alle Check-Typen</option>
              {POLICY_GROUPED.map(g => (
                <optgroup key={g.category} label={g.label}>
                  {g.types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Merge Config */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Config (JSON) — wird in check_config gemergt
            </label>
            <textarea
              value={form.merge_config_json}
              onChange={e => set('merge_config_json', e.target.value)}
              rows={5}
              className="w-full text-sm font-mono border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500 dark:bg-gray-700 dark:text-gray-200"
              placeholder='{"exclude": ["sppsvc", "wuauserv"]}'
            />
          </div>

          {/* Merge Strategy */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Merge-Strategie</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" checked={form.merge_strategy === 'merge'}
                  onChange={() => set('merge_strategy', 'merge')} className="accent-overseer-600" />
                <span>Merge <span className="text-xs text-gray-400 dark:text-gray-500">(Arrays vereinen, Skalare als Default)</span></span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" checked={form.merge_strategy === 'override'}
                  onChange={() => set('merge_strategy', 'override')} className="accent-overseer-600" />
                <span>Override <span className="text-xs text-gray-400 dark:text-gray-500">(Werte erzwingen)</span></span>
              </label>
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Priorität: {form.priority} <span className="text-gray-400 dark:text-gray-500">(höher = wird später angewandt)</span>
            </label>
            <input type="range" min={0} max={100} step={1} value={form.priority}
              onChange={e => set('priority', parseInt(e.target.value))}
              className="w-full accent-overseer-600" />
          </div>

          {/* Scope */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Geltungsbereich</label>
            <div className="flex gap-2 mb-3">
              {(['all', 'include_tenants', 'exclude_tenants'] as const).map(mode => (
                <button key={mode} onClick={() => set('scope_mode', mode)}
                  className={clsx('px-3 py-1.5 rounded text-xs font-semibold transition-all',
                    form.scope_mode === mode ? 'bg-overseer-100 dark:bg-overseer-900/30 text-overseer-700 dark:text-overseer-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500')}>
                  {mode === 'all' ? 'Alle Tenants' : mode === 'include_tenants' ? 'Nur diese' : 'Alle außer'}
                </button>
              ))}
            </div>

            {form.scope_mode !== 'all' && (
              <div className="max-h-40 overflow-y-auto space-y-1 border border-gray-200 dark:border-gray-700 rounded-lg p-2">
                {tenants.map(t => (
                  <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer px-1 py-0.5 hover:bg-gray-50 dark:hover:bg-gray-700 rounded">
                    <input type="checkbox" checked={form.scope_tenant_ids.includes(t.id)}
                      onChange={() => toggleTenant(t.id)} className="rounded border-gray-300 dark:border-gray-600" />
                    <span className="text-gray-700 dark:text-gray-300">{t.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Enabled */}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.enabled}
              onChange={e => set('enabled', e.target.checked)} className="rounded border-gray-300 dark:border-gray-600" />
            <span className="text-gray-700 dark:text-gray-300">Aktiviert</span>
          </label>

          {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Abbrechen</button>
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.name}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-60">
            {saveMutation.isPending ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function GlobalPoliciesPage() {
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editPolicy, setEditPolicy] = useState<GlobalPolicy | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const { data: policies = [], isLoading } = useQuery<GlobalPolicy[]>({
    queryKey: ['global-policies'],
    queryFn: () => api.get('/api/v1/global-policies/').then(r => r.data),
  })

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['tenants'],
    queryFn: () => api.get('/api/v1/tenants/').then(r => r.data),
  })

  const toggleEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/api/v1/global-policies/${id}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['global-policies'] }),
  })

  const deletePolicy = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/global-policies/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['global-policies'] }); setDeleteTarget(null) },
  })

  return (
    <div className="p-8">
      {(showModal || editPolicy) && (
        <PolicyModal
          onClose={() => { setShowModal(false); setEditPolicy(undefined) }}
          tenants={tenants}
          existing={editPolicy}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Globe className="w-7 h-7 text-overseer-600" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Globale Check-Policies</h1>
          <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">{policies.length} Policies</span>
        </div>
        <button onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700">
          <Plus className="w-4 h-4" /> Neue Policy
        </button>
      </div>

      {/* Info box */}
      <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-800 dark:text-blue-300">
        Globale Policies mergen Config-Werte in die <code className="font-mono bg-blue-100 dark:bg-blue-900/50 px-1 rounded">check_config</code> aller
        Services eines Check-Typs. Beispiel: Services global von <code className="font-mono bg-blue-100 dark:bg-blue-900/50 px-1 rounded">agent_services_auto</code> ausschließen.
        Bei Arrays (z.B. <code className="font-mono bg-blue-100 dark:bg-blue-900/50 px-1 rounded">exclude</code>) werden die Werte vereint.
      </div>

      {isLoading && <div className="text-gray-400 dark:text-gray-500 text-sm">Lade...</div>}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            <tr>
              <th className="px-6 py-3 text-left">Name</th>
              <th className="px-6 py-3 text-left">Check-Typ</th>
              <th className="px-6 py-3 text-left">Config</th>
              <th className="px-6 py-3 text-left">Strategie</th>
              <th className="px-6 py-3 text-left">Geltungsbereich</th>
              <th className="px-6 py-3 text-center">Prio</th>
              <th className="px-6 py-3 text-center">Aktiv</th>
              <th className="px-6 py-3 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {policies.map(p => (
              <tr key={p.id} className={clsx('hover:bg-gray-50 dark:hover:bg-gray-700', !p.enabled && 'opacity-50')}>
                <td className="px-6 py-3">
                  <p className="font-medium text-gray-900 dark:text-gray-100">{p.name}</p>
                  {p.description && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{p.description}</p>}
                </td>
                <td className="px-6 py-3">
                  <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-300">
                    {p.check_type === '*' ? 'Alle' : (CHECK_TYPE_REGISTRY.find(ct => ct.key === p.check_type)?.label ?? p.check_type)}
                  </span>
                </td>
                <td className="px-6 py-3">
                  <code className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 px-2 py-1 rounded block max-w-xs truncate" title={JSON.stringify(p.merge_config)}>
                    {JSON.stringify(p.merge_config)}
                  </code>
                </td>
                <td className="px-6 py-3 text-xs text-gray-500 dark:text-gray-400">{p.merge_strategy}</td>
                <td className="px-6 py-3 text-xs text-gray-500 dark:text-gray-400">
                  {p.scope_mode === 'all' ? (
                    <span className="text-green-600 font-medium">Alle Tenants</span>
                  ) : (
                    <span>
                      {p.scope_mode === 'include_tenants' ? 'Nur: ' : 'Alle außer: '}
                      {(p.scope_tenant_names ?? p.scope_tenant_ids).join(', ') || '–'}
                    </span>
                  )}
                </td>
                <td className="px-6 py-3 text-center text-xs font-mono text-gray-500 dark:text-gray-400">{p.priority}</td>
                <td className="px-6 py-3 text-center">
                  <button
                    onClick={() => toggleEnabled.mutate({ id: p.id, enabled: !p.enabled })}
                    className={clsx('w-10 h-5 rounded-full relative transition-colors',
                      p.enabled ? 'bg-overseer-600' : 'bg-gray-300')}>
                    <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                      p.enabled ? 'left-5' : 'left-0.5')} />
                  </button>
                </td>
                <td className="px-6 py-3 text-right">
                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => setEditPolicy(p)} title="Bearbeiten" className="text-gray-400 dark:text-gray-500 hover:text-overseer-600">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => setDeleteTarget(p.id)} title="Löschen" className="text-gray-400 dark:text-gray-500 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {policies.length === 0 && !isLoading && (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500 text-sm">Keine globalen Check-Policies konfiguriert.</div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Policy löschen"
        message="Soll diese globale Check-Policy wirklich gelöscht werden?"
        confirmLabel="Löschen"
        variant="danger"
        loading={deletePolicy.isPending}
        onConfirm={() => deleteTarget && deletePolicy.mutate(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
