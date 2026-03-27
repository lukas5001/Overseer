import type { WidgetProps } from './registry'

function getThresholdColor(value: number, thresholds?: { value: number; color: string }[]): string | undefined {
  if (!thresholds || thresholds.length === 0) return undefined
  const sorted = [...thresholds].sort((a, b) => b.value - a.value)
  for (const t of sorted) {
    if (value >= t.value) return t.color
  }
  return undefined
}

function formatValue(value: number | null | undefined, unit?: string, decimals = 1): string {
  if (value == null) return 'N/A'
  const formatted = Number(value).toFixed(decimals)
  if (unit) return `${formatted}${unit}`
  return formatted
}

export default function StatWidget({ config, data, summaryData, isLoading }: WidgetProps) {
  const ds = config.dataSource
  const opts = config.options

  // Summary-based stat (total_hosts, ok, warning, critical, etc.)
  if (ds.type === 'summary' && ds.field && summaryData) {
    const val = summaryData[ds.field]
    const color = opts.color || '#fff'
    return (
      <div className="h-full flex flex-col bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-700">
          <span className="text-sm font-medium text-gray-200 truncate">{config.title}</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span className="text-4xl font-bold" style={{ color }}>
            {val != null ? val : 'N/A'}
          </span>
        </div>
      </div>
    )
  }

  // Query-based stat
  const series = data?.series?.[0]
  const value = series?.value ?? null
  const unit = opts.unit || series?.unit || ''
  const decimals = opts.decimals ?? 1
  const thresholdColor = value != null ? getThresholdColor(value, opts.thresholds) : undefined
  const displayColor = thresholdColor || opts.color || '#fff'

  // Sparkline data if available
  const sparkData = series?.data
  const hasSparkline = opts.showSparkline !== false && sparkData && sparkData.length > 1

  return (
    <div className="h-full flex flex-col bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-200 truncate">{config.title}</span>
        {series && (
          <span className="text-[10px] text-gray-500 truncate ml-2">{series.host}</span>
        )}
      </div>
      <div className="flex-1 flex flex-col items-center justify-center relative px-3">
        {isLoading && !data ? (
          <div className="text-gray-500 text-sm">Laden...</div>
        ) : (
          <>
            <span className="text-4xl font-bold" style={{ color: displayColor }}>
              {formatValue(value, unit, decimals)}
            </span>
            {series && (
              <span className="text-xs text-gray-500 mt-1 truncate max-w-full">
                {series.metric}
              </span>
            )}
          </>
        )}
        {hasSparkline && (
          <svg
            className="absolute bottom-0 left-0 right-0 h-8 opacity-30"
            viewBox={`0 0 ${sparkData.length} 100`}
            preserveAspectRatio="none"
          >
            <polyline
              fill="none"
              stroke={displayColor}
              strokeWidth="2"
              points={sparkData
                .map((d, i) => {
                  const vals = sparkData.filter(p => p.value != null).map(p => p.value!)
                  const min = Math.min(...vals)
                  const max = Math.max(...vals)
                  const range = max - min || 1
                  const y = 100 - ((((d.value ?? min) - min) / range) * 80 + 10)
                  return `${i},${y}`
                })
                .join(' ')}
            />
          </svg>
        )}
      </div>
    </div>
  )
}
