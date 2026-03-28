import React, { useState } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Play, Search,
  CheckCircle, Clock, Plus, X, Trash2, TrendingUp, Pencil, Settings2, Power, Copy,
  Monitor, ClipboardCopy, KeyRound, Download, Shield, ShieldX,
  AlertTriangle, CheckCircle2,
} from 'lucide-react'
import { getHostTypeIcon, getCheckTypeDef, getCheckTypeLabel, getAvailableCheckTypes, groupCheckTypesByCategory } from '../lib/constants'
import RegistryConfigFields from '../components/RegistryConfigFields'
import type { DiskConfig } from '../components/DiskConfigEditor'
import { getStatusConfig } from '../components/StatusBadge'
import clsx from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'
import { api } from '../api/client'
import ConfirmDialog from '../components/ConfirmDialog'
import AnomalySection from '../components/AnomalySection'

// ── Copyable code block ─────────────────────────────────────────────────────

function CodeBlock({ children, className }: { children: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className={clsx('relative group', className)}>
      <pre className="bg-gray-900 rounded px-3 py-2 text-emerald-400 text-xs font-mono whitespace-pre-wrap break-all overflow-x-auto">{children}</pre>
      <button
        onClick={() => { navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
        className="absolute top-1.5 right-1.5 p-1 rounded bg-gray-700/80 text-gray-300 hover:text-white hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Kopieren"
      >
        {copied ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
      </button>
    </div>
  )
}

interface Host {
  id: string
  tenant_id: string
  collector_id: string | null
  hostname: string
  display_name: string | null
  ip_address: string | null
  host_type_id: string
  host_type_name: string | null
  host_type_icon: string | null
  host_type_agent_capable: boolean
  host_type_snmp_enabled: boolean
  host_type_ip_required: boolean
  host_type_os_family: string | null
  snmp_community: string | null
  snmp_version: string | null
  tags: string[]
  agent_managed: boolean
  active: boolean
  created_at: string
}

interface AgentTokenInfo {
  active: boolean
  last_seen_at: string | null
  agent_version: string | null
  agent_os: string | null
  created_at: string
}

interface ServiceStatus {
  service_id: string
  host_id: string
  tenant_id: string
  status: 'OK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN' | 'NO_DATA'
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

interface ServiceItem {
  id: string
  name: string
  check_type: string
  check_config: Record<string, unknown>
  interval_seconds: number
  threshold_warn: number | null
  threshold_crit: number | null
  max_check_attempts: number
  retry_interval_seconds: number
  check_mode: string
  active: boolean
}


const statusOrder: Record<string, number> = { CRITICAL: 0, WARNING: 1, NO_DATA: 2, UNKNOWN: 3, OK: 4 }

// ── Sparkline (inline SVG, no dependencies) ────────────────────────────────────

function Sparkline({ values, color = '#3b82f6' }: { values: number[]; color?: string }) {
  if (values.length < 2) return null
  const w = 80, h = 24
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

// ── History Modal ──────────────────────────────────────────────────────────────

interface HistoryPoint { time: string; status: string; value: number | null; unit: string | null; message: string | null }

interface HistoryModalProps {
  serviceId: string
  serviceName: string
  thresholdWarn: number | null
  thresholdCrit: number | null
  onClose: () => void
}

const STATUS_COLORS: Record<string, string> = {
  OK: '#10b981', WARNING: '#f59e0b', CRITICAL: '#ef4444', NO_DATA: '#f97316', UNKNOWN: '#9ca3af',
}

function formatTimeLabel(date: Date, hours: number): string {
  if (hours <= 24) return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  if (hours <= 168) return date.toLocaleDateString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
}

function formatTooltipTime(date: Date): string {
  return date.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function InteractiveChart({ history, unit, hours, thresholdWarn, thresholdCrit }: {
  history: HistoryPoint[]
  unit: string
  hours: number
  thresholdWarn: number | null
  thresholdCrit: number | null
}) {
  const [hover, setHover] = useState<{ x: number; y: number; point: HistoryPoint; chartY: number } | null>(null)
  const svgRef = React.useRef<SVGSVGElement>(null)

  const withValues = history.filter(p => p.value !== null)
  if (withValues.length === 0) return null

  const values = withValues.map(p => p.value as number)
  const times = withValues.map(p => new Date(p.time).getTime())

  // Chart dimensions
  const W = 720, H = 200
  const PAD = { top: 12, right: 16, bottom: 32, left: 52 }
  const cw = W - PAD.left - PAD.right
  const ch = H - PAD.top - PAD.bottom

  // Y range — include thresholds so they're always visible
  const allVals = [...values]
  if (thresholdWarn !== null) allVals.push(thresholdWarn)
  if (thresholdCrit !== null) allVals.push(thresholdCrit)
  let yMin = Math.min(...allVals)
  let yMax = Math.max(...allVals)
  const yPad = (yMax - yMin) * 0.1 || 1
  yMin = Math.max(0, yMin - yPad)
  yMax = yMax + yPad

  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  const tRange = tMax - tMin || 1

  const toX = (t: number) => PAD.left + ((t - tMin) / tRange) * cw
  const toY = (v: number) => PAD.top + ch - ((v - yMin) / (yMax - yMin)) * ch

  // Generate Y-axis ticks (5 ticks)
  const yTicks: number[] = []
  for (let i = 0; i <= 4; i++) {
    yTicks.push(yMin + (i / 4) * (yMax - yMin))
  }

  // Generate X-axis ticks (6-8 ticks)
  const xTickCount = hours <= 6 ? 6 : 8
  const xTicks: number[] = []
  for (let i = 0; i <= xTickCount; i++) {
    xTicks.push(tMin + (i / xTickCount) * tRange)
  }

  // Line path
  const linePath = withValues.map((p, i) => {
    const x = toX(times[i])
    const y = toY(p.value as number)
    return `${i === 0 ? 'M' : 'L'}${x},${y}`
  }).join(' ')

  // Area fill (gradient)
  const areaPath = linePath + ` L${toX(times[times.length - 1])},${PAD.top + ch} L${toX(times[0])},${PAD.top + ch} Z`

  // Status bar segments at the bottom
  const statusSegments: { x1: number; x2: number; color: string }[] = []
  for (let i = 0; i < history.length; i++) {
    const t1 = new Date(history[i].time).getTime()
    const t2 = i < history.length - 1 ? new Date(history[i + 1].time).getTime() : tMax
    if (t1 < tMin) continue
    statusSegments.push({ x1: toX(t1), x2: toX(t2), color: STATUS_COLORS[history[i].status] ?? '#9ca3af' })
  }

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const scaleX = W / rect.width
    const mouseX = (e.clientX - rect.left) * scaleX

    if (mouseX < PAD.left || mouseX > W - PAD.right) { setHover(null); return }

    // Find nearest point
    const mouseT = tMin + ((mouseX - PAD.left) / cw) * tRange
    let nearest = 0
    let minDist = Infinity
    for (let i = 0; i < withValues.length; i++) {
      const d = Math.abs(times[i] - mouseT)
      if (d < minDist) { minDist = d; nearest = i }
    }
    const pt = withValues[nearest]
    setHover({
      x: toX(times[nearest]),
      y: (e.clientY - rect.top) * (H / rect.height),
      point: pt,
      chartY: toY(pt.value as number),
    })
  }

  const fmtVal = (v: number) => {
    if (Number.isInteger(v)) return v.toString()
    return v.toFixed(v < 10 ? 2 : 1)
  }

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
        style={{ cursor: 'crosshair' }}
      >
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {yTicks.map((v, i) => (
          <g key={`y${i}`}>
            <line x1={PAD.left} x2={W - PAD.right} y1={toY(v)} y2={toY(v)} stroke="#e5e7eb" strokeWidth="0.5" />
            <text x={PAD.left - 6} y={toY(v) + 3} textAnchor="end" fontSize="9" fill="#9ca3af" fontFamily="monospace">{fmtVal(v)}{unit}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <g key={`x${i}`}>
            <line x1={toX(t)} x2={toX(t)} y1={PAD.top} y2={PAD.top + ch} stroke="#f3f4f6" strokeWidth="0.5" />
            <text x={toX(t)} y={H - 4} textAnchor="middle" fontSize="9" fill="#9ca3af">{formatTimeLabel(new Date(t), hours)}</text>
          </g>
        ))}

        {/* Threshold lines */}
        {thresholdWarn !== null && thresholdWarn >= yMin && thresholdWarn <= yMax && (
          <g>
            <line x1={PAD.left} x2={W - PAD.right} y1={toY(thresholdWarn)} y2={toY(thresholdWarn)} stroke="#f59e0b" strokeWidth="1" strokeDasharray="6,3" />
            <text x={W - PAD.right + 4} y={toY(thresholdWarn) + 3} fontSize="8" fill="#f59e0b" fontWeight="bold">W</text>
          </g>
        )}
        {thresholdCrit !== null && thresholdCrit >= yMin && thresholdCrit <= yMax && (
          <g>
            <line x1={PAD.left} x2={W - PAD.right} y1={toY(thresholdCrit)} y2={toY(thresholdCrit)} stroke="#ef4444" strokeWidth="1" strokeDasharray="6,3" />
            <text x={W - PAD.right + 4} y={toY(thresholdCrit) + 3} fontSize="8" fill="#ef4444" fontWeight="bold">C</text>
          </g>
        )}

        {/* Area fill */}
        <path d={areaPath} fill="url(#areaGrad)" />

        {/* Data line */}
        <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />

        {/* Data points (only if few enough) */}
        {withValues.length <= 100 && withValues.map((p, i) => (
          <circle key={i} cx={toX(times[i])} cy={toY(p.value as number)} r="2" fill={STATUS_COLORS[p.status] ?? '#3b82f6'} />
        ))}

        {/* Status bar at bottom */}
        {statusSegments.map((seg, i) => (
          <rect key={i} x={seg.x1} y={PAD.top + ch + 2} width={Math.max(1, seg.x2 - seg.x1)} height="4" rx="1" fill={seg.color} />
        ))}

        {/* Hover crosshair */}
        {hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={PAD.top} y2={PAD.top + ch} stroke="#6b7280" strokeWidth="0.5" strokeDasharray="3,2" />
            <circle cx={hover.x} cy={hover.chartY} r="4" fill="white" stroke="#3b82f6" strokeWidth="2" />
          </g>
        )}
      </svg>

      {/* Tooltip */}
      {hover && (
        <div
          className="absolute z-10 pointer-events-none bg-gray-900 text-white text-xs rounded-lg shadow-lg px-3 py-2 max-w-xs"
          style={{
            left: `${Math.min(85, Math.max(5, (hover.x / W) * 100))}%`,
            top: '4px',
            transform: 'translateX(-50%)',
          }}
        >
          <p className="font-mono text-gray-300">{formatTooltipTime(new Date(hover.point.time))}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[hover.point.status] }} />
            <span className="font-bold">{hover.point.value !== null ? `${hover.point.value}${hover.point.unit ?? ''}` : '–'}</span>
            <span className="text-gray-400">{hover.point.status}</span>
          </div>
          {hover.point.message && <p className="text-gray-400 mt-1 truncate">{hover.point.message}</p>}
        </div>
      )}
    </div>
  )
}

function HistoryModal({ serviceId, serviceName, thresholdWarn, thresholdCrit, onClose }: HistoryModalProps) {
  const [hours, setHours] = useState(24)
  const [tab, setTab] = useState<'chart' | 'table'>('chart')

  const { data: history = [], isLoading } = useQuery<HistoryPoint[]>({
    queryKey: ['history', serviceId, hours],
    queryFn: () => api.get(`/api/v1/history/${serviceId}?hours=${hours}`).then(r => r.data),
  })

  const { data: summary } = useQuery<Record<string, number>>({
    queryKey: ['history-summary', serviceId, hours],
    queryFn: () => api.get(`/api/v1/history/${serviceId}/summary?hours=${hours}`).then(r => r.data),
  })

  const hasValues = history.some(p => p.value !== null)
  const unit = history.find(p => p.unit)?.unit ?? ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-overseer-600" />
            <h2 className="text-lg font-semibold text-gray-900">{serviceName}</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {[
                { key: 'chart' as const, label: 'Graph' },
                { key: 'table' as const, label: 'Tabelle' },
              ].map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={clsx('px-3 py-1 text-xs font-medium rounded-md transition-colors',
                    tab === t.key ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'
                  )}>{t.label}</button>
              ))}
            </div>
            <select value={hours} onChange={e => setHours(Number(e.target.value))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-overseer-500">
              <option value={1}>1h</option>
              <option value={6}>6h</option>
              <option value={24}>24h</option>
              <option value={168}>7 Tage</option>
              <option value={720}>30 Tage</option>
            </select>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* Summary stats */}
        {summary && summary.total > 0 && (
          <div className="grid grid-cols-5 gap-2 mb-4">
            {[
              { label: 'Min', val: summary.min != null ? `${summary.min}${unit}` : '–', color: 'text-blue-600' },
              { label: 'Durchschnitt', val: summary.avg != null ? `${summary.avg}${unit}` : '–', color: 'text-gray-800' },
              { label: 'Max', val: summary.max != null ? `${summary.max}${unit}` : '–', color: 'text-blue-600' },
              { label: 'Checks', val: summary.total, color: 'text-gray-800' },
              { label: 'Verfügbarkeit', val: summary.total > 0 ? `${Math.round(((summary.ok_count ?? 0) / summary.total) * 100)}%` : '–', color: (summary.ok_count ?? 0) === summary.total ? 'text-emerald-600' : 'text-amber-600' },
            ].map(s => (
              <div key={s.label} className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">{s.label}</p>
                <p className={clsx('text-sm font-bold mt-0.5', s.color)}>{s.val}</p>
              </div>
            ))}
          </div>
        )}

        {isLoading ? (
          <p className="text-center text-gray-400 py-12">Lade…</p>
        ) : history.length === 0 ? (
          <p className="text-center text-gray-400 py-12">Keine Daten für diesen Zeitraum.</p>
        ) : (
          <>
            {/* Chart tab */}
            {tab === 'chart' && (
              <div className="space-y-3">
                {hasValues ? (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <InteractiveChart history={history} unit={unit} hours={hours} thresholdWarn={thresholdWarn} thresholdCrit={thresholdCrit} />
                  </div>
                ) : (
                  /* No numeric values — show status timeline only */
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-xs text-gray-500 mb-3">Kein numerischer Wert — Status-Verlauf:</p>
                    <div className="flex gap-0.5 h-8 rounded overflow-hidden">
                      {history.map((p, i) => {
                        const w = history.length > 1 ? 100 / history.length : 100
                        return (
                          <div key={i} style={{ width: `${w}%`, backgroundColor: STATUS_COLORS[p.status] ?? '#9ca3af' }}
                            title={`${formatTooltipTime(new Date(p.time))}: ${p.status}${p.message ? ' — ' + p.message : ''}`}
                            className="min-w-[2px] hover:opacity-80 transition-opacity cursor-default" />
                        )
                      })}
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-[10px] text-gray-400">{formatTimeLabel(new Date(history[0].time), hours)}</span>
                      <span className="text-[10px] text-gray-400">{formatTimeLabel(new Date(history[history.length - 1].time), hours)}</span>
                    </div>
                  </div>
                )}

                {/* Status distribution bar */}
                {summary && summary.total > 0 && (
                  <div>
                    <div className="flex gap-0.5 h-2 rounded-full overflow-hidden">
                      {(['OK', 'WARNING', 'CRITICAL', 'UNKNOWN', 'NO_DATA'] as const).map(s => {
                        const key = s === 'NO_DATA' ? 'no_data_count' : `${s.toLowerCase()}_count`
                        const count = (summary as any)[key] ?? 0
                        if (count === 0) return null
                        return <div key={s} style={{ width: `${(count / summary.total) * 100}%`, backgroundColor: STATUS_COLORS[s] }} />
                      })}
                    </div>
                    <div className="flex gap-3 mt-1.5">
                      {(['OK', 'WARNING', 'CRITICAL', 'UNKNOWN', 'NO_DATA'] as const).map(s => {
                        const key = s === 'NO_DATA' ? 'no_data_count' : `${s.toLowerCase()}_count`
                        const count = (summary as any)[key] ?? 0
                        if (count === 0) return null
                        return (
                          <span key={s} className="flex items-center gap-1 text-[10px] text-gray-500">
                            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: STATUS_COLORS[s] }} />
                            {s === 'NO_DATA' ? 'NO DATA' : s} ({count})
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Table tab */}
            {tab === 'table' && (
              <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left">Zeit</th>
                      <th className="px-4 py-2 text-left">Status</th>
                      <th className="px-4 py-2 text-right">Wert</th>
                      <th className="px-4 py-2 text-left">Meldung</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {[...history].reverse().map((p, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-1.5 text-gray-400 font-mono whitespace-nowrap">
                          {formatTooltipTime(new Date(p.time))}
                        </td>
                        <td className="px-4 py-1.5">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: STATUS_COLORS[p.status] }} />
                            <span className="font-bold" style={{ color: STATUS_COLORS[p.status] }}>{p.status === 'NO_DATA' ? 'NO DATA' : p.status}</span>
                          </span>
                        </td>
                        <td className="px-4 py-1.5 text-right font-mono text-gray-700">
                          {p.value !== null ? `${p.value}${p.unit ?? ''}` : '–'}
                        </td>
                        <td className="px-4 py-1.5 text-gray-500 truncate max-w-sm">{p.message ?? '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── SparklineCell – fetches 2h history and renders inline ─────────────────────

function SparklineCell({ serviceId, onClick }: { serviceId: string; onClick: () => void }) {
  const { data: history = [] } = useQuery<{ value: number | null }[]>({
    queryKey: ['sparkline', serviceId],
    queryFn: () => api.get(`/api/v1/history/${serviceId}?hours=2`).then(r => r.data),
    staleTime: 60000,
  })
  const values = history.filter(p => p.value !== null).map(p => p.value as number)
  return (
    <button onClick={onClick} className="text-gray-300 hover:text-overseer-500 transition-colors flex items-center gap-1" title="Verlauf anzeigen">
      {values.length >= 2 ? <Sparkline values={values} /> : <TrendingUp className="w-4 h-4" />}
    </button>
  )
}

// ── Check type helpers (registry-driven) ─────────────────────────────────────

// ── SSL Certificate Detail Panel ───────────────────────────────────────────────

function SslCertificatePanel({ serviceId }: { serviceId: string }) {
  const { data: sslLatest } = useQuery<{ metadata: Record<string, unknown>; time: string; status: string } | null>({
    queryKey: ['ssl-latest', serviceId],
    queryFn: () => api.get(`/api/v1/history/${serviceId}/ssl-latest`).then(r => r.data),
    staleTime: 30000,
  })
  const { data: sslHistory = [] } = useQuery<{ time: string; days_until_expiry: number }[]>({
    queryKey: ['ssl-history', serviceId],
    queryFn: () => api.get(`/api/v1/history/${serviceId}/ssl-history?hours=4320`).then(r => r.data),
    staleTime: 60000,
  })

  if (!sslLatest?.metadata) return null

  const meta = sslLatest.metadata
  const days = meta.days_until_expiry as number | undefined
  const notAfter = meta.not_after as string | undefined
  const notBefore = meta.not_before as string | undefined
  const issuer = meta.issuer as string | undefined
  const subject = meta.subject as string | undefined
  const serial = meta.serial_number as string | undefined
  const sans = meta.sans as string[] | undefined
  const signatureAlg = meta.signature_algorithm as string | undefined
  const keyType = meta.key_type as string | undefined
  const keyBits = meta.key_size as number | undefined
  const chainValid = meta.chain_valid as boolean | undefined
  const hostnameMatch = meta.hostname_valid as boolean | undefined
  const ocspStatus = meta.ocsp_status as string | undefined
  const selfSigned = meta.is_self_signed as boolean | undefined

  // Days remaining color
  const getDaysColor = (d: number | undefined) => {
    if (d === undefined) return 'var(--color-gray-500)'
    if (d <= 0) return '#dc2626'
    if (d <= 14) return '#dc2626'
    if (d <= 30) return '#d97706'
    return '#16a34a'
  }

  const Check = ({ ok, label }: { ok: boolean | undefined; label: string }) => {
    if (ok === undefined) return null
    return (
      <div className="flex items-center gap-2">
        {ok ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
        ) : (
          <ShieldX className="w-4 h-4 text-red-500 flex-shrink-0" />
        )}
        <span className="text-sm text-gray-700">{label}</span>
      </div>
    )
  }

  return (
    <div className="mt-4 space-y-4">
      {/* Certificate Details Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-5 h-5 text-overseer-600" />
          <h3 className="font-semibold text-gray-800">Certificate Details</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
          {subject && (
            <div className="flex justify-between py-1.5 border-b border-gray-50">
              <span className="text-gray-500 font-medium">Subject</span>
              <span className="text-gray-800 font-mono text-xs">{subject}</span>
            </div>
          )}
          {issuer && (
            <div className="flex justify-between py-1.5 border-b border-gray-50">
              <span className="text-gray-500 font-medium">Issuer</span>
              <span className="text-gray-800 text-xs">{issuer}</span>
            </div>
          )}
          {notBefore && (
            <div className="flex justify-between py-1.5 border-b border-gray-50">
              <span className="text-gray-500 font-medium">Valid From</span>
              <span className="text-gray-800 text-xs">{notBefore}</span>
            </div>
          )}
          {notAfter && (
            <div className="flex justify-between py-1.5 border-b border-gray-50">
              <span className="text-gray-500 font-medium">Valid Until</span>
              <span className="text-xs">
                <span className="text-gray-800">{notAfter}</span>
                {days !== undefined && (
                  <span className="ml-2 font-bold" style={{ color: getDaysColor(days) }}>
                    {days <= 0 ? `EXPIRED ${Math.abs(days)} days ago` : `(${days} days remaining)`}
                  </span>
                )}
              </span>
            </div>
          )}
          {serial && (
            <div className="flex justify-between py-1.5 border-b border-gray-50">
              <span className="text-gray-500 font-medium">Serial</span>
              <span className="text-gray-800 font-mono text-[11px] truncate max-w-[200px]" title={serial}>{serial}</span>
            </div>
          )}
          {sans && sans.length > 0 && (
            <div className="flex justify-between py-1.5 border-b border-gray-50 col-span-full">
              <span className="text-gray-500 font-medium">SANs</span>
              <span className="text-gray-800 text-xs">{sans.join(', ')}</span>
            </div>
          )}
        </div>

        {/* Validation checks */}
        <div className="mt-4 pt-3 border-t border-gray-100 grid grid-cols-2 md:grid-cols-3 gap-2">
          {signatureAlg && (
            <Check ok={true} label={`${signatureAlg}`} />
          )}
          {keyType && (
            <Check ok={true} label={`${keyType}${keyBits ? ` ${keyBits} bit` : ''}`} />
          )}
          <Check ok={chainValid} label="Chain" />
          <Check ok={hostnameMatch} label="Hostname Match" />
          {ocspStatus && (
            <Check ok={ocspStatus.toLowerCase() === 'good'} label={`OCSP: ${ocspStatus}`} />
          )}
          {selfSigned && (
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <span className="text-sm text-amber-700">Self-Signed</span>
            </div>
          )}
        </div>
      </div>

      {/* Days until Expiry Chart */}
      {sslHistory.length >= 2 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-overseer-600" />
            <h3 className="font-semibold text-gray-800">Days until Expiry</h3>
          </div>
          <SslExpiryChart data={sslHistory} />
        </div>
      )}
    </div>
  )
}

function SslExpiryChart({ data }: { data: { time: string; days_until_expiry: number }[] }) {
  const [hover, setHover] = React.useState<{ x: number; point: typeof data[0]; chartY: number } | null>(null)
  const svgRef = React.useRef<SVGSVGElement>(null)

  const W = 720, H = 200
  const PAD = { top: 12, right: 16, bottom: 32, left: 52 }
  const cw = W - PAD.left - PAD.right
  const ch = H - PAD.top - PAD.bottom

  const values = data.map(d => d.days_until_expiry)
  const times = data.map(d => new Date(d.time).getTime())

  let yMin = Math.min(0, Math.min(...values))
  let yMax = Math.max(...values)
  const yPad = (yMax - yMin) * 0.1 || 5
  yMax = yMax + yPad

  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  const tRange = tMax - tMin || 1

  const toX = (t: number) => PAD.left + ((t - tMin) / tRange) * cw
  const toY = (v: number) => PAD.top + ch - ((v - yMin) / (yMax - yMin)) * ch

  // Y-axis ticks
  const yTicks: number[] = []
  for (let i = 0; i <= 4; i++) yTicks.push(yMin + (i / 4) * (yMax - yMin))

  // X-axis ticks
  const xTicks: number[] = []
  for (let i = 0; i <= 6; i++) xTicks.push(tMin + (i / 6) * tRange)

  // Line path
  const linePath = data.map((d, i) => {
    const x = toX(times[i])
    const y = toY(d.days_until_expiry)
    return `${i === 0 ? 'M' : 'L'}${x},${y}`
  }).join(' ')

  const areaPath = linePath + ` L${toX(times[times.length - 1])},${PAD.top + ch} L${toX(times[0])},${PAD.top + ch} Z`

  // Threshold reference lines
  const warnDays = 30
  const critDays = 14

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const scaleX = W / rect.width
    const mouseX = (e.clientX - rect.left) * scaleX
    if (mouseX < PAD.left || mouseX > W - PAD.right) { setHover(null); return }
    const mouseT = tMin + ((mouseX - PAD.left) / cw) * tRange
    let nearest = 0, minDist = Infinity
    for (let i = 0; i < data.length; i++) {
      const d = Math.abs(times[i] - mouseT)
      if (d < minDist) { minDist = d; nearest = i }
    }
    setHover({
      x: toX(times[nearest]),
      point: data[nearest],
      chartY: toY(data[nearest].days_until_expiry),
    })
  }

  const fmtDate = (t: number) => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
        style={{ cursor: 'crosshair' }}
      >
        <defs>
          <linearGradient id="sslAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grid */}
        {yTicks.map((v, i) => (
          <g key={`y${i}`}>
            <line x1={PAD.left} x2={W - PAD.right} y1={toY(v)} y2={toY(v)} stroke="#e5e7eb" strokeWidth="0.5" />
            <text x={PAD.left - 6} y={toY(v) + 3} textAnchor="end" fontSize="9" fill="#9ca3af" fontFamily="monospace">{Math.round(v)}d</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <g key={`x${i}`}>
            <line x1={toX(t)} x2={toX(t)} y1={PAD.top} y2={PAD.top + ch} stroke="#f3f4f6" strokeWidth="0.5" />
            <text x={toX(t)} y={H - 4} textAnchor="middle" fontSize="9" fill="#9ca3af">{fmtDate(t)}</text>
          </g>
        ))}

        {/* Warning threshold line (30d) */}
        {warnDays >= yMin && warnDays <= yMax && (
          <g>
            <line x1={PAD.left} x2={W - PAD.right} y1={toY(warnDays)} y2={toY(warnDays)} stroke="#f59e0b" strokeWidth="1" strokeDasharray="6,3" />
            <text x={W - PAD.right + 4} y={toY(warnDays) + 3} fontSize="8" fill="#f59e0b" fontWeight="bold">30d</text>
          </g>
        )}
        {/* Critical threshold line (14d) */}
        {critDays >= yMin && critDays <= yMax && (
          <g>
            <line x1={PAD.left} x2={W - PAD.right} y1={toY(critDays)} y2={toY(critDays)} stroke="#ef4444" strokeWidth="1" strokeDasharray="6,3" />
            <text x={W - PAD.right + 4} y={toY(critDays) + 3} fontSize="8" fill="#ef4444" fontWeight="bold">14d</text>
          </g>
        )}

        {/* Area + line */}
        <path d={areaPath} fill="url(#sslAreaGrad)" />
        <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />

        {/* Points (if not too many) */}
        {data.length <= 200 && data.map((d, i) => {
          const color = d.days_until_expiry <= 0 ? '#dc2626' : d.days_until_expiry <= 14 ? '#dc2626' : d.days_until_expiry <= 30 ? '#d97706' : '#3b82f6'
          return <circle key={i} cx={toX(times[i])} cy={toY(d.days_until_expiry)} r="2" fill={color} />
        })}

        {/* Hover */}
        {hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={PAD.top} y2={PAD.top + ch} stroke="#6b7280" strokeWidth="0.5" strokeDasharray="3,2" />
            <circle cx={hover.x} cy={hover.chartY} r="4" fill="white" stroke="#3b82f6" strokeWidth="2" />
          </g>
        )}
      </svg>

      {hover && (
        <div
          className="absolute z-10 pointer-events-none bg-gray-900 text-white text-xs rounded-lg shadow-lg px-3 py-2"
          style={{
            left: `${Math.min(85, Math.max(5, (hover.x / W) * 100))}%`,
            top: '4px',
            transform: 'translateX(-50%)',
          }}
        >
          <p className="font-mono text-gray-300">{new Date(hover.point.time).toLocaleString('de-DE')}</p>
          <p className="font-bold mt-1" style={{ color: hover.point.days_until_expiry <= 0 ? '#ef4444' : hover.point.days_until_expiry <= 14 ? '#ef4444' : hover.point.days_until_expiry <= 30 ? '#f59e0b' : '#10b981' }}>
            {hover.point.days_until_expiry} days
          </p>
        </div>
      )}
    </div>
  )
}

// ── Add Check Modal ────────────────────────────────────────────────────────────

interface AddCheckModalProps {
  host: Host
  onClose: () => void
  onSaved: () => void
}

// ── Service Templates (loaded from API) ──────────────────────────────────────

interface TemplateCheck {
  name: string
  check_type: string
  check_config: Record<string, string>
  interval_seconds: number
  threshold_warn: number | null
  threshold_crit: number | null
  retry_interval_seconds?: number
  check_mode?: string
}

interface ServiceTemplate {
  id: string
  name: string
  description: string
  checks: TemplateCheck[]
}

function AddCheckModal({ host, onClose, onSaved }: AddCheckModalProps) {
  const { data: templates = [] } = useQuery<ServiceTemplate[]>({
    queryKey: ['service-templates'],
    queryFn: () => api.get('/api/v1/service-templates/').then(r => r.data),
  })

  // Registry-driven check type filtering
  const available = getAvailableCheckTypes(host)
  const grouped = groupCheckTypesByCategory(available)
  const [mode, setMode] = useState<'choose' | 'manual' | 'template'>('choose')
  const [applyingTemplate, setApplyingTemplate] = useState<string | null>(null)

  const firstDef = available[0]
  const [form, setForm] = useState({
    name: '',
    check_type: firstDef?.key ?? 'ping',
    interval_seconds: String(firstDef?.defaults?.interval ?? 60),
    threshold_warn: firstDef?.defaults?.warn != null ? String(firstDef.defaults.warn) : '',
    threshold_crit: firstDef?.defaults?.crit != null ? String(firstDef.defaults.crit) : '',
    max_check_attempts: '3',
    retry_interval_seconds: '15',
    check_mode: firstDef?.mode ?? 'active',
  })
  const [config, setConfig] = useState<Record<string, string>>({})
  const [diskConfig, setDiskConfig] = useState<DiskConfig>({ warn: '80', crit: '90', overrides: [], exclude: '' })
  const [error, setError] = useState<string | null>(null)

  const typeDef = getCheckTypeDef(form.check_type)
  const isDisk = typeDef?.managesOwnThresholds === true

  // When check type changes, update defaults
  const handleTypeChange = (newType: string) => {
    const def = getCheckTypeDef(newType)
    setForm(prev => ({
      ...prev,
      check_type: newType,
      check_mode: def?.mode ?? 'active',
      interval_seconds: def?.defaults?.interval != null ? String(def.defaults.interval) : prev.interval_seconds,
      threshold_warn: def?.managesOwnThresholds ? '' : (def?.defaults?.warn != null ? String(def.defaults.warn) : ''),
      threshold_crit: def?.managesOwnThresholds ? '' : (def?.defaults?.crit != null ? String(def.defaults.crit) : ''),
    }))
    setConfig({})
    setDiskConfig({ warn: '80', crit: '90', overrides: [], exclude: '' })
  }

  const mutation = useMutation({
    mutationFn: () => {
      const { _mode, ...cleanConfig } = config
      const finalConfig: Record<string, unknown> = { ...cleanConfig }
      if (form.check_type === 'agent_services_auto' && typeof finalConfig.exclude === 'string') {
        finalConfig.exclude = (finalConfig.exclude as string).split(',').map(s => s.trim()).filter(Boolean)
      }
      if (isDisk) {
        finalConfig.warn = parseFloat(diskConfig.warn) || 80
        finalConfig.crit = parseFloat(diskConfig.crit) || 90
        if (diskConfig.overrides.length > 0) {
          finalConfig.overrides = diskConfig.overrides
            .filter(o => o.path.trim())
            .map(o => ({ path: o.path.trim(), warn: parseFloat(o.warn) || null, crit: parseFloat(o.crit) || null }))
        }
        if (diskConfig.exclude.trim()) {
          finalConfig.exclude = diskConfig.exclude.split(',').map(s => s.trim()).filter(Boolean)
        }
      }
      // SSL certificate validations
      if (form.check_type === 'ssl_certificate') {
        const hostname = (finalConfig.hostname as string ?? '').trim()
        if (/^https?:\/\//.test(hostname) || hostname.includes('/')) {
          throw { response: { data: { detail: 'Enter only the hostname, without protocol or path.' } } }
        }
        const warnDays = parseInt(finalConfig.warning_days as string) || 30
        const critDays = parseInt(finalConfig.critical_days as string) || 14
        if (warnDays <= critDays) {
          throw { response: { data: { detail: 'Warning Days must be greater than Critical Days.' } } }
        }
        if (critDays < 1) {
          throw { response: { data: { detail: 'Critical Days must be at least 1.' } } }
        }
        const port = parseInt(finalConfig.port as string) || 443
        if (port < 1 || port > 65535) {
          throw { response: { data: { detail: 'Port must be between 1 and 65535.' } } }
        }
        // Convert checkbox strings to booleans, numbers to ints
        finalConfig.hostname = hostname
        finalConfig.port = port
        finalConfig.warning_days = warnDays
        finalConfig.critical_days = critDays
        finalConfig.allow_self_signed = finalConfig.allow_self_signed === 'true'
        finalConfig.check_ocsp = finalConfig.check_ocsp === 'true'
      }
      return api.post('/api/v1/services/', {
        host_id: host.id,
        tenant_id: host.tenant_id,
        name: form.name,
        check_type: form.check_type,
        check_config: finalConfig,
        interval_seconds: parseInt(form.interval_seconds) || 60,
        threshold_warn: !isDisk && form.threshold_warn ? parseFloat(form.threshold_warn) : null,
        threshold_crit: !isDisk && form.threshold_crit ? parseFloat(form.threshold_crit) : null,
        max_check_attempts: parseInt(form.max_check_attempts) || 3,
        retry_interval_seconds: parseInt(form.retry_interval_seconds) || 15,
        check_mode: typeDef?.mode ?? form.check_mode,
      })
    },
    onSuccess: () => { onSaved(); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler beim Speichern'),
  })

  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const applyTemplate = async (template: ServiceTemplate) => {
    setApplyingTemplate(template.id)
    setError(null)
    setSuccessMsg(null)
    let created = 0
    const skippedNames: string[] = []
    try {
      for (const check of template.checks) {
        try {
          await api.post('/api/v1/services/', {
            host_id: host.id,
            tenant_id: host.tenant_id,
            name: check.name,
            check_type: check.check_type,
            check_config: check.check_config,
            interval_seconds: check.interval_seconds,
            threshold_warn: check.threshold_warn,
            threshold_crit: check.threshold_crit,
            max_check_attempts: 3,
            retry_interval_seconds: check.retry_interval_seconds ?? 15,
            check_mode: check.check_mode ?? 'active',
          })
          created++
        } catch (e: any) {
          if (e.response?.status === 409) {
            skippedNames.push(check.name)
          } else {
            throw e
          }
        }
      }
      onSaved()
      if (skippedNames.length > 0 && created === 0) {
        setError(`Alle Checks existieren bereits: ${skippedNames.join(', ')}`)
      } else if (skippedNames.length > 0) {
        setSuccessMsg(`${created} Check(s) erstellt. Übersprungen (existieren bereits): ${skippedNames.join(', ')}`)
      } else {
        setSuccessMsg(`${created} Check(s) erfolgreich erstellt!`)
      }
    } catch (e: any) {
      onSaved()
      setError(e.response?.data?.detail ?? 'Fehler beim Anwenden der Vorlage')
    } finally {
      setApplyingTemplate(null)
    }
  }

  const setF = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">
            {mode === 'choose' ? 'Check hinzufügen' : mode === 'template' ? 'Vorlage anwenden' : 'Einzelner Check'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm">
          <p className="font-medium text-gray-800">{host.display_name || host.hostname}</p>
        </div>

        {/* Step 1: Choose mode */}
        {mode === 'choose' && (
          <div className="space-y-3">
            <button onClick={() => setMode('template')}
              className="w-full text-left border border-gray-200 rounded-lg px-4 py-3 hover:bg-gray-50 transition-colors">
              <p className="font-medium text-gray-800 text-sm">Vorlage verwenden</p>
              <p className="text-xs text-gray-500 mt-0.5">Vorgefertigtes Check-Paket (Linux Server, Switch, etc.)</p>
            </button>
            <button onClick={() => setMode('manual')}
              className="w-full text-left border border-gray-200 rounded-lg px-4 py-3 hover:bg-gray-50 transition-colors">
              <p className="font-medium text-gray-800 text-sm">Einzelnen Check erstellen</p>
              <p className="text-xs text-gray-500 mt-0.5">Manuell konfigurieren</p>
            </button>
          </div>
        )}

        {/* Template picker */}
        {mode === 'template' && (() => {
          // 2.7 Templates nach Kompatibilität filtern
          const hostTypeLower = (host.host_type_name ?? '').toLowerCase()
          const isWindows = hostTypeLower.includes('windows')
          const isLinux = hostTypeLower.includes('linux')

          const compatibleTemplates = templates.filter(tpl => {
            const tplLower = tpl.name.toLowerCase()
            const types = tpl.checks.map(c => c.check_type)
            // OS-Filter: Windows-Templates nicht für Linux-Hosts und umgekehrt
            if (isLinux && tplLower.includes('windows')) return false
            if (isWindows && tplLower.includes('linux')) return false
            // Mindestens ein Check muss zum Host passen
            const compatible = types.filter(t => {
              if (t.startsWith('agent_')) return host.host_type_agent_capable
              if (t.startsWith('snmp')) return host.host_type_snmp_enabled || !!host.snmp_community
              if (t.startsWith('ssh_')) return !!host.ip_address
              if (t === 'ping' || t === 'port') return !!host.ip_address
              return true
            })
            return compatible.length > 0
          })
          return (
          <div className="space-y-2">
            {compatibleTemplates.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">
                {templates.length === 0
                  ? <>Keine Vorlagen vorhanden. Erstelle welche unter <a href="/templates" className="text-overseer-600 hover:underline">Vorlagen</a>.</>
                  : 'Keine kompatiblen Vorlagen für diesen Host. Vorlagen erfordern passende Konfiguration (Agent, IP, SNMP).'}
              </p>
            )}
            {compatibleTemplates.map(tpl => (
              <button key={tpl.id} onClick={() => applyTemplate(tpl)}
                disabled={!!applyingTemplate}
                className={clsx(
                  'w-full text-left border rounded-lg px-4 py-3 transition-colors',
                  applyingTemplate === tpl.id ? 'border-overseer-400 bg-overseer-50' : 'border-gray-200 hover:bg-gray-50',
                  applyingTemplate && applyingTemplate !== tpl.id && 'opacity-50',
                )}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-800 text-sm">{tpl.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{tpl.description}</p>
                  </div>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                    {applyingTemplate === tpl.id ? 'Wird erstellt…' : `${tpl.checks.length} Checks`}
                  </span>
                </div>
              </button>
            ))}
            {successMsg && (
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{successMsg}</p>
            )}
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}
            <button onClick={successMsg ? onClose : () => setMode('choose')}
              className="w-full py-2 text-sm text-gray-500 hover:text-gray-700">
              {successMsg ? 'Schließen' : 'Zurück'}
            </button>
          </div>
          )
        })()}

        {/* Manual form */}
        {mode === 'manual' && (
          <>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                  <input value={form.name} onChange={setF('name')} placeholder="CPU-Auslastung"
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Check-Typ *</label>
                  <select value={form.check_type} onChange={e => handleTypeChange(e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none">
                    {grouped.map(g => (
                      <optgroup key={g.category} label={g.label}>
                        {g.types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  {typeDef?.description && (
                    <p className="text-[11px] text-gray-400 mt-0.5">{typeDef.description}</p>
                  )}
                </div>
              </div>

              {/* Dynamic config fields from registry */}
              <RegistryConfigFields
                checkType={form.check_type}
                config={config}
                onChange={(k, v) => setConfig(prev => ({ ...prev, [k]: v }))}
                tenantId={host.tenant_id}
                osFamily={host.host_type_os_family}
                diskConfig={diskConfig}
                onDiskConfigChange={setDiskConfig}
              />

              <div className={clsx('grid gap-3', isDisk ? 'grid-cols-1' : 'grid-cols-3')}>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Intervall (s)</label>
                  <input value={form.interval_seconds} onChange={setF('interval_seconds')} type="number"
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
                </div>
                {!isDisk && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Warn-Schwelle</label>
                      <input value={form.threshold_warn} onChange={setF('threshold_warn')} type="number" placeholder="80"
                        className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Crit-Schwelle</label>
                      <input value={form.threshold_crit} onChange={setF('threshold_crit')} type="number" placeholder="90"
                        className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
                    </div>
                  </>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Max. Versuche (SOFT→HARD)</label>
                  <input value={form.max_check_attempts} onChange={setF('max_check_attempts')} type="number" min="1"
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Retry-Intervall (s)</label>
                  <input value={form.retry_interval_seconds} onChange={setF('retry_interval_seconds')} type="number" min="5"
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Check-Modus</label>
                {typeDef?.mode === 'agent' ? (
                  <div className="text-sm text-gray-500 bg-gray-50 px-3 py-2 rounded-lg">
                    Agent <span className="text-xs text-gray-400">(wird automatisch gesetzt)</span>
                  </div>
                ) : (
                  <div className="flex gap-3 mt-1">
                    <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="radio" name="check_mode" value="active" checked={form.check_mode === 'active'}
                        onChange={setF('check_mode')} className="w-4 h-4 text-overseer-600 focus:ring-overseer-500" />
                      <span>Aktiv <span className="text-xs text-gray-400">(Server prüft)</span></span>
                    </label>
                    {host.collector_id ? (
                      <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
                        <input type="radio" name="check_mode" value="passive" checked={form.check_mode === 'passive'}
                          onChange={setF('check_mode')} className="w-4 h-4 text-overseer-600 focus:ring-overseer-500" />
                        <span>Passiv <span className="text-xs text-gray-400">(Collector sendet)</span></span>
                      </label>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-sm text-gray-300">
                        Passiv <span className="text-xs">(kein Collector zugewiesen)</span>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {available.length === 0 && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Keine Check-Typen für diesen Host verfügbar. Bitte zuerst IP-Adresse, Agent oder SNMP-Community konfigurieren.
                </p>
              )}

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setMode('choose')}
                className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
                Zurück
              </button>
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || !form.name}
                className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50">
                {mutation.isPending ? 'Speichern…' : 'Check anlegen'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Edit Host Modal ──────────────────────────────────────────────────────────

interface EditHostModalProps {
  host: Host
  onClose: () => void
  onSaved: () => void
}

function EditHostModal({ host, onClose, onSaved }: EditHostModalProps) {
  const { data: hostTypes = [] } = useQuery<{ id: string; name: string; icon: string; category: string; agent_capable: boolean; snmp_enabled: boolean; ip_required: boolean }[]>({
    queryKey: ['host-types'],
    queryFn: () => api.get('/api/v1/host-types/').then(r => r.data),
  })

  const [form, setForm] = useState({
    hostname: host.hostname,
    display_name: host.display_name ?? '',
    ip_address: host.ip_address ?? '',
    host_type_id: host.host_type_id,
    snmp_community: host.snmp_community ?? '',
    snmp_version: host.snmp_version ?? '2c',
  })
  const [error, setError] = useState<string | null>(null)

  const selectedType = hostTypes.find(t => t.id === form.host_type_id)

  const mutation = useMutation({
    mutationFn: () => api.patch(`/api/v1/hosts/${host.id}`, {
      hostname: form.hostname,
      display_name: form.display_name || null,
      ip_address: form.ip_address || null,
      host_type_id: form.host_type_id,
      snmp_community: form.snmp_community || null,
      snmp_version: form.snmp_version || '2c',
    }),
    onSuccess: () => { onSaved(); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler beim Speichern'),
  })

  const setF = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Host bearbeiten</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Hostname *</label>
            <input value={form.hostname} onChange={setF('hostname')}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Anzeigename</label>
            <input value={form.display_name} onChange={setF('display_name')} placeholder="z.B. Webserver Produktion"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">IP-Adresse</label>
              <input value={form.ip_address} onChange={setF('ip_address')} placeholder="192.168.1.1"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
              <p className="text-[11px] text-gray-400 mt-0.5">
                {host.agent_managed
                  ? 'Optional — Agent verbindet sich selbst. Nur für Netzwerk-Checks nötig.'
                  : host.collector_id
                    ? 'Erforderlich für passive Checks über den Collector'
                    : 'Erforderlich für aktive Checks (Ping, SSH, Port)'}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Typ</label>
              <select value={form.host_type_id} onChange={setF('host_type_id')}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none">
                {hostTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          {/* SNMP-Felder nur wenn Typ SNMP unterstützt oder bereits konfiguriert */}
          {(selectedType?.snmp_enabled || host.snmp_community) && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">SNMP Community</label>
                <input value={form.snmp_community} onChange={setF('snmp_community')} placeholder="public"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">SNMP Version</label>
                <select value={form.snmp_version} onChange={setF('snmp_version')}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none">
                  <option value="1">v1</option>
                  <option value="2c">v2c</option>
                </select>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            Abbrechen
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.hostname}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50">
            {mutation.isPending ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit Service Modal ──────────────────────────────────────────────────────

interface EditServiceModalProps {
  service: ServiceItem
  host: Host
  onClose: () => void
  onSaved: () => void
}

function EditServiceModal({ service, host, onClose, onSaved }: EditServiceModalProps) {
  const editTypeDef = getCheckTypeDef(service.check_type)
  const isDisk = editTypeDef?.managesOwnThresholds === true

  const [form, setForm] = useState({
    name: service.name,
    interval_seconds: String(service.interval_seconds),
    threshold_warn: service.threshold_warn !== null ? String(service.threshold_warn) : '',
    threshold_crit: service.threshold_crit !== null ? String(service.threshold_crit) : '',
    max_check_attempts: String(service.max_check_attempts),
    retry_interval_seconds: String(service.retry_interval_seconds ?? 15),
    check_mode: service.check_mode ?? 'passive',
  })
  const [config, setConfig] = useState<Record<string, string>>(() => {
    // Skip disk-specific keys from flat config
    const skipKeys = new Set(['disks', 'warn', 'crit', 'overrides', 'exclude', 'path'])
    const entries = Object.entries(service.check_config)
      .filter(([k]) => !skipKeys.has(k))
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)])
    const result = Object.fromEntries(entries)
    // If existing config uses script_path (local script), set mode
    if (service.check_type === 'agent_script' && service.check_config.script_path && !service.check_config.script_id) {
      result._mode = 'local'
    }
    return result
  })
  const [diskConfig, setDiskConfig] = useState<DiskConfig>(() => {
    const cc = service.check_config as any
    if (isDisk) {
      // New auto-discover format
      if (cc.warn != null || cc.overrides) {
        return {
          warn: cc.warn != null ? String(cc.warn) : '80',
          crit: cc.crit != null ? String(cc.crit) : '90',
          overrides: Array.isArray(cc.overrides)
            ? cc.overrides.map((o: any) => ({ path: o.path ?? '', warn: o.warn != null ? String(o.warn) : '', crit: o.crit != null ? String(o.crit) : '' }))
            : [],
          exclude: Array.isArray(cc.exclude) ? cc.exclude.join(', ') : '',
        }
      }
      // Legacy: disks array → convert to auto-discover with overrides
      if (Array.isArray(cc.disks) && cc.disks.length > 0) {
        const first = cc.disks[0]
        return {
          warn: first.warn != null ? String(first.warn) : '80',
          crit: first.crit != null ? String(first.crit) : '90',
          overrides: cc.disks.slice(1).map((d: any) => ({
            path: d.path ?? '', warn: d.warn != null ? String(d.warn) : '', crit: d.crit != null ? String(d.crit) : '',
          })),
          exclude: '',
        }
      }
      // Legacy: single path → auto-discover defaults
      return {
        warn: service.threshold_warn != null ? String(service.threshold_warn) : '80',
        crit: service.threshold_crit != null ? String(service.threshold_crit) : '90',
        overrides: [],
        exclude: '',
      }
    }
    return { warn: '80', crit: '90', overrides: [], exclude: '' }
  })
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => {
      const { _mode, ...cleanConfig } = config
      const finalConfig: Record<string, unknown> = { ...cleanConfig }
      if (service.check_type === 'agent_services_auto' && typeof finalConfig.exclude === 'string') {
        finalConfig.exclude = (finalConfig.exclude as string).split(',').map(s => s.trim()).filter(Boolean)
      }
      if (isDisk) {
        // Auto-discover format
        finalConfig.warn = parseFloat(diskConfig.warn) || 80
        finalConfig.crit = parseFloat(diskConfig.crit) || 90
        if (diskConfig.overrides.length > 0) {
          finalConfig.overrides = diskConfig.overrides
            .filter(o => o.path.trim())
            .map(o => ({ path: o.path.trim(), warn: parseFloat(o.warn) || null, crit: parseFloat(o.crit) || null }))
        }
        if (diskConfig.exclude.trim()) {
          finalConfig.exclude = diskConfig.exclude.split(',').map(s => s.trim()).filter(Boolean)
        }
      }
      return api.patch(`/api/v1/services/${service.id}`, {
        name: form.name,
        check_config: finalConfig,
        interval_seconds: parseInt(form.interval_seconds) || 60,
        threshold_warn: !isDisk && form.threshold_warn ? parseFloat(form.threshold_warn) : null,
        threshold_crit: !isDisk && form.threshold_crit ? parseFloat(form.threshold_crit) : null,
        max_check_attempts: parseInt(form.max_check_attempts) || 3,
        retry_interval_seconds: parseInt(form.retry_interval_seconds) || 15,
        check_mode: form.check_mode,
      })
    },
    onSuccess: () => { onSaved(); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail ?? 'Fehler beim Speichern'),
  })

  const setF = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Service bearbeiten</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm flex items-center justify-between">
          <span className="font-medium text-gray-800">{service.name}</span>
          <span className="text-gray-500 text-xs">{editTypeDef ? `${editTypeDef.label}` : service.check_type}</span>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
            <input value={form.name} onChange={setF('name')}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
          </div>

          {/* Dynamic config fields from registry */}
          <RegistryConfigFields
            checkType={service.check_type}
            config={config}
            onChange={(k, v) => setConfig(prev => ({ ...prev, [k]: v }))}
            tenantId={host.tenant_id}
            osFamily={host.host_type_os_family}
            diskConfig={diskConfig}
            onDiskConfigChange={setDiskConfig}
          />

          <div className={clsx('grid gap-3', isDisk ? 'grid-cols-1' : 'grid-cols-3')}>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Intervall (s)</label>
              <input value={form.interval_seconds} onChange={setF('interval_seconds')} type="number"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
            </div>
            {!isDisk && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Warn-Schwelle</label>
                  <input value={form.threshold_warn} onChange={setF('threshold_warn')} type="number" placeholder="80"
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Crit-Schwelle</label>
                  <input value={form.threshold_crit} onChange={setF('threshold_crit')} type="number" placeholder="90"
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Max. Versuche (SOFT→HARD)</label>
              <input value={form.max_check_attempts} onChange={setF('max_check_attempts')} type="number"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Retry-Intervall (s)</label>
              <input value={form.retry_interval_seconds} onChange={setF('retry_interval_seconds')} type="number" min="5"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Check-Modus</label>
            {editTypeDef?.mode === 'agent' ? (
              <div className="text-sm text-gray-500 bg-gray-50 px-3 py-2 rounded-lg">
                Agent <span className="text-xs text-gray-400">(wird automatisch gesetzt)</span>
              </div>
            ) : (
              <div className="flex gap-3 mt-1">
                <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="edit_check_mode" value="active" checked={form.check_mode === 'active'}
                    onChange={setF('check_mode')} className="w-4 h-4 text-overseer-600 focus:ring-overseer-500" />
                  <span>Aktiv <span className="text-xs text-gray-400">(Server prüft)</span></span>
                </label>
                <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="edit_check_mode" value="passive" checked={form.check_mode === 'passive'}
                    onChange={setF('check_mode')} className="w-4 h-4 text-overseer-600 focus:ring-overseer-500" />
                  <span>Passiv <span className="text-xs text-gray-400">(Collector sendet)</span></span>
                </label>
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            Abbrechen
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.name}
            className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50">
            {mutation.isPending ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── SNMP Discovery Modal ─────────────────────────────────────────────────────

interface SnmpDiscoveryModalProps {
  host: Host
  onClose: () => void
  onSaved: () => void
}

interface SnmpResult {
  oid: string
  name: string
  value: string
  type: string
}

function SnmpDiscoveryModal({ host, onClose, onSaved }: SnmpDiscoveryModalProps) {
  const [baseOid, setBaseOid] = useState('1.3.6.1.2.1')
  const [results, setResults] = useState<SnmpResult[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [walking, setWalking] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  const startWalk = async () => {
    // 3.5 Validierung: SNMP Community prüfen
    if (!host.snmp_community) {
      setError('Bitte SNMP Community in den Host-Einstellungen setzen bevor Sie einen Walk starten.')
      return
    }
    if (!host.ip_address) {
      setError('Bitte IP-Adresse in den Host-Einstellungen setzen bevor Sie einen Walk starten.')
      return
    }
    setWalking(true)
    setError(null)
    setResults([])
    setSelected(new Set())
    setSuccessMsg(null)
    try {
      const res = await api.post(`/api/v1/hosts/${host.id}/snmp-walk`, {
        base_oid: baseOid,
        max_results: 500,
      })
      setResults(res.data.results)
      setTruncated(res.data.truncated)
    } catch (e: any) {
      setError(e.response?.data?.detail ?? 'SNMP Walk fehlgeschlagen')
    } finally {
      setWalking(false)
    }
  }

  const toggleSelect = (oid: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(oid)) next.delete(oid)
      else next.add(oid)
      return next
    })
  }

  const selectAll = () => {
    const numericResults = filtered.filter(r => {
      try { parseFloat(r.value); return true } catch { return false }
    })
    if (selected.size === numericResults.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(numericResults.map(r => r.oid)))
    }
  }

  const createChecks = async () => {
    setCreating(true)
    setError(null)
    setSuccessMsg(null)
    let created = 0
    const skipped: string[] = []
    const errors: string[] = []

    for (const oid of selected) {
      const result = results.find(r => r.oid === oid)
      if (!result) continue

      // Use readable name if available, otherwise sanitize OID
      const checkName = result.name !== result.oid
        ? result.name.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase()
        : `snmp_${oid.replace(/\./g, '_')}`

      try {
        await api.post('/api/v1/services/', {
          host_id: host.id,
          tenant_id: host.tenant_id,
          name: checkName,
          check_type: oid.startsWith('1.3.6.1.2.1.2.2.1.8.') ? 'snmp_interface' : 'snmp',
          check_config: {
            oid,
            community: host.snmp_community || 'public',
            version: host.snmp_version || '2c',
          },
          interval_seconds: 60,
          max_check_attempts: 3,
          retry_interval_seconds: 15,
          check_mode: 'active',
        })
        created++
      } catch (e: any) {
        if (e.response?.status === 409) {
          skipped.push(checkName)
        } else {
          errors.push(checkName)
        }
      }
    }

    if (created > 0) onSaved()
    const parts: string[] = []
    if (created > 0) parts.push(`${created} Check(s) erstellt`)
    if (skipped.length > 0) parts.push(`${skipped.length} übersprungen (existieren bereits)`)
    if (errors.length > 0) parts.push(`${errors.length} fehlgeschlagen`)

    if (errors.length > 0 && created === 0) {
      setError(parts.join('. '))
    } else {
      setSuccessMsg(parts.join('. '))
    }
    setCreating(false)
  }

  const filtered = results.filter(r => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return r.oid.includes(q) || r.name.toLowerCase().includes(q) || r.value.toLowerCase().includes(q)
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl mx-4 p-6 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-overseer-600" />
            <h2 className="text-lg font-semibold text-gray-900">SNMP Discovery</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm flex items-center justify-between">
          <div>
            <span className="font-medium text-gray-800">{host.display_name || host.hostname}</span>
            <span className="text-gray-400 ml-2">{host.ip_address}</span>
          </div>
          <span className="text-xs text-gray-500">Community: {host.snmp_community || '–'}</span>
        </div>

        {/* Walk controls */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1">
            <input value={baseOid} onChange={e => setBaseOid(e.target.value)}
              placeholder="Base OID (z.B. 1.3.6.1.2.1)"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none" />
          </div>
          <button onClick={startWalk} disabled={walking}
            className="px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700 disabled:opacity-50 whitespace-nowrap">
            {walking ? 'Scanne...' : 'Walk starten'}
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>
        )}
        {successMsg && (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">{successMsg}</p>
        )}

        {/* Results */}
        {results.length > 0 && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <input value={filter} onChange={e => setFilter(e.target.value)}
                placeholder="Filtern nach OID, Name oder Wert..."
                className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-overseer-500 outline-none" />
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {filtered.length} OIDs{truncated ? ' (abgeschnitten)' : ''}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg min-h-0">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left w-8">
                      <input type="checkbox" onChange={selectAll}
                        checked={selected.size > 0}
                        className="w-3.5 h-3.5" />
                    </th>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">OID</th>
                    <th className="px-3 py-2 text-left">Wert</th>
                    <th className="px-3 py-2 text-left">Typ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(r => (
                    <tr key={r.oid} className={clsx('hover:bg-gray-50 cursor-pointer', selected.has(r.oid) && 'bg-overseer-50')}
                      onClick={() => toggleSelect(r.oid)}>
                      <td className="px-3 py-1.5">
                        <input type="checkbox" checked={selected.has(r.oid)} onChange={() => toggleSelect(r.oid)}
                          className="w-3.5 h-3.5" />
                      </td>
                      <td className="px-3 py-1.5 font-medium text-gray-800">
                        {r.name !== r.oid ? r.name : <span className="text-gray-400">–</span>}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-gray-500">{r.oid}</td>
                      <td className="px-3 py-1.5 text-gray-700 max-w-xs truncate" title={r.value}>{r.value}</td>
                      <td className="px-3 py-1.5 text-gray-400">{r.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selected.size > 0 && (
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm text-gray-500">{selected.size} OID(s) ausgewählt</span>
                <button onClick={createChecks} disabled={creating}
                  className="px-4 py-2 bg-overseer-600 text-white text-sm font-medium rounded-lg hover:bg-overseer-700 disabled:opacity-50">
                  {creating ? 'Erstelle...' : `${selected.size} Check(s) erstellen`}
                </button>
              </div>
            )}
          </>
        )}

        {results.length === 0 && !walking && !error && (
          <p className="text-center text-gray-400 py-8 text-sm">
            Klicke "Walk starten" um verfügbare SNMP-OIDs zu entdecken.
          </p>
        )}
        {walking && (
          <p className="text-center text-gray-400 py-8 text-sm animate-pulse">
            SNMP Walk läuft...
          </p>
        )}
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function HostDetailPage() {
  const { hostId } = useParams<{ hostId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const isNewHost = searchParams.get('new') === '1'
  const queryClient = useQueryClient()
  const [showAddCheck, setShowAddCheck] = useState(false)
  const [showEditHost, setShowEditHost] = useState(false)
  const [showSnmpDiscovery, setShowSnmpDiscovery] = useState(false)
  const [editService, setEditService] = useState<ServiceItem | null>(null)
  const [historyTarget, setHistoryTarget] = useState<{ id: string; name: string; warn: number | null; crit: number | null } | null>(null)
  const [expandedSslService, setExpandedSslService] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showAgentSetup, setShowAgentSetup] = useState(false)
  const [generatedToken, setGeneratedToken] = useState<string | null>(null)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [revokeConfirm, setRevokeConfirm] = useState(false)
  const [setupTab, setSetupTab] = useState<'windows' | 'debian' | 'rhel' | 'generic'>('debian')

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

  const { data: serviceList = [] } = useQuery<ServiceItem[]>({
    queryKey: ['services', hostId],
    queryFn: () => api.get(`/api/v1/services/?host_id=${hostId}&include_inactive=true`).then(r => r.data),
    enabled: !!hostId,
  })

  // Agent token info (only fetched when host is agent_managed)
  const { data: agentTokenInfo } = useQuery<AgentTokenInfo>({
    queryKey: ['agent-token', hostId],
    queryFn: () => api.get(`/api/v1/hosts/${hostId}/agent-token`).then(r => r.data),
    enabled: !!hostId && !!host?.agent_managed,
    refetchInterval: 30000,
  })

  // Dependencies
  const { data: dependencies = [] } = useQuery<{ id: string; source_type: string; source_id: string; source_name: string | null; depends_on_type: string; depends_on_id: string; depends_on_name: string | null }[]>({
    queryKey: ['dependencies', hostId],
    queryFn: () => api.get(`/api/v1/dependencies/?host_id=${hostId}`).then(r => r.data),
    enabled: !!hostId,
  })
  const { data: allHosts = [] } = useQuery<{ id: string; hostname: string }[]>({
    queryKey: ['hosts-simple'],
    queryFn: () => api.get('/api/v1/hosts/?limit=500').then(r => r.data.map((h: any) => ({ id: h.id, hostname: h.hostname }))),
  })
  const [depTarget, setDepTarget] = useState('')
  const addDepMutation = useMutation({
    mutationFn: (data: { source_type: string; source_id: string; depends_on_type: string; depends_on_id: string }) =>
      api.post('/api/v1/dependencies/', data).then(r => r.data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['dependencies', hostId] }); setDepTarget('') },
  })
  const deleteDepMutation = useMutation({
    mutationFn: (depId: string) => api.delete(`/api/v1/dependencies/${depId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dependencies', hostId] }),
  })

  const generateTokenMutation = useMutation({
    mutationFn: () => api.post(`/api/v1/hosts/${hostId}/agent-token`),
    onSuccess: (resp) => {
      setGeneratedToken(resp.data.token)
      setSetupTab(host?.host_type_name?.toLowerCase().includes('windows') ? 'windows' : 'debian')
      setShowAgentSetup(true)
      queryClient.invalidateQueries({ queryKey: ['host', hostId] })
      queryClient.invalidateQueries({ queryKey: ['agent-token', hostId] })
    },
  })

  const revokeTokenMutation = useMutation({
    mutationFn: () => api.delete(`/api/v1/hosts/${hostId}/agent-token`),
    onSuccess: () => {
      setRevokeConfirm(false)
      queryClient.invalidateQueries({ queryKey: ['host', hostId] })
      queryClient.invalidateQueries({ queryKey: ['agent-token', hostId] })
    },
  })

  const deleteServiceMutation = useMutation({
    mutationFn: (serviceId: string) => api.delete(`/api/v1/services/${serviceId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services', hostId] })
      queryClient.invalidateQueries({ queryKey: ['host-status', hostId] })
    },
  })

  const toggleServiceActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/api/v1/services/${id}`, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services', hostId] })
      queryClient.invalidateQueries({ queryKey: ['host-status', hostId] })
    },
  })

  const navigate = useNavigate()

  const deleteHostMutation = useMutation({
    mutationFn: () => api.delete(`/api/v1/hosts/${hostId}`),
    onSuccess: () => { setShowDeleteConfirm(false); navigate('/hosts') },
    onError: () => setShowDeleteConfirm(false),
  })

  const copyHostMutation = useMutation({
    mutationFn: (body: { hostname?: string; target_tenant_id?: string }) =>
      api.post(`/api/v1/hosts/${hostId}/copy`, body),
    onSuccess: (resp) => navigate(`/hosts/${resp.data.id}`),
  })

  const [showCopyHost, setShowCopyHost] = useState(false)
  const [copyHostname, setCopyHostname] = useState('')
  const [copyTenantId, setCopyTenantId] = useState('')
  const [copyHostError, setCopyHostError] = useState<string | null>(null)

  const { data: tenantsList = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['tenants-list'],
    queryFn: () => api.get('/api/v1/tenants/').then(r => r.data),
    enabled: showCopyHost,
  })

  const [checkingNow, setCheckingNow] = useState<Record<string, 'pending' | 'done' | 'error'>>({})
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const runCheckNow = async (serviceId: string) => {
    setCheckingNow(prev => ({ ...prev, [serviceId]: 'pending' }))
    try {
      await api.post(`/api/v1/services/${serviceId}/check-now`)
      setCheckingNow(prev => ({ ...prev, [serviceId]: 'done' }))
      queryClient.invalidateQueries({ queryKey: ['host-status', hostId] })
      setTimeout(() => setCheckingNow(prev => { const n = { ...prev }; delete n[serviceId]; return n }), 3000)
    } catch {
      setCheckingNow(prev => ({ ...prev, [serviceId]: 'error' }))
      setTimeout(() => setCheckingNow(prev => { const n = { ...prev }; delete n[serviceId]; return n }), 3000)
    }
  }

  const serviceNames: Record<string, { name: string; check_type: string; check_mode: string; active: boolean; max_check_attempts: number; retry_interval_seconds: number; threshold_warn: number | null; threshold_crit: number | null }> = {}
  serviceList.forEach(s => { serviceNames[s.id] = { name: s.name, check_type: s.check_type, check_mode: s.check_mode ?? 'passive', active: s.active, max_check_attempts: s.max_check_attempts ?? 3, retry_interval_seconds: s.retry_interval_seconds ?? 15, threshold_warn: s.threshold_warn, threshold_crit: s.threshold_crit } })

  // Merge: status data + services without status (inactive services may not have current_status)
  const statusServiceIds = new Set(services.map(s => s.service_id))
  const orphanServices: ServiceStatus[] = serviceList
    .filter(s => !statusServiceIds.has(s.id))
    .map(s => ({
      service_id: s.id,
      host_id: hostId!,
      tenant_id: host?.tenant_id ?? '',
      status: 'NO_DATA' as const,
      state_type: 'SOFT' as const,
      current_attempt: 0,
      status_message: null,
      value: null,
      unit: null,
      last_check_at: null,
      last_state_change_at: null,
      acknowledged: false,
      in_downtime: false,
      service_name: s.name,
    }))
  const allServices = [...services, ...orphanServices]
  const sorted = allServices.sort((a, b) => {
    const metaA = serviceNames[a.service_id]
    const metaB = serviceNames[b.service_id]
    // Active services first, then by status severity
    if (metaA?.active !== false && metaB?.active === false) return -1
    if (metaA?.active === false && metaB?.active !== false) return 1
    return statusOrder[a.status] - statusOrder[b.status]
  })

  const counts: Record<string, number> = { OK: 0, WARNING: 0, CRITICAL: 0, UNKNOWN: 0, NO_DATA: 0 }
  services.forEach(s => {
    const meta = serviceNames[s.service_id]
    if (meta?.active !== false) counts[s.status]++
  })

  if (hostLoading) {
    return <div className="p-8 text-gray-500">Lade Host-Daten…</div>
  }
  if (!host) {
    return <div className="p-8 text-red-500">Host nicht gefunden.</div>
  }

  const HostIcon = getHostTypeIcon(host.host_type_icon)
  const activeSorted = sorted.filter(s => serviceNames[s.service_id]?.active !== false)
  const worstStatus = activeSorted[0]?.status ?? 'OK'
  const worstCfg = getStatusConfig(worstStatus)
  const WIcon = worstCfg.icon

  return (
    <div className="p-8">
      {showAddCheck && (
        <AddCheckModal
          host={host}
          onClose={() => setShowAddCheck(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['services', hostId] })
            queryClient.invalidateQueries({ queryKey: ['host-status', hostId] })
          }}
        />
      )}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Host löschen"
        message={`Host "${host?.display_name || host?.hostname}" endgültig löschen?\n\nAlle Services, Check-Ergebnisse und Downtimes werden unwiderruflich gelöscht.`}
        confirmLabel="Endgültig löschen"
        variant="danger"
        loading={deleteHostMutation.isPending}
        onConfirm={() => deleteHostMutation.mutate()}
        onCancel={() => setShowDeleteConfirm(false)}
      />
      {showEditHost && (
        <EditHostModal
          host={host}
          onClose={() => setShowEditHost(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['host', hostId] })}
        />
      )}
      {showSnmpDiscovery && (
        <SnmpDiscoveryModal
          host={host}
          onClose={() => setShowSnmpDiscovery(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['services', hostId] })
            queryClient.invalidateQueries({ queryKey: ['host-status', hostId] })
          }}
        />
      )}
      {editService && (
        <EditServiceModal
          service={editService}
          host={host}
          onClose={() => setEditService(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['services', hostId] })
            queryClient.invalidateQueries({ queryKey: ['host-status', hostId] })
          }}
        />
      )}
      {historyTarget && (
        <HistoryModal
          serviceId={historyTarget.id}
          serviceName={historyTarget.name}
          thresholdWarn={historyTarget.warn}
          thresholdCrit={historyTarget.crit}
          onClose={() => setHistoryTarget(null)}
        />
      )}

      {/* Copy Host Modal */}
      {showCopyHost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Host kopieren</h2>
              <button onClick={() => setShowCopyHost(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="bg-gray-50 rounded-lg px-4 py-3 mb-4 text-sm">
              <p className="text-gray-500">Quelle:</p>
              <p className="font-medium text-gray-800">{host.display_name || host.hostname}</p>
              <p className="text-xs text-gray-400 mt-1">Alle Services werden mitkopiert.</p>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Neuer Hostname</label>
                <input
                  value={copyHostname}
                  onChange={e => setCopyHostname(e.target.value)}
                  placeholder={`${host.hostname}-copy`}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ziel-Tenant</label>
                <select
                  value={copyTenantId}
                  onChange={e => setCopyTenantId(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-overseer-500 outline-none"
                >
                  <option value="">Gleicher Tenant</option>
                  {tenantsList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
            {copyHostError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{copyHostError}</p>}
            <div className="flex gap-3">
              <button onClick={() => setShowCopyHost(false)}
                className="flex-1 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Abbrechen</button>
              <button
                onClick={() => {
                  setCopyHostError(null)
                  const body: { hostname?: string; target_tenant_id?: string } = {}
                  if (copyHostname) body.hostname = copyHostname
                  if (copyTenantId) body.target_tenant_id = copyTenantId
                  copyHostMutation.mutate(body, {
                    onError: (e: any) => setCopyHostError(e.response?.data?.detail ?? 'Fehler beim Kopieren'),
                  })
                }}
                disabled={copyHostMutation.isPending}
                className="flex-1 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700 disabled:opacity-50">
                {copyHostMutation.isPending ? 'Kopiere…' : 'Host kopieren'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Back link */}
      <Link
        to="/hosts"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Zurück zu Hosts
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
              <span>{host.host_type_name ?? 'Unbekannt'}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowEditHost(true)}
              className="p-2 rounded-lg border border-gray-200 text-gray-400 hover:text-overseer-600 hover:border-overseer-300 transition-colors"
              title="Host bearbeiten"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={() => { setShowCopyHost(true); setCopyHostname(''); setCopyTenantId(''); setCopyHostError(null) }}
              className="p-2 rounded-lg border border-gray-200 text-gray-400 hover:text-blue-500 hover:border-blue-300 transition-colors"
              title="Host kopieren"
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="p-2 rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-300 transition-colors"
              title="Host endgültig löschen"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <div className={clsx('flex items-center gap-2 px-4 py-2 rounded-lg', worstCfg.bg)}>
              <WIcon className={clsx('w-5 h-5', worstCfg.color)} />
              <span className={clsx('font-bold text-sm', worstCfg.text)}>{worstStatus}</span>
            </div>
          </div>
        </div>

        {/* Mini stats */}
        <div className="grid grid-cols-5 gap-3 mt-5 pt-5 border-t border-gray-100">
          {(['CRITICAL', 'WARNING', 'NO_DATA', 'UNKNOWN', 'OK'] as const).map(s => {
            const cfg = getStatusConfig(s)
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

      {/* 3.1 Onboarding-Banner für neue Hosts */}
      {isNewHost && serviceList.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 mb-6">
          <p className="text-sm font-medium text-blue-800 mb-2">Host erstellt! Nächste Schritte:</p>
          <div className="flex flex-wrap gap-2">
            {host.host_type_agent_capable && !host.agent_managed && (
              <button onClick={() => generateTokenMutation.mutate()}
                disabled={generateTokenMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors">
                <KeyRound className="w-3.5 h-3.5" />
                Agent einrichten
              </button>
            )}
            <button onClick={() => setShowAddCheck(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-blue-700 text-xs font-medium rounded-lg border border-blue-300 hover:bg-blue-50 transition-colors">
              <Plus className="w-3.5 h-3.5" />
              Checks / Template hinzufügen
            </button>
            <button onClick={() => { setSearchParams({}); }}
              className="px-3 py-1.5 text-xs text-blue-500 hover:text-blue-700 transition-colors">
              Hinweis ausblenden
            </button>
          </div>
        </div>
      )}

      {/* Agent section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Monitor className="w-5 h-5 text-gray-400" />
            <h2 className="font-semibold text-gray-800">Agent</h2>
          </div>
          {host.agent_managed && agentTokenInfo && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => generateTokenMutation.mutate()}
                disabled={generateTokenMutation.isPending}
                className="text-xs text-overseer-600 hover:text-overseer-800 transition-colors"
              >
                {generateTokenMutation.isPending ? 'Generiere…' : 'Token erneuern'}
              </button>
              <button
                onClick={() => setRevokeConfirm(true)}
                className="text-xs text-red-500 hover:text-red-700 transition-colors"
              >
                Token widerrufen
              </button>
            </div>
          )}
        </div>

        {!host.agent_managed ? (
          <div className="mt-3 flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
            <p className="text-sm text-gray-500">Kein Agent eingerichtet</p>
            {host.host_type_agent_capable ? (
              <button
                onClick={() => generateTokenMutation.mutate()}
                disabled={generateTokenMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-overseer-600 text-white text-xs font-medium rounded-lg hover:bg-overseer-700 disabled:opacity-50 transition-colors"
              >
                <KeyRound className="w-3.5 h-3.5" />
                {generateTokenMutation.isPending ? 'Generiere…' : 'Agent einrichten'}
              </button>
            ) : (
              <span className="text-xs text-gray-400">Agent für diesen Host-Typ nicht verfügbar</span>
            )}
          </div>
        ) : agentTokenInfo ? (
          <div className="mt-3 flex items-center gap-4 bg-gray-50 rounded-lg px-4 py-3">
            <div className="flex items-center gap-2">
              <div className={clsx(
                'w-2.5 h-2.5 rounded-full',
                agentTokenInfo.last_seen_at && (Date.now() - new Date(agentTokenInfo.last_seen_at).getTime()) < 3 * 60 * 1000
                  ? 'bg-emerald-500' : 'bg-red-500'
              )} />
              <span className="text-sm font-medium text-gray-800">
                {agentTokenInfo.last_seen_at && (Date.now() - new Date(agentTokenInfo.last_seen_at).getTime()) < 3 * 60 * 1000
                  ? 'Agent online' : 'Agent offline'}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              {agentTokenInfo.agent_version && <span>v{agentTokenInfo.agent_version}</span>}
              {agentTokenInfo.agent_os && <span>{agentTokenInfo.agent_os}</span>}
              {agentTokenInfo.last_seen_at && (
                <span>Zuletzt: {formatDistanceToNow(new Date(agentTokenInfo.last_seen_at), { locale: de, addSuffix: true })}</span>
              )}
              {!agentTokenInfo.last_seen_at && <span className="text-amber-500">Noch nie verbunden</span>}
            </div>
          </div>
        ) : (
          <div className="mt-3 text-sm text-gray-400">Lade Agent-Status…</div>
        )}

        {/* Revoke confirmation */}
        {revokeConfirm && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-red-700">Token wirklich widerrufen? Der Agent wird sich nicht mehr verbinden können.</span>
            <div className="flex gap-2">
              <button onClick={() => setRevokeConfirm(false)} className="text-xs text-gray-500 hover:text-gray-700">Abbrechen</button>
              <button
                onClick={() => revokeTokenMutation.mutate()}
                disabled={revokeTokenMutation.isPending}
                className="text-xs text-red-600 font-medium hover:text-red-800"
              >
                {revokeTokenMutation.isPending ? 'Widerrufe…' : 'Ja, widerrufen'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Agent Setup Dialog (Token generated) */}
      {showAgentSetup && generatedToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Agent einrichten</h2>
              <button onClick={() => { setShowAgentSetup(false); setGeneratedToken(null); setTokenCopied(false) }}
                className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4">
              <p className="text-sm text-amber-800 font-medium">Token wird nur einmal angezeigt!</p>
              <p className="text-xs text-amber-600 mt-1">Kopiere den Token jetzt und trage ihn in die Agent-Konfiguration ein.</p>
            </div>

            <div className="bg-gray-900 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
              <code className="text-sm text-emerald-400 break-all">{generatedToken}</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedToken)
                  setTokenCopied(true)
                  setTimeout(() => setTokenCopied(false), 3000)
                }}
                className={clsx('ml-3 flex-shrink-0 p-1.5 rounded transition-colors',
                  tokenCopied ? 'text-emerald-400' : 'text-gray-400 hover:text-white')}
                title="In Zwischenablage kopieren"
              >
                {tokenCopied ? <CheckCircle className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}
              </button>
            </div>

            {/* Tab selector */}
            <div className="flex border-b border-gray-200 mb-4">
              {([
                ['debian', 'Debian / Ubuntu'],
                ['rhel', 'RHEL / Rocky'],
                ['generic', 'Andere'],
                ['windows', 'Windows'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setSetupTab(key)}
                  className={clsx('px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px',
                    setupTab === key ? 'border-overseer-600 text-overseer-700' : 'border-transparent text-gray-500 hover:text-gray-700')}
                >{label}</button>
              ))}
            </div>

            <div className="text-sm text-gray-700">
              {setupTab === 'windows' ? (
                <div className="bg-gray-50 rounded-lg px-4 py-3 text-xs space-y-3">
                  <p className="font-sans"><span className="text-gray-400 font-mono">1.</span> Installer herunterladen:</p>
                  <a
                    href="/agent/overseer-agent-setup.exe"
                    download
                    className="flex items-center gap-2 px-3 py-2 bg-overseer-600 text-white rounded-lg text-xs font-medium hover:bg-overseer-700 transition-colors no-underline w-fit font-sans"
                  >
                    <Download className="w-3.5 h-3.5" />
                    overseer-agent-setup.exe (5.6 MB)
                  </a>
                  <p className="font-sans"><span className="text-gray-400 font-mono">2.</span> Setup als Administrator ausführen</p>
                  <p className="font-sans"><span className="text-gray-400 font-mono">3.</span> Server-URL und Token eingeben:</p>
                  <CodeBlock>{`Server: ${window.location.origin}\nToken: ${generatedToken}`}</CodeBlock>
                  <p className="font-sans"><span className="text-gray-400 font-mono">4.</span> Weiter klicken — der Installer erledigt den Rest</p>
                  <p className="text-gray-400 font-sans">(Service wird automatisch installiert und gestartet)</p>
                </div>
              ) : (
                <div className="bg-gray-50 rounded-lg px-4 py-3 text-xs space-y-3">
                  {setupTab === 'debian' && (
                    <>
                      <p className="font-sans text-gray-600">Voraussetzung — <code className="bg-gray-200 px-1.5 py-0.5 rounded text-[11px]">wget</code> installieren falls nicht vorhanden:</p>
                      <CodeBlock>{`apt install -y wget`}</CodeBlock>
                    </>
                  )}
                  {setupTab === 'rhel' && (
                    <>
                      <p className="font-sans text-gray-600">Voraussetzung — <code className="bg-gray-200 px-1.5 py-0.5 rounded text-[11px]">wget</code> installieren falls nicht vorhanden:</p>
                      <CodeBlock>{`dnf install -y wget`}</CodeBlock>
                    </>
                  )}
                  {setupTab === 'generic' && (
                    <p className="font-sans text-gray-600">
                      <code className="bg-gray-200 px-1.5 py-0.5 rounded text-[11px]">wget</code> oder <code className="bg-gray-200 px-1.5 py-0.5 rounded text-[11px]">curl</code> muss installiert sein.
                    </p>
                  )}
                  <p className="font-sans text-gray-700">Als <strong>root</strong> ausführen:</p>
                  <CodeBlock>{`wget -qO- ${window.location.origin}/agent/install.sh | bash -s -- ${generatedToken} ${window.location.origin}`}</CodeBlock>
                  <p className="text-gray-400 text-[11px] font-sans">
                    Das Script lädt den Agent herunter, erstellt Config + systemd-Service und startet den Agent.
                    Bei erneuter Ausführung wird eine bestehende Installation aktualisiert.
                  </p>
                  <p className="text-gray-400 text-[11px] font-sans">
                    Logs: <code className="text-emerald-600">journalctl -u overseer-agent -f</code>
                  </p>
                </div>
              )}
            </div>

            <p className="text-xs text-gray-400 mt-3">Sobald der Agent sich meldet, erscheint der Status oben.</p>

            <button
              onClick={() => { setShowAgentSetup(false); setGeneratedToken(null); setTokenCopied(false) }}
              className="w-full mt-5 py-2 rounded-lg bg-overseer-600 text-white text-sm font-medium hover:bg-overseer-700"
            >
              Verstanden
            </button>
          </div>
        </div>
      )}

      {/* Services table */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">
            Services ({serviceList.filter(s => s.active).length})
            {serviceList.some(s => !s.active) && (
              <span className="text-gray-400 font-normal text-sm ml-1">
                · {serviceList.filter(s => !s.active).length} inaktiv
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {host.snmp_community && host.ip_address && (
              <button
                onClick={() => setShowSnmpDiscovery(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Search className="w-3.5 h-3.5" />
                SNMP Discovery
              </button>
            )}
            <button
              onClick={() => setShowAddCheck(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-overseer-600 text-white text-xs font-medium rounded-lg hover:bg-overseer-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Check hinzufügen
            </button>
          </div>
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
                <th className="px-6 py-3 text-left">Verlauf</th>
                <th className="px-6 py-3 text-right">Letzte Änderung</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map(svc => {
                const meta = serviceNames[svc.service_id]
                const isInactive = meta?.active === false
                const cfg = getStatusConfig(svc.status)
                const Icon = cfg.icon
                const isSslCheck = meta?.check_type === 'ssl_certificate'
                const isSslExpanded = isSslCheck && expandedSslService === svc.service_id
                return (
                  <React.Fragment key={svc.service_id}>
                  <tr
                    className={clsx('hover:bg-gray-50', isInactive && 'opacity-50', isSslCheck && 'cursor-pointer')}
                    onClick={isSslCheck ? () => setExpandedSslService(prev => prev === svc.service_id ? null : svc.service_id) : undefined}
                  >
                    <td className="px-6 py-3 whitespace-nowrap">
                      {isInactive ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold bg-gray-100 text-gray-400">
                          INAKTIV
                        </span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <span className={clsx(
                            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold',
                            cfg.bg, cfg.text
                          )}>
                            <Icon className="w-3 h-3" />
                            {cfg.label}
                          </span>
                          {svc.state_type === 'SOFT' && svc.status !== 'OK' && (
                            <span className="text-[10px] text-amber-600 font-medium px-1">
                              Attempt {svc.current_attempt}/{meta?.max_check_attempts ?? 3}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className={clsx('px-6 py-3 font-medium whitespace-nowrap', isInactive ? 'text-gray-400 line-through' : 'text-gray-800')}>
                      <span className="flex items-center gap-1.5">
                        {isSslCheck && <Shield className={clsx('w-3.5 h-3.5', isSslExpanded ? 'text-overseer-500' : 'text-gray-400')} />}
                        {meta?.name ?? '–'}
                        {isSslCheck && (
                          <svg className={clsx('w-3 h-3 transition-transform', isSslExpanded && 'rotate-180')} viewBox="0 0 12 12" fill="currentColor">
                            <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-500 text-xs whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        {meta?.check_type ? getCheckTypeLabel(meta.check_type) : '–'}
                        {meta?.check_mode === 'active' && (
                          <span className="text-[10px] font-sans font-medium bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">aktiv</span>
                        )}
                        {meta?.check_mode === 'agent' && (
                          <span className="text-[10px] font-sans font-medium bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded">agent</span>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-500">
                      <span
                        className="block break-words cursor-pointer hover:text-gray-800"
                        onClick={() => svc.status_message && navigator.clipboard.writeText(svc.status_message)}
                      >
                        {svc.status_message ?? '–'}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right font-mono text-xs text-gray-700 whitespace-nowrap">
                      {svc.value !== null ? `${svc.value}${svc.unit ?? ''}` : '–'}
                    </td>
                    <td className="px-4 py-3">
                      <SparklineCell serviceId={svc.service_id} onClick={() =>
                        setHistoryTarget({ id: svc.service_id, name: meta?.name ?? svc.service_id, warn: meta?.threshold_warn ?? null, crit: meta?.threshold_crit ?? null })
                      } />
                    </td>
                    <td className="px-6 py-3 text-right text-gray-400 text-xs whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 justify-end">
                        <Clock className="w-3 h-3" />
                        {svc.last_state_change_at
                          ? formatDistanceToNow(new Date(svc.last_state_change_at), { locale: de, addSuffix: true })
                          : '–'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        <button
                          onClick={() => runCheckNow(svc.service_id)}
                          disabled={checkingNow[svc.service_id] === 'pending'}
                          className={clsx(
                            'transition-colors',
                            checkingNow[svc.service_id] === 'pending' ? 'text-overseer-400 animate-pulse' :
                            checkingNow[svc.service_id] === 'done' ? 'text-emerald-500' :
                            checkingNow[svc.service_id] === 'error' ? 'text-red-500' :
                            'text-gray-300 hover:text-overseer-500',
                          )}
                          title="Jetzt prüfen"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                        {meta && (
                          <button
                            onClick={() => toggleServiceActiveMutation.mutate({ id: svc.service_id, active: !meta.active })}
                            className={clsx(
                              'transition-colors',
                              meta.active
                                ? 'text-gray-300 hover:text-red-500'
                                : 'text-emerald-500 hover:text-emerald-700',
                            )}
                            title={meta.active ? 'Deaktivieren' : 'Aktivieren'}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {meta?.active !== false && serviceList.find(s => s.id === svc.service_id) && (
                          <button
                            onClick={() => setEditService(serviceList.find(s => s.id === svc.service_id)!)}
                            className="text-gray-300 hover:text-overseer-500 transition-colors"
                            title="Service bearbeiten"
                          >
                            <Settings2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {confirmDelete === svc.service_id ? (
                          <span className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                deleteServiceMutation.mutate(svc.service_id)
                                setConfirmDelete(null)
                              }}
                              className="text-red-500 hover:text-red-700 transition-colors text-xs font-medium"
                              title="Löschen bestätigen"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="text-gray-400 hover:text-gray-600 transition-colors"
                              title="Abbrechen"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(svc.service_id)}
                            className="text-gray-300 hover:text-red-500 transition-colors"
                            title="Check löschen"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isSslExpanded && (
                    <tr>
                      <td colSpan={8} className="px-4 py-2 bg-gray-50/50">
                        <SslCertificatePanel serviceId={svc.service_id} />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Anomaly Detection & Predictions */}
      <AnomalySection
        hostId={hostId!}
        services={sorted
          .filter(s => {
            const meta = serviceNames[s.service_id]
            return meta && (s.value !== null || ['agent_cpu', 'agent_memory', 'agent_disk', 'cpu', 'memory', 'disk', 'snmp_cpu', 'snmp_memory', 'snmp_disk'].includes(meta.check_type))
          })
          .map(s => ({
            service_id: s.service_id,
            name: serviceNames[s.service_id]?.name || s.service_name || s.service_id,
            check_type: serviceNames[s.service_id]?.check_type || '',
          }))}
      />

      {/* Dependencies section */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Dependencies</h2>
          <p className="text-xs text-gray-500 mt-0.5">When a parent host is down, alerts for this host are suppressed.</p>
        </div>
        <div className="p-6 space-y-4">
          {/* Parents: this host depends on */}
          {(() => {
            const parents = dependencies.filter(d => d.source_type === 'host' && d.source_id === hostId)
            const children = dependencies.filter(d => d.depends_on_type === 'host' && d.depends_on_id === hostId)
            return (
              <>
                <div>
                  <h3 className="text-xs font-medium text-gray-600 uppercase tracking-wider mb-2">This host depends on</h3>
                  {parents.length === 0 ? (
                    <p className="text-sm text-gray-400">No parent dependencies</p>
                  ) : (
                    <div className="space-y-1.5">
                      {parents.map(d => (
                        <div key={d.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                          <Link to={`/hosts/${d.depends_on_id}`} className="text-sm font-medium text-blue-600 hover:underline">
                            {d.depends_on_name || d.depends_on_id}
                          </Link>
                          <button
                            onClick={() => deleteDepMutation.mutate(d.id)}
                            className="text-gray-400 hover:text-red-500 p-1"
                            title="Remove dependency"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Add parent */}
                  <div className="flex items-center gap-2 mt-2">
                    <select
                      value={depTarget} onChange={e => setDepTarget(e.target.value)}
                      className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-overseer-500"
                    >
                      <option value="">Select parent host...</option>
                      {allHosts
                        .filter(h => h.id !== hostId && !parents.some(p => p.depends_on_id === h.id))
                        .map(h => <option key={h.id} value={h.id}>{h.hostname}</option>)
                      }
                    </select>
                    <button
                      onClick={() => depTarget && addDepMutation.mutate({ source_type: 'host', source_id: hostId!, depends_on_type: 'host', depends_on_id: depTarget })}
                      disabled={!depTarget || addDepMutation.isPending}
                      className="px-3 py-1.5 rounded-lg bg-overseer-600 text-white text-xs font-medium hover:bg-overseer-700 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                  {addDepMutation.isError && (
                    <p className="text-xs text-red-500 mt-1">{(addDepMutation.error as any)?.response?.data?.detail || 'Error'}</p>
                  )}
                </div>

                {children.length > 0 && (
                  <div className="pt-3 border-t border-gray-100">
                    <h3 className="text-xs font-medium text-gray-600 uppercase tracking-wider mb-2">Dependent hosts (children)</h3>
                    <div className="space-y-1.5">
                      {children.map(d => (
                        <div key={d.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                          <Link to={`/hosts/${d.source_id}`} className="text-sm font-medium text-blue-600 hover:underline">
                            {d.source_name || d.source_id}
                          </Link>
                          <button
                            onClick={() => deleteDepMutation.mutate(d.id)}
                            className="text-gray-400 hover:text-red-500 p-1"
                            title="Remove dependency"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
