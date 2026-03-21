import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, XCircle, HelpCircle, CheckCircle } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'

interface StatusSummary {
  ok: number
  warning: number
  critical: number
  unknown: number
  total: number
}

const statusCards = [
  { key: 'critical', label: 'Critical', icon: XCircle, color: 'bg-red-500', textColor: 'text-red-600', bgLight: 'bg-red-50' },
  { key: 'warning', label: 'Warning', icon: AlertTriangle, color: 'bg-amber-500', textColor: 'text-amber-600', bgLight: 'bg-amber-50' },
  { key: 'unknown', label: 'Unknown', icon: HelpCircle, color: 'bg-gray-500', textColor: 'text-gray-600', bgLight: 'bg-gray-100' },
  { key: 'ok', label: 'OK', icon: CheckCircle, color: 'bg-emerald-500', textColor: 'text-emerald-600', bgLight: 'bg-emerald-50' },
] as const

export default function DashboardPage() {
  const { data: summary, isLoading } = useQuery<StatusSummary>({
    queryKey: ['status-summary'],
    queryFn: () => api.get('/api/v1/status/summary').then(r => r.data),
  })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Activity className="w-7 h-7 text-overseer-600" />
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statusCards.map((card) => {
          const count = summary?.[card.key] ?? 0
          return (
            <div
              key={card.key}
              className={clsx(
                'rounded-xl p-5 border',
                card.bgLight,
                'border-gray-200'
              )}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">{card.label}</p>
                  <p className={clsx('text-3xl font-bold mt-1', card.textColor)}>
                    {isLoading ? '–' : count}
                  </p>
                </div>
                <div className={clsx('w-12 h-12 rounded-full flex items-center justify-center', card.color)}>
                  <card.icon className="w-6 h-6 text-white" />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Total */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Checks gesamt</p>
            <p className="text-4xl font-bold text-gray-900 mt-1">
              {isLoading ? '–' : summary?.total ?? 0}
            </p>
          </div>
          <p className="text-sm text-gray-400">
            Aktualisiert alle 10 Sekunden
          </p>
        </div>
      </div>

      {/* TODO: Add per-tenant breakdown table */}
      {/* TODO: Add recent state changes feed */}
    </div>
  )
}
