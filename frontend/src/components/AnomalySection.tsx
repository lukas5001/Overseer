import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Activity, TrendingUp, AlertTriangle, ChevronDown, ChevronRight,
  Clock, Zap, Ban,
} from 'lucide-react'
import clsx from 'clsx'
import { format } from 'date-fns'
import { api } from '../api/client'

interface AnomalyConfig {
  service_id: string
  tenant_id: string
  enabled: boolean
  sensitivity: number
  min_training_days: number
  status: string
  learning_started_at: string | null
  activated_at: string | null
  service_name: string
  check_type: string
  host_id: string
  hostname: string
}

interface AnomalyEvent {
  id: string
  service_id: string
  detected_at: string
  value: number
  expected_mean: number
  expected_std: number
  z_score: number
  is_false_positive: boolean
  service_name: string
  check_type: string
}

interface Prediction {
  id: string
  service_id: string
  service_name: string
  check_type: string
  host_id: string
  hostname: string
  host_display_name: string | null
  current_value: number
  capacity: number
  rate_per_day: number
  days_until_full: number
  predicted_date: string
  confidence: number
  created_at: string
}

interface Baseline {
  day_of_week: number
  hour_of_day: number
  mean: number
  std_dev: number
  median: number | null
  sample_count: number
}

const dayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function sensitivityLabel(s: number) {
  if (s <= 2.0) return 'Hoch'
  if (s <= 3.0) return 'Normal'
  return 'Niedrig'
}

function statusBadge(status: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    disabled: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Deaktiviert' },
    learning: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Lernphase' },
    active: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Aktiv' },
  }
  const s = map[status] || map.disabled
  return <span className={clsx('px-2 py-0.5 rounded text-xs font-medium', s.bg, s.text)}>{s.label}</span>
}

// ── Baseline Mini Chart ─────────────────────────────────────────────────────

