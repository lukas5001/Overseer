import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCheck, Clock, Filter, Server, Router } from 'lucide-react'
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
  status: 'WARNING' | 'CRITICAL' | 'UNKNOWN'
  state_type: 'SOFT' | 'HARD'
  status_message: string | null
  value: number | null
  unit: string | null
  last_check_at: string | null
  last_state_change_at: string | null
  duration_seconds: number | null
  acknowledged: boolean
  acknowledged_by: string | null
  in_downtime: boolean
}

const statusConfig = {
  CRITICAL: { label: 'CRITICAL', bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300', dot: 'bg-red-500' },
  WARNING: { label: 'WARNING', bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300', dot: 'bg-amber-500' },
  UNKNOWN: { label: 'UNKNOWN', bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-300', dot: 'bg-gray-500' },
}

const hostTypeIcons: Record<string, typeof Server> = {
  server: Server,
  switch: Router,
  router: Router,
}

export default function ErrorOverviewPage() {
  const { data: errors = [], isLoading } = useQuery<ErrorItem[]>({
    queryKey: ['error-overview'],
    queryFn: () => api.get('/api/v1/status/errors').then(r => r.data),
  })

  const criticalCount = errors.filter(e => e.status === 'CRITICAL').length
  const warningCount = errors.filter(e => e.status === 'WARNING').length
  const unknownCount = errors.filter(e => e.status === 'UNKNOWN').length

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-7 h-7 text-red-500" />
          <h1 className="text-2xl font-bold text-gray-900">Fehlerübersicht</h1>
          <span className="text-sm text-gray-500 ml-2">
            {errors.length} {errors.length === 1 ? 'Problem' : 'Probleme'}
          </span>
        </div>

        {/* Quick filters */}
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

      {/* No errors state */}
      {!isLoading && errors.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
            <CheckCheck className="w-8 h-8 text-emerald-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900">Alles in Ordnung</h2>
          <p className="text-gray-500 mt-1">Keine aktuellen Probleme.</p>
        </div>
      )}

      {/* Error list */}
      <div className="space-y-2">
        {errors.map((error) => {
          const config = statusConfig[error.status]
          const HostIcon = hostTypeIcons[error.host_type] ?? Server

          return (
            <div
              key={error.service_id}
              className={clsx(
                'flex items-center gap-4 px-5 py-4 rounded-lg border bg-white transition-colors',
                config.border,
                error.status === 'CRITICAL' && !error.acknowledged && 'animate-pulse-critical'
              )}
            >
              {/* Status badge */}
              <div className={clsx('px-3 py-1 rounded text-xs font-bold uppercase whitespace-nowrap', config.bg, config.text)}>
                {config.label}
              </div>

              {/* Host info */}
              <div className="flex items-center gap-2 min-w-[200px]">
                <HostIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {error.host_display_name || error.host_hostname}
                  </p>
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
              <div className="flex items-center gap-1 text-xs text-gray-400 min-w-[120px] text-right">
                <Clock className="w-3.5 h-3.5" />
                {error.last_state_change_at
                  ? formatDistanceToNow(new Date(error.last_state_change_at), { locale: de, addSuffix: true })
                  : '–'
                }
              </div>

              {/* Acknowledged */}
              {error.acknowledged && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                  <CheckCheck className="w-3 h-3" /> ACK
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
