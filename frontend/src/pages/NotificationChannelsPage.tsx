import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Mail, Webhook, Plus, X, Trash2, TestTube2, Check,
  Pencil, Power, Hash, Users, Send, Loader2, Bell,
} from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import type { NotificationChannel, NotificationChannelTypeInfo, Tenant } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'

const PASSWORD_MASK = '••••••••'

// ── Channel type icon mapping ────────────────────────────────────────────────

const TYPE_ICONS: Record<string, typeof Mail> = {
  email: Mail,
  webhook: Webhook,
  slack: Hash,
  teams: Users,
  telegram: Send,
}

function ChannelTypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon = TYPE_ICONS[type] ?? Bell
  return <Icon className={className} />
}

// ── Dynamic Config Form ─────────────────────────────────────────────────────

function ConfigForm({
  schema,
  values,
  onChange,
  isEdit,
}: {
  schema: NotificationChannelTypeInfo['config_schema']
  values: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  isEdit: boolean
}) {
  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])

  const handleChange = (key: string, value: unknown) => {
    onChange({ ...values, [key]: value })
  }

  return (
    <div className="space-y-3">
      {Object.entries(properties).map(([key, prop]) => {
        const isPassword = prop.format === 'password'
        const isRequired = required.has(key)
        const currentValue = values[key] ?? prop.default ?? ''
        const label = prop.title ?? key

        if (prop.type === 'boolean') {
          return (
            <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={!!currentValue}
                onChange={e => handleChange(key, e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              <span className="text-gray-700 dark:text-gray-300">{label}</span>
              {prop.description && <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">({prop.description})</span>}
            </label>
          )
        }

        const inputType = isPassword ? 'password'
          : prop.format === 'email' ? 'email'
          : prop.format === 'uri' ? 'url'
          : prop.type === 'number' || prop.type === 'integer' ? 'number'
          : 'text'

        return (
          <div key={key}>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {label}{isRequired && ' *'}
            </label>
            <input
              type={inputType}
              value={String(currentValue)}
              placeholder={isEdit && isPassword ? PASSWORD_MASK : (prop.description ?? '')}
              onChange={e => {
                const v = prop.type === 'number' || prop.type === 'integer'
                  ? (e.target.value === '' ? '' : Number(e.target.value))
                  : e.target.value
                handleChange(key, v)
              }}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500"
            />
            {prop.description && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{prop.description}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Channel Modal (Add / Edit) ──────────────────────────────────────────────

interface ChannelModalProps {
  onClose: () => void
  tenants: Tenant[]
  channelTypes: NotificationChannelTypeInfo[]
  existing?: NotificationChannel
}

function ChannelModal({ onClose, tenants, channelTypes, existing }: ChannelModalProps) {
  const qc = useQueryClient()
  const isEdit = !!existing

  const [step, setStep] = useState<'type' | 'config'>(isEdit ? 'config' : 'type')
  const [name, setName] = useState(existing?.name ?? '')
  const [tenantId, setTenantId] = useState(existing?.tenant_id ?? tenants[0]?.id ?? '')
  const [channelType, setChannelType] = useState(existing?.channel_type ?? '')
  const [config, setConfig] = useState<Record<string, unknown>>(existing?.config ?? {})
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; detail?: string } | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)

  const selectedSchema = channelTypes.find(t => t.channel_type === channelType)

  // When editing, filter out masked password values so they don't get sent back
  const cleanConfigForSubmit = (cfg: Record<string, unknown>) => {
    if (!selectedSchema) return cfg
    const pwFields = Object.entries(selectedSchema.config_schema.properties ?? {})
      .filter(([, v]) => v.format === 'password')
      .map(([k]) => k)
    const cleaned = { ...cfg }
    for (const pf of pwFields) {
      if (cleaned[pf] === '' || cleaned[pf] === undefined) {
        if (isEdit) {
          // Send the mask back — backend will preserve the original
          cleaned[pf] = PASSWORD_MASK
        }
      }
    }
    return cleaned
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const cleanedConfig = cleanConfigForSubmit(config)
      if (isEdit) {
        return api.patch(`/api/v1/notifications/${existing!.id}`, {
          name, config: cleanedConfig,
        }).then(r => r.data)
      }
      return api.post('/api/v1/notifications/', {
        tenant_id: tenantId, name, channel_type: channelType, config: cleanedConfig,
      }).then(r => r.data)
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['notification-channels'] })
      if (!isEdit && data?.id) {
        setCreatedId(data.id)
      } else {
        onClose()
      }
    },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler'),
  })

  const testMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/notifications/${id}/test`).then(r => r.data),
    onSuccess: (data) => setTestResult({ ok: data.status === 'sent', detail: data.detail }),
    onError: () => setTestResult({ ok: false, detail: 'Request failed' }),
  })

  // After creation: show "test now?" prompt
  if (createdId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mx-auto mb-4">
              <Check className="w-6 h-6 text-emerald-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Kanal erstellt</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Test-Benachrichtigung senden?</p>

            {testResult && (
              <div className={clsx('mb-4 px-3 py-2 rounded-lg text-sm',
                testResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
                {testResult.ok ? 'Test erfolgreich gesendet!' : `Fehler: ${testResult.detail}`}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={onClose}
                className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                Schließen
              </button>
              <button
                onClick={() => testMutation.mutate(createdId)}
                disabled={testMutation.isPending}
                className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-60 inline-flex items-center justify-center gap-2">
                {testMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube2 className="w-4 h-4" />}
                Test senden
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {isEdit ? 'Kanal bearbeiten' : step === 'type' ? 'Kanaltyp wählen' : 'Kanal konfigurieren'}
          </h2>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"><X className="w-5 h-5" /></button>
        </div>

        {/* Step 1: Type selection (only for create) */}
        {step === 'type' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {channelTypes.map(ct => (
                <button
                  key={ct.channel_type}
                  onClick={() => { setChannelType(ct.channel_type); setConfig({}); setStep('config') }}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-overseer-500 hover:bg-overseer-50 transition-colors">
                  <ChannelTypeIcon type={ct.channel_type} className="w-8 h-8 text-gray-600 dark:text-gray-400" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{ct.display_name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Configuration */}
        {step === 'config' && selectedSchema && (
          <div className="space-y-4">
            {!isEdit && (
              <button onClick={() => setStep('type')}
                className="text-xs text-overseer-600 hover:text-overseer-700 font-medium mb-2">
                &larr; Typ ändern ({selectedSchema.display_name})
              </button>
            )}

            {isEdit && (
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-2">
                <ChannelTypeIcon type={channelType} className="w-4 h-4" />
                <span>{selectedSchema.display_name}</span>
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name *</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="z.B. Slack #critical-alerts"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
            </div>

            {/* Tenant (only for create) */}
            {!isEdit && (
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Tenant</label>
                <select value={tenantId} onChange={e => setTenantId(e.target.value)}
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500">
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}

            {/* Dynamic config form */}
            <ConfigForm
              schema={selectedSchema.config_schema}
              values={config}
              onChange={setConfig}
              isEdit={isEdit}
            />

            {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-3 mt-6">
              <button onClick={onClose}
                className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                Abbrechen
              </button>
              <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !name}
                className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-60">
                {saveMutation.isPending ? 'Speichern…' : 'Speichern'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function NotificationChannelsPage() {
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editChannel, setEditChannel] = useState<NotificationChannel | undefined>()
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; detail?: string }>>({})
  const [testingId, setTestingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const { data: channels = [], isLoading } = useQuery<NotificationChannel[]>({
    queryKey: ['notification-channels'],
    queryFn: () => api.get('/api/v1/notifications/').then(r => r.data),
  })

  const { data: channelTypes = [] } = useQuery<NotificationChannelTypeInfo[]>({
    queryKey: ['notification-channel-types'],
    queryFn: () => api.get('/api/v1/notifications/types').then(r => r.data),
    staleTime: 300_000,
  })

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['tenants'],
    queryFn: () => api.get('/api/v1/tenants/').then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/notifications/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notification-channels'] }); setDeleteTarget(null) },
  })

  const enableMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/api/v1/notifications/${id}`, { active: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-channels'] }),
  })

  const testMutation = useMutation({
    mutationFn: (id: string) => {
      setTestingId(id)
      return api.post(`/api/v1/notifications/${id}/test`).then(r => r.data)
    },
    onSuccess: (data, id) => {
      setTestResults(prev => ({ ...prev, [id]: { ok: data.status === 'sent', detail: data.detail } }))
      setTestingId(null)
    },
    onError: (_, id) => {
      setTestResults(prev => ({ ...prev, [id]: { ok: false, detail: 'Request failed' } }))
      setTestingId(null)
    },
  })

  const tenantNames: Record<string, string> = {}
  tenants.forEach(t => { tenantNames[t.id] = t.name })

  // Map channel_type to display_name
  const typeDisplayNames: Record<string, string> = {}
  channelTypes.forEach(ct => { typeDisplayNames[ct.channel_type] = ct.display_name })

  return (
    <div className="p-8">
      {(showModal || editChannel) && (
        <ChannelModal
          onClose={() => { setShowModal(false); setEditChannel(undefined) }}
          tenants={tenants}
          channelTypes={channelTypes}
          existing={editChannel}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bell className="w-7 h-7 text-overseer-600" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Benachrichtigungskanäle</h1>
          <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">{channels.length} Kanäle</span>
        </div>
        <button onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700">
          <Plus className="w-4 h-4" /> Neuer Kanal
        </button>
      </div>

      {isLoading && <div className="text-gray-400 dark:text-gray-500 text-sm">Lade…</div>}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            <tr>
              <th className="px-6 py-3 text-left">Name</th>
              <th className="px-6 py-3 text-left">Typ</th>
              <th className="px-6 py-3 text-left">Tenant</th>
              <th className="px-6 py-3 text-center">Status</th>
              <th className="px-6 py-3 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {channels.map(ch => {
              const isDisabled = !ch.active
              const failureInfo = ch.consecutive_failures > 0
                ? `${ch.consecutive_failures} Fehler`
                : null
              const tr = testResults[ch.id]

              return (
                <tr key={ch.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-3 font-medium text-gray-900 dark:text-gray-100">{ch.name}</td>
                  <td className="px-6 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                      <ChannelTypeIcon type={ch.channel_type} className="w-3.5 h-3.5" />
                      {typeDisplayNames[ch.channel_type] ?? ch.channel_type}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-xs text-gray-500 dark:text-gray-400">{tenantNames[ch.tenant_id] ?? '–'}</td>
                  <td className="px-6 py-3 text-center">
                    {isDisabled ? (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                        Deaktiviert{failureInfo && ` (${failureInfo})`}
                      </span>
                    ) : failureInfo ? (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                        Aktiv ({failureInfo})
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                        Aktiv
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      {/* Test result inline */}
                      {tr && (
                        <span className={clsx('text-xs', tr.ok ? 'text-emerald-600' : 'text-red-500')}>
                          {tr.ok ? 'Gesendet' : tr.detail?.substring(0, 30) ?? 'Fehler'}
                        </span>
                      )}

                      {/* Test button */}
                      <button
                        onClick={() => testMutation.mutate(ch.id)}
                        disabled={testingId === ch.id}
                        title="Test senden"
                        className="inline-flex items-center gap-1 text-xs text-overseer-600 hover:text-overseer-700 font-medium disabled:opacity-50">
                        {testingId === ch.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <TestTube2 className="w-3.5 h-3.5" />}
                        Test
                      </button>

                      {/* Edit */}
                      <button onClick={() => setEditChannel(ch)} title="Bearbeiten"
                        className="text-gray-400 dark:text-gray-500 hover:text-overseer-600">
                        <Pencil className="w-4 h-4" />
                      </button>

                      {/* Enable (only when disabled) */}
                      {isDisabled && (
                        <button onClick={() => enableMutation.mutate(ch.id)} title="Aktivieren"
                          className="text-gray-400 dark:text-gray-500 hover:text-emerald-600">
                          <Power className="w-4 h-4" />
                        </button>
                      )}

                      {/* Delete */}
                      <button onClick={() => setDeleteTarget(ch.id)}
                        title="Löschen" className="text-gray-400 dark:text-gray-500 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {channels.length === 0 && !isLoading && (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500 text-sm">Keine Kanäle konfiguriert.</div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Kanal löschen"
        message="Soll dieser Benachrichtigungskanal wirklich gelöscht werden?"
        confirmLabel="Löschen"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
