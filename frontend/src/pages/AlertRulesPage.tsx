import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Plus, X, Trash2, ChevronUp, ChevronDown, Zap, TestTube2 } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import type {
  AlertRule, AlertRuleCreate, NotificationChannel,
  Tenant, EscalationStep, CheckStatus,
} from '../types'

const STATUS_OPTIONS: { value: CheckStatus; label: string; color: string }[] = [
  { value: 'CRITICAL', label: 'Critical', color: 'bg-red-100 text-red-800' },
  { value: 'WARNING', label: 'Warning', color: 'bg-amber-100 text-amber-800' },
  { value: 'UNKNOWN', label: 'Unknown', color: 'bg-gray-100 text-gray-700' },
]

// ── New/Edit Rule Modal ──────────────────────────────────────────────────────

interface RuleModalProps {
  onClose: () => void
  channels: NotificationChannel[]
  tenants: Tenant[]
  existing?: AlertRule
}

function RuleModal({ onClose, channels, tenants, existing }: RuleModalProps) {
  const qc = useQueryClient()
  const [name, setName] = useState(existing?.name ?? '')
  const [tenantId, setTenantId] = useState(existing?.tenant_id ?? tenants[0]?.id ?? '')
  const [statuses, setStatuses] = useState<CheckStatus[]>(existing?.conditions.statuses ?? ['CRITICAL', 'UNKNOWN'])
  const [minDuration, setMinDuration] = useState(existing?.conditions.min_duration_minutes ?? 5)
  const [hostTags, setHostTags] = useState(existing?.conditions.host_tags?.join(', ') ?? '')
  const [serviceNames, setServiceNames] = useState(existing?.conditions.service_names?.join(', ') ?? '')
  const [selectedChannels, setSelectedChannels] = useState<string[]>(existing?.notification_channels ?? [])
  const [steps, setSteps] = useState<EscalationStep[]>([])
  const [error, setError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: async () => {
      const body: AlertRuleCreate = {
        tenant_id: tenantId,
        name,
        conditions: {
          statuses,
          min_duration_minutes: minDuration,
          host_tags: hostTags.split(',').map(s => s.trim()).filter(Boolean),
          service_names: serviceNames.split(',').map(s => s.trim()).filter(Boolean),
        },
        notification_channels: selectedChannels,
      }
      let rule: any
      if (existing) {
        rule = await api.patch(`/api/v1/alert-rules/${existing.id}`, body).then(r => r.data)
      } else {
        rule = await api.post('/api/v1/alert-rules/', body).then(r => r.data)
      }
      // Save escalation if steps defined
      if (steps.length > 0) {
        await api.put(`/api/v1/alert-rules/${rule.id}/escalation`, { steps })
      }
      return rule
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alert-rules'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler'),
  })

  const toggleStatus = (s: CheckStatus) => {
    setStatuses(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  const toggleChannel = (id: string) => {
    setSelectedChannels(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const addStep = () => setSteps(prev => [...prev, { delay_minutes: (prev.length + 1) * 30, channels: [] }])
  const removeStep = (i: number) => setSteps(prev => prev.filter((_, idx) => idx !== i))
  const moveStep = (i: number, dir: -1 | 1) => {
    setSteps(prev => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  const updateStep = (i: number, field: string, val: unknown) => {
    setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: val } : s))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">{existing ? 'Regel bearbeiten' : 'Neue Alert-Regel'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} required placeholder="z.B. Critical Alerts"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>

          {/* Tenant */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tenant</label>
            <select value={tenantId} onChange={e => setTenantId(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500">
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          {/* Status Checkboxes */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Status-Filter</label>
            <div className="flex gap-2">
              {STATUS_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => toggleStatus(opt.value)}
                  className={clsx('px-3 py-1.5 rounded text-xs font-semibold transition-all',
                    statuses.includes(opt.value) ? opt.color : 'bg-gray-100 text-gray-400')}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Min Duration */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Min. Dauer: {minDuration} Min.
            </label>
            <input type="range" min={0} max={120} step={5} value={minDuration}
              onChange={e => setMinDuration(parseInt(e.target.value))}
              className="w-full accent-overseer-600" />
          </div>

          {/* Host Tags */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Host-Tags (kommagetrennt)</label>
            <input type="text" value={hostTags} onChange={e => setHostTags(e.target.value)}
              placeholder="server, production"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>

          {/* Service Names */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Service-Namen (kommagetrennt)</label>
            <input type="text" value={serviceNames} onChange={e => setServiceNames(e.target.value)}
              placeholder="ping, cpu_usage"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
          </div>

          {/* Notification Channels */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Benachrichtigungskanäle</label>
            <div className="space-y-1">
              {channels.filter(c => c.active).map(ch => (
                <label key={ch.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={selectedChannels.includes(ch.id)}
                    onChange={() => toggleChannel(ch.id)} className="rounded border-gray-300" />
                  <span className="text-gray-700">{ch.name}</span>
                  <span className="text-xs text-gray-400">({ch.channel_type})</span>
                </label>
              ))}
              {channels.length === 0 && <p className="text-xs text-gray-400">Keine Kanäle konfiguriert</p>}
            </div>
          </div>

          {/* Escalation Steps */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">Eskalationsstufen</label>
              <button onClick={addStep} className="text-xs text-overseer-600 hover:text-overseer-700 font-medium inline-flex items-center gap-1">
                <Plus className="w-3 h-3" /> Stufe hinzufügen
              </button>
            </div>
            {steps.length === 0 && (
              <p className="text-xs text-gray-400">Keine Eskalation konfiguriert</p>
            )}
            <div className="space-y-2">
              {steps.map((step, i) => (
                <div key={i} className="flex items-start gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex flex-col gap-1">
                    <button onClick={() => moveStep(i, -1)} disabled={i === 0} className="text-gray-400 hover:text-gray-600 disabled:opacity-30">
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <button onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} className="text-gray-400 hover:text-gray-600 disabled:opacity-30">
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex-1 space-y-2">
                    <div>
                      <label className="text-xs text-gray-500">Verzögerung (Min.)</label>
                      <input type="number" min={0} value={step.delay_minutes}
                        onChange={e => updateStep(i, 'delay_minutes', parseInt(e.target.value) || 0)}
                        className="w-full text-sm border border-gray-300 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-overseer-500" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Kanäle</label>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {channels.filter(c => c.active).map(ch => (
                          <button key={ch.id} onClick={() => {
                            const chs = step.channels.includes(ch.id) ? step.channels.filter(x => x !== ch.id) : [...step.channels, ch.id]
                            updateStep(i, 'channels', chs)
                          }} className={clsx('px-2 py-0.5 rounded text-xs',
                            step.channels.includes(ch.id) ? 'bg-overseer-100 text-overseer-700' : 'bg-gray-100 text-gray-500')}>
                            {ch.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <button onClick={() => removeStep(i)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Abbrechen</button>
          <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !name}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-60">
            {createMutation.isPending ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function AlertRulesPage() {
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editRule, setEditRule] = useState<AlertRule | undefined>()

  const { data: rules = [], isLoading } = useQuery<AlertRule[]>({
    queryKey: ['alert-rules'],
    queryFn: () => api.get('/api/v1/alert-rules/').then(r => r.data),
  })

  const { data: channels = [] } = useQuery<NotificationChannel[]>({
    queryKey: ['notification-channels'],
    queryFn: () => api.get('/api/v1/notifications/').then(r => r.data),
  })

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['tenants'],
    queryFn: () => api.get('/api/v1/tenants/').then(r => r.data),
  })

  const toggleEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/api/v1/alert-rules/${id}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
  })

  const deleteRule = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/alert-rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
  })

  const testRule = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/alert-rules/${id}/test`),
  })

  const tenantNames: Record<string, string> = {}
  tenants.forEach(t => { tenantNames[t.id] = t.name })

  return (
    <div className="p-8">
      {(showModal || editRule) && (
        <RuleModal
          onClose={() => { setShowModal(false); setEditRule(undefined) }}
          channels={channels}
          tenants={tenants}
          existing={editRule}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bell className="w-7 h-7 text-overseer-600" />
          <h1 className="text-2xl font-bold text-gray-900">Alert-Regeln</h1>
          <span className="text-sm text-gray-500 ml-2">{rules.length} Regeln</span>
        </div>
        <button onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700">
          <Plus className="w-4 h-4" /> Neue Regel
        </button>
      </div>

      {isLoading && <div className="text-gray-400 text-sm">Lade…</div>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-6 py-3 text-left">Name</th>
              <th className="px-6 py-3 text-left">Bedingungen</th>
              <th className="px-6 py-3 text-center">Kanäle</th>
              <th className="px-6 py-3 text-left">Tenant</th>
              <th className="px-6 py-3 text-center">Aktiv</th>
              <th className="px-6 py-3 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rules.map(rule => (
              <tr key={rule.id} className="hover:bg-gray-50">
                <td className="px-6 py-3 font-medium text-gray-900">{rule.name}</td>
                <td className="px-6 py-3">
                  <div className="flex gap-1 flex-wrap">
                    {rule.conditions.statuses.map(s => (
                      <span key={s} className={clsx('px-1.5 py-0.5 rounded text-xs font-semibold',
                        s === 'CRITICAL' ? 'bg-red-100 text-red-800' : s === 'WARNING' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700')}>
                        {s}
                      </span>
                    ))}
                    <span className="text-xs text-gray-400 ml-1">{rule.conditions.min_duration_minutes}min</span>
                  </div>
                </td>
                <td className="px-6 py-3 text-center text-gray-500">{rule.notification_channels.length}</td>
                <td className="px-6 py-3 text-xs text-gray-500">{tenantNames[rule.tenant_id] ?? '–'}</td>
                <td className="px-6 py-3 text-center">
                  <button
                    onClick={() => toggleEnabled.mutate({ id: rule.id, enabled: !rule.enabled })}
                    className={clsx('w-10 h-5 rounded-full relative transition-colors',
                      rule.enabled ? 'bg-overseer-600' : 'bg-gray-300')}>
                    <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                      rule.enabled ? 'left-5' : 'left-0.5')} />
                  </button>
                </td>
                <td className="px-6 py-3 text-right">
                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => testRule.mutate(rule.id)} title="Test" className="text-gray-400 hover:text-overseer-600">
                      <TestTube2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditRule(rule)} title="Bearbeiten" className="text-gray-400 hover:text-overseer-600">
                      <Zap className="w-4 h-4" />
                    </button>
                    <button onClick={() => { if (confirm('Regel löschen?')) deleteRule.mutate(rule.id) }}
                      title="Löschen" className="text-gray-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rules.length === 0 && !isLoading && (
          <div className="p-8 text-center text-gray-400 text-sm">Keine Alert-Regeln konfiguriert.</div>
        )}
      </div>
    </div>
  )
}
