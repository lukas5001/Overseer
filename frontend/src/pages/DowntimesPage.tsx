import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock, Plus, X, StopCircle, Server, Layers, Search } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import { formatDateTime } from '../lib/format'
import ConfirmDialog from '../components/ConfirmDialog'

interface Downtime {
  id: string
  tenant_id: string
  host_id: string | null
  service_id: string | null
  start_at: string
  end_at: string
  comment: string
  active: boolean
}

interface HostOption {
  id: string
  hostname: string
  display_name: string | null
  tenant_name: string | null
  tenant_id: string
}

interface ServiceOption {
  id: string
  name: string
  host_id: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatRelativeTime(downtime: Downtime): string {
  if (!downtime.active) return 'beendet'
  const now = Date.now()
  const end = new Date(downtime.end_at).getTime()
  const diffMs = end - now
  if (diffMs <= 0) return 'beendet'
  const totalMinutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `endet in ${hours}h ${minutes}m`
  return `endet in ${minutes}m`
}

function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    date.getFullYear() +
    '-' + pad(date.getMonth() + 1) +
    '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) +
    ':' + pad(date.getMinutes())
  )
}

/** Display a datetime-local value in European format (dd.mm.yyyy HH:MM) */
function displayEuropeanDate(dtLocal: string): string {
  if (!dtLocal) return ''
  const d = new Date(dtLocal)
  if (isNaN(d.getTime())) return dtLocal
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Host/Service Search Selector ─────────────────────────────────────────────

interface HostSelectorProps {
  value: string
  onChange: (hostId: string, label: string) => void
  hosts: HostOption[]
}

function HostSelector({ value, onChange, hosts }: HostSelectorProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedLabel, setSelectedLabel] = useState('')

  const filtered = useMemo(() => {
    if (!search) return hosts.slice(0, 50)
    const q = search.toLowerCase()
    return hosts.filter(h =>
      h.hostname.toLowerCase().includes(q) ||
      (h.display_name?.toLowerCase().includes(q) ?? false) ||
      (h.tenant_name?.toLowerCase().includes(q) ?? false)
    ).slice(0, 50)
  }, [hosts, search])

  const select = (h: HostOption) => {
    const label = `${h.display_name || h.hostname} (${h.tenant_name})`
    setSelectedLabel(label)
    onChange(h.id, label)
    setOpen(false)
    setSearch('')
  }

  const clear = () => {
    onChange('', '')
    setSelectedLabel('')
    setSearch('')
  }

  return (
    <div className="relative">
      <label className="block text-xs font-medium text-gray-600 mb-1">
        Host <span className="font-normal text-gray-400">(optional)</span>
      </label>
      {value ? (
        <div className="flex items-center gap-2 text-sm border border-gray-300 rounded-lg px-3 py-2 bg-gray-50">
          <Server className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          <span className="flex-1 truncate text-gray-700">{selectedLabel}</span>
          <button onClick={clear} className="text-gray-400 hover:text-gray-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 text-sm border border-gray-300 rounded-lg px-3 py-2 cursor-pointer hover:border-overseer-400"
        >
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-gray-400">Host suchen…</span>
        </div>
      )}
      {open && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Hostname, Tenant…"
              className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded focus:ring-1 focus:ring-overseer-500 outline-none"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto max-h-48">
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-400">Keine Hosts gefunden</p>
            )}
            {filtered.map(h => (
              <button
                key={h.id}
                onClick={() => select(h)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-overseer-50 flex items-center gap-2"
              >
                <Server className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-gray-800 truncate">{h.display_name || h.hostname}</p>
                  <p className="text-xs text-gray-400 truncate">{h.tenant_name}{h.display_name ? ` · ${h.hostname}` : ''}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface ServiceSelectorProps {
  value: string
  onChange: (serviceId: string, label: string) => void
  hostId: string
  hosts: HostOption[]
}

function ServiceSelector({ value, onChange, hostId, hosts }: ServiceSelectorProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedLabel, setSelectedLabel] = useState('')

  const { data: services = [] } = useQuery<ServiceOption[]>({
    queryKey: ['services-for-host', hostId],
    queryFn: () => api.get(`/api/v1/services/?host_id=${hostId}&limit=500`).then(r => r.data),
    enabled: !!hostId,
  })

  // If no host selected, load all services (limited)
  const { data: allServices = [] } = useQuery<(ServiceOption & { host_hostname?: string; tenant_name?: string })[]>({
    queryKey: ['services-all-search', search],
    queryFn: () => api.get(`/api/v1/services/?limit=50&search=${encodeURIComponent(search)}`).then(r => r.data),
    enabled: !hostId && search.length >= 2,
  })

  const serviceList = hostId ? services : allServices

  const filtered = useMemo(() => {
    if (!search) return serviceList.slice(0, 50)
    const q = search.toLowerCase()
    return serviceList.filter((s: any) =>
      s.name.toLowerCase().includes(q) ||
      (s.host_hostname?.toLowerCase().includes(q) ?? false)
    ).slice(0, 50)
  }, [serviceList, search])

  const select = (s: any) => {
    const host = hosts.find(h => h.id === s.host_id)
    const label = host
      ? `${s.name} (${host.display_name || host.hostname})`
      : s.name
    setSelectedLabel(label)
    onChange(s.id, label)
    setOpen(false)
    setSearch('')
  }

  const clear = () => {
    onChange('', '')
    setSelectedLabel('')
    setSearch('')
  }

  return (
    <div className="relative">
      <label className="block text-xs font-medium text-gray-600 mb-1">
        Service <span className="font-normal text-gray-400">(optional)</span>
      </label>
      {value ? (
        <div className="flex items-center gap-2 text-sm border border-gray-300 rounded-lg px-3 py-2 bg-gray-50">
          <Layers className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          <span className="flex-1 truncate text-gray-700">{selectedLabel}</span>
          <button onClick={clear} className="text-gray-400 hover:text-gray-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 text-sm border border-gray-300 rounded-lg px-3 py-2 cursor-pointer hover:border-overseer-400"
        >
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-gray-400">{hostId ? 'Service wählen…' : 'Erst Host wählen oder hier suchen…'}</span>
        </div>
      )}
      {open && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Service suchen…"
              className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded focus:ring-1 focus:ring-overseer-500 outline-none"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto max-h-48">
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-400">
                {!hostId && search.length < 2 ? 'Mind. 2 Zeichen eingeben' : 'Keine Services gefunden'}
              </p>
            )}
            {filtered.map((s: any) => (
              <button
                key={s.id}
                onClick={() => select(s)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-overseer-50 flex items-center gap-2"
              >
                <Layers className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-gray-800 truncate">{s.name}</p>
                  {s.host_hostname && <p className="text-xs text-gray-400 truncate">{s.host_hostname}</p>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Add Downtime Modal ─────────────────────────────────────────────────────────

interface AddDowntimeModalProps {
  onClose: () => void
  onSaved: () => void
}

function AddDowntimeModal({ onClose, onSaved }: AddDowntimeModalProps) {
  const now = new Date()
  const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000)

  const [hostId, setHostId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [startAt, setStartAt] = useState(toDatetimeLocal(now))
  const [endAt, setEndAt] = useState(toDatetimeLocal(twoHoursLater))
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: hosts = [] } = useQuery<HostOption[]>({
    queryKey: ['hosts-all'],
    queryFn: () => api.get('/api/v1/hosts/?limit=500').then(r => r.data),
    staleTime: 60000,
  })

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/api/v1/downtimes/', {
        host_id: hostId || null,
        service_id: serviceId || null,
        start_at: new Date(startAt).toISOString(),
        end_at: new Date(endAt).toISOString(),
        comment,
      }),
    onSuccess: () => {
      onSaved()
      onClose()
    },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler beim Speichern'),
  })

  const handleSubmit = () => {
    if (!hostId && !serviceId) {
      setError('Bitte einen Host oder Service auswählen.')
      return
    }
    setError(null)
    mutation.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Downtime anlegen</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          {/* Host selector */}
          <HostSelector
            value={hostId}
            onChange={(id) => { setHostId(id); if (!id) setServiceId('') }}
            hosts={hosts}
          />

          {/* Service selector */}
          <ServiceSelector
            value={serviceId}
            onChange={(id) => setServiceId(id)}
            hostId={hostId}
            hosts={hosts}
          />

          <p className="text-xs text-gray-400 -mt-1">Mindestens Host oder Service muss gewählt werden.</p>

          {/* Date inputs with European preview */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Beginn *</label>
              <input
                type="datetime-local"
                value={startAt}
                onChange={e => setStartAt(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none"
              />
              <p className="text-xs text-gray-400 mt-0.5">{displayEuropeanDate(startAt)}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Ende *</label>
              <input
                type="datetime-local"
                value={endAt}
                onChange={e => setEndAt(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none"
              />
              <p className="text-xs text-gray-400 mt-0.5">{displayEuropeanDate(endAt)}</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Kommentar</label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              placeholder="Wartungsfenster für …"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none resize-none"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Speichern…' : 'Downtime anlegen'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

type TabMode = 'active' | 'all'

export default function DowntimesPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabMode>('active')
  const [showAdd, setShowAdd] = useState(false)
  const [endTarget, setEndTarget] = useState<string | null>(null)

  const activeOnly = tab === 'active'

  const { data: downtimes = [], isLoading } = useQuery<Downtime[]>({
    queryKey: ['downtimes-list', activeOnly],
    queryFn: () =>
      api.get(`/api/v1/downtimes/?active_only=${activeOnly}`).then(r => r.data),
    refetchInterval: 30000,
  })

  // Load hosts for name resolution in downtime cards
  const { data: hosts = [] } = useQuery<HostOption[]>({
    queryKey: ['hosts-all'],
    queryFn: () => api.get('/api/v1/hosts/?limit=500').then(r => r.data),
    staleTime: 60000,
  })

  const hostMap = useMemo(() => {
    const m: Record<string, HostOption> = {}
    for (const h of hosts) m[h.id] = h
    return m
  }, [hosts])

  const endMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/downtimes/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['downtimes-list'] }); setEndTarget(null) },
  })

  return (
    <div className="p-8">
      {showAdd && (
        <AddDowntimeModal
          onClose={() => setShowAdd(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['downtimes-list'] })}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Clock className="w-7 h-7 text-overseer-600" />
          <h1 className="text-2xl font-bold text-gray-900">Downtimes</h1>
          <span className="text-sm text-gray-500 ml-2">{downtimes.length}</span>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Downtime anlegen
        </button>
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-lg w-fit">
        {(['active', 'all'] as TabMode[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
              tab === t
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            {t === 'active' ? 'Aktiv' : 'Alle'}
          </button>
        ))}
      </div>

      {isLoading && <div className="text-gray-400 text-sm">Lade…</div>}

      {/* Empty state */}
      {!isLoading && downtimes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
          <Clock className="w-10 h-10" />
          <p className="text-sm">Keine Downtimes</p>
        </div>
      )}

      {/* Card list */}
      {downtimes.length > 0 && (
        <div className="space-y-3">
          {downtimes.map(dt => {
            const host = dt.host_id ? hostMap[dt.host_id] : null

            return (
              <div
                key={dt.id}
                className="bg-white rounded-xl border border-gray-200 px-5 py-4"
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: scope + times + comment */}
                  <div className="flex-1 min-w-0 space-y-2">
                    {/* Scope badges */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {dt.host_id && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-xs text-blue-800">
                          <Server className="w-3 h-3 flex-shrink-0" />
                          {host ? (host.display_name || host.hostname) : dt.host_id.slice(0, 8) + '…'}
                          {host?.tenant_name && <span className="text-blue-400 ml-1">({host.tenant_name})</span>}
                        </span>
                      )}
                      {dt.service_id && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-violet-50 border border-violet-200 text-xs text-violet-700">
                          <Layers className="w-3 h-3 flex-shrink-0" />
                          Service: {dt.service_id.slice(0, 8)}…
                        </span>
                      )}

                      {/* Active badge */}
                      <span
                        className={clsx(
                          'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                          dt.active
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-gray-100 text-gray-500',
                        )}
                      >
                        {dt.active ? 'Aktiv' : 'Inaktiv'}
                      </span>

                      {/* Relative time */}
                      <span className="text-xs text-gray-400">{formatRelativeTime(dt)}</span>
                    </div>

                    {/* Time range */}
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Clock className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                      <span>{formatDateTime(dt.start_at)}</span>
                      <span className="text-gray-300">–</span>
                      <span>{formatDateTime(dt.end_at)}</span>
                    </div>

                    {/* Comment */}
                    {dt.comment && (
                      <p className="text-sm text-gray-700 leading-snug">{dt.comment}</p>
                    )}
                  </div>

                  {/* Right: actions */}
                  <div className="flex-shrink-0">
                    {dt.active && (
                      <button
                        onClick={() => setEndTarget(dt.id)}
                        disabled={endMutation.isPending}
                        title="Downtime beenden"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        <StopCircle className="w-3.5 h-3.5" />
                        Beenden
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!endTarget}
        title="Downtime beenden"
        message="Soll diese Downtime jetzt beendet werden?"
        confirmLabel="Beenden"
        variant="warning"
        loading={endMutation.isPending}
        onConfirm={() => endTarget && endMutation.mutate(endTarget)}
        onCancel={() => setEndTarget(null)}
      />
    </div>
  )
}
