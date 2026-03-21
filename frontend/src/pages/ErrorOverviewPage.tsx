import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCheck, Clock, Server, Router, Printer, Shield, Wifi, BellOff, X } from 'lucide-react'
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
  CRITICAL: { label: 'CRITICAL', bg: 'bg-red-100',   text: 'text-red-800',   border: 'border-red-300' },
  WARNING:  { label: 'WARNING',  bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' },
  UNKNOWN:  { label: 'UNKNOWN',  bg: 'bg-gray-100',  text: 'text-gray-700',  border: 'border-gray-300' },
}

const hostTypeIcons: Record<string, React.ElementType> = {
  server: Server, switch: Router, router: Router,
  printer: Printer, firewall: Shield, access_point: Wifi,
}

// ── Downtime Modal ────────────────────────────────────────────────────────────

interface DowntimeModalProps {
  error: ErrorItem
  onClose: () => void
  onSaved: () => void
}

function DowntimeModal({ error, onClose, onSaved }: DowntimeModalProps) {
  const now = new Date()
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000)

  const pad = (d: Date) => d.toISOString().slice(0, 16)  // "YYYY-MM-DDTHH:MM"

  const [startAt, setStartAt] = useState(pad(now))
  const [endAt,   setEndAt]   = useState(pad(inOneHour))
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
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <BellOff className="w-5 h-5 text-overseer-600" />
            <h2 className="text-lg font-semibold text-gray-900">Downtime eintragen</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Target info */}
        <div className="bg-gray-50 rounded-lg px-4 py-3 mb-5 text-sm">
          <p className="font-medium text-gray-800">{error.host_display_name || error.host_hostname}</p>
          <p className="text-gray-500">{error.service_name} · {error.tenant_name}</p>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Von</label>
              <input
                type="datetime-local"
                value={startAt}
                onChange={e => setStartAt(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Bis</label>
              <input
                type="datetime-local"
                value={endAt}
                onChange={e => setEndAt(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Kommentar</label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={2}
              placeholder="z.B. Geplante Wartung – Switch-Update"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 focus:border-transparent outline-none resize-none"
            />
          </div>

          {error_ && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error_}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
          >
            Abbrechen
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-60"
          >
            {mutation.isPending ? 'Speichern…' : 'Downtime speichern'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ErrorOverviewPage() {
  const queryClient = useQueryClient()
  const [downtimeTarget, setDowntimeTarget] = useState<ErrorItem | null>(null)

  const { data: errors = [], isLoading } = useQuery<ErrorItem[]>({
    queryKey: ['error-overview'],
    queryFn: () => api.get('/api/v1/status/errors').then(r => r.data),
    refetchInterval: 10000,
  })

  const ackMutation = useMutation({
    mutationFn: (serviceId: string) => api.post(`/api/v1/status/acknowledge/${serviceId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['error-overview'] }),
  })

  const unackMutation = useMutation({
    mutationFn: (serviceId: string) => api.delete(`/api/v1/status/acknowledge/${serviceId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['error-overview'] }),
  })

  const criticalCount = errors.filter(e => e.status === 'CRITICAL').length
  const warningCount  = errors.filter(e => e.status === 'WARNING').length
  const unknownCount  = errors.filter(e => e.status === 'UNKNOWN').length

  return (
    <div className="p-8">
      {/* Modal */}
      {downtimeTarget && (
        <DowntimeModal
          error={downtimeTarget}
          onClose={() => setDowntimeTarget(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['error-overview'] })}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-7 h-7 text-red-500" />
          <h1 className="text-2xl font-bold text-gray-900">Fehlerübersicht</h1>
          <span className="text-sm text-gray-500 ml-2">
            {errors.length} {errors.length === 1 ? 'Problem' : 'Probleme'}
          </span>
        </div>
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

      {/* No errors */}
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
          const config   = statusConfig[error.status]
          const HostIcon = hostTypeIcons[error.host_type] ?? Server
          const isAcking   = ackMutation.isPending   && ackMutation.variables   === error.service_id
          const isUnacking = unackMutation.isPending && unackMutation.variables === error.service_id

          return (
            <div
              key={error.service_id}
              className={clsx(
                'flex items-center gap-4 px-5 py-4 rounded-lg border bg-white transition-colors',
                config.border,
                error.status === 'CRITICAL' && !error.acknowledged && 'animate-pulse-critical',
                error.acknowledged && 'opacity-70',
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
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700 font-medium">
                    <CheckCheck className="w-3 h-3" /> ACK
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
                  onClick={() => ackMutation.mutate(error.service_id)}
                  disabled={isAcking}
                  className="text-xs px-3 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {isAcking ? '…' : 'ACK'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
