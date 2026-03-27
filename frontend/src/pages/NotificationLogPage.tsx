import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ScrollText, ChevronDown, ChevronRight, Check, X as XIcon,
  Mail, Webhook, Hash, Users, Send, Bell, ChevronLeft,
} from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import type { NotificationLogEntry, NotificationChannel } from '../types'

const PAGE_SIZE = 50

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

function formatDateTime(iso: string | null): string {
  if (!iso) return '–'
  const d = new Date(iso)
  return d.toLocaleString('de-DE', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

const TYPE_LABELS: Record<string, string> = {
  alert: 'Alert',
  recovery: 'Recovery',
  test: 'Test',
  ssl_certificate: 'SSL',
}

export default function NotificationLogPage() {
  const [channelFilter, setChannelFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [page, setPage] = useState(0)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  const params: Record<string, unknown> = {
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }
  if (channelFilter) params.channel_id = channelFilter
  if (statusFilter === 'success') params.success = true
  if (statusFilter === 'error') params.success = false

  const { data: logs = [], isLoading } = useQuery<NotificationLogEntry[]>({
    queryKey: ['notification-log', params],
    queryFn: () => api.get('/api/v1/notifications/log', { params }).then(r => r.data),
    refetchInterval: false,
  })

  const { data: channels = [] } = useQuery<NotificationChannel[]>({
    queryKey: ['notification-channels'],
    queryFn: () => api.get('/api/v1/notifications/').then(r => r.data),
  })

  const channelNames: Record<string, string> = {}
  channels.forEach(ch => { channelNames[ch.id] = ch.name })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <ScrollText className="w-7 h-7 text-overseer-600" />
        <h1 className="text-2xl font-bold text-gray-900">Notification Log</h1>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <select value={channelFilter} onChange={e => { setChannelFilter(e.target.value); setPage(0) }}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500">
          <option value="">Alle Kanäle</option>
          {channels.map(ch => (
            <option key={ch.id} value={ch.id}>{ch.name} ({ch.channel_type})</option>
          ))}
        </select>

        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0) }}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500">
          <option value="">Alle Status</option>
          <option value="success">Nur erfolgreich</option>
          <option value="error">Nur Fehler</option>
        </select>
      </div>

      {isLoading && <div className="text-gray-400 text-sm">Lade…</div>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 text-left w-8"></th>
              <th className="px-4 py-3 text-left">Zeitpunkt</th>
              <th className="px-4 py-3 text-left">Kanal</th>
              <th className="px-4 py-3 text-left">Typ</th>
              <th className="px-4 py-3 text-left">Host / Service</th>
              <th className="px-4 py-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {logs.map(log => {
              const isExpanded = expandedRow === log.id
              const hasError = !log.success && log.error_message

              return (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    {hasError && (
                      <button onClick={() => setExpandedRow(isExpanded ? null : log.id)}
                        className="text-gray-400 hover:text-gray-600">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {formatDateTime(log.sent_at)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                      <ChannelTypeIcon type={log.channel_type} className="w-3.5 h-3.5" />
                      {log.channel_id ? channelNames[log.channel_id] ?? log.channel_type : log.channel_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx('px-1.5 py-0.5 rounded text-xs font-medium',
                      log.notification_type === 'alert' ? 'bg-red-100 text-red-700'
                        : log.notification_type === 'recovery' ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-100 text-gray-600')}>
                      {TYPE_LABELS[log.notification_type] ?? log.notification_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {log.host_name && log.service_name
                      ? `${log.host_name} / ${log.service_name}`
                      : log.host_name ?? log.service_name ?? '–'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {log.success ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                        <Check className="w-3.5 h-3.5" /> Gesendet
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-red-500">
                        <XIcon className="w-3.5 h-3.5" /> Fehler
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
            {/* Expanded error detail row */}
            {logs.map(log => {
              if (expandedRow !== log.id || !log.error_message) return null
              return (
                <tr key={`${log.id}-detail`} className="bg-red-50/50">
                  <td colSpan={6} className="px-12 py-2 text-xs text-red-700 font-mono">
                    {log.error_message}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {logs.length === 0 && !isLoading && (
          <div className="p-8 text-center text-gray-400 text-sm">Keine Log-Einträge gefunden.</div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
          className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-30">
          <ChevronLeft className="w-4 h-4" /> Zurück
        </button>
        <span className="text-xs text-gray-500">Seite {page + 1}</span>
        <button onClick={() => setPage(p => p + 1)} disabled={logs.length < PAGE_SIZE}
          className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-30">
          Weiter <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
