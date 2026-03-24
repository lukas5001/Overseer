import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Mail, Webhook, Plus, X, Trash2, TestTube2, Check, AlertCircle } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import type { NotificationChannel, ChannelCreate, ChannelType, Tenant } from '../types'

// ── New Channel Modal ────────────────────────────────────────────────────────

function ChannelModal({ onClose, tenants }: { onClose: () => void; tenants: Tenant[] }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? '')
  const [channelType, setChannelType] = useState<ChannelType>('email')
  const [error, setError] = useState<string | null>(null)

  // Email fields
  const [emailTo, setEmailTo] = useState('')
  const [emailSubjectPrefix, setEmailSubjectPrefix] = useState('[Overseer]')

  // Webhook fields
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookMethod, setWebhookMethod] = useState('POST')
  const [webhookHeaders, setWebhookHeaders] = useState<{ key: string; value: string }[]>([])
  const [webhookBody, setWebhookBody] = useState('')

  const mutation = useMutation({
    mutationFn: () => {
      const config: Record<string, unknown> = channelType === 'email'
        ? { to: emailTo, subject_prefix: emailSubjectPrefix }
        : {
            url: webhookUrl,
            method: webhookMethod,
            headers: Object.fromEntries(webhookHeaders.filter(h => h.key).map(h => [h.key, h.value])),
            body_template: webhookBody || undefined,
          }
      const body: ChannelCreate = { tenant_id: tenantId, name, channel_type: channelType, config }
      return api.post('/api/v1/notifications/', body).then(r => r.data)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notification-channels'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Neuer Benachrichtigungskanal</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="z.B. Ops-Team Email"
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

          {/* Type */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Typ</label>
            <div className="flex gap-3">
              <button onClick={() => setChannelType('email')}
                className={clsx('flex-1 py-2 rounded-lg text-sm font-medium border transition-colors inline-flex items-center justify-center gap-2',
                  channelType === 'email' ? 'border-overseer-600 bg-overseer-50 text-overseer-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50')}>
                <Mail className="w-4 h-4" /> Email
              </button>
              <button onClick={() => setChannelType('webhook')}
                className={clsx('flex-1 py-2 rounded-lg text-sm font-medium border transition-colors inline-flex items-center justify-center gap-2',
                  channelType === 'webhook' ? 'border-overseer-600 bg-overseer-50 text-overseer-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50')}>
                <Webhook className="w-4 h-4" /> Webhook
              </button>
            </div>
          </div>

          {/* Email config */}
          {channelType === 'email' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Empfänger *</label>
                <input type="email" value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="ops@example.com"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Betreff-Präfix</label>
                <input type="text" value={emailSubjectPrefix} onChange={e => setEmailSubjectPrefix(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
              </div>
            </>
          )}

          {/* Webhook config */}
          {channelType === 'webhook' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">URL *</label>
                <input type="url" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} placeholder="https://hooks.slack.com/..."
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">HTTP-Methode</label>
                <select value={webhookMethod} onChange={e => setWebhookMethod(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500">
                  <option value="POST">POST</option>
                  <option value="GET">GET</option>
                  <option value="PUT">PUT</option>
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-600">Headers</label>
                  <button onClick={() => setWebhookHeaders(prev => [...prev, { key: '', value: '' }])}
                    className="text-xs text-overseer-600 hover:text-overseer-700 font-medium">+ Zeile</button>
                </div>
                {webhookHeaders.map((h, i) => (
                  <div key={i} className="flex gap-2 mb-1">
                    <input type="text" value={h.key} onChange={e => {
                      const next = [...webhookHeaders]; next[i] = { ...next[i], key: e.target.value }; setWebhookHeaders(next)
                    }} placeholder="Key" className="flex-1 text-sm border border-gray-300 rounded px-2 py-1 outline-none" />
                    <input type="text" value={h.value} onChange={e => {
                      const next = [...webhookHeaders]; next[i] = { ...next[i], value: e.target.value }; setWebhookHeaders(next)
                    }} placeholder="Value" className="flex-1 text-sm border border-gray-300 rounded px-2 py-1 outline-none" />
                    <button onClick={() => setWebhookHeaders(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-gray-400 hover:text-red-500"><X className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Body-Template (optional)</label>
                <textarea value={webhookBody} onChange={e => setWebhookBody(e.target.value)} rows={3}
                  placeholder='{"text": "Alert: {{service_name}} on {{host_name}}"}'
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500 resize-none font-mono text-xs" />
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Abbrechen</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-60">
            {mutation.isPending ? 'Erstellen…' : 'Kanal erstellen'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function NotificationChannelsPage() {
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean } | null>(null)

  const { data: channels = [], isLoading } = useQuery<NotificationChannel[]>({
    queryKey: ['notification-channels'],
    queryFn: () => api.get('/api/v1/notifications/').then(r => r.data),
  })

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['tenants'],
    queryFn: () => api.get('/api/v1/tenants/').then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/notifications/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-channels'] }),
  })

  const testMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/notifications/${id}/test`),
    onSuccess: (_, id) => setTestResult({ id, ok: true }),
    onError: (_, id) => setTestResult({ id, ok: false }),
  })

  const tenantNames: Record<string, string> = {}
  tenants.forEach(t => { tenantNames[t.id] = t.name })

  return (
    <div className="p-8">
      {showModal && <ChannelModal onClose={() => setShowModal(false)} tenants={tenants} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Mail className="w-7 h-7 text-overseer-600" />
          <h1 className="text-2xl font-bold text-gray-900">Benachrichtigungskanäle</h1>
          <span className="text-sm text-gray-500 ml-2">{channels.length} Kanäle</span>
        </div>
        <button onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700">
          <Plus className="w-4 h-4" /> Neuer Kanal
        </button>
      </div>

      {isLoading && <div className="text-gray-400 text-sm">Lade…</div>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-6 py-3 text-left">Name</th>
              <th className="px-6 py-3 text-left">Typ</th>
              <th className="px-6 py-3 text-left">Konfiguration</th>
              <th className="px-6 py-3 text-left">Tenant</th>
              <th className="px-6 py-3 text-center">Status</th>
              <th className="px-6 py-3 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {channels.map(ch => (
              <tr key={ch.id} className="hover:bg-gray-50">
                <td className="px-6 py-3 font-medium text-gray-900">{ch.name}</td>
                <td className="px-6 py-3">
                  <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                    {ch.channel_type === 'email' ? <Mail className="w-3.5 h-3.5" /> : <Webhook className="w-3.5 h-3.5" />}
                    {ch.channel_type}
                  </span>
                </td>
                <td className="px-6 py-3 text-xs text-gray-500 max-w-xs truncate">
                  {ch.channel_type === 'email'
                    ? (ch.config as any).to
                    : (ch.config as any).url}
                </td>
                <td className="px-6 py-3 text-xs text-gray-500">{tenantNames[ch.tenant_id] ?? '–'}</td>
                <td className="px-6 py-3 text-center">
                  <span className={clsx('px-2 py-0.5 rounded text-xs font-medium',
                    ch.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500')}>
                    {ch.active ? 'Aktiv' : 'Inaktiv'}
                  </span>
                </td>
                <td className="px-6 py-3 text-right">
                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => testMutation.mutate(ch.id)} title="Test senden"
                      className="inline-flex items-center gap-1 text-xs text-overseer-600 hover:text-overseer-700 font-medium">
                      {testResult?.id === ch.id
                        ? testResult.ok
                          ? <Check className="w-3.5 h-3.5 text-emerald-600" />
                          : <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                        : <TestTube2 className="w-3.5 h-3.5" />}
                      Test
                    </button>
                    <button onClick={() => { if (confirm('Kanal löschen?')) deleteMutation.mutate(ch.id) }}
                      title="Löschen" className="text-gray-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {channels.length === 0 && !isLoading && (
          <div className="p-8 text-center text-gray-400 text-sm">Keine Kanäle konfiguriert.</div>
        )}
      </div>
    </div>
  )
}
