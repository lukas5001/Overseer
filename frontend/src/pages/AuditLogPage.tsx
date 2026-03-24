import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ScrollText, Trash2, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import { formatDateTime } from '../lib/format'
import ConfirmDialog from '../components/ConfirmDialog'

// ── Types ───────────────────────────────────────────────────────────────────────

interface AuditEntry {
  id: string
  tenant_id: string | null
  actor_email: string | null
  action: string
  target_type: string | null
  target_id: string | null
  detail: Record<string, unknown>
  created_at: string | null
}

interface DeadLetter {
  stream_id: string
  original_id: string | null
  error: string | null
  delivery_count: string | null
  failed_at: string | null
  data_preview: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

const ACTION_COLORS: Record<string, string> = {
  // Auth
  login: 'bg-blue-100 text-blue-700',
  login_failed: 'bg-red-100 text-red-700',
  // CRUD – create
  host_create: 'bg-emerald-100 text-emerald-700',
  service_create: 'bg-emerald-100 text-emerald-700',
  tenant_create: 'bg-emerald-100 text-emerald-700',
  user_create: 'bg-emerald-100 text-emerald-700',
  collector_create: 'bg-emerald-100 text-emerald-700',
  notification_channel_create: 'bg-emerald-100 text-emerald-700',
  downtime_create: 'bg-blue-100 text-blue-700',
  // CRUD – update
  host_update: 'bg-sky-100 text-sky-700',
  service_update: 'bg-sky-100 text-sky-700',
  tenant_update: 'bg-sky-100 text-sky-700',
  user_update: 'bg-sky-100 text-sky-700',
  notification_channel_update: 'bg-sky-100 text-sky-700',
  // CRUD – delete
  host_delete: 'bg-red-100 text-red-700',
  service_delete: 'bg-red-100 text-red-700',
  user_delete: 'bg-red-100 text-red-700',
  collector_delete: 'bg-red-100 text-red-700',
  notification_channel_delete: 'bg-red-100 text-red-700',
  downtime_delete: 'bg-red-100 text-red-700',
  // Security
  user_password_change: 'bg-orange-100 text-orange-700',
  '2fa_enable': 'bg-purple-100 text-purple-700',
  '2fa_disable': 'bg-purple-100 text-purple-700',
  // Status
  acknowledge: 'bg-amber-100 text-amber-700',
  unacknowledge: 'bg-gray-100 text-gray-600',
  bulk_acknowledge: 'bg-amber-100 text-amber-700',
  // Minor (shown when toggled on)
  preference_update: 'bg-gray-50 text-gray-400',
  saved_filter_create: 'bg-gray-50 text-gray-400',
  saved_filter_update: 'bg-gray-50 text-gray-400',
  saved_filter_delete: 'bg-gray-50 text-gray-400',
  saved_filter_set_default: 'bg-gray-50 text-gray-400',
}

function actionBadge(action: string) {
  const color = ACTION_COLORS[action] ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={clsx('inline-block px-2 py-0.5 rounded text-xs font-medium', color)}>
      {action}
    </span>
  )
}


// ── Audit Log Tab ───────────────────────────────────────────────────────────────

