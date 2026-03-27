import { useParams } from 'react-router-dom'
import { usePublicStatusPage, usePublicSubscribe } from '../api/hooks'
import type { PublicStatusPageData } from '../types'
import { useState } from 'react'

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  operational: { label: 'Operational', color: '#22c55e', icon: '✓' },
  degraded_performance: { label: 'Degraded Performance', color: '#eab308', icon: '!' },
  partial_outage: { label: 'Partial Outage', color: '#f97316', icon: '⚠' },
  major_outage: { label: 'Major Outage', color: '#ef4444', icon: '✕' },
  under_maintenance: { label: 'Under Maintenance', color: '#3b82f6', icon: '🔧' },
}

const OVERALL_LABELS: Record<string, { text: string; bg: string; fg: string }> = {
  operational: { text: 'All Systems Operational', bg: '#22c55e', fg: '#fff' },
  degraded_performance: { text: 'Some Systems Degraded', bg: '#eab308', fg: '#fff' },
  partial_outage: { text: 'Partial System Outage', bg: '#f97316', fg: '#fff' },
  major_outage: { text: 'Major System Outage', bg: '#ef4444', fg: '#fff' },
  under_maintenance: { text: 'Scheduled Maintenance In Progress', bg: '#3b82f6', fg: '#fff' },
}

export default function PublicStatusPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data, isLoading, error } = usePublicStatusPage(slug)

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-400 text-lg">Loading...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-300 mb-2">404</h1>
          <p className="text-gray-500">Status page not found.</p>
        </div>
      </div>
    )
  }

  return <StatusPageView data={data} slug={slug!} />
}


function StatusPageView({ data, slug }: { data: PublicStatusPageData; slug: string }) {
  const overall = OVERALL_LABELS[data.overall_status] || OVERALL_LABELS.operational

  // Group components
  const groups = new Map<string, typeof data.components>()
  for (const comp of data.components) {
    const key = comp.group_name || ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(comp)
  }

  // Upcoming maintenance (scheduled, not yet started)
  const upcomingMaint = (data.scheduled_maintenances || []).filter(m => m.status === 'scheduled')
  // Active maintenance (in_progress)
  const activeMaint = (data.scheduled_maintenances || []).filter(m => m.status === 'in_progress')

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f0f4f8', fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          {data.logo_url && <img src={data.logo_url} alt="" className="h-10 mx-auto" />}
          <h1 className="text-2xl font-bold text-gray-900">{data.title}</h1>
          {data.description && <p className="text-gray-500">{data.description}</p>}
        </div>

        {/* Upcoming maintenance banner */}
        {upcomingMaint.map(m => (
          <div key={m.id} className="rounded-xl px-6 py-4 shadow-sm border border-blue-200" style={{ backgroundColor: '#eff6ff' }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-blue-500 text-lg">🔧</span>
              <span className="font-semibold text-blue-900">Scheduled Maintenance</span>
            </div>
            <p className="text-blue-800 font-medium">{m.title}</p>
            <p className="text-sm text-blue-600 mt-1">
              {m.scheduled_start && new Date(m.scheduled_start).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {' — '}
              {m.scheduled_end && new Date(m.scheduled_end).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
            {m.updates.length > 0 && (
              <p className="text-sm text-blue-700 mt-2">{m.updates[m.updates.length - 1].body}</p>
            )}
          </div>
        ))}

        {/* Active maintenance banner */}
        {activeMaint.map(m => (
          <div key={m.id} className="rounded-xl px-6 py-4 shadow-sm" style={{ backgroundColor: '#3b82f6', color: '#fff' }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">🔧</span>
              <span className="font-semibold">Maintenance In Progress</span>
            </div>
            <p className="font-medium">{m.title}</p>
            <p className="text-sm opacity-90 mt-1">
              Expected completion: {m.scheduled_end && new Date(m.scheduled_end).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        ))}

        {/* Overall status banner */}
        <div className="rounded-xl px-6 py-4 text-center font-semibold text-lg shadow-sm" style={{ backgroundColor: overall.bg, color: overall.fg }}>
          {data.overall_status === 'operational' ? '✓ ' : data.overall_status === 'under_maintenance' ? '🔧 ' : '⚠ '}{overall.text}
        </div>

        {/* Components */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 divide-y divide-gray-100">
          {[...groups.entries()].map(([groupName, comps]) => (
            <div key={groupName}>
              {groupName && (
                <div className="px-6 pt-4 pb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">{groupName}</span>
                </div>
              )}
              {comps.map(comp => (
                <ComponentRow key={comp.id} comp={comp} />
              ))}
            </div>
          ))}
        </div>

        {/* Active incidents */}
        {data.active_incidents.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">Current Incidents</h2>
            {data.active_incidents.map(inc => (
              <IncidentCard key={inc.id} incident={inc} />
            ))}
          </div>
        )}

        {/* Past incidents */}
        {data.past_incidents.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">Past Incidents</h2>
            {data.past_incidents.map(inc => (
              <IncidentCard key={inc.id} incident={inc} />
            ))}
          </div>
        )}

        {/* Subscribe to updates */}
        <SubscribeForm slug={slug} />

        {/* Footer */}
        <div className="text-center text-xs text-gray-400 pt-4 pb-8">
          Powered by Overseer
        </div>
      </div>
    </div>
  )
}


function SubscribeForm({ slug }: { slug: string }) {
  const subscribeMut = usePublicSubscribe()
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [message, setMessage] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    subscribeMut.mutate({ slug, email }, {
      onSuccess: (data: { message: string }) => {
        setDone(true)
        setMessage(data.message)
        setEmail('')
      },
      onError: () => setMessage('An error occurred. Please try again.'),
    })
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <h3 className="font-semibold text-gray-900 mb-3">Subscribe to Updates</h3>
      {done ? (
        <p className="text-sm text-green-600">{message}</p>
      ) : (
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={subscribeMut.isPending}
            className="px-5 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            Subscribe
          </button>
        </form>
      )}
    </div>
  )
}


function ComponentRow({ comp }: { comp: PublicStatusPageData['components'][0] }) {
  const cfg = STATUS_CONFIG[comp.current_status] || STATUS_CONFIG.operational

  return (
    <div className="px-6 py-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">{comp.name}</span>
          {comp.description && <span className="text-sm text-gray-400">— {comp.description}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: cfg.color }}>{cfg.label}</span>
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cfg.color }} />
        </div>
      </div>

      {/* 90-day uptime bar */}
      {comp.show_uptime && (
        <div className="flex items-center gap-1">
          <UptimeBar days={comp.uptime_90d} />
          <span className="text-xs text-gray-500 ml-2 whitespace-nowrap">{comp.overall_uptime}%</span>
        </div>
      )}
    </div>
  )
}


