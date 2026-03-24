import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Server, Router, Printer, Shield, Wifi, ArrowLeft,
  CheckCircle, XCircle, AlertTriangle, HelpCircle, Clock,
  ChevronDown, ChevronRight, Play, X, Plus,
} from 'lucide-react'
import clsx from 'clsx'
import { formatDistanceToNow, format } from 'date-fns'
import { de } from 'date-fns/locale'
import { api } from '../api/client'
import MiniGraph from '../components/MiniGraph'
import type {
  Host, CurrentStatus, Service, HistoryBucket,
  Downtime, StateHistory, CheckStatus,
} from '../types'

const hostTypeIcons: Record<string, React.ElementType> = {
  server: Server, switch: Router, router: Router,
  printer: Printer, firewall: Shield, access_point: Wifi,
}
const hostTypeLabels: Record<string, string> = {
  server: 'Server', switch: 'Switch', router: 'Router',
  printer: 'Drucker', firewall: 'Firewall', access_point: 'Access Point', other: 'Sonstiges',
}

const statusConfig = {
  OK:       { icon: CheckCircle,   color: 'text-emerald-500', bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'OK' },
  WARNING:  { icon: AlertTriangle, color: 'text-amber-500',   bg: 'bg-amber-100',   text: 'text-amber-800',   label: 'WARNING' },
  CRITICAL: { icon: XCircle,       color: 'text-red-500',     bg: 'bg-red-100',     text: 'text-red-800',     label: 'CRITICAL' },
  UNKNOWN:  { icon: HelpCircle,    color: 'text-gray-400',    bg: 'bg-gray-100',    text: 'text-gray-700',    label: 'UNKNOWN' },
}
const statusOrder: Record<string, number> = { CRITICAL: 0, WARNING: 1, UNKNOWN: 2, OK: 3 }

// ── Expandable Service Row ───────────────────────────────────────────────────

function ServiceRow({ svc, meta }: {
  svc: CurrentStatus
  meta?: { name: string; check_type: string; threshold_warn: number | null; threshold_crit: number | null }
}) {
  const [expanded, setExpanded] = useState(false)
  const qc = useQueryClient()
  const cfg = statusConfig[svc.status]
  const Icon = cfg.icon

  const checkNow = useMutation({
    mutationFn: () => api.post(`/api/v1/services/${svc.service_id}/check-now`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['host-status'] })
    },
  })

  // Fetch history only when expanded
  const { data: history = [] } = useQuery<HistoryBucket[]>({
    queryKey: ['service-history-buckets', svc.service_id, '1h'],
    queryFn: () => {
      const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const end = new Date().toISOString()
      return api.get(`/api/v1/services/${svc.service_id}/history`, {
        params: { start, end, interval: '1h' },
      }).then(r => r.data)
    },
    enabled: expanded,
    refetchInterval: false,
  })

  return (
    <>
      <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => setExpanded(prev => !prev)}>
        <td className="px-6 py-3 w-6">
          {expanded
            ? <ChevronDown className="w-4 h-4 text-gray-400" />
            : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </td>
        <td className="px-6 py-3">
          <span className={clsx('inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold', cfg.bg, cfg.text)}>
            <Icon className="w-3 h-3" /> {cfg.label}
          </span>
        </td>
        <td className="px-6 py-3 font-medium text-gray-800">{meta?.name ?? '–'}</td>
        <td className="px-6 py-3 text-gray-500 font-mono text-xs">{meta?.check_type ?? '–'}</td>
        <td className="px-6 py-3 text-gray-500 max-w-xs truncate">{svc.status_message ?? '–'}</td>
        <td className="px-6 py-3 text-right font-mono text-xs text-gray-700">
          {svc.value !== null ? `${svc.value}${svc.unit ?? ''}` : '–'}
        </td>
        <td className="px-6 py-3 text-right text-gray-400 text-xs">
          <span className="inline-flex items-center gap-1 justify-end">
            <Clock className="w-3 h-3" />
            {svc.last_state_change_at
              ? formatDistanceToNow(new Date(svc.last_state_change_at), { locale: de, addSuffix: true })
              : '–'}
          </span>
        </td>
        <td className="px-6 py-3 text-right">
          <button
            onClick={e => { e.stopPropagation(); checkNow.mutate() }}
            disabled={checkNow.isPending}
            title="Check jetzt ausführen"
            className="text-gray-300 hover:text-overseer-600 disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="px-6 py-4 bg-gray-50 border-t border-gray-100">
            <MiniGraph
              data={history}
              thresholdWarn={meta?.threshold_warn}
              thresholdCrit={meta?.threshold_crit}
              unit={svc.unit}
            />
          </td>
        </tr>
      )}
    </>
  )
}

