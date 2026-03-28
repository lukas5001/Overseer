import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, ChevronDown, ChevronRight, X, Clock, Play, Pause, FileText } from 'lucide-react'
import clsx from 'clsx'
import { format } from 'date-fns'
import { useSearchLogs, useHosts } from '../api/hooks'
import type { LogEntry, LogSearchParams } from '../types'

// Syslog severity levels
const SEVERITY_CONFIG: Record<number, { label: string; bg: string; text: string; short: string }> = {
  0: { label: 'Emergency',  bg: 'bg-purple-100',  text: 'text-purple-800',  short: 'EMERG' },
  1: { label: 'Alert',      bg: 'bg-red-100',     text: 'text-red-800',     short: 'ALERT' },
  2: { label: 'Critical',   bg: 'bg-red-100',     text: 'text-red-800',     short: 'CRIT' },
  3: { label: 'Error',      bg: 'bg-red-100',     text: 'text-red-800',     short: 'ERROR' },
  4: { label: 'Warning',    bg: 'bg-amber-100',   text: 'text-amber-800',   short: 'WARN' },
  5: { label: 'Notice',     bg: 'bg-blue-100',    text: 'text-blue-800',    short: 'NOTICE' },
  6: { label: 'Info',       bg: 'bg-sky-100',     text: 'text-sky-800',     short: 'INFO' },
  7: { label: 'Debug',      bg: 'bg-gray-100',    text: 'text-gray-800',    short: 'DEBUG' },
}

const TIME_RANGES = [
  { label: '15 Min', value: 15 },
  { label: '1 Std', value: 60 },
  { label: '6 Std', value: 360 },
  { label: '24 Std', value: 1440 },
  { label: '7 Tage', value: 10080 },
]

function SeverityBadge({ severity }: { severity: number }) {
  const cfg = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG[6]
  return (
    <span className={clsx('inline-flex px-1.5 py-0.5 rounded text-[11px] font-bold tracking-wide', cfg.bg, cfg.text)}>
      {cfg.short}
    </span>
  )
}