function UptimeBar({ days }: { days: { date: string; uptime: number | null; worst_status: string | null; outage_minutes: number }[] }) {
  // Build a map of existing data
  const dayMap = new Map(days.map(d => [d.date, d]))

  // Generate last 90 days
  const bars: { date: string; uptime: number | null; outage_minutes: number }[] = []
  for (let i = 89; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().split('T')[0]
    const entry = dayMap.get(key)
    bars.push({
      date: key,
      uptime: entry?.uptime ?? null,
      outage_minutes: entry?.outage_minutes ?? 0,
    })
  }

  return (
    <div className="flex gap-px flex-1">
      {bars.map(bar => (
        <UptimeBarSegment key={bar.date} bar={bar} />
      ))}
    </div>
  )
}


function UptimeBarSegment({ bar }: { bar: { date: string; uptime: number | null; outage_minutes: number } }) {
  const [hover, setHover] = useState(false)

  let color: string
  if (bar.uptime === null) color = '#d1d5db'
  else if (bar.uptime >= 100) color = '#22c55e'
  else if (bar.uptime >= 99.5) color = '#86efac'
  else if (bar.uptime >= 99) color = '#eab308'
  else if (bar.uptime >= 95) color = '#f97316'
  else color = '#ef4444'

  const dateStr = new Date(bar.date + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })

  return (
    <div className="relative flex-1">
      <div
        className="h-8 rounded-[2px] cursor-pointer transition-transform hover:scale-y-110"
        style={{ backgroundColor: color }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      {hover && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg shadow-lg whitespace-nowrap z-10 pointer-events-none">
          <div className="font-medium">{dateStr}</div>
          {bar.uptime !== null ? (
            <>
              <div>{bar.uptime}% uptime</div>
              {bar.outage_minutes > 0 && <div>{bar.outage_minutes} min downtime</div>}
            </>
          ) : (
            <div>No data</div>
          )}
        </div>
      )}
    </div>
  )
}


function IncidentCard({ incident }: { incident: PublicStatusPageData['active_incidents'][0] }) {
  const isResolved = incident.status === 'resolved'
  const impactColor = incident.impact === 'critical' ? '#ef4444' : incident.impact === 'major' ? '#f97316' : '#eab308'

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-start gap-3">
        <div className="w-3 h-3 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: isResolved ? '#22c55e' : impactColor }} />
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900">{incident.title}</h3>
          <p className="text-xs text-gray-400 mb-3">
            {new Date(incident.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
            {isResolved && ' — Resolved'}
          </p>

          {incident.updates.length > 0 && (
            <div className="border-l-2 border-gray-200 pl-4 space-y-3">
              {incident.updates.map(u => (
                <div key={u.id}>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium capitalize text-gray-700">{u.status}</span>
                    <span className="text-gray-400 text-xs">
                      {new Date(u.created_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mt-0.5">{u.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
