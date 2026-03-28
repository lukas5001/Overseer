import { useMemo, useEffect, useState } from 'react'
import { getWidgetType } from './registry'
import { useDashboardQuery, useStatusSummary } from '../../api/hooks'
import type { DashboardWidget, DashboardQueryRequest } from '../../types'

interface WidgetRendererProps {
  widget: DashboardWidget
  timeRange: { from: string; to: string }
  refreshInterval: number  // seconds, 0 = off
  isEditing: boolean
  onConfigChange: (widget: DashboardWidget) => void
  /** Resolved variable values: maps variable name to host/service IDs */
  variableValues?: Record<string, string | string[]>
  /** Custom query hook (for public dashboards) */
  useQueryHook?: typeof useDashboardQuery
  /** Custom summary hook (for public dashboards) */
  useSummaryHook?: () => { data: any }
}

function usePageVisible() {
  const [visible, setVisible] = useState(!document.hidden)
  useEffect(() => {
    const handler = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])
  return visible
}

function computeAutoInterval(timeFrom: string): string {
  if (timeFrom.includes('15m')) return '1m'
  if (timeFrom.includes('1h')) return '1m'
  if (timeFrom.includes('6h')) return '5m'
  if (timeFrom.includes('24h')) return '15m'
  if (timeFrom.includes('7d')) return '1h'
  if (timeFrom.includes('30d')) return '6h'
  return '5m'
}

/** Resolve variable references ($varName) in an ID array using current variable values */
function resolveIds(
  ids: string[] | undefined,
  variableValues: Record<string, string | string[]>,
): string[] | undefined {
  if (!ids?.length) return ids
  const resolved: string[] = []
  for (const id of ids) {
    if (id.startsWith('$')) {
      const varName = id.slice(1)
      const val = variableValues[varName]
      if (!val || val === '__all__') continue // "All" = no filter
      if (Array.isArray(val)) {
        resolved.push(...val.filter(v => v !== '__all__'))
      } else {
        resolved.push(val)
      }
    } else {
      resolved.push(id)
    }
  }
  return resolved.length ? resolved : undefined
}

export default function WidgetRenderer({
  widget,
  timeRange,
  refreshInterval,
  isEditing,
  onConfigChange,
  variableValues = {},
  useQueryHook = useDashboardQuery,
  useSummaryHook,
}: WidgetRendererProps) {
  const pageVisible = usePageVisible()
  const widgetDef = getWidgetType(widget.type)

  // Resolve variable references in data source
  const resolvedHostIds = useMemo(
    () => resolveIds(widget.dataSource.host_ids, variableValues),
    [widget.dataSource.host_ids, variableValues]
  )
  const resolvedServiceIds = useMemo(
    () => resolveIds(widget.dataSource.service_ids, variableValues),
    [widget.dataSource.service_ids, variableValues]
  )

  // Build query from widget dataSource
  const query = useMemo<DashboardQueryRequest | null>(() => {
    const ds = widget.dataSource
    if (ds.type === 'summary') return null

    const needsTimeSeries = widget.type === 'line_chart'

    return {
      service_ids: resolvedServiceIds,
      host_ids: resolvedHostIds,
      check_types: ds.check_types?.length ? ds.check_types : undefined,
      from: timeRange.from,
      to: timeRange.to,
      aggregation: ds.aggregation || 'last',
      interval: needsTimeSeries ? computeAutoInterval(timeRange.from) : undefined,
    }
  }, [widget.dataSource, widget.type, timeRange, resolvedHostIds, resolvedServiceIds])

  // For stat widgets with sparkline, we also want time series data
  const sparklineQuery = useMemo<DashboardQueryRequest | null>(() => {
    if (widget.type !== 'stat' || widget.options.showSparkline === false) return null
    const ds = widget.dataSource
    if (ds.type === 'summary') return null
    if (!resolvedServiceIds?.length) return null

    return {
      service_ids: resolvedServiceIds,
      from: timeRange.from,
      to: timeRange.to,
      aggregation: ds.aggregation || 'last',
      interval: computeAutoInterval(timeRange.from),
    }
  }, [widget, timeRange, resolvedServiceIds])

  const effectiveRefresh = pageVisible && !isEditing && refreshInterval > 0
    ? refreshInterval * 1000
    : undefined

  const hasServiceIds = (resolvedServiceIds?.length ?? 0) > 0
  const hasHostIds = (resolvedHostIds?.length ?? 0) > 0
  const hasCheckTypes = (widget.dataSource.check_types?.length ?? 0) > 0
  const queryEnabled = widget.dataSource.type !== 'summary' && (hasServiceIds || hasHostIds || hasCheckTypes)

  const { data: queryData, isLoading: queryLoading } = useQueryHook(query, {
    refetchInterval: effectiveRefresh,
    enabled: queryEnabled,
  })

  const { data: sparklineData } = useQueryHook(sparklineQuery, {
    refetchInterval: effectiveRefresh,
    enabled: !!sparklineQuery && queryEnabled,
  })

  // For summary widgets, use the status summary
  const defaultSummaryHook = useStatusSummary
  const summaryHook = useSummaryHook ?? defaultSummaryHook
  const { data: statusSummary } = summaryHook()
  const summaryData = useMemo(() => {
    if (!statusSummary) return undefined
    return {
      ...statusSummary,
      total_hosts: statusSummary.total,
    } as Record<string, number>
  }, [statusSummary])

  // Merge sparkline data into main query response for stat widget
  const effectiveData = useMemo(() => {
    if (sparklineData && queryData && widget.type === 'stat') {
      return {
        series: queryData.series.map((s, i) => ({
          ...s,
          data: sparklineData.series[i]?.data || s.data,
        })),
      }
    }
    return queryData ?? null
  }, [queryData, sparklineData, widget.type])

  if (!widgetDef) {
    return (
      <div className="h-full flex flex-col bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{widget.title}</span>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400 text-sm">
          Unbekannter Widget-Typ: {widget.type}
        </div>
      </div>
    )
  }

  const Component = widgetDef.component

  return (
    <Component
      config={widget}
      data={effectiveData}
      summaryData={summaryData}
      isLoading={queryLoading}
      isEditing={isEditing}
      timeRange={timeRange}
      onConfigChange={onConfigChange}
    />
  )
}
