import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import {
  AlertTriangle, CheckCheck, Clock, Server, Router, Printer, Shield, Wifi,
  BellOff, X, Search, Filter, ChevronDown,
} from 'lucide-react'
import clsx from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'
import { api } from '../api/client'
import type { ErrorOverviewItem, TenantStatusSummary } from '../types'

const statusConfig = {
  CRITICAL: { label: 'CRITICAL', bg: 'bg-red-100',    text: 'text-red-800',    border: 'border-red-300' },
  WARNING:  { label: 'WARNING',  bg: 'bg-amber-100',  text: 'text-amber-800',  border: 'border-amber-300' },
  UNKNOWN:  { label: 'UNKNOWN',  bg: 'bg-gray-100',   text: 'text-gray-700',   border: 'border-gray-300' },
  OK:       { label: 'OK',       bg: 'bg-green-100',  text: 'text-green-800',  border: 'border-green-300' },
}

const hostTypeIcons: Record<string, React.ElementType> = {
  server: Server, switch: Router, router: Router,
  printer: Printer, firewall: Shield, access_point: Wifi,
}

// ── Downtime Modal ────────────────────────────────────────────────────────────

interface DowntimeModalProps {
  error: ErrorOverviewItem
  onClose: () => void
  onSaved: () => void
}

