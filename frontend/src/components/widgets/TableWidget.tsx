import { useState, useMemo } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import type { WidgetProps } from './registry'

interface TableRow {
  host: string
  service: string
  status: string
  value: string
  unit: string
  last_check: string
  [key: string]: string
}

const STATUS_COLORS: Record<string, string> = {
  OK: 'text-emerald-400',
  WARNING: 'text-amber-400',
  CRITICAL: 'text-red-400',
  UNKNOWN: 'text-gray-400',
  NO_DATA: 'text-orange-400',
}

const COLUMN_LABELS: Record<string, string> = {
  host: 'Host',
  service: 'Service',
  status: 'Status',
  value: 'Wert',
  unit: 'Einheit',
  last_check: 'Letzte Prüfung',
  check_type: 'Typ',
}

type SortDir = 'asc' | 'desc'

export default function TableWidget({ config, data, isLoading }: WidgetProps) {
  const opts = config.options
  const columns = (opts.columns as string[] | undefined) || ['host', 'service', 'status', 'value', 'last_check']
  const [sortCol, setSortCol] = useState<string>('host')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const rows = useMemo<TableRow[]>(() => {
    if (!data?.series) return []

    // For status_table: data comes from a different source (current_status),
    // but for now we use the query series format
    return data.series.map(s => ({
      host: s.host,
      service: s.metric,
      status: '', // Status comes from separate data if needed
      value: s.value != null ? Number(s.value).toFixed(opts.decimals ?? 1) : 'N/A',
      unit: s.unit || '',
      last_check: s.data && s.data.length > 0
        ? new Date(s.data[s.data.length - 1].time).toLocaleString('de-DE')
        : '',
      check_type: s.check_type,
    }))
  }, [data, opts.decimals])

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[sortCol] ?? ''
      const bv = b[sortCol] ?? ''
      const cmp = av.localeCompare(bv, 'de', { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortCol, sortDir])

  function toggleSort(col: string) {
    if (sortCol === col) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  return (
    <div className="h-full flex flex-col bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-700">
        <span className="text-sm font-medium text-gray-200 truncate">{config.title}</span>
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading && !data ? (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm">Laden...</div>
        ) : sorted.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm">Keine Daten</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-800">
              <tr>
                {columns.map(col => (
                  <th
                    key={col}
                    onClick={() => toggleSort(col)}
                    className="px-3 py-2 text-left text-gray-400 font-medium cursor-pointer hover:text-white select-none whitespace-nowrap"
                  >
                    <span className="inline-flex items-center gap-1">
                      {COLUMN_LABELS[col] || col}
                      {sortCol === col && (
                        sortDir === 'asc'
                          ? <ChevronUp className="w-3 h-3" />
                          : <ChevronDown className="w-3 h-3" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr
                  key={i}
                  className="border-t border-gray-700/50 hover:bg-gray-700/30 transition-colors"
                >
                  {columns.map(col => (
                    <td
                      key={col}
                      className={clsx(
                        'px-3 py-1.5 whitespace-nowrap',
                        col === 'status' && STATUS_COLORS[row[col]] || 'text-gray-300',
                      )}
                    >
                      {col === 'value' && row.unit ? `${row[col]} ${row.unit}` : row[col]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
