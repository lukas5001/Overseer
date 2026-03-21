import { useQuery } from '@tanstack/react-query'
import { Monitor, Server, Router, Printer, Shield, Wifi, HelpCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { api } from '../api/client'

interface HostItem {
  id: string
  hostname: string
  display_name: string | null
  ip_address: string | null
  host_type: string
  tenant_id: string
  tenant_name: string | null
  active: boolean
}

interface StatusSummary {
  [host_id: string]: 'OK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN'
}

const hostTypeIcons: Record<string, React.ElementType> = {
  server: Server,
  switch: Router,
  router: Router,
  printer: Printer,
  firewall: Shield,
  access_point: Wifi,
}

const statusDot: Record<string, string> = {
  OK:       'bg-emerald-500',
  WARNING:  'bg-amber-400',
  CRITICAL: 'bg-red-500',
  UNKNOWN:  'bg-gray-300',
}

export default function HostsPage() {
  const { data: hosts = [], isLoading } = useQuery<HostItem[]>({
    queryKey: ['hosts-list'],
    queryFn: () => api.get('/api/v1/hosts/').then(r => r.data),
    refetchInterval: 30000,
  })

  // Fetch error overview to derive per-host worst status
  const { data: errors = [] } = useQuery<{ host_id: string; status: string }[]>({
    queryKey: ['error-overview'],
    queryFn: () => api.get('/api/v1/status/errors?include_downtime=true').then(r => r.data),
    refetchInterval: 10000,
  })

  // Build worst-status map: host_id → worst status
  const worstStatus: StatusSummary = {}
  for (const e of errors) {
    const cur = worstStatus[e.host_id]
    const rank: Record<string, number> = { CRITICAL: 3, WARNING: 2, UNKNOWN: 1, OK: 0 }
    if (!cur || rank[e.status] > rank[cur]) {
      worstStatus[e.host_id] = e.status as 'OK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN'
    }
  }

  // Group by tenant
  const byTenant: Record<string, { name: string; hosts: HostItem[] }> = {}
  for (const h of hosts) {
    const tid = h.tenant_id
    if (!byTenant[tid]) byTenant[tid] = { name: h.tenant_name ?? tid, hosts: [] }
    byTenant[tid].hosts.push(h)
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Monitor className="w-7 h-7 text-overseer-600" />
        <h1 className="text-2xl font-bold text-gray-900">Hosts</h1>
        <span className="text-sm text-gray-500 ml-2">
          {hosts.length} {hosts.length === 1 ? 'Host' : 'Hosts'}
        </span>
      </div>

      {isLoading && (
        <div className="text-gray-400 text-sm">Lade…</div>
      )}

      {/* Grouped by tenant */}
      <div className="space-y-6">
        {Object.values(byTenant).map(({ name: tenantName, hosts: tenantHosts }) => (
          <div key={tenantName} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-700">{tenantName}</p>
            </div>
            <table className="w-full text-sm">
              <thead className="text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <tr>
                  <th className="px-6 py-3 text-left">Host</th>
                  <th className="px-6 py-3 text-left">IP</th>
                  <th className="px-6 py-3 text-left">Typ</th>
                  <th className="px-6 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {tenantHosts.map(host => {
                  const HostIcon = hostTypeIcons[host.host_type] ?? HelpCircle
                  const status = worstStatus[host.id] ?? 'OK'
                  const dotClass = statusDot[status]
                  return (
                    <tr
                      key={host.id}
                      className="hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-6 py-3">
                        <Link
                          to={`/hosts/${host.id}`}
                          className="flex items-center gap-2 hover:text-overseer-600"
                        >
                          <HostIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <div>
                            <p className="font-medium text-gray-900">
                              {host.display_name || host.hostname}
                            </p>
                            {host.display_name && (
                              <p className="text-xs text-gray-400">{host.hostname}</p>
                            )}
                          </div>
                        </Link>
                      </td>
                      <td className="px-6 py-3 text-gray-500 font-mono text-xs">
                        {host.ip_address ?? '–'}
                      </td>
                      <td className="px-6 py-3 text-gray-500 capitalize">
                        {host.host_type.replace('_', ' ')}
                      </td>
                      <td className="px-6 py-3">
                        <span className={clsx('inline-flex items-center gap-1.5 text-xs font-medium', status === 'OK' ? 'text-emerald-700' : status === 'WARNING' ? 'text-amber-700' : status === 'CRITICAL' ? 'text-red-700' : 'text-gray-500')}>
                          <span className={clsx('w-2 h-2 rounded-full', dotClass)} />
                          {status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
}