function AuditLogTab() {
  const PAGE_SIZE = 50
  const [offset, setOffset] = useState(0)
  const [filterAction, setFilterAction] = useState('')
  const [includeMinor, setIncludeMinor] = useState(false)

  const { data, isLoading } = useQuery<{ entries: AuditEntry[]; total: number }>({
    queryKey: ['audit-log', offset, filterAction, includeMinor],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      if (filterAction) params.set('action', filterAction)
      if (includeMinor) params.set('include_minor', 'true')
      const resp = await api.get(`/api/v1/audit/?${params}`)
      const total = parseInt(resp.headers['x-total-count'] ?? '0', 10)
      return { entries: resp.data, total }
    },
    refetchInterval: 30000,
  })

  const entries = data?.entries ?? []
  const total = data?.total ?? 0
  const page = Math.floor(offset / PAGE_SIZE) + 1
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-4">
        <input
          value={filterAction}
          onChange={(e) => { setFilterAction(e.target.value); setOffset(0) }}
          placeholder="Filter nach Aktion (z.B. host_create)"
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 w-64 focus:ring-2 focus:ring-overseer-500 outline-none"
        />
        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeMinor}
            onChange={(e) => { setIncludeMinor(e.target.checked); setOffset(0) }}
            className="w-3.5 h-3.5 rounded border-gray-300 text-overseer-600 focus:ring-overseer-500"
          />
          Nebenaktionen
        </label>
        <span className="text-xs text-gray-400">{total} Eintr&auml;ge</span>
      </div>

      {isLoading && <div className="text-gray-400 text-sm">Lade...</div>}

      {!isLoading && entries.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
          <ScrollText className="w-10 h-10" />
          <p className="text-sm">Keine Audit-Eintr&auml;ge</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-3 py-2">Zeitpunkt</th>
                <th className="px-3 py-2">Akteur</th>
                <th className="px-3 py-2">Aktion</th>
                <th className="px-3 py-2">Zieltyp</th>
                <th className="px-3 py-2">Ziel-ID</th>
                <th className="px-3 py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{formatDateTime(e.created_at)}</td>
                  <td className="px-3 py-2.5 text-gray-700">{e.actor_email ?? '–'}</td>
                  <td className="px-3 py-2.5">{actionBadge(e.action)}</td>
                  <td className="px-3 py-2.5 text-gray-500">{e.target_type ?? '–'}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-gray-400 max-w-[12rem] truncate" title={e.target_id ?? ''}>
                    {e.target_id ?? '–'}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-gray-400 max-w-[16rem] truncate" title={JSON.stringify(e.detail)}>
                    {Object.keys(e.detail).length > 0 ? JSON.stringify(e.detail) : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
          >
            <ChevronLeft className="w-4 h-4" /> Zur&uuml;ck
          </button>
          <span className="text-xs text-gray-500">Seite {page} von {totalPages}</span>
          <button
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={page >= totalPages}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
          >
            Weiter <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Dead Letters Tab ────────────────────────────────────────────────────────────

function DeadLettersTab() {
  const queryClient = useQueryClient()
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const { data: letters = [], isLoading } = useQuery<DeadLetter[]>({
    queryKey: ['dead-letters'],
    queryFn: () => api.get('/api/v1/audit/dead-letters?count=100').then((r) => r.data),
    refetchInterval: 15000,
  })

  const deleteMutation = useMutation({
    mutationFn: (streamId: string) => api.delete(`/api/v1/audit/dead-letters/${encodeURIComponent(streamId)}`),
    onSuccess: () => { setDeleteTarget(null); queryClient.invalidateQueries({ queryKey: ['dead-letters'] }) },
  })

  return (
    <div>
      {isLoading && <div className="text-gray-400 text-sm">Lade...</div>}

      {!isLoading && letters.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
          <AlertTriangle className="w-10 h-10" />
          <p className="text-sm">Keine Dead Letters</p>
        </div>
      )}

      {letters.length > 0 && (
        <div className="space-y-3">
          {letters.map((dl) => (
            <div key={dl.stream_id} className="bg-white rounded-xl border border-red-200 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-block px-2 py-0.5 rounded bg-red-100 text-red-700 text-xs font-medium">
                      Dead Letter
                    </span>
                    <span className="text-xs text-gray-400 font-mono">{dl.stream_id}</span>
                    {dl.delivery_count && (
                      <span className="text-xs text-gray-400">
                        {dl.delivery_count}x versucht
                      </span>
                    )}
                  </div>

                  {dl.error && (
                    <p className="text-sm text-red-600 font-mono leading-snug break-all">{dl.error}</p>
                  )}

                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    {dl.original_id && <span>Original: <span className="font-mono">{dl.original_id}</span></span>}
                    {dl.failed_at && <span>Fehlgeschlagen: {formatDateTime(dl.failed_at)}</span>}
                  </div>

                  {dl.data_preview && (
                    <pre className="text-xs text-gray-400 bg-gray-50 rounded-lg p-2 mt-1 overflow-x-auto max-w-full">
                      {dl.data_preview}
                    </pre>
                  )}
                </div>

                <button
                  onClick={() => setDeleteTarget(dl.stream_id)}
                  disabled={deleteMutation.isPending}
                  title="Entfernen"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Entfernen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Dead Letter entfernen"
        message="Diese Dead Letter wirklich entfernen?"
        confirmLabel="Entfernen"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

// ── Main Page ───────────────────────────────────────────────────────────────────

type TabMode = 'audit' | 'dead-letters'

export default function AuditLogPage() {
  const [tab, setTab] = useState<TabMode>('audit')

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <ScrollText className="w-7 h-7 text-overseer-600" />
        <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-lg w-fit">
        {([
          { key: 'audit' as TabMode, label: 'Audit Log' },
          { key: 'dead-letters' as TabMode, label: 'Dead Letters' },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
              tab === t.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'audit' ? <AuditLogTab /> : <DeadLettersTab />}
    </div>
  )
}
