import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Plus, X, Trash2, Send, Webhook } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import ConfirmDialog from '../components/ConfirmDialog'

interface Channel {
  id: string
  tenant_id: string
  name: string
  channel_type: string
  config: Record<string, unknown>
  events: string[]
  active: boolean
  created_at: string | null
}

interface Tenant {
  id: string
  name: string
}

// ── Add/Edit Modal ──────────────────────────────────────────────────────────

interface ChannelModalProps {
  tenants: Tenant[]
  channel?: Channel
  onClose: () => void
  onSaved: () => void
}

function ChannelModal({ tenants, channel, onClose, onSaved }: ChannelModalProps) {
  const [name, setName] = useState(channel?.name ?? '')
  const [tenantId, setTenantId] = useState(channel?.tenant_id ?? (tenants[0]?.id ?? ''))
  const [url, setUrl] = useState((channel?.config?.url as string) ?? '')
  const [secret, setSecret] = useState((channel?.config?.headers as any)?.['X-Webhook-Secret'] ?? '')
  const [events, setEvents] = useState<string[]>(channel?.events ?? ['state_change'])
  const [error, setError] = useState<string | null>(null)

  const isEdit = !!channel

  const mutation = useMutation({
    mutationFn: () => {
      const config: Record<string, unknown> = { url }
      if (secret) {
        config.headers = { 'X-Webhook-Secret': secret }
      }
      if (isEdit) {
        return api.patch(`/api/v1/notifications/${channel.id}`, { name, config, events })
      }
      return api.post('/api/v1/notifications/', {
        tenant_id: tenantId, name, channel_type: 'webhook', config, events,
      })
    },
    onSuccess: () => { onSaved(); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler'),
  })

  const toggleEvent = (ev: string) => {
    setEvents(prev => prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEdit ? 'Webhook bearbeiten' : 'Webhook hinzufügen'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          {!isEdit && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tenant *</label>
              <select value={tenantId} onChange={e => setTenantId(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none">
                {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="z.B. Teams-Webhook"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">URL *</label>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://hooks.example.com/..."
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none font-mono text-xs" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Secret (optional)</label>
            <input value={secret} onChange={e => setSecret(e.target.value)} placeholder="wird als X-Webhook-Secret Header gesendet"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Events</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {['state_change', 'recovery'].map(ev => (
                <label key={ev} className="inline-flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={events.includes(ev)} onChange={() => toggleEvent(ev)}
                    className="w-4 h-4 rounded border-gray-300 text-overseer-600 focus:ring-overseer-500" />
                  {ev === 'state_change' ? 'Statuswechsel (HARD)' : 'Recovery (zurück zu OK)'}
                </label>
              ))}
            </div>
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Abbrechen</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name || !url}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50">
            {mutation.isPending ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [editTarget, setEditTarget] = useState<Channel | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const { data: channels = [], isLoading } = useQuery<Channel[]>({
    queryKey: ['notification-channels'],
    queryFn: () => api.get('/api/v1/notifications/').then(r => r.data),
  })

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['tenants-list'],
    queryFn: () => api.get('/api/v1/tenants/').then(r => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/notifications/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['notification-channels'] }); setDeleteTarget(null) },
  })

  const testMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/notifications/${id}/test`),
  })

  const tenantNames: Record<string, string> = {}
  tenants.forEach(t => { tenantNames[t.id] = t.name })

  const activeChannels = channels.filter(c => c.active)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notification-channels'] })

  return (
    <div className="p-8 max-w-4xl">
      {showAdd && (
        <ChannelModal tenants={tenants} onClose={() => setShowAdd(false)} onSaved={invalidate} />
      )}
      {editTarget && (
        <ChannelModal tenants={tenants} channel={editTarget} onClose={() => setEditTarget(null)} onSaved={invalidate} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bell className="w-7 h-7 text-overseer-600" />
          <h1 className="text-2xl font-bold text-gray-900">Benachrichtigungen</h1>
          <span className="text-sm text-gray-500">{activeChannels.length} aktiv</span>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700"
        >
          <Plus className="w-4 h-4" /> Webhook hinzufügen
        </button>
      </div>

      <p className="text-sm text-gray-500 mb-6">
        Webhooks werden bei Statuswechseln (SOFT → HARD) und Recoveries (zurück zu OK) ausgelöst.
        Jeder Webhook erhält einen JSON-Payload mit Event-Details.
      </p>

      {isLoading ? (
        <p className="text-center text-gray-400 py-12">Lade…</p>
      ) : activeChannels.length === 0 ? (
        <div className="text-center py-16">
          <Webhook className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">Noch keine Webhooks konfiguriert.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeChannels.map(ch => (
            <div key={ch.id} className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-overseer-50 flex items-center justify-center flex-shrink-0">
                <Webhook className="w-5 h-5 text-overseer-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-800 text-sm">{ch.name}</p>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                    {tenantNames[ch.tenant_id] ?? '–'}
                  </span>
                </div>
                <p className="text-xs text-gray-400 font-mono truncate mt-0.5">
                  {(ch.config.url as string) ?? '–'}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  {ch.events.map(ev => (
                    <span key={ev} className="text-xs bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded">
                      {ev}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => testMutation.mutate(ch.id)}
                  disabled={testMutation.isPending}
                  className={clsx(
                    'text-xs px-3 py-1.5 rounded border transition-colors font-medium flex items-center gap-1',
                    testMutation.isSuccess && testMutation.variables === ch.id
                      ? 'border-emerald-300 text-emerald-600 bg-emerald-50'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50',
                  )}
                >
                  <Send className="w-3 h-3" />
                  {testMutation.isPending && testMutation.variables === ch.id ? '…' : 'Test'}
                </button>
                <button
                  onClick={() => setEditTarget(ch)}
                  className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium"
                >
                  Bearbeiten
                </button>
                <button
                  onClick={() => setDeleteTarget(ch.id)}
                  className="text-gray-300 hover:text-red-500 transition-colors"
                  title="Löschen"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Payload example */}
      <div className="mt-8 bg-gray-50 rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 text-sm mb-3">Webhook-Payload Beispiel</h3>
        <pre className="text-xs text-gray-600 font-mono bg-white rounded-lg p-4 overflow-x-auto border border-gray-100">{`{
  "event": "state_change",
  "tenant": "beispiel-corp",
  "host": "srv-web-01",
  "service": "disk_root",
  "status": "CRITICAL",
  "previous_status": "WARNING",
  "state_type": "HARD",
  "message": "DISK CRITICAL - / 96.2% used",
  "value": 96.2,
  "unit": "%",
  "timestamp": "2026-03-21T14:30:00+00:00"
}`}</pre>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Webhook löschen"
        message="Soll dieser Webhook wirklich gelöscht werden?"
        confirmLabel="Löschen"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