// ── Downtime Modal (inline) ──────────────────────────────────────────────────

function DowntimeModal({ hostId, onClose }: { hostId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const now = new Date()
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000)
  const pad = (d: Date) => d.toISOString().slice(0, 16)

  const [startAt, setStartAt] = useState(pad(now))
  const [endAt, setEndAt] = useState(pad(inOneHour))
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.post('/api/v1/downtimes/', {
      host_id: hostId,
      start_at: new Date(startAt).toISOString(),
      end_at: new Date(endAt).toISOString(),
      comment,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['downtimes'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Downtime planen</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Von</label>
              <input type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Bis</label>
              <input type="datetime-local" value={endAt} onChange={e => setEndAt(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Kommentar</label>
            <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500 resize-none" />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Abbrechen</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-60">
            {mutation.isPending ? 'Speichern…' : 'Downtime speichern'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'services' | 'history' | 'downtimes'

export default function HostDetailPage() {
  const { hostId } = useParams<{ hostId: string }>()
  const [activeTab, setActiveTab] = useState<Tab>('services')
  const [showDowntimeModal, setShowDowntimeModal] = useState(false)

  const { data: host, isLoading: hostLoading } = useQuery<Host>({
    queryKey: ['host', hostId],
    queryFn: () => api.get(`/api/v1/hosts/${hostId}`).then(r => r.data),
    enabled: !!hostId,
  })

  const { data: services = [], isLoading: svcLoading } = useQuery<CurrentStatus[]>({
    queryKey: ['host-status', hostId],
    queryFn: () => api.get(`/api/v1/status/host/${hostId}`).then(r => r.data),
    enabled: !!hostId,
    refetchInterval: 10_000,
  })

  const { data: serviceList = [] } = useQuery<Service[]>({
    queryKey: ['services', { host_id: hostId }],
    queryFn: () => api.get(`/api/v1/services/?host_id=${hostId}`).then(r => r.data),
    enabled: !!hostId,
  })

  const { data: stateHistory = [] } = useQuery<StateHistory[]>({
    queryKey: ['history-raw', hostId],
    queryFn: () => api.get(`/api/v1/history/${serviceList[0]?.id}`, { params: { hours: 168 } }).then(r => r.data),
    enabled: activeTab === 'history' && serviceList.length > 0,
    refetchInterval: false,
  })

  const { data: downtimes = [] } = useQuery<Downtime[]>({
    queryKey: ['downtimes', { host_id: hostId }],
    queryFn: () => api.get('/api/v1/downtimes/', { params: { tenant_id: host?.tenant_id } }).then(r => r.data),
    enabled: activeTab === 'downtimes' && !!host,
  })

  const serviceMeta: Record<string, { name: string; check_type: string; threshold_warn: number | null; threshold_crit: number | null }> = {}
  serviceList.forEach(s => {
    serviceMeta[s.id] = { name: s.name, check_type: s.check_type, threshold_warn: s.threshold_warn, threshold_crit: s.threshold_crit }
  })

  const sorted = [...services].sort((a, b) => statusOrder[a.status] - statusOrder[b.status])
  const counts: Record<CheckStatus, number> = { OK: 0, WARNING: 0, CRITICAL: 0, UNKNOWN: 0 }
  services.forEach(s => counts[s.status]++)

  if (hostLoading) return <div className="p-8 text-gray-500">Lade Host-Daten…</div>
  if (!host) return <div className="p-8 text-red-500">Host nicht gefunden.</div>

  const HostIcon = hostTypeIcons[host.host_type] ?? Server
  const worstStatus = sorted[0]?.status ?? 'OK'
  const worstCfg = statusConfig[worstStatus]
  const WIcon = worstCfg.icon

  const tabs: { key: Tab; label: string }[] = [
    { key: 'services', label: `Services (${services.length})` },
    { key: 'history', label: 'History' },
    { key: 'downtimes', label: 'Downtimes' },
  ]

  // Filter downtimes for this host
  const hostDowntimes = downtimes.filter(d => d.host_id === hostId || (d.service_id && serviceList.some(s => s.id === d.service_id)))

  return (
    <div className="p-8 max-w-5xl">
      {showDowntimeModal && (
        <DowntimeModal hostId={hostId!} onClose={() => setShowDowntimeModal(false)} />
      )}

      {/* Back link */}
      <Link to="/hosts" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft className="w-4 h-4" /> Zurück zu Hosts
      </Link>

      {/* Host header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className={clsx('w-14 h-14 rounded-xl flex items-center justify-center', worstCfg.bg)}>
            <HostIcon className={clsx('w-7 h-7', worstCfg.color)} />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900">{host.display_name || host.hostname}</h1>
            <p className="text-gray-500 text-sm mt-0.5">{host.hostname}</p>
            <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
              {host.ip_address && <span className="font-mono bg-gray-100 px-2 py-0.5 rounded">{host.ip_address}</span>}
              <span>{hostTypeLabels[host.host_type] ?? host.host_type}</span>
              {(host.tags ?? []).map(tag => (
                <span key={tag} className="px-2 py-0.5 bg-overseer-50 text-overseer-700 rounded text-xs">{tag}</span>
              ))}
            </div>
          </div>
          <div className={clsx('flex items-center gap-2 px-4 py-2 rounded-lg', worstCfg.bg)}>
            <WIcon className={clsx('w-5 h-5', worstCfg.color)} />
            <span className={clsx('font-bold text-sm', worstCfg.text)}>{worstStatus}</span>
          </div>
        </div>

        {/* Mini stats */}
        <div className="grid grid-cols-4 gap-3 mt-5 pt-5 border-t border-gray-100">
          {(['CRITICAL', 'WARNING', 'UNKNOWN', 'OK'] as const).map(s => {
            const cfg = statusConfig[s]
            const SIcon = cfg.icon
            return (
              <div key={s} className={clsx('rounded-lg px-3 py-2 flex items-center gap-2', cfg.bg)}>
                <SIcon className={clsx('w-4 h-4', cfg.color)} />
                <span className={clsx('text-sm font-semibold', cfg.text)}>{counts[s]} {s}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-6">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={clsx('pb-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.key
                  ? 'border-overseer-600 text-overseer-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700')}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Services Tab */}
      {activeTab === 'services' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {svcLoading ? (
            <div className="p-8 text-center text-gray-400">Lade Services…</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="px-6 py-3 w-6"></th>
                  <th className="px-6 py-3 text-left">Status</th>
                  <th className="px-6 py-3 text-left">Check</th>
                  <th className="px-6 py-3 text-left">Typ</th>
                  <th className="px-6 py-3 text-left">Meldung</th>
                  <th className="px-6 py-3 text-right">Wert</th>
                  <th className="px-6 py-3 text-right">Letzte Änderung</th>
                  <th className="px-6 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map(svc => (
                  <ServiceRow key={svc.service_id} svc={svc} meta={serviceMeta[svc.service_id]} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">State-Wechsel (letzte 7 Tage)</h2>
          </div>
          {stateHistory.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">Keine State-Wechsel in diesem Zeitraum.</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {stateHistory.slice(0, 100).map((h: any, i: number) => {
                const newCfg = statusConfig[(h.status ?? h.new_status ?? 'UNKNOWN') as CheckStatus] ?? statusConfig.UNKNOWN
                return (
                  <div key={h.id ?? i} className="flex items-center gap-4 px-6 py-3 text-sm">
                    <span className="text-xs text-gray-400 w-36">{format(new Date(h.time ?? h.created_at), 'dd.MM.yyyy HH:mm:ss')}</span>
                    <span className={clsx('px-2 py-0.5 rounded text-xs font-bold', newCfg.bg, newCfg.text)}>
                      {h.status ?? h.new_status ?? 'UNKNOWN'}
                    </span>
                    <span className="text-gray-500 truncate">{h.message ?? '–'}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Downtimes Tab */}
      {activeTab === 'downtimes' && (
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={() => setShowDowntimeModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700">
              <Plus className="w-4 h-4" /> Neue Downtime
            </button>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {hostDowntimes.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">Keine Downtimes vorhanden.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-6 py-3 text-left">Von</th>
                    <th className="px-6 py-3 text-left">Bis</th>
                    <th className="px-6 py-3 text-left">Kommentar</th>
                    <th className="px-6 py-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {hostDowntimes.map(d => {
                    const isActive = d.active && new Date(d.start_at) <= new Date() && new Date(d.end_at) >= new Date()
                    return (
                      <tr key={d.id} className="hover:bg-gray-50">
                        <td className="px-6 py-3 text-gray-700">{format(new Date(d.start_at), 'dd.MM.yyyy HH:mm')}</td>
                        <td className="px-6 py-3 text-gray-700">{format(new Date(d.end_at), 'dd.MM.yyyy HH:mm')}</td>
                        <td className="px-6 py-3 text-gray-500">{d.comment || '–'}</td>
                        <td className="px-6 py-3">
                          {isActive
                            ? <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">Aktiv</span>
                            : <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">Beendet</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
