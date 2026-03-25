import { useState, useMemo, useEffect } from 'react'
import ConfirmDialog from '../components/ConfirmDialog'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCheck, Clock, Server, BellOff, X, Search, EyeOff, MessageSquare, ArrowUpDown, Filter, Save, Trash2, Edit2, Star, Tv } from 'lucide-react'
import { HOST_TYPE_ICONS } from '../lib/constants'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'
import { api } from '../api/client'

interface ErrorItem {
  service_id: string
  host_id: string
  tenant_id: string
  tenant_name: string
  host_hostname: string
  host_display_name: string | null
  host_type: string
  service_name: string
  check_type: string
  status: 'WARNING' | 'CRITICAL' | 'UNKNOWN' | 'OK'
  state_type: 'SOFT' | 'HARD'
  status_message: string | null
  value: number | null
  unit: string | null
  last_check_at: string | null
  last_state_change_at: string | null
  duration_seconds: number | null
  acknowledged: boolean
  acknowledged_by: string | null
  acknowledged_at: string | null
  acknowledge_comment: string | null
  in_downtime: boolean
}

interface SavedFilter {
  id: string
  name: string
  description: string | null
  filter_config: {
    hidden_tenants?: string[]
    statuses?: string[]
    status?: string | null  // legacy format
    search?: string
    show_acknowledged?: boolean
    show_downtime?: boolean
    only_ack?: boolean
    only_downtime?: boolean
    sort_key?: string
    sort_asc?: boolean
  }
}

type SortKey = 'status' | 'duration' | 'host' | 'service' | 'tenant' | 'last_check'