function DowntimeModal({ error, onClose, onSaved }: DowntimeModalProps) {
  const now = new Date()
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000)
  const pad = (d: Date) => d.toISOString().slice(0, 16)

  const [startAt, setStartAt] = useState(pad(now))
  const [endAt, setEndAt] = useState(pad(inOneHour))
  const [comment, setComment] = useState('')
  const [error_, setError_] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.post('/api/v1/downtimes/', {
      service_id: error.service_id,
      start_at: new Date(startAt).toISOString(),
      end_at: new Date(endAt).toISOString(),
      comment,
    }),
    onSuccess: () => { onSaved(); onClose() },
    onError: (e: any) => setError_(e.response?.data?.detail ?? 'Fehler beim Speichern'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <BellOff className="w-5 h-5 text-overseer-600" />
            <h2 className="text-lg font-semibold text-gray-900">Downtime eintragen</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="bg-gray-50 rounded-lg px-4 py-3 mb-5 text-sm">
          <p className="font-medium text-gray-800">{error.host_display_name || error.host_hostname}</p>
          <p className="text-gray-500">{error.service_name} · {error.tenant_name}</p>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Von</label>
              <input type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Bis</label>
              <input type="datetime-local" value={endAt} onChange={e => setEndAt(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Kommentar</label>
            <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
              placeholder="z.B. Geplante Wartung – Switch-Update"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none resize-none" />
          </div>
          {error_ && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error_}</p>
          )}
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            Abbrechen
          </button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-60">
            {mutation.isPending ? 'Speichern…' : 'Downtime speichern'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Status Summary Bar ───────────────────────────────────────────────────────

function StatusSummaryBar({ errors }: { errors: ErrorOverviewItem[] }) {
  const criticalCount = errors.filter(e => e.status === 'CRITICAL').length
  const warningCount = errors.filter(e => e.status === 'WARNING').length
  const unknownCount = errors.filter(e => e.status === 'UNKNOWN').length

  const cards = [
    { key: 'CRITICAL', count: criticalCount, bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: 'bg-red-500' },
    { key: 'WARNING', count: warningCount, bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', icon: 'bg-amber-500' },
    { key: 'UNKNOWN', count: unknownCount, bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-600', icon: 'bg-gray-400' },
  ]

  return (
    <div className="grid grid-cols-3 gap-4 mb-6">
      {cards.map(c => (
        <div key={c.key} className={clsx('rounded-xl p-4 border', c.bg, c.border)}>
          <p className="text-xs font-medium text-gray-500 uppercase">{c.key}</p>
          <p className={clsx('text-3xl font-bold mt-1', c.text)}>{c.count}</p>
        </div>
      ))}
    </div>
  )
}

// ── Filter Bar ───────────────────────────────────────────────────────────────

function FilterBar({
  searchParams,
  setSearchParams,
  tenants,
}: {
  searchParams: URLSearchParams
  setSearchParams: (fn: (prev: URLSearchParams) => URLSearchParams) => void
  tenants: TenantStatusSummary[]
}) {
  const statusFilters = searchParams.get('statuses')?.split(',').filter(Boolean) ?? []
  const tenantFilter = searchParams.get('tenant_id') ?? ''
  const search = searchParams.get('q') ?? ''

  const toggleStatus = (status: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      const current = next.get('statuses')?.split(',').filter(Boolean) ?? []
      const updated = current.includes(status)
        ? current.filter(s => s !== status)
        : [...current, status]
      if (updated.length > 0) next.set('statuses', updated.join(','))
      else next.delete('statuses')
      return next
    })
  }

  const setTenant = (id: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (id) next.set('tenant_id', id)
      else next.delete('tenant_id')
      return next
    })
  }

  const setSearch = (q: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (q) next.set('q', q)
      else next.delete('q')
      return next
    })
  }

  return (
    <div className="flex items-center gap-3 mb-4 flex-wrap">
      {/* Status toggle buttons */}
      <div className="flex items-center gap-1">
        <Filter className="w-4 h-4 text-gray-400 mr-1" />
        {(['CRITICAL', 'WARNING', 'UNKNOWN'] as const).map(s => {
          const active = statusFilters.length === 0 || statusFilters.includes(s)
          const cfg = statusConfig[s]
          return (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              className={clsx(
                'px-2.5 py-1 rounded text-xs font-semibold transition-all',
                active ? [cfg.bg, cfg.text] : 'bg-gray-100 text-gray-400',
              )}
            >
              {s}
            </button>
          )
        })}
      </div>

      {/* Tenant dropdown */}
      <div className="relative">
        <select
          value={tenantFilter}
          onChange={e => setTenant(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg pl-3 pr-8 py-1.5 bg-white appearance-none focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none"
        >
          <option value="">Alle Kunden</option>
          {tenants.map(t => (
            <option key={t.tenant_id} value={t.tenant_id}>{t.tenant_name}</option>
          ))}
        </select>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>

      {/* Text search */}
      <div className="relative flex-1 max-w-xs">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Host oder Service suchen…"
          className="w-full text-sm border border-gray-300 rounded-lg pl-9 pr-3 py-1.5 focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none"
        />
      </div>
    </div>
  )
}

// ── Bulk Action Bar ──────────────────────────────────────────────────────────

function BulkActionBar({
  count,
  onAcknowledge,
  onCancel,
  isPending,
}: {
  count: number
  onAcknowledge: () => void
  onCancel: () => void
  isPending: boolean
}) {
  if (count === 0) return null
  return (
    <div className="flex items-center gap-4 mb-4 px-4 py-3 bg-overseer-50 border border-overseer-200 rounded-lg">
      <span className="text-sm font-medium text-overseer-800">{count} ausgewählt</span>
      <button
        onClick={onAcknowledge}
        disabled={isPending}
        className="text-sm px-4 py-1.5 rounded-lg bg-overseer-600 text-white font-medium hover:bg-overseer-700 disabled:opacity-60"
      >
        {isPending ? 'Acknowledge…' : 'Acknowledge'}
      </button>
      <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700">
        Abbrechen
      </button>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ErrorOverviewPage() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [downtimeTarget, setDowntimeTarget] = useState<ErrorOverviewItem | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Fetch data
  const { data: errors = [], isLoading } = useQuery<ErrorOverviewItem[]>({
    queryKey: ['error-overview'],
    queryFn: () => api.get('/api/v1/status/errors').then(r => r.data),
    refetchInterval: 15_000,
  })

  const { data: tenants = [] } = useQuery<TenantStatusSummary[]>({
    queryKey: ['status-by-tenant'],
    queryFn: () => api.get('/api/v1/status/summary/by-tenant').then(r => r.data),
    refetchInterval: 30_000,
  })

  // Mutations
  const ackMutation = useMutation({
    mutationFn: (serviceId: string) => api.post(`/api/v1/status/acknowledge/${serviceId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['error-overview'] }),
  })
  const unackMutation = useMutation({
    mutationFn: (serviceId: string) => api.delete(`/api/v1/status/acknowledge/${serviceId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['error-overview'] }),
  })
  const bulkAckMutation = useMutation({
    mutationFn: (serviceIds: string[]) =>
      api.post('/api/v1/status/bulk-acknowledge', { service_ids: serviceIds, comment: 'Bulk-ACK' }),
    onSuccess: () => {
      setSelected(new Set())
      queryClient.invalidateQueries({ queryKey: ['error-overview'] })
    },
  })

  // Filtering
  const statusFilters = searchParams.get('statuses')?.split(',').filter(Boolean) ?? []
  const tenantFilter = searchParams.get('tenant_id') ?? ''
  const searchQuery = (searchParams.get('q') ?? '').toLowerCase()

  const filtered = useMemo(() => {
    return errors.filter(e => {
      if (statusFilters.length > 0 && !statusFilters.includes(e.status)) return false
      if (tenantFilter && e.tenant_id !== tenantFilter) return false
      if (searchQuery) {
        const hay = `${e.host_hostname} ${e.host_display_name ?? ''} ${e.service_name} ${e.tenant_name}`.toLowerCase()
        if (!hay.includes(searchQuery)) return false
      }
      return true
    })
  }, [errors, statusFilters, tenantFilter, searchQuery])

  // Selection
  const allSelected = filtered.length > 0 && filtered.every(e => selected.has(e.service_id))
  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(filtered.map(e => e.service_id)))
  }
  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const criticalCount = errors.filter(e => e.status === 'CRITICAL').length
  const warningCount = errors.filter(e => e.status === 'WARNING').length
  const unknownCount = errors.filter(e => e.status === 'UNKNOWN').length

  return (
    <div className="p-8">
      {/* Modal */}
      {downtimeTarget && (
        <DowntimeModal
          error={downtimeTarget}
          onClose={() => setDowntimeTarget(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['error-overview'] })}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-7 h-7 text-red-500" />
          <h1 className="text-2xl font-bold text-gray-900">Fehlerübersicht</h1>
          <span className="text-sm text-gray-500 ml-2">
            {errors.length} {errors.length === 1 ? 'Problem' : 'Probleme'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">
            {criticalCount} Critical
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
            {warningCount} Warning
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
            {unknownCount} Unknown
          </span>
        </div>
      </div>

      {/* Status Summary */}
      <StatusSummaryBar errors={errors} />

      {/* Filter Bar */}
      <FilterBar searchParams={searchParams} setSearchParams={setSearchParams} tenants={tenants} />

      {/* Bulk Action Bar */}
      <BulkActionBar
        count={selected.size}
        onAcknowledge={() => bulkAckMutation.mutate(Array.from(selected))}
        onCancel={() => setSelected(new Set())}
        isPending={bulkAckMutation.isPending}
      />

      {/* No errors */}
      {!isLoading && errors.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
            <CheckCheck className="w-8 h-8 text-emerald-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900">Alles in Ordnung</h2>
          <p className="text-gray-500 mt-1">Keine aktuellen Probleme.</p>
        </div>
      )}

      {/* Error table */}
      {filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Host</th>
                <th className="px-4 py-3 text-left">Service</th>
                <th className="px-4 py-3 text-right">Wert</th>
                <th className="px-4 py-3 text-right">Dauer</th>
                <th className="px-4 py-3 text-left">Kunde</th>
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(error => {
                const config = statusConfig[error.status]
                const HostIcon = hostTypeIcons[error.host_type] ?? Server
                const isAcking = ackMutation.isPending && ackMutation.variables === error.service_id
                const isUnacking = unackMutation.isPending && unackMutation.variables === error.service_id
                const isSelected = selected.has(error.service_id)

                return (
                  <tr
                    key={error.service_id}
                    className={clsx(
                      'hover:bg-gray-50 transition-colors',
                      error.status === 'CRITICAL' && !error.acknowledged && 'animate-pulse-critical',
                      error.acknowledged && 'opacity-70',
                    )}
                  >
                    {/* Checkbox */}
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(error.service_id)}
                        className="rounded border-gray-300"
                      />
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={clsx('px-2.5 py-1 rounded text-xs font-bold uppercase whitespace-nowrap', config.bg, config.text)}>
                        {config.label}
                      </span>
                    </td>

                    {/* Host */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <HostIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <Link to={`/hosts/${error.host_id}`}
                          className="text-sm font-semibold text-gray-900 hover:text-overseer-600 hover:underline">
                          {error.host_display_name || error.host_hostname}
                        </Link>
                      </div>
                    </td>

                    {/* Service */}
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-800">{error.service_name}</p>
                      <p className="text-xs text-gray-500 truncate max-w-xs">{error.status_message}</p>
                    </td>

                    {/* Value */}
                    <td className="px-4 py-3 text-right">
                      {error.value !== null && (
                        <span className={clsx('text-sm font-bold', config.text)}>
                          {error.value}{error.unit}
                        </span>
                      )}
                    </td>

                    {/* Duration */}
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                        <Clock className="w-3.5 h-3.5" />
                        {error.last_state_change_at
                          ? formatDistanceToNow(new Date(error.last_state_change_at), { locale: de, addSuffix: true })
                          : '–'}
                      </span>
                    </td>

                    {/* Tenant */}
                    <td className="px-4 py-3 text-xs text-gray-500">{error.tenant_name}</td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => setDowntimeTarget(error)} title="Downtime"
                          className="text-gray-300 hover:text-overseer-500 transition-colors">
                          <BellOff className="w-4 h-4" />
                        </button>
                        {error.acknowledged ? (
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700 font-medium">
                              <CheckCheck className="w-3 h-3" /> ACK
                            </span>
                            <button onClick={() => unackMutation.mutate(error.service_id)}
                              disabled={isUnacking}
                              className="text-xs text-gray-400 hover:text-gray-600 underline disabled:opacity-50">
                              {isUnacking ? '…' : 'aufheben'}
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => ackMutation.mutate(error.service_id)}
                            disabled={isAcking}
                            className="text-xs px-3 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50 whitespace-nowrap">
                            {isAcking ? '…' : 'ACK'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Filtered empty */}
      {!isLoading && errors.length > 0 && filtered.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">
          Keine Treffer für die aktuelle Filterung.
        </div>
      )}
    </div>
  )
}
