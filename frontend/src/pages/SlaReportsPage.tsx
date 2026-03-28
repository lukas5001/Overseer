import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Download, ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import { format, subDays } from 'date-fns'
import { api } from '../api/client'
import { getRole } from '../api/hooks'
import type { TenantSlaReport, ServiceSlaSummary, Tenant } from '../types'

const periodOptions = [
  { label: '7 Tage', days: 7 },
  { label: '30 Tage', days: 30 },
  { label: '90 Tage', days: 90 },
]

function slaColor(pct: number | null): string {
  if (pct == null) return 'text-gray-400'
  if (pct >= 99.9) return 'text-emerald-700'
  if (pct >= 99.5) return 'text-amber-600'
  return 'text-red-600'
}

function exportCsv(services: ServiceSlaSummary[], tenantName: string, period: string) {
  const header = ['Service', 'Host', 'SLA %', 'Uptime (Min)', 'Downtime (Min)']
  const rows = services.map(s => [
    s.service_name,
    s.host_name,
    s.sla_pct?.toFixed(2) ?? 'N/A',
    String(s.uptime_minutes),
    String(s.downtime_minutes),
  ])
  const csv = [header, ...rows].map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `sla-report-${tenantName}-${period}.csv`
  a.click()
}

export default function SlaReportsPage() {
  const role = getRole()
  const isSuperAdmin = role === 'super_admin'

  const [days, setDays] = useState(30)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [selectedTenantId, setSelectedTenantId] = useState<string>('')

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['tenants'],
    queryFn: () => api.get('/api/v1/tenants/').then(r => r.data),
    enabled: isSuperAdmin,
  })

  // Auto-select first tenant if super_admin
  const activeTenantId = selectedTenantId || tenants[0]?.id || ''

  const start = customStart || format(subDays(new Date(), days), 'yyyy-MM-dd')
  const end = customEnd || format(new Date(), 'yyyy-MM-dd')

  const { data: report, isLoading } = useQuery<TenantSlaReport>({
    queryKey: ['tenant-sla', activeTenantId, start, end],
    queryFn: () => api.get(`/api/v1/sla/tenants/${activeTenantId}/sla-report`, {
      params: { start: `${start}T00:00:00Z`, end: `${end}T23:59:59Z` },
    }).then(r => r.data),
    enabled: !!activeTenantId,
    refetchInterval: false,
  })

  const services = report?.services ?? []
  const tenantName = tenants.find(t => t.id === activeTenantId)?.name ?? 'tenant'

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 className="w-7 h-7 text-overseer-600" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">SLA Reports</h1>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        {/* Tenant dropdown (super admin) */}
        {isSuperAdmin && tenants.length > 0 && (
          <div className="relative">
            <select value={activeTenantId} onChange={e => setSelectedTenantId(e.target.value)}
              className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg pl-3 pr-8 py-2 bg-white dark:bg-gray-700 dark:text-gray-200 appearance-none outline-none focus:ring-2 focus:ring-overseer-500">
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        )}

        {/* Period buttons */}
        <div className="flex gap-1">
          {periodOptions.map(p => (
            <button key={p.days} onClick={() => { setDays(p.days); setCustomStart(''); setCustomEnd('') }}
              className={clsx('px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                days === p.days && !customStart ? 'bg-overseer-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600')}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom date range */}
        <div className="flex items-center gap-2">
          <input type="date" value={customStart || start} onChange={e => setCustomStart(e.target.value)}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500 dark:bg-gray-700 dark:text-gray-200" />
          <span className="text-gray-400 dark:text-gray-500">–</span>
          <input type="date" value={customEnd || end} onChange={e => setCustomEnd(e.target.value)}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-overseer-500 dark:bg-gray-700 dark:text-gray-200" />
        </div>

        {/* CSV Export */}
        <button onClick={() => exportCsv(services, tenantName, `${start}_${end}`)}
          disabled={services.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 ml-auto">
          <Download className="w-4 h-4" /> CSV Export
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-gray-400 dark:text-gray-500 text-sm">Lade SLA-Daten…</div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 text-left">Service</th>
                <th className="px-6 py-3 text-left">Host</th>
                <th className="px-6 py-3 text-right">SLA %</th>
                <th className="px-6 py-3 text-right">Uptime (Min)</th>
                <th className="px-6 py-3 text-right">Downtime (Min)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {services.map(s => (
                <tr key={s.service_id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-3 font-medium text-gray-900 dark:text-gray-100">{s.service_name}</td>
                  <td className="px-6 py-3 text-gray-500 dark:text-gray-400">{s.host_name}</td>
                  <td className={clsx('px-6 py-3 text-right font-bold', slaColor(s.sla_pct))}>
                    {s.sla_pct != null ? `${s.sla_pct.toFixed(2)}%` : 'N/A'}
                  </td>
                  <td className="px-6 py-3 text-right text-gray-600 dark:text-gray-400">{s.uptime_minutes.toLocaleString()}</td>
                  <td className="px-6 py-3 text-right text-gray-600 dark:text-gray-400">{s.downtime_minutes.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {services.length === 0 && (
            <div className="p-8 text-center text-gray-400 dark:text-gray-500 text-sm">Keine SLA-Daten für den gewählten Zeitraum.</div>
          )}
        </div>
      )}
    </div>
  )
}
