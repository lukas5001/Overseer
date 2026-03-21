import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, XCircle, HelpCircle, CheckCircle, Building2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { api } from '../api/client'

interface StatusSummary {
  ok: number
  warning: number
  critical: number
  unknown: number
  total: number
}

interface TenantSummary {
  tenant_id: string
  tenant_name: string
  total: number
  ok: number
  warning: number
  critical: number
  unknown: number
}

const statusCards = [
  { key: 'critical' as const, label: 'Critical', icon: XCircle,       textColor: 'text-red-600',     bgLight: 'bg-red-50',     iconBg: 'bg-red-500' },
  { key: 'warning'  as const, label: 'Warning',  icon: AlertTriangle,  textColor: 'text-amber-600',   bgLight: 'bg-amber-50',   iconBg: 'bg-amber-500' },
  { key: 'unknown'  as const, label: 'Unknown',  icon: HelpCircle,     textColor: 'text-gray-600',    bgLight: 'bg-gray-100',   iconBg: 'bg-gray-500' },
  { key: 'ok'       as const, label: 'OK',       icon: CheckCircle,    textColor: 'text-emerald-600', bgLight: 'bg-emerald-50', iconBg: 'bg-emerald-500' },
]

function TenantBar({ ok, warning, critical, unknown, total }: Omit<TenantSummary, 'tenant_id' | 'tenant_name'>) {
  if (total === 0) return null
  return (
    <div className="flex h-2 rounded-full overflow-hidden w-full gap-px">
      {critical > 0 && <div className="bg-red-500"    style={{ width: `${(critical / total) * 100}%` }} />}
      {warning  > 0 && <div className="bg-amber-400"  style={{ width: `${(warning  / total) * 100}%` }} />}
      {unknown  > 0 && <div className="bg-gray-300"   style={{ width: `${(unknown  / total) * 100}%` }} />}
      {ok       > 0 && <div className="bg-emerald-400" style={{ width: `${(ok      / total) * 100}%` }} />}
    </div>
  )
}

export default function DashboardPage() {
  const { data: summary, isLoading } = useQuery<StatusSummary>({
    queryKey: ['status-summary'],
    queryFn: () => api.get('/api/v1/status/summary').then(r => r.data),
    refetchInterval: 10000,
  })

  const { data: tenants = [], isLoading: tenantsLoading } = useQuery<TenantSummary[]>({
    queryKey: ['status-by-tenant'],
    queryFn: () => api.get('/api/v1/status/summary/by-tenant').then(r => r.data),
    refetchInterval: 10000,
  })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Activity className="w-7 h-7 text-overseer-600" />
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {statusCards.map((card) => {
          const count = summary?.[card.key] ?? 0
          return (
            <div key={card.key} className={clsx('rounded-xl p-5 border border-gray-200', card.bgLight)}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">{card.label}</p>
                  <p className={clsx('text-3xl font-bold mt-1', card.textColor)}>
                    {isLoading ? '–' : count}
                  </p>
                </div>
                <div className={clsx('w-12 h-12 rounded-full flex items-center justify-center', card.iconBg)}>
                  <card.icon className="w-6 h-6 text-white" />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Total + last updated */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Checks gesamt</p>
            <p className="text-4xl font-bold text-gray-900 mt-1">
              {isLoading ? '–' : summary?.total ?? 0}
            </p>
          </div>
          <p className="text-sm text-gray-400">Aktualisiert alle 10 Sekunden</p>
        </div>
      </div>

      {/* Per-Tenant Breakdown */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-gray-400" />
          <h2 className="font-semibold text-gray-800">Status nach Kunde</h2>
        </div>

        {tenantsLoading ? (
          <div className="p-8 text-center text-gray-400">Lade…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 text-left">Kunde</th>
                <th className="px-6 py-3 text-center text-red-600">Critical</th>
                <th className="px-6 py-3 text-center text-amber-600">Warning</th>
                <th className="px-6 py-3 text-center text-gray-500">Unknown</th>
                <th className="px-6 py-3 text-center text-emerald-600">OK</th>
                <th className="px-6 py-3 text-right text-gray-500">Gesamt</th>
                <th className="px-6 py-3 min-w-[140px]">Verteilung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tenants.map(t => (
                <tr key={t.tenant_id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">
                    {t.tenant_name}
                  </td>
                  <td className="px-6 py-4 text-center">
                    {t.critical > 0
                      ? <Link to={`/errors?tenant_id=${t.tenant_id}`} className="font-bold text-red-600 hover:underline">{t.critical}</Link>
                      : <span className="text-gray-300">–</span>}
                  </td>
                  <td className="px-6 py-4 text-center">
                    {t.warning > 0
                      ? <span className="font-bold text-amber-600">{t.warning}</span>
                      : <span className="text-gray-300">–</span>}
                  </td>
                  <td className="px-6 py-4 text-center">
                    {t.unknown > 0
                      ? <span className="font-semibold text-gray-500">{t.unknown}</span>
                      : <span className="text-gray-300">–</span>}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="font-semibold text-emerald-600">{t.ok}</span>
                  </td>
                  <td className="px-6 py-4 text-right text-gray-500">{t.total}</td>
                  <td className="px-6 py-4">
                    <TenantBar {...t} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
