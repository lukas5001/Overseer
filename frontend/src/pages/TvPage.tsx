import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCheck, Clock } from 'lucide-react'
import clsx from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'
import { api } from '../api/client'
import type { ErrorOverviewItem, StatusSummary } from '../types'

const statusConfig = {
  CRITICAL: { bg: 'bg-red-900/40', text: 'text-red-400', border: 'border-red-700', label: 'CRITICAL' },
  WARNING:  { bg: 'bg-amber-900/40', text: 'text-amber-400', border: 'border-amber-700', label: 'WARNING' },
  UNKNOWN:  { bg: 'bg-gray-700/40', text: 'text-gray-400', border: 'border-gray-600', label: 'UNKNOWN' },
}

export default function TvPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const refreshSec = parseInt(searchParams.get('refresh') ?? '30') || 30
  const pivot = searchParams.get('pivot') === 'true'

  // If token param provided, set it as auth header
  useEffect(() => {
    if (token) {
      localStorage.setItem('overseer_tv_token', token)
    }
  }, [token])

  // Override auth for TV mode
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined

  const { data: errors = [] } = useQuery<ErrorOverviewItem[]>({
    queryKey: ['tv-errors'],
    queryFn: () => {
      const config = authHeaders ? { headers: authHeaders } : {}
      return api.get('/api/v1/status/errors', config).then(r => r.data)
    },
    refetchInterval: refreshSec * 1000,
  })

  const { data: summary } = useQuery<StatusSummary>({
    queryKey: ['tv-summary'],
    queryFn: () => {
      const config = authHeaders ? { headers: authHeaders } : {}
      return api.get('/api/v1/status/summary', config).then(r => r.data)
    },
    refetchInterval: refreshSec * 1000,
  })

  const criticalCount = errors.filter(e => e.status === 'CRITICAL').length
  const warningCount = errors.filter(e => e.status === 'WARNING').length
  const unknownCount = errors.filter(e => e.status === 'UNKNOWN').length

  return (
    <div
      className={clsx('min-h-screen bg-gray-950 text-white p-6', pivot && 'origin-center rotate-90')}
      style={pivot ? { width: '100vh', height: '100vw', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%) rotate(90deg)' } : undefined}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold">Overseer</h1>
          <span className="text-lg text-gray-400">Monitoring</span>
        </div>
        <div className="text-sm text-gray-500">
          {new Date().toLocaleString('de-DE')}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="rounded-xl p-5 bg-red-900/30 border border-red-800">
          <p className="text-sm text-red-400">Critical</p>
          <p className="text-5xl font-bold text-red-400 mt-2">{criticalCount}</p>
        </div>
        <div className="rounded-xl p-5 bg-amber-900/30 border border-amber-800">
          <p className="text-sm text-amber-400">Warning</p>
          <p className="text-5xl font-bold text-amber-400 mt-2">{warningCount}</p>
        </div>
        <div className="rounded-xl p-5 bg-gray-800/50 border border-gray-700">
          <p className="text-sm text-gray-400">Unknown</p>
          <p className="text-5xl font-bold text-gray-400 mt-2">{unknownCount}</p>
        </div>
        <div className="rounded-xl p-5 bg-emerald-900/30 border border-emerald-800">
          <p className="text-sm text-emerald-400">OK</p>
          <p className="text-5xl font-bold text-emerald-400 mt-2">{summary?.ok ?? 0}</p>
        </div>
      </div>

      {/* All OK state */}
      {errors.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <CheckCheck className="w-20 h-20 text-emerald-500 mb-4" />
          <p className="text-3xl font-bold text-emerald-400">Alles in Ordnung</p>
          <p className="text-lg text-gray-500 mt-2">Keine aktuellen Probleme</p>
        </div>
      )}

      {/* Error list */}
      <div className="space-y-2">
        {errors.map(error => {
          const cfg = statusConfig[error.status]
          return (
            <div key={error.service_id}
              className={clsx('flex items-center gap-4 px-5 py-4 rounded-lg border', cfg.bg, cfg.border,
                error.status === 'CRITICAL' && !error.acknowledged && 'animate-pulse-critical')}>
              {/* Status */}
              <div className={clsx('px-3 py-1.5 rounded text-sm font-bold uppercase', cfg.text)}>
                {cfg.label}
              </div>

              {/* Host + Service */}
              <div className="flex-1 min-w-0">
                <p className="text-lg font-semibold text-white truncate">
                  {error.host_display_name || error.host_hostname}
                </p>
                <p className="text-sm text-gray-400 truncate">{error.service_name} · {error.tenant_name}</p>
              </div>

              {/* Message */}
              <div className="text-sm text-gray-400 max-w-xs truncate hidden xl:block">
                {error.status_message}
              </div>

              {/* Value */}
              {error.value !== null && (
                <div className={clsx('text-xl font-bold', cfg.text)}>
                  {error.value}{error.unit}
                </div>
              )}

              {/* Duration */}
              <div className="text-sm text-gray-500 flex items-center gap-1 whitespace-nowrap">
                <Clock className="w-4 h-4" />
                {error.last_state_change_at
                  ? formatDistanceToNow(new Date(error.last_state_change_at), { locale: de, addSuffix: true })
                  : '–'}
              </div>

              {/* ACK badge */}
              {error.acknowledged && (
                <span className="px-2 py-1 rounded text-xs bg-blue-900/50 text-blue-400 font-medium">ACK</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