const statusConfig: Record<string, { label: string; bg: string; text: string; border: string; order: number }> = {
  CRITICAL: { label: 'CRITICAL', bg: 'bg-red-100',     text: 'text-red-800',     border: 'border-red-300',     order: 0 },
  WARNING:  { label: 'WARNING',  bg: 'bg-amber-100',   text: 'text-amber-800',   border: 'border-amber-300',   order: 1 },
  UNKNOWN:  { label: 'UNKNOWN',  bg: 'bg-gray-100',    text: 'text-gray-700',    border: 'border-gray-300',    order: 2 },
  OK:       { label: 'OK',       bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300', order: 3 },
}

const sortOptions: { key: SortKey; label: string }[] = [
  { key: 'status',     label: 'Status' },
  { key: 'duration',   label: 'Dauer' },
  { key: 'host',       label: 'Host' },
  { key: 'service',    label: 'Service' },
  { key: 'tenant',     label: 'Kunde' },
  { key: 'last_check', label: 'Letzter Check' },
]


// ── ACK Modal ─────────────────────────────────────────────────────────────────

interface AckModalProps {
  error: ErrorItem
  onClose: () => void
  onSaved: () => void
}

function AckModal({ error, onClose, onSaved }: AckModalProps) {
  const [comment, setComment] = useState('')
  const [error_, setError_] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.post(`/api/v1/status/acknowledge/${error.service_id}`, { comment }),
    onSuccess: () => { onSaved(); onClose() },
    onError: (e: any) => setError_(e.response?.data?.detail ?? 'Fehler'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <CheckCheck className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">Acknowledge</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-gray-50 rounded-lg px-4 py-3 mb-5 text-sm">
          <p className="font-medium text-gray-800">{error.host_display_name || error.host_hostname}</p>
          <p className="text-gray-500">{error.service_name} &middot; {error.tenant_name}</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Kommentar <span className="text-red-500">*</span>
            </label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              placeholder="Grund für Acknowledge..."
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
              autoFocus
            />
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
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !comment.trim()}
            className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
          >
            {mutation.isPending ? 'Speichern…' : 'Acknowledge'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Bulk ACK Modal ────────────────────────────────────────────────────────────

interface BulkAckModalProps {
  serviceIds: string[]
  onClose: () => void
  onSaved: () => void
}

function BulkAckModal({ serviceIds, onClose, onSaved }: BulkAckModalProps) {
  const [comment, setComment] = useState('')
  const [error_, setError_] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.post('/api/v1/status/bulk-acknowledge', { service_ids: serviceIds, comment }),
    onSuccess: () => { onSaved(); onClose() },
    onError: (e: any) => setError_(e.response?.data?.detail ?? 'Fehler'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <CheckCheck className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">Bulk Acknowledge ({serviceIds.length})</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="bg-gray-50 rounded-lg px-4 py-3 mb-5 text-sm text-gray-600">
          {serviceIds.length} ausgewählte Probleme acknowledgen.
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Kommentar <span className="text-red-500">*</span>
            </label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              placeholder="Grund für Acknowledge..."
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
              autoFocus
            />
          </div>
          {error_ && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error_}</p>}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Abbrechen</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !comment.trim()}
            className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
            {mutation.isPending ? 'Speichern…' : 'Acknowledge'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Downtime Modal ────────────────────────────────────────────────────────────

interface DowntimeModalProps {
  error: ErrorItem
  onClose: () => void
  onSaved: () => void
}

function toLocalDatetime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function DowntimeModal({ error, onClose, onSaved }: DowntimeModalProps) {
  const now = new Date()
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000)

  const [startAt, setStartAt] = useState(toLocalDatetime(now))
  const [endAt,   setEndAt]   = useState(toLocalDatetime(inOneHour))
  const [comment, setComment] = useState('')
  const [error_, setError_]   = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.post('/api/v1/downtimes/', {
      service_id: error.service_id,
      start_at: new Date(startAt).toISOString(),
      end_at:   new Date(endAt).toISOString(),
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
          <p className="text-gray-500">{error.service_name} &middot; {error.tenant_name}</p>
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
          {error_ && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error_}</p>}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Abbrechen</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-60">
            {mutation.isPending ? 'Speichern…' : 'Downtime speichern'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Bulk Downtime Modal ──────────────────────────────────────────────────────

interface BulkDowntimeModalProps {
  serviceIds: string[]
  onClose: () => void
  onSaved: () => void
}

function BulkDowntimeModal({ serviceIds, onClose, onSaved }: BulkDowntimeModalProps) {
  const now = new Date()
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000)

  const [startAt, setStartAt] = useState(toLocalDatetime(now))
  const [endAt,   setEndAt]   = useState(toLocalDatetime(inOneHour))
  const [comment, setComment] = useState('')
  const [error_, setError_]   = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.post('/api/v1/downtimes/bulk', {
      service_ids: serviceIds,
      start_at: new Date(startAt).toISOString(),
      end_at:   new Date(endAt).toISOString(),
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
            <h2 className="text-lg font-semibold text-gray-900">Bulk-Downtime ({serviceIds.length})</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="bg-gray-50 rounded-lg px-4 py-3 mb-5 text-sm text-gray-600">
          Downtime für {serviceIds.length} ausgewählte Services eintragen.
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Von</label>
              <input type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Bis</label>
              <input type="datetime-local" value={endAt} onChange={e => setEndAt(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Kommentar</label>
            <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
              placeholder="z.B. Geplante Wartung"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none resize-none" />
          </div>
          {error_ && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error_}</p>}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Abbrechen</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-60">
            {mutation.isPending ? 'Speichern…' : 'Downtime speichern'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Save Filter Modal ────────────────────────────────────────────────────────

interface SaveFilterModalProps {
  onClose: () => void
  onSaved: () => void
  hiddenTenants: Set<string>
  activeStatuses: Set<string>
  search: string
  showAcknowledged: boolean
  showDowntime: boolean
  onlyAck: boolean
  onlyDowntime: boolean
  sortKey: SortKey
  sortAsc: boolean
  editFilter?: SavedFilter | null
}

function SaveFilterModal({ onClose, onSaved, hiddenTenants, activeStatuses, search, showAcknowledged, showDowntime, onlyAck, onlyDowntime, sortKey, sortAsc, editFilter }: SaveFilterModalProps) {
  const [name, setName] = useState(editFilter?.name ?? '')
  const [description, setDescription] = useState(editFilter?.description ?? '')
  const [error_, setError_] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => {
      const config = {
        hidden_tenants: [...hiddenTenants],
        statuses: [...activeStatuses],
        search,
        show_acknowledged: showAcknowledged,
        show_downtime: showDowntime,
        only_ack: onlyAck,
        only_downtime: onlyDowntime,
        sort_key: sortKey,
        sort_asc: sortAsc,
      }
      if (editFilter) {
        return api.put(`/api/v1/saved-filters/${editFilter.id}`, { name, description: description || null, filter_config: config })
      }
      return api.post('/api/v1/saved-filters/', { name, description: description || null, filter_config: config })
    },
    onSuccess: () => { onSaved(); onClose() },
    onError: (e: any) => setError_(e.response?.data?.detail ?? 'Fehler'),
  })

  const allStatuses = ['CRITICAL', 'WARNING', 'UNKNOWN', 'OK']
  const defaultStatuses = new Set(['CRITICAL', 'WARNING', 'UNKNOWN'])
  const isDefault = activeStatuses.size === defaultStatuses.size && [...defaultStatuses].every(s => activeStatuses.has(s))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">{editFilter ? 'Filter bearbeiten' : 'Filter speichern'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="z.B. Nur kritische Kunden"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Beschreibung</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
          </div>

          <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500 space-y-1">
            <p className="font-medium text-gray-600">Aktuelle Filtereinstellungen:</p>
            {hiddenTenants.size > 0 && <p>{hiddenTenants.size} Kunde(n) ausgeblendet</p>}
            {!isDefault && <p>Status: {allStatuses.filter(s => activeStatuses.has(s)).join(', ')}</p>}
            {search && <p>Suche: "{search}"</p>}
            <p>ACK: {onlyAck ? 'nur ACK' : showAcknowledged ? 'sichtbar' : 'ausgeblendet'}</p>
            {(showDowntime || onlyDowntime) && <p>Downtimes: {onlyDowntime ? 'nur Downtimes' : 'sichtbar'}</p>}
            <p>Sortierung: {sortOptions.find(o => o.key === sortKey)?.label} {sortAsc ? '↑' : '↓'}</p>
          </div>

          {error_ && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error_}</p>}
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Abbrechen</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name.trim()}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-60">
            {mutation.isPending ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Tenant Toggle Panel ─────────────────────────────────────────────────────

interface TenantTogglePanelProps {
  tenants: { id: string; name: string }[]
  hiddenTenants: Set<string>
  onToggle: (tenantId: string) => void
  onClose: () => void
  errorCountByTenant: Record<string, number>
}

function TenantTogglePanel({ tenants, hiddenTenants, onToggle, onClose, errorCountByTenant }: TenantTogglePanelProps) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search) return tenants
    const q = search.toLowerCase()
    return tenants.filter(t => t.name.toLowerCase().includes(q))
  }, [tenants, search])

  return (
    <div className="absolute z-20 mt-1 right-0 w-80 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
      <div className="p-3 border-b border-gray-100 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">Kunden ein-/ausblenden</p>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
      </div>
      <div className="px-3 py-2 border-b border-gray-100">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Kunde suchen…"
          className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded focus:ring-1 focus:ring-overseer-500 outline-none" />
      </div>
      <div className="overflow-y-auto max-h-64 divide-y divide-gray-50">
        {filtered.map(t => {
          const count = errorCountByTenant[t.id] ?? 0
          const isHidden = hiddenTenants.has(t.id)
          return (
            <label key={t.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={!isHidden}
                onChange={() => onToggle(t.id)}
                className="w-4 h-4 rounded border-gray-300 text-overseer-600 focus:ring-overseer-500"
              />
              <span className={clsx('text-sm flex-1', isHidden ? 'text-gray-400 line-through' : 'text-gray-700')}>
                {t.name}
              </span>
              {count > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">{count}</span>
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}

// ── Sorting ──────────────────────────────────────────────────────────────────

function sortErrors(items: ErrorItem[], sortKey: SortKey, sortAsc: boolean): ErrorItem[] {
  const dir = sortAsc ? 1 : -1
  return [...items].sort((a, b) => {
    switch (sortKey) {
      case 'status':
        return (statusConfig[a.status].order - statusConfig[b.status].order) * dir
          || (a.duration_seconds ?? 0) - (b.duration_seconds ?? 0)
      case 'duration':
        return ((b.duration_seconds ?? 0) - (a.duration_seconds ?? 0)) * dir
      case 'host': {
        const ah = (a.host_display_name || a.host_hostname).toLowerCase()
        const bh = (b.host_display_name || b.host_hostname).toLowerCase()
        return ah.localeCompare(bh) * dir
      }
      case 'service':
        return a.service_name.toLowerCase().localeCompare(b.service_name.toLowerCase()) * dir
      case 'tenant':
        return a.tenant_name.toLowerCase().localeCompare(b.tenant_name.toLowerCase()) * dir
      case 'last_check': {
        const at = a.last_check_at ? new Date(a.last_check_at).getTime() : 0
        const bt = b.last_check_at ? new Date(b.last_check_at).getTime() : 0
        return (bt - at) * dir
      }
      default:
        return 0
    }
  })
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ErrorOverviewPage() {
  const queryClient = useQueryClient()
  const [downtimeTarget, setDowntimeTarget] = useState<ErrorItem | null>(null)
  const [bulkDowntime, setBulkDowntime] = useState(false)
  const [ackTarget, setAckTarget] = useState<ErrorItem | null>(null)
  const [bulkAck, setBulkAck] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [showAcknowledged, setShowAcknowledged] = useState(false)
  const [showDowntime, setShowDowntime] = useState(false)
  const [onlyAck, setOnlyAck] = useState(false)
  const [onlyDowntime, setOnlyDowntime] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortAsc, setSortAsc] = useState(true)
  const [hiddenTenants, setHiddenTenants] = useState<Set<string>>(new Set())
  const [showTenantPanel, setShowTenantPanel] = useState(false)
  const [showSaveFilter, setShowSaveFilter] = useState(false)
  const [editFilter, setEditFilter] = useState<SavedFilter | null>(null)
  const [activeStatuses, setActiveStatuses] = useState<Set<string>>(new Set(['CRITICAL', 'WARNING', 'UNKNOWN']))
  const [defaultFilterId, setDefaultFilterId] = useState<string | null>(null)
  const [defaultApplied, setDefaultApplied] = useState(false)
  const [deleteFilterTarget, setDeleteFilterTarget] = useState<{ id: string; name: string } | null>(null)

  const statusesParam = [...activeStatuses].sort().join(',')

  const { data: errors = [], isLoading } = useQuery<ErrorItem[]>({
    queryKey: ['error-overview', statusesParam, showDowntime || onlyDowntime],
    queryFn: () => api.get('/api/v1/status/errors', { params: { statuses: statusesParam, limit: 1000, include_downtime: showDowntime || onlyDowntime } }).then(r => r.data),
    refetchInterval: 10000,
  })

  const { data: tenants = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['tenants-list'],
    queryFn: () => api.get('/api/v1/tenants/').then(r => r.data),
  })

  const { data: savedFilters = [], refetch: refetchFilters } = useQuery<SavedFilter[]>({
    queryKey: ['saved-filters'],
    queryFn: () => api.get('/api/v1/saved-filters/').then(r => r.data),
  })

  // Load user profile for default filter
  const { data: userProfile } = useQuery<{ default_filter_id: string | null }>({
    queryKey: ['user-me'],
    queryFn: () => api.get('/api/v1/auth/me').then(r => r.data),
    staleTime: 60000,
  })

  // Apply default filter on first load
  useEffect(() => {
    if (defaultApplied || !userProfile?.default_filter_id || savedFilters.length === 0) return
    const df = savedFilters.find(sf => sf.id === userProfile.default_filter_id)
    if (df) {
      applySavedFilter(df)
      setDefaultFilterId(userProfile.default_filter_id)
    }
    setDefaultApplied(true)
  }, [userProfile, savedFilters, defaultApplied])

  // Keep defaultFilterId in sync with server
  useEffect(() => {
    if (userProfile?.default_filter_id !== undefined) {
      setDefaultFilterId(userProfile.default_filter_id)
    }
  }, [userProfile])

  const deleteFilterMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/saved-filters/${id}`),
    onSuccess: () => { setDeleteFilterTarget(null); refetchFilters() },
  })

  const setDefaultMutation = useMutation({
    mutationFn: (filterId: string) => api.put(`/api/v1/saved-filters/${filterId}/set-default`),
    onSuccess: (_, filterId) => {
      setDefaultFilterId(filterId)
      queryClient.invalidateQueries({ queryKey: ['user-me'] })
    },
  })

  const clearDefaultMutation = useMutation({
    mutationFn: () => api.delete('/api/v1/saved-filters/default'),
    onSuccess: () => {
      setDefaultFilterId(null)
      queryClient.invalidateQueries({ queryKey: ['user-me'] })
    },
  })

  // Count errors per tenant (for panel badges)
  const errorCountByTenant = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const e of errors) {
      counts[e.tenant_id] = (counts[e.tenant_id] ?? 0) + 1
    }
    return counts
  }, [errors])

  const ackedCount = useMemo(() => errors.filter(e => e.acknowledged).length, [errors])
  const downtimeCount = useMemo(() => errors.filter(e => e.in_downtime).length, [errors])
  const hiddenTenantCount = hiddenTenants.size

  const filtered = useMemo(() => {
    const items = errors.filter(e => {
      if (hiddenTenants.has(e.tenant_id)) return false
      // "nur" mode: only show items matching active "nur" filters (union)
      if (onlyAck || onlyDowntime) {
        if (!(onlyAck && e.acknowledged) && !(onlyDowntime && e.in_downtime)) return false
      } else {
        if (!showAcknowledged && e.acknowledged) return false
      }
      if (search) {
        const q = search.toLowerCase()
        return (
          e.host_hostname.toLowerCase().includes(q) ||
          (e.host_display_name?.toLowerCase().includes(q) ?? false) ||
          e.service_name.toLowerCase().includes(q) ||
          e.tenant_name.toLowerCase().includes(q)
        )
      }
      return true
    })
    return sortErrors(items, sortKey, sortAsc)
  }, [errors, hiddenTenants, search, showAcknowledged, onlyAck, onlyDowntime, sortKey, sortAsc])

  const unackMutation = useMutation({
    mutationFn: (serviceId: string) => api.delete(`/api/v1/status/acknowledge/${serviceId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['error-overview'] }),
  })

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(e => e.service_id)))
    }
  }

  const toggleTenantHidden = (tenantId: string) => {
    setHiddenTenants(prev => {
      const next = new Set(prev)
      next.has(tenantId) ? next.delete(tenantId) : next.add(tenantId)
      return next
    })
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const toggleStatus = (s: string) => {
    setActiveStatuses(prev => {
      const next = new Set(prev)
      next.has(s) ? next.delete(s) : next.add(s)
      // Ensure at least one status is selected
      if (next.size === 0) return prev
      return next
    })
  }

  const applySavedFilter = (sf: SavedFilter) => {
    const cfg = sf.filter_config
    if (cfg.hidden_tenants) setHiddenTenants(new Set(cfg.hidden_tenants))
    // New format: statuses array; legacy: single status string
    if (cfg.statuses && cfg.statuses.length > 0) {
      setActiveStatuses(new Set(cfg.statuses))
    } else if (cfg.status) {
      setActiveStatuses(new Set([cfg.status]))
    } else {
      setActiveStatuses(new Set(['CRITICAL', 'WARNING', 'UNKNOWN']))
    }
    setSearch(cfg.search ?? '')
    setShowAcknowledged(cfg.show_acknowledged ?? false)
    setShowDowntime(cfg.show_downtime ?? false)
    setOnlyAck(cfg.only_ack ?? false)
    setOnlyDowntime(cfg.only_downtime ?? false)
    setSortKey((cfg.sort_key as SortKey) ?? 'status')
    setSortAsc(cfg.sort_asc ?? true)
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['error-overview'] })
    setSelected(new Set())
  }

  const criticalCount = filtered.filter(e => e.status === 'CRITICAL').length
  const warningCount  = filtered.filter(e => e.status === 'WARNING').length
  const unknownCount  = filtered.filter(e => e.status === 'UNKNOWN').length
  const okCount       = filtered.filter(e => e.status === 'OK').length

  // Count hidden errors
  const hiddenErrorCount = useMemo(() => {
    return errors.filter(e => hiddenTenants.has(e.tenant_id)).length
  }, [errors, hiddenTenants])

  // Get hidden tenant names
  const hiddenTenantNames = useMemo(() => {
    return tenants.filter(t => hiddenTenants.has(t.id)).map(t => t.name)
  }, [tenants, hiddenTenants])

  return (
    <div className="p-8">
      {/* Modals */}
      {downtimeTarget && (
        <DowntimeModal error={downtimeTarget} onClose={() => setDowntimeTarget(null)} onSaved={invalidate} />
      )}
      {bulkDowntime && selected.size > 0 && (
        <BulkDowntimeModal serviceIds={[...selected]} onClose={() => setBulkDowntime(false)} onSaved={invalidate} />
      )}
      {ackTarget && (
        <AckModal error={ackTarget} onClose={() => setAckTarget(null)} onSaved={invalidate} />
      )}
      {bulkAck && selected.size > 0 && (
        <BulkAckModal serviceIds={[...selected]} onClose={() => setBulkAck(false)} onSaved={invalidate} />
      )}
      {showSaveFilter && (
        <SaveFilterModal
          onClose={() => { setShowSaveFilter(false); setEditFilter(null) }}
          onSaved={() => refetchFilters()}
          hiddenTenants={hiddenTenants}
          activeStatuses={activeStatuses}
          search={search}
          showAcknowledged={showAcknowledged}
          showDowntime={showDowntime}
          onlyAck={onlyAck}
          onlyDowntime={onlyDowntime}
          sortKey={sortKey}
          sortAsc={sortAsc}
          editFilter={editFilter}
        />
      )}

      {/* Hidden tenants banner */}
      {hiddenTenantCount > 0 && (
        <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <EyeOff className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span className="text-sm text-amber-800 flex-1">
            <strong>{hiddenTenantCount} Kunde(n) ausgeblendet</strong>
            <span className="text-amber-600"> — {hiddenTenantNames.join(', ')}</span>
            {hiddenErrorCount > 0 && (
              <span className="text-amber-700 font-medium"> ({hiddenErrorCount} Probleme versteckt)</span>
            )}
          </span>
          <button
            onClick={() => setHiddenTenants(new Set())}
            className="text-xs px-2.5 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-100 font-medium"
          >
            Alle einblenden
          </button>
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="mb-4 flex items-center gap-3 bg-overseer-50 border border-overseer-200 rounded-lg px-4 py-3">
          <span className="text-sm font-medium text-overseer-800">
            {selected.size} ausgewählt
          </span>
          <button onClick={() => setBulkAck(true)}
            className="text-xs px-3 py-1.5 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 transition-colors font-medium">
            Alle ACK ({selected.size})
          </button>
          <button onClick={() => setBulkDowntime(true)}
            className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors font-medium flex items-center gap-1">
            <BellOff className="w-3 h-3" /> Downtime ({selected.size})
          </button>
          <button onClick={() => setSelected(new Set())}
            className="text-xs text-gray-400 hover:text-gray-600 ml-auto">
            Auswahl aufheben
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-7 h-7 text-red-500" />
          <h1 className="text-2xl font-bold text-gray-900">Fehlerübersicht</h1>
          <span className="text-sm text-gray-500 ml-2">
            {filtered.length}{filtered.length !== errors.length ? ` / ${errors.length}` : ''} {filtered.length === 1 ? 'Eintrag' : 'Einträge'}
            {!showAcknowledged && ackedCount > 0 && (
              <span className="text-gray-400"> ({ackedCount} ACK ausgeblendet)</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/tv"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-colors"
            title="TV-Modus in neuem Tab öffnen"
          >
            <Tv className="w-4 h-4" />
            TV
          </a>
          {activeStatuses.has('CRITICAL') && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">
              {criticalCount} Critical
            </span>
          )}
          {activeStatuses.has('WARNING') && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
              {warningCount} Warning
            </span>
          )}
          {activeStatuses.has('UNKNOWN') && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
              {unknownCount} Unknown
            </span>
          )}
          {activeStatuses.has('OK') && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
              {okCount} OK
            </span>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Host, Service, Kunde…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-overseer-500 outline-none"
          />
        </div>
        <div className="flex items-center gap-1">
          {(['CRITICAL', 'WARNING', 'UNKNOWN', 'OK'] as const).map(s => {
            const cfg = statusConfig[s]
            const active = activeStatuses.has(s)
            return (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={clsx(
                  'text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors',
                  active
                    ? `${cfg.bg} ${cfg.text} border-current`
                    : 'border-gray-200 text-gray-400 bg-white hover:bg-gray-50'
                )}
              >
                {cfg.label}
              </button>
            )
          })}
        </div>

        {/* Sort */}
        <div className="flex items-center gap-1">
          <ArrowUpDown className="w-4 h-4 text-gray-400" />
          <select
            value={sortKey}
            onChange={e => handleSort(e.target.value as SortKey)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none"
          >
            {sortOptions.map(o => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => setSortAsc(!sortAsc)}
            className="text-xs px-2 py-2 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50"
            title={sortAsc ? 'Aufsteigend' : 'Absteigend'}
          >
            {sortAsc ? '↑' : '↓'}
          </button>
        </div>

        <div className="flex items-center">
          <button
            onClick={() => { if (showAcknowledged || onlyAck) { setShowAcknowledged(false); setOnlyAck(false) } else { setShowAcknowledged(true) } }}
            className={clsx(
              'flex items-center gap-1.5 text-sm px-3 py-2 rounded-l-lg border border-r-0 transition-colors',
              onlyAck
                ? 'border-blue-500 bg-blue-100 text-blue-800'
                : showAcknowledged
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-gray-300 text-gray-500 hover:bg-gray-50',
            )}
          >
            <CheckCheck className="w-4 h-4" />
            ACK
            {ackedCount > 0 && <span className="text-xs text-gray-400">({ackedCount})</span>}
          </button>
          <button
            onClick={() => { if (onlyAck) { setOnlyAck(false) } else { setOnlyAck(true); setShowAcknowledged(true) } }}
            className={clsx(
              'text-xs px-2 py-2 rounded-r-lg border transition-colors',
              onlyAck
                ? 'border-blue-500 bg-blue-600 text-white'
                : 'border-gray-300 text-gray-400 hover:text-blue-600 hover:bg-gray-50',
            )}
            title={onlyAck ? 'Show only aufheben' : 'Nur acknowledged anzeigen'}
          >
            show only
          </button>
        </div>

        <div className="flex items-center">
          <button
            onClick={() => { if (showDowntime || onlyDowntime) { setShowDowntime(false); setOnlyDowntime(false) } else { setShowDowntime(true) } }}
            className={clsx(
              'flex items-center gap-1.5 text-sm px-3 py-2 rounded-l-lg border border-r-0 transition-colors',
              onlyDowntime
                ? 'border-purple-500 bg-purple-100 text-purple-800'
                : showDowntime
                  ? 'border-purple-300 bg-purple-50 text-purple-700'
                  : 'border-gray-300 text-gray-500 hover:bg-gray-50',
            )}
          >
            <BellOff className="w-4 h-4" />
            Downtimes
            {downtimeCount > 0 && <span className="text-xs text-gray-400">({downtimeCount})</span>}
          </button>
          <button
            onClick={() => { if (onlyDowntime) { setOnlyDowntime(false) } else { setOnlyDowntime(true); setShowDowntime(true) } }}
            className={clsx(
              'text-xs px-2 py-2 rounded-r-lg border transition-colors',
              onlyDowntime
                ? 'border-purple-500 bg-purple-600 text-white'
                : 'border-gray-300 text-gray-400 hover:text-purple-600 hover:bg-gray-50',
            )}
            title={onlyDowntime ? 'Show only aufheben' : 'Nur Downtimes anzeigen'}
          >
            show only
          </button>
        </div>

        {/* Tenant toggle */}
        <div className="relative">
          <button
            onClick={() => setShowTenantPanel(!showTenantPanel)}
            className={clsx(
              'flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border transition-colors',
              hiddenTenantCount > 0
                ? 'border-amber-300 bg-amber-50 text-amber-700'
                : 'border-gray-300 text-gray-500 hover:bg-gray-50',
            )}
          >
            <Filter className="w-4 h-4" />
            Kunden
            {hiddenTenantCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-800 text-xs font-medium">
                {hiddenTenantCount}
              </span>
            )}
          </button>
          {showTenantPanel && (
            <TenantTogglePanel
              tenants={tenants}
              hiddenTenants={hiddenTenants}
              onToggle={toggleTenantHidden}
              onClose={() => setShowTenantPanel(false)}
              errorCountByTenant={errorCountByTenant}
            />
          )}
        </div>

        {(hiddenTenantCount > 0 || activeStatuses.size !== 3 || !['CRITICAL', 'WARNING', 'UNKNOWN'].every(s => activeStatuses.has(s)) || search || showAcknowledged || showDowntime || onlyAck || onlyDowntime) && (
          <button
            onClick={() => { setSearch(''); setHiddenTenants(new Set()); setActiveStatuses(new Set(['CRITICAL', 'WARNING', 'UNKNOWN'])); setShowAcknowledged(false); setShowDowntime(false); setOnlyAck(false); setOnlyDowntime(false) }}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Filter zurücksetzen
          </button>
        )}
      </div>

      {/* Saved filters bar */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {savedFilters.map(sf => {
          const isDefault = sf.id === defaultFilterId
          return (
            <div key={sf.id} className="group flex items-center gap-1">
              <button
                onClick={() => applySavedFilter(sf)}
                title={sf.description ?? undefined}
                className={clsx(
                  'text-xs px-3 py-1.5 rounded-lg border transition-colors',
                  isDefault
                    ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                    : 'border-gray-200 text-gray-600 hover:bg-overseer-50 hover:border-overseer-300 hover:text-overseer-700',
                )}
              >
                {isDefault && <Star className="w-3 h-3 inline mr-1 fill-amber-400 text-amber-400" />}
                <Filter className="w-3 h-3 inline mr-1" />
                {sf.name}
              </button>
              <button
                onClick={() => {
                  if (isDefault) {
                    clearDefaultMutation.mutate()
                  } else {
                    setDefaultMutation.mutate(sf.id)
                  }
                }}
                className={clsx(
                  'p-0.5 transition-opacity',
                  isDefault
                    ? 'text-amber-400 hover:text-amber-600'
                    : 'opacity-0 group-hover:opacity-100 text-gray-400 hover:text-amber-500',
                )}
                title={isDefault ? 'Standard entfernen' : 'Als Standard setzen'}
              >
                <Star className={clsx('w-3 h-3', isDefault && 'fill-current')} />
              </button>
              <button
                onClick={() => { setEditFilter(sf); setShowSaveFilter(true) }}
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition-opacity p-0.5"
                title="Bearbeiten"
              >
                <Edit2 className="w-3 h-3" />
              </button>
              <button
                onClick={() => setDeleteFilterTarget({ id: sf.id, name: sf.name })}
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity p-0.5"
                title="Löschen"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )
        })}
        <button
          onClick={() => { setEditFilter(null); setShowSaveFilter(true) }}
          className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-gray-300 text-gray-400 hover:text-overseer-600 hover:border-overseer-400 transition-colors flex items-center gap-1"
        >
          <Save className="w-3 h-3" />
          Aktuellen Filter speichern
        </button>
      </div>

      {/* No errors */}
      {!isLoading && filtered.length === 0 && errors.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
            <CheckCheck className="w-8 h-8 text-emerald-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900">Alles in Ordnung</h2>
          <p className="text-gray-500 mt-1">Keine aktuellen Probleme.</p>
        </div>
      )}
      {!isLoading && filtered.length === 0 && errors.length > 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-gray-400">Keine Ergebnisse für den aktuellen Filter.</p>
          {!showAcknowledged && !onlyAck && ackedCount > 0 && (
            <button
              onClick={() => setShowAcknowledged(true)}
              className="mt-2 text-sm text-blue-600 hover:text-blue-700 underline"
            >
              {ackedCount} acknowledged Einträge anzeigen
            </button>
          )}
        </div>
      )}

      {/* Error list */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-2 mb-2 pl-1">
          <input
            type="checkbox"
            checked={selected.size === filtered.length && filtered.length > 0}
            onChange={toggleAll}
            className="w-4 h-4 rounded border-gray-300 text-overseer-600 focus:ring-overseer-500"
          />
          <span className="text-xs text-gray-400">Alle auswählen</span>
        </div>
      )}
      <div className="space-y-2">
        {filtered.map((error) => {
          const config   = statusConfig[error.status]
          const HostIcon = HOST_TYPE_ICONS[error.host_type] ?? Server
          const isUnacking = unackMutation.isPending && unackMutation.variables === error.service_id

          return (
            <div
              key={error.service_id}
              className={clsx(
                'rounded-lg border bg-white transition-colors',
                config.border,
                error.status === 'CRITICAL' && !error.acknowledged && 'border-red-400',
                error.acknowledged && 'opacity-70',
              )}
            >
              <div className="flex items-center gap-4 px-5 py-4">
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={selected.has(error.service_id)}
                  onChange={() => toggleSelect(error.service_id)}
                  className="w-4 h-4 rounded border-gray-300 text-overseer-600 focus:ring-overseer-500 flex-shrink-0"
                />

                {/* Status badge */}
                <div className={clsx('px-3 py-1 rounded text-xs font-bold uppercase whitespace-nowrap', config.bg, config.text)}>
                  {config.label}
                </div>

                {/* Downtime indicator */}
                {error.in_downtime && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-700 font-medium" title="In Downtime">
                    <BellOff className="w-3 h-3" /> DT
                  </span>
                )}

                {/* Host info */}
                <div className="flex items-center gap-2 min-w-[200px]">
                  <HostIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <div>
                    <Link
                      to={`/hosts/${error.host_id}`}
                      className="text-sm font-semibold text-gray-900 hover:text-overseer-600 hover:underline"
                    >
                      {error.host_display_name || error.host_hostname}
                    </Link>
                    <p className="text-xs text-gray-500">{error.tenant_name}</p>
                  </div>
                </div>

                {/* Check info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{error.service_name}</p>
                  <p className="text-xs text-gray-500 truncate">{error.status_message}</p>
                </div>

                {/* Value */}
                {error.value !== null && (
                  <div className="text-right min-w-[80px]">
                    <p className={clsx('text-sm font-bold', config.text)}>
                      {error.value}{error.unit}
                    </p>
                  </div>
                )}

                {/* Duration */}
                <div className="flex items-center gap-1 text-xs text-gray-400 min-w-[110px]">
                  <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                  {error.last_state_change_at
                    ? formatDistanceToNow(new Date(error.last_state_change_at), { locale: de, addSuffix: true })
                    : '–'}
                </div>

                {/* Downtime button */}
                <button
                  onClick={() => setDowntimeTarget(error)}
                  title="Downtime eintragen"
                  className="text-gray-300 hover:text-overseer-500 transition-colors"
                >
                  <BellOff className="w-4 h-4" />
                </button>

                {/* ACK */}
                {error.acknowledged ? (
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700 font-medium cursor-default"
                      title={[
                        error.acknowledged_by ? `Von: ${error.acknowledged_by}` : null,
                        error.acknowledged_at ? `Am: ${new Date(error.acknowledged_at).toLocaleString('de-DE')}` : null,
                        error.acknowledge_comment ? `Kommentar: ${error.acknowledge_comment}` : null,
                      ].filter(Boolean).join('\n')}
                    >
                      <CheckCheck className="w-3 h-3" /> ACK{error.acknowledged_by ? ` · ${error.acknowledged_by.split('@')[0]}` : ''}
                    </span>
                    <button
                      onClick={() => unackMutation.mutate(error.service_id)}
                      disabled={isUnacking}
                      className="text-xs text-gray-400 hover:text-gray-600 underline disabled:opacity-50"
                    >
                      {isUnacking ? '…' : 'aufheben'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAckTarget(error)}
                    className="text-xs px-3 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 transition-colors whitespace-nowrap"
                  >
                    ACK
                  </button>
                )}
              </div>

              {/* ACK comment row */}
              {error.acknowledged && error.acknowledge_comment && (
                <div className="flex items-start gap-2 px-5 pb-3 -mt-1 ml-[52px]">
                  <MessageSquare className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-600">
                    <span className="font-medium">{error.acknowledged_by?.split('@')[0] ?? 'Unbekannt'}</span>
                    {error.acknowledged_at && (
                      <span className="text-blue-400"> · {formatDistanceToNow(new Date(error.acknowledged_at), { locale: de, addSuffix: true })}</span>
                    )}
                    <span className="text-gray-500"> — {error.acknowledge_comment}</span>
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        open={!!deleteFilterTarget}
        title="Filter löschen"
        message={`Filter "${deleteFilterTarget?.name}" wirklich löschen?`}
        confirmLabel="Löschen"
        variant="danger"
        loading={deleteFilterMutation.isPending}
        onConfirm={() => deleteFilterTarget && deleteFilterMutation.mutate(deleteFilterTarget.id)}
        onCancel={() => setDeleteFilterTarget(null)}
      />
    </div>
  )
}