export default function LogsPage() {
  const [searchParams] = useSearchParams()

  // Initialize from URL params (for log correlation links)
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '')
  const [submittedQuery, setSubmittedQuery] = useState(searchParams.get('q') || '')
  const [selectedHosts, setSelectedHosts] = useState<string[]>(() => {
    const h = searchParams.get('host_ids')
    return h ? h.split(',') : []
  })
  const [selectedSeverities, setSelectedSeverities] = useState<number[]>(() => {
    const s = searchParams.get('severity')
    return s ? s.split(',').map(Number) : []
  })
  const [timeRangeMinutes, setTimeRangeMinutes] = useState(() => {
    const t = searchParams.get('time')
    return t ? parseInt(t) : 1440
  })
  const [customFrom, setCustomFrom] = useState<string | null>(searchParams.get('from'))
  const [customTo, setCustomTo] = useState<string | null>(searchParams.get('to'))
  const [offset, setOffset] = useState(0)
  const [allLogs, setAllLogs] = useState<LogEntry[]>([])
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const [liveTail, setLiveTail] = useState(false)
  const [showHostFilter, setShowHostFilter] = useState(false)
  const [showSeverityFilter, setShowSeverityFilter] = useState(false)
  const hostFilterRef = useRef<HTMLDivElement>(null)
  const severityFilterRef = useRef<HTMLDivElement>(null)

  const { data: hosts } = useHosts()

  // Build time range
  const timeRange = useMemo(() => {
    if (customFrom && customTo) {
      return { from: customFrom, to: customTo }
    }
    const to = new Date()
    const from = new Date(to.getTime() - timeRangeMinutes * 60 * 1000)
    return { from: from.toISOString(), to: to.toISOString() }
  }, [timeRangeMinutes, customFrom, customTo])

  // Build search params
  const searchParamsObj = useMemo<LogSearchParams>(() => {
    const p: LogSearchParams = {
      limit: 200,
      offset,
      from: timeRange.from,
      to: timeRange.to,
    }
    if (submittedQuery) p.query = submittedQuery
    if (selectedHosts.length > 0) p.host_ids = selectedHosts
    if (selectedSeverities.length > 0) {
      // severity_min = most severe selected (lowest number)
      p.severity_min = Math.max(...selectedSeverities)
    }
    return p
  }, [submittedQuery, selectedHosts, selectedSeverities, timeRange, offset])

  const { data, isLoading } = useSearchLogs(searchParamsObj)

  // Live tail via SSE
  useEffect(() => {
    if (!liveTail) return
    const token = localStorage.getItem('overseer_token')
    if (!token) return

    const params = new URLSearchParams()
    params.set('token', token)
    if (selectedHosts.length > 0) params.set('host_ids', selectedHosts.join(','))
    if (selectedSeverities.length > 0) params.set('severity_min', String(Math.max(...selectedSeverities)))
    if (submittedQuery) params.set('query', submittedQuery)

    const url = `/api/v1/logs/stream?${params.toString()}`
    const eventSource = new EventSource(url)

    eventSource.onmessage = (event) => {
      try {
        const newLogs: LogEntry[] = JSON.parse(event.data)
        if (newLogs.length > 0) {
          setAllLogs(prev => [...newLogs.reverse(), ...prev].slice(0, 2000))
        }
      } catch { /* ignore parse errors */ }
    }

    eventSource.onerror = () => {
      // SSE reconnects automatically
    }

    return () => eventSource.close()
  }, [liveTail, selectedHosts, selectedSeverities, submittedQuery])

  // Accumulate logs for "Load More"
  useEffect(() => {
    if (data?.logs) {
      if (offset === 0) {
        setAllLogs(data.logs)
      } else {
        setAllLogs(prev => [...prev, ...data.logs])
      }
    }
  }, [data, offset])

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0)
    setAllLogs([])
  }, [submittedQuery, selectedHosts, selectedSeverities, timeRangeMinutes, customFrom, customTo])

  // Close dropdowns on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (hostFilterRef.current && !hostFilterRef.current.contains(e.target as Node)) setShowHostFilter(false)
      if (severityFilterRef.current && !severityFilterRef.current.contains(e.target as Node)) setShowSeverityFilter(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    setSubmittedQuery(searchQuery)
    setOffset(0)
  }, [searchQuery])

  const toggleHost = (id: string) => {
    setSelectedHosts(prev => prev.includes(id) ? prev.filter(h => h !== id) : [...prev, id])
  }

  const toggleSeverity = (sev: number) => {
    setSelectedSeverities(prev => prev.includes(sev) ? prev.filter(s => s !== sev) : [...prev, sev])
  }

  const formatTimestamp = (iso: string) => {
    try { return format(new Date(iso), 'HH:mm:ss.SSS') } catch { return iso }
  }

  const formatDate = (iso: string) => {
    try { return format(new Date(iso), 'dd.MM.yyyy') } catch { return '' }
  }

  // Group logs by date for date separators
  const logsWithDates = useMemo(() => {
    const result: { type: 'date'; date: string }[] | { type: 'log'; log: LogEntry; idx: number }[] = []
    let lastDate = ''
    allLogs.forEach((log, idx) => {
      const d = formatDate(log.time)
      if (d !== lastDate) {
        (result as any[]).push({ type: 'date', date: d })
        lastDate = d
      }
      (result as any[]).push({ type: 'log', log, idx })
    })
    return result as ({ type: 'date'; date: string } | { type: 'log'; log: LogEntry; idx: number })[]
  }, [allLogs])

  const total = data?.total ?? 0

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FileText className="w-6 h-6 text-blue-400" />
          <h1 className="text-xl font-bold text-white">Logs</h1>
        </div>
        {/* Live Tail Toggle */}
        <button
          onClick={() => setLiveTail(prev => !prev)}
          className={clsx(
            'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
            liveTail
              ? 'bg-red-600/20 text-red-400 border border-red-500/50'
              : 'bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700'
          )}
        >
          {liveTail ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          Live
          {liveTail && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
        </button>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder='Suche: "connection refused" OR timeout ...'
            className="w-full pl-10 pr-24 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            type="submit"
            className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md transition-colors"
          >
            Suchen
          </button>
        </div>
      </form>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Host Filter */}
        <div className="relative" ref={hostFilterRef}>
          <button
            onClick={() => { setShowHostFilter(!showHostFilter); setShowSeverityFilter(false) }}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors',
              selectedHosts.length > 0
                ? 'bg-blue-600/30 text-blue-200 border-blue-500/50'
                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
            )}
          >
            Host {selectedHosts.length > 0 && `(${selectedHosts.length})`}
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          {showHostFilter && (
            <div className="absolute z-20 top-full mt-1 left-0 w-64 max-h-64 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg shadow-xl">
              {selectedHosts.length > 0 && (
                <button
                  onClick={() => setSelectedHosts([])}
                  className="w-full px-3 py-1.5 text-xs text-gray-400 hover:text-white text-left border-b border-gray-700"
                >
                  Alle abwählen
                </button>
              )}
              {(hosts ?? []).map(h => (
                <label key={h.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 cursor-pointer text-sm text-gray-200">
                  <input
                    type="checkbox"
                    checked={selectedHosts.includes(h.id)}
                    onChange={() => toggleHost(h.id)}
                    className="rounded border-gray-600 text-blue-500 focus:ring-blue-500 bg-gray-700"
                  />
                  {h.display_name || h.hostname}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Severity Filter */}
        <div className="relative" ref={severityFilterRef}>
          <button
            onClick={() => { setShowSeverityFilter(!showSeverityFilter); setShowHostFilter(false) }}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors',
              selectedSeverities.length > 0
                ? 'bg-amber-600/20 text-amber-300 border-amber-500/50'
                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
            )}
          >
            Severity {selectedSeverities.length > 0 && `(${selectedSeverities.length})`}
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          {showSeverityFilter && (
            <div className="absolute z-20 top-full mt-1 left-0 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl">
              {selectedSeverities.length > 0 && (
                <button
                  onClick={() => setSelectedSeverities([])}
                  className="w-full px-3 py-1.5 text-xs text-gray-400 hover:text-white text-left border-b border-gray-700"
                >
                  Alle abwählen
                </button>
              )}
              {Object.entries(SEVERITY_CONFIG).map(([sev, cfg]) => (
                <label key={sev} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={selectedSeverities.includes(Number(sev))}
                    onChange={() => toggleSeverity(Number(sev))}
                    className="rounded border-gray-600 text-blue-500 focus:ring-blue-500 bg-gray-700"
                  />
                  <SeverityBadge severity={Number(sev)} />
                  <span className="text-gray-300">{cfg.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Time Range */}
        <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-lg p-0.5">
          {TIME_RANGES.map(tr => (
            <button
              key={tr.value}
              onClick={() => { setTimeRangeMinutes(tr.value); setCustomFrom(null); setCustomTo(null) }}
              className={clsx(
                'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                timeRangeMinutes === tr.value && !customFrom
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              )}
            >
              {tr.label}
            </button>
          ))}
        </div>

        {/* Active filter chips */}
        {submittedQuery && (
          <span className="flex items-center gap-1 px-2 py-1 bg-blue-600/30 text-blue-200 border border-blue-500/30 rounded-lg text-xs">
            Suche: "{submittedQuery}"
            <button onClick={() => { setSearchQuery(''); setSubmittedQuery('') }}>
              <X className="w-3 h-3" />
            </button>
          </span>
        )}
      </div>

      {/* Log Stats Summary */}
      {!isLoading && data && (
        <div className="flex items-center gap-4 mb-3 text-xs text-gray-400">
          <span>{total.toLocaleString()} Ergebnisse</span>
          <span className="text-gray-600">|</span>
          <span>Zeige {allLogs.length} von {total.toLocaleString()}</span>
          {liveTail && <span className="text-red-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> Live-Tail aktiv</span>}
        </div>
      )}

      {/* Log Entries */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        {isLoading && allLogs.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-gray-500">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mr-3" />
            Logs werden geladen...
          </div>
        ) : allLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <FileText className="w-10 h-10 mb-3 opacity-50" />
            <p>Keine Logs gefunden</p>
            <p className="text-xs mt-1">Passe den Zeitraum oder die Filter an</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800/50">
            {logsWithDates.map((item) => {
              if (item.type === 'date') {
                return (
                  <div key={`date-${item.date}`} className="px-4 py-1.5 bg-gray-800/50 text-xs text-gray-500 font-medium sticky top-0 z-10">
                    {item.date}
                  </div>
                )
              }

              const log = item.log
              const idx = item.idx
              const isExpanded = expandedIdx === idx
              const sevCfg = SEVERITY_CONFIG[log.severity] ?? SEVERITY_CONFIG[6]

              return (
                <div key={`${log.time}-${idx}`}>
                  <button
                    onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                    className={clsx(
                      'w-full text-left px-4 py-2 hover:bg-gray-800/50 transition-colors group',
                      isExpanded && 'bg-gray-800/30'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {/* Expand icon */}
                      {isExpanded
                        ? <ChevronDown className="w-3.5 h-3.5 text-gray-500 mt-0.5 flex-shrink-0" />
                        : <ChevronRight className="w-3.5 h-3.5 text-gray-600 mt-0.5 flex-shrink-0 group-hover:text-gray-400" />
                      }

                      {/* Timestamp */}
                      <span className="font-mono text-xs text-gray-500 flex-shrink-0 mt-0.5 w-[90px]">
                        {formatTimestamp(log.time)}
                      </span>

                      {/* Host + Service */}
                      <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5 w-[180px] truncate">
                        {log.host ?? 'unknown'}
                        {log.service && <span className="text-gray-600"> / {log.service}</span>}
                      </span>

                      {/* Severity Badge */}
                      <span className="flex-shrink-0 mt-0.5">
                        <SeverityBadge severity={log.severity} />
                      </span>

                      {/* Message */}
                      <span
                        className={clsx(
                          'text-sm flex-1 min-w-0',
                          log.severity <= 3 ? 'text-red-400' : log.severity === 4 ? 'text-amber-400' : 'text-gray-300'
                        )}
                      >
                        <span
                          className={clsx(!isExpanded && 'line-clamp-2')}
                          dangerouslySetInnerHTML={{ __html: log.message }}
                        />
                      </span>
                    </div>
                  </button>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="px-4 pb-3 pl-[52px] space-y-2">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div>
                          <span className="text-gray-500">Zeit:</span>{' '}
                          <span className="text-gray-300 font-mono">{format(new Date(log.time), 'dd.MM.yyyy HH:mm:ss.SSS')}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Source:</span>{' '}
                          <span className="text-gray-300">{log.source}</span>
                        </div>
                        {log.source_path && (
                          <div className="col-span-2">
                            <span className="text-gray-500">Pfad:</span>{' '}
                            <span className="text-gray-300 font-mono">{log.source_path}</span>
                          </div>
                        )}
                        <div>
                          <span className="text-gray-500">Host:</span>{' '}
                          <span className="text-gray-300">{log.host}</span>
                        </div>
                        {log.service && (
                          <div>
                            <span className="text-gray-500">Service:</span>{' '}
                            <span className="text-gray-300">{log.service}</span>
                          </div>
                        )}
                        <div>
                          <span className="text-gray-500">Severity:</span>{' '}
                          <span className={clsx(sevCfg.text)}>{sevCfg.label} ({log.severity})</span>
                        </div>
                      </div>

                      {/* Full message */}
                      <div className="mt-2">
                        <span className="text-gray-500 text-xs">Message:</span>
                        <pre className="mt-1 p-2 bg-gray-950 rounded text-xs text-gray-300 font-mono whitespace-pre-wrap break-words max-h-60 overflow-auto">
                          {log.message.replace(/<\/?[^>]+(>|$)/g, '')}
                        </pre>
                      </div>

                      {/* Fields */}
                      {log.fields && Object.keys(log.fields).length > 0 && (
                        <div className="mt-2">
                          <span className="text-gray-500 text-xs">Felder:</span>
                          <div className="mt-1 p-2 bg-gray-950 rounded text-xs font-mono">
                            {Object.entries(log.fields).map(([k, v]) => (
                              <div key={k} className="flex gap-2">
                                <span className="text-blue-400">{k}:</span>
                                <span className="text-gray-300">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Context link */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          const logTime = new Date(log.time)
                          const ctxFrom = new Date(logTime.getTime() - 30000).toISOString()
                          const ctxTo = new Date(logTime.getTime() + 30000).toISOString()
                          setCustomFrom(ctxFrom)
                          setCustomTo(ctxTo)
                          if (log.host_id) setSelectedHosts([log.host_id])
                          setSubmittedQuery('')
                          setSearchQuery('')
                          setOffset(0)
                          setExpandedIdx(null)
                        }}
                        className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-1"
                      >
                        <Clock className="w-3 h-3" />
                        Umgebende Logs anzeigen (±30s)
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Load More */}
      {allLogs.length < total && (
        <div className="flex justify-center mt-4">
          <button
            onClick={() => setOffset(prev => prev + 200)}
            disabled={isLoading}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Laden...' : `Mehr laden (${allLogs.length} von ${total.toLocaleString()})`}
          </button>
        </div>
      )}

      {/* Custom time range indicator */}
      {customFrom && customTo && (
        <div className="flex items-center justify-center mt-3 gap-2">
          <span className="text-xs text-gray-500">
            Benutzerdefinierter Zeitraum: {format(new Date(customFrom), 'dd.MM.yyyy HH:mm:ss')} — {format(new Date(customTo), 'dd.MM.yyyy HH:mm:ss')}
          </span>
          <button
            onClick={() => { setCustomFrom(null); setCustomTo(null) }}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            Zurücksetzen
          </button>
        </div>
      )}
    </div>
  )
}