function BaselineChart({ baselines, sensitivity }: { baselines: Baseline[]; sensitivity: number }) {
  if (baselines.length === 0) return <p className="text-sm text-gray-400">Noch keine Baselines berechnet.</p>

  const maxVal = Math.max(...baselines.map(b => b.mean + b.std_dev * sensitivity))
  const h = 120
  const w = 672 // 168 buckets × 4px

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h + 20}`} className="w-full min-w-[672px]" preserveAspectRatio="xMinYMin">
        {/* Day labels */}
        {dayNames.map((d, i) => (
          <text key={d} x={i * 96 + 48} y={h + 14} textAnchor="middle" className="fill-gray-400" style={{ fontSize: 9 }}>{d}</text>
        ))}
        {/* Expected range (green band) */}
        <path
          d={baselines.map((b, i) => {
            const x = i * 4
            const yLow = h - ((b.mean - b.std_dev * sensitivity) / maxVal) * h
            return `${i === 0 ? 'M' : 'L'}${x},${Math.max(0, Math.min(h, yLow))}`
          }).join(' ') + baselines.slice().reverse().map((b, i) => {
            const x = (baselines.length - 1 - i) * 4
            const yHigh = h - ((b.mean + b.std_dev * sensitivity) / maxVal) * h
            return `L${x},${Math.max(0, Math.min(h, yHigh))}`
          }).join(' ') + 'Z'}
          fill="rgb(34, 197, 94)" fillOpacity={0.15}
        />
        {/* Mean line */}
        <path
          d={baselines.map((b, i) => {
            const x = i * 4
            const y = h - (b.mean / maxVal) * h
            return `${i === 0 ? 'M' : 'L'}${x},${Math.max(0, Math.min(h, y))}`
          }).join(' ')}
          fill="none" stroke="rgb(34, 197, 94)" strokeWidth={1.5}
        />
      </svg>
    </div>
  )
}

// ── Anomaly Section for Host Detail ─────────────────────────────────────────

export default function AnomalySection({ hostId, services }: { hostId: string; services: { service_id: string; name: string; check_type: string }[] }) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [selectedService, setSelectedService] = useState<string | null>(null)
  const [showBaselines, setShowBaselines] = useState(false)

  const { data: configs = [] } = useQuery<AnomalyConfig[]>({
    queryKey: ['anomaly-configs', hostId],
    queryFn: () => api.get('/api/v1/anomaly/config', { params: { host_id: hostId } }).then(r => r.data),
    enabled: expanded,
  })

  const { data: events = [] } = useQuery<AnomalyEvent[]>({
    queryKey: ['anomaly-events', hostId],
    queryFn: () => api.get('/api/v1/anomaly/events', { params: { host_id: hostId, limit: 20 } }).then(r => r.data),
    enabled: expanded,
  })

  const { data: predictions = [] } = useQuery<Prediction[]>({
    queryKey: ['predictions', hostId],
    queryFn: () => api.get('/api/v1/anomaly/predictions', { params: { host_id: hostId } }).then(r => r.data),
    enabled: expanded,
  })

  const { data: baselines = [] } = useQuery<Baseline[]>({
    queryKey: ['anomaly-baselines', selectedService],
    queryFn: () => api.get(`/api/v1/anomaly/baselines/${selectedService}`).then(r => r.data),
    enabled: !!selectedService && showBaselines,
  })

  const toggleMutation = useMutation({
    mutationFn: ({ serviceId, enabled, sensitivity }: { serviceId: string; enabled: boolean; sensitivity?: number }) =>
      api.put(`/api/v1/anomaly/config/${serviceId}`, { enabled, sensitivity }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['anomaly-configs', hostId] }),
  })

  const fpMutation = useMutation({
    mutationFn: (eventId: string) => api.patch(`/api/v1/anomaly/events/${eventId}`, { is_false_positive: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['anomaly-events', hostId] }),
  })

  const activeConfigs = configs.filter(c => c.enabled)
  const activeAnomalies = events.filter(e => !e.is_false_positive)
  const configMap = new Map(configs.map(c => [c.service_id, c]))

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-6 py-4 flex items-center justify-between border-b border-gray-100 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-overseer-600" />
          <div className="text-left">
            <h2 className="font-semibold text-gray-800">Anomaly Detection & Predictions</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {activeConfigs.length} aktive Konfigurationen
              {activeAnomalies.length > 0 && ` · ${activeAnomalies.length} Anomalien`}
              {predictions.length > 0 && ` · ${predictions.length} Prognosen`}
            </p>
          </div>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>

      {expanded && (
        <div className="p-6 space-y-6">
          {/* Service Toggles */}
          <div>
            <h3 className="text-xs font-medium text-gray-600 uppercase tracking-wider mb-3">Services konfigurieren</h3>
            <div className="space-y-2">
              {services.map(svc => {
                const cfg = configMap.get(svc.service_id)
                const isEnabled = cfg?.enabled ?? false
                const status = cfg?.status || 'disabled'
                return (
                  <div key={svc.service_id} className="flex items-center justify-between px-4 py-2.5 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={() => toggleMutation.mutate({ serviceId: svc.service_id, enabled: !isEnabled })}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:bg-overseer-600 transition-colors after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
                      </label>
                      <div>
                        <span className="text-sm font-medium text-gray-800">{svc.name}</span>
                        <span className="text-xs text-gray-400 ml-2">{svc.check_type}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {cfg && (
                        <select
                          value={cfg.sensitivity}
                          onChange={e => toggleMutation.mutate({ serviceId: svc.service_id, enabled: true, sensitivity: parseFloat(e.target.value) })}
                          disabled={!isEnabled}
                          className="text-xs border border-gray-200 rounded px-2 py-1 outline-none disabled:opacity-50"
                        >
                          <option value="2.0">Hoch (2σ)</option>
                          <option value="3.0">Normal (3σ)</option>
                          <option value="4.0">Niedrig (4σ)</option>
                        </select>
                      )}
                      {statusBadge(status)}
                      {cfg && (
                        <button
                          onClick={() => { setSelectedService(svc.service_id); setShowBaselines(!showBaselines || selectedService !== svc.service_id) }}
                          className="text-xs text-overseer-600 hover:text-overseer-700"
                        >
                          Baselines
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Baselines Chart */}
          {showBaselines && selectedService && (
            <div>
              <h3 className="text-xs font-medium text-gray-600 uppercase tracking-wider mb-3">
                Baseline – {services.find(s => s.service_id === selectedService)?.name}
              </h3>
              <div className="bg-gray-50 rounded-lg p-4">
                <BaselineChart
                  baselines={baselines}
                  sensitivity={configMap.get(selectedService)?.sensitivity ?? 3.0}
                />
                <p className="text-xs text-gray-400 mt-2">Grüne Fläche: erwarteter Bereich ({sensitivityLabel(configMap.get(selectedService)?.sensitivity ?? 3.0)}). Linie: Mittelwert.</p>
              </div>
            </div>
          )}

          {/* Predictions */}
          {predictions.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-gray-600 uppercase tracking-wider mb-3">Kapazitätsprognosen</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {predictions.map(p => {
                  const urgencyColor =
                    p.days_until_full < 7 ? 'border-red-300 bg-red-50' :
                    p.days_until_full < 14 ? 'border-amber-300 bg-amber-50' :
                    p.days_until_full < 30 ? 'border-yellow-300 bg-yellow-50' :
                    'border-gray-200 bg-gray-50'
                  const urgencyIcon =
                    p.days_until_full < 7 ? <AlertTriangle className="w-5 h-5 text-red-500" /> :
                    p.days_until_full < 14 ? <AlertTriangle className="w-5 h-5 text-amber-500" /> :
                    <Clock className="w-5 h-5 text-yellow-500" />
                  return (
                    <div key={p.id} className={clsx('rounded-lg border p-4', urgencyColor)}>
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{p.service_name}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Voll in {Math.round(p.days_until_full)} Tagen ({p.predicted_date})
                          </p>
                        </div>
                        {urgencyIcon}
                      </div>
                      <div className="mt-3 space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-500">Aktuell</span>
                          <span className="font-medium">{p.current_value.toFixed(1)}% / {p.capacity}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className={clsx('h-2 rounded-full', p.current_value > 90 ? 'bg-red-500' : p.current_value > 75 ? 'bg-amber-500' : 'bg-emerald-500')}
                            style={{ width: `${Math.min(100, p.current_value)}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-500">Wachstum</span>
                          <span className="font-medium">{p.rate_per_day.toFixed(2)}%/Tag</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-500">Konfidenz</span>
                          <span className="font-medium">{(p.confidence * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Anomaly Events */}
          {events.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-gray-600 uppercase tracking-wider mb-3">Letzte Anomalien</h3>
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Zeitpunkt</th>
                      <th className="px-4 py-2 text-left">Service</th>
                      <th className="px-4 py-2 text-right">Wert</th>
                      <th className="px-4 py-2 text-right">Erwartet</th>
                      <th className="px-4 py-2 text-right">Z-Score</th>
                      <th className="px-4 py-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {events.map(e => (
                      <tr key={e.id} className={clsx('hover:bg-gray-50', e.is_false_positive && 'opacity-50')}>
                        <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">
                          {format(new Date(e.detected_at), 'dd.MM. HH:mm')}
                        </td>
                        <td className="px-4 py-2 text-gray-700">{e.service_name}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{e.value.toFixed(2)}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-gray-400">
                          {(e.expected_mean - e.expected_std).toFixed(1)}–{(e.expected_mean + e.expected_std).toFixed(1)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span className={clsx('font-mono text-xs font-medium',
                            Math.abs(e.z_score) > 4 ? 'text-red-600' : 'text-amber-600')}>
                            {e.z_score > 0 ? '+' : ''}{e.z_score.toFixed(1)}σ
                          </span>
                        </td>
                        <td className="px-4 py-2 text-center">
                          {e.is_false_positive ? (
                            <span className="text-xs text-gray-400 flex items-center justify-center gap-1">
                              <Ban className="w-3 h-3" /> False Positive
                            </span>
                          ) : (
                            <button
                              onClick={() => fpMutation.mutate(e.id)}
                              className="text-xs text-gray-400 hover:text-red-600 flex items-center justify-center gap-1 mx-auto"
                              title="Als False Positive markieren"
                            >
                              <Zap className="w-3 h-3" /> Anomalie
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {events.length === 0 && predictions.length === 0 && activeConfigs.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">
              Aktivieren Sie die Anomaly Detection für einen Service, um Anomalien und Prognosen zu erhalten.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Predictions Dashboard Widget ────────────────────────────────────────────

export function PredictionsWidget() {
  const { data: predictions = [], isLoading } = useQuery<Prediction[]>({
    queryKey: ['all-predictions'],
    queryFn: () => api.get('/api/v1/anomaly/predictions').then(r => r.data),
    refetchInterval: 60_000,
  })

  if (isLoading) return <div className="text-sm text-gray-400 p-4">Lade Prognosen…</div>
  if (predictions.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-amber-500" />
        <h3 className="font-semibold text-sm text-gray-800">Kapazitätsprognosen</h3>
        <span className="ml-auto text-xs text-gray-400">{predictions.length} aktiv</span>
      </div>
      <div className="divide-y divide-gray-100">
        {predictions.slice(0, 10).map(p => (
          <div key={p.id} className="px-5 py-3 flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-gray-800">{p.hostname}</span>
              <span className="text-xs text-gray-400 ml-2">{p.service_name}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-gray-500">{p.current_value.toFixed(1)}%</span>
              <span className={clsx('text-xs font-medium',
                p.days_until_full < 7 ? 'text-red-600' :
                p.days_until_full < 14 ? 'text-amber-600' :
                p.days_until_full < 30 ? 'text-yellow-600' : 'text-gray-500')}>
                {Math.round(p.days_until_full)}d
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
