import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Server, Router, Printer, Shield, Wifi, ArrowLeft,
  CheckCircle, XCircle, AlertTriangle, HelpCircle, Clock,
} from 'lucide-react'
import clsx from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'
import { api } from '../api/client'

interface Host {
  id: string
  tenant_id: string
  collector_id: string
  hostname: string
  display_name: string | null
  ip_address: string | null
  host_type: string
  tags: string[]
  active: boolean
  created_at: string
}

interface ServiceStatus {
  service_id: string
  host_id: string
  tenant_id: string
  status: 'OK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN'
  state_type: 'SOFT' | 'HARD'
  current_attempt: number
  status_message: string | null
  value: number | null
  unit: string | null
  last_check_at: string | null
  last_state_change_at: string | null
  acknowledged: boolean
  in_downtime: boolean
  service_name: string | null
}

const hostTypeIcons: Record<string, React.ElementType> = {
  server: Server,
  switch: Router,
  router: Router,
  printer: Printer,
  firewall: Shield,
  access_point: Wifi,
}

const hostTypeLabels: Record<string, string> = {
  server: 'Server',
  switch: 'Switch',
  router: 'Router',
  printer: 'Drucker',
  firewall: 'Firewall',
  access_point: 'Access Point',
  other: 'Sonstiges',
}

const statusConfig = {
  OK:       { icon: CheckCircle,   color: 'text-emerald-500', bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'OK' },
  WARNING:  { icon: AlertTriangle, color: 'text-amber-500',   bg: 'bg-amber-100',   text: 'text-amber-800',   label: 'WARNING' },
  CRITICAL: { icon: XCircle,       color: 'text-red-500',     bg: 'bg-red-100',     text: 'text-red-800',     label: 'CRITICAL' },
  UNKNOWN:  { icon: HelpCircle,    color: 'text-gray-400',    bg: 'bg-gray-100',    text: 'text-gray-700',    label: 'UNKNOWN' },
}

const statusOrder = { CRITICAL: 0, WARNING: 1, UNKNOWN: 2, OK: 3 }

export default function HostDetailPage() {
  const { hostId } = useParams<{ hostId: string }>()

  const { data: host, isLoading: hostLoading } = useQuery<Host>({
    queryKey: ['host', hostId],
    queryFn: () => api.get(`/api/v1/hosts/${hostId}`).then(r => r.data),
    enabled: !!hostId,
  })

  const { data: services = [], isLoading: svcLoading } = useQuery<ServiceStatus[]>({
    queryKey: ['host-status', hostId],
    queryFn: () => api.get(`/api/v1/status/host/${hostId}`).then(r => r.data),
    enabled: !!hostId,
    refetchInterval: 10000,
  })

  // Also fetch service names
  const { data: serviceList = [] } = useQuery<{ id: string; name: string; check_type: string }[]>({
    queryKey: ['services', hostId],
    queryFn: () => api.get(`/api/v1/services/?host_id=${hostId}`).then(r => r.data),
    enabled: !!hostId,
  })
  const serviceNames: Record<string, { name: string; check_type: string }> = {}
  serviceList.forEach(s => { serviceNames[s.id] = { name: s.name, check_type: s.check_type } })

  const sorted = [...services].sort(
    (a, b) => statusOrder[a.status] - statusOrder[b.status]
  )

  const counts = { OK: 0, WARNING: 0, CRITICAL: 0, UNKNOWN: 0 }
  services.forEach(s => counts[s.status]++)

  if (hostLoading) {
    return <div className="p-8 text-gray-500">Lade Host-Daten…</div>
  }
  if (!host) {
    return <div className="p-8 text-red-500">Host nicht gefunden.</div>
  }

  const HostIcon = hostTypeIcons[host.host_type] ?? Server
  const worstStatus = sorted[0]?.status ?? 'OK'
  const worstCfg = statusConfig[worstStatus]
  const WIcon = worstCfg.icon

  return (
    <div className="p-8 max-w-5xl">
      {/* Back link */}
      <Link
        to="/errors"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Zurück zur Fehlerübersicht
      </Link>

      {/* Host header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className={clsx('w-14 h-14 rounded-xl flex items-center justify-center', worstCfg.bg)}>
            <HostIcon className={clsx('w-7 h-7', worstCfg.color)} />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900">
              {host.display_name || host.hostname}
            </h1>
            <p className="text-gray-500 text-sm mt-0.5">{host.hostname}</p>
            <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
              {host.ip_address && (
                <span className="font-mono bg-gray-100 px-2 py-0.5 rounded">{host.ip_address}</span>
              )}
              <span>{hostTypeLabels[host.host_type] ?? host.host_type}</span>
            </div>
          </div>
          {/* Overall status */}
          <div className={clsx('flex items-center gap-2 px-4 py-2 rounded-lg', worstCfg.bg)}>
            <WIcon className={clsx('w-5 h-5', worstCfg.color)} />
            <span className={clsx('font-bold text-sm', worstCfg.text)}>{worstStatus}</span>
          </div>
        </div>

        {/* Mini stats */}
        <div className="grid grid-cols-4 gap-3 mt-5 pt-5 border-t border-gray-100">
          {(['CRITICAL', 'WARNING', 'UNKNOWN', 'OK'] as const).map(s => {
            const cfg = statusConfig[s]
            const Icon = cfg.icon
            return (
              <div key={s} className={clsx('rounded-lg px-3 py-2 flex items-center gap-2', cfg.bg)}>
                <Icon className={clsx('w-4 h-4', cfg.color)} />
                <span className={clsx('text-sm font-semibold', cfg.text)}>{counts[s]} {s}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Services table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">
            Services ({services.length})
          </h2>
        </div>

        {svcLoading ? (
          <div className="p-8 text-center text-gray-400">Lade Services…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-left">Check</th>
                <th className="px-6 py-3 text-left">Typ</th>
                <th className="px-6 py-3 text-left">Meldung</th>
                <th className="px-6 py-3 text-right">Wert</th>
                <th className="px-6 py-3 text-right">Letzte Änderung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map(svc => {
                const cfg = statusConfig[svc.status]
                const Icon = cfg.icon
                const meta = serviceNames[svc.service_id]
                return (
                  <tr key={svc.service_id} className="hover:bg-gray-50">
                    <td className="px-6 py-3">
                      <span className={clsx(
                        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold',
                        cfg.bg, cfg.text
                      )}>
                        <Icon className="w-3 h-3" />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-6 py-3 font-medium text-gray-800">
                      {meta?.name ?? '–'}
                    </td>
                    <td className="px-6 py-3 text-gray-500 font-mono text-xs">
                      {meta?.check_type ?? '–'}
                    </td>
                    <td className="px-6 py-3 text-gray-500 max-w-xs truncate">
                      {svc.status_message ?? '–'}
                    </td>
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
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
