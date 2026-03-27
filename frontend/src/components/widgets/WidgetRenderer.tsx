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
  // Pick aggregation interval based on time range
  if (timeFrom.includes('15m')) return '1m'
  if (timeFrom.includes('1h')) return '1m'
  if (timeFrom.includes('6h')) return '5m'
  if (timeFrom.includes('24h')) return '15m'
  if (timeFrom.includes('7d')) return '1h'
  if (timeFrom.includes('30d')) return '6h'
  return '5m'
}

export default function WidgetRenderer({
  widget,
  timeRange,
  refreshInterval,
  isEditing,
  onConfigChange,
}: WidgetRendererProps) {
  const pageVisible = usePageVisible()
  const widgetDef = getWidgetType(widget.type)

  // Build query from widget dataSource
  const query = useMemo<DashboardQueryRequest | null>(() => {
    const ds = widget.dataSource
    if (ds.type === 'summary') return null  // Summary uses a different hook

    const needsTimeSeries = widget.type === 'line_chart'

    return {
      service_ids: ds.service_ids?.length ? ds.service_ids : undefined,
      host_ids: ds.host_ids?.length ? ds.host_ids : undefined,
      check_types: ds.check_types?.length ? ds.check_types : undefined,
      from: timeRange.from,
      to: timeRange.to,
      aggregation: ds.aggregation || 'last',
      interval: needsTimeSeries ? computeAutoInterval(timeRange.from) : undefined,
    }
  }, [widget.dataSource, widget.type, timeRange])

  // For stat widgets with sparkline, we also want time series data
  const sparklineQuery = useMemo<DashboardQueryRequest | null>(() => {
    if (widget.type !== 'stat' || widget.options.showSparkline === false) return null
    const ds = widget.dataSource
    if (ds.type === 'summary') return null
    if (!ds.service_ids?.length) return null

    return {
      service_ids: ds.service_ids,
      from: timeRange.from,
      to: timeRange.to,
      aggregation: ds.aggregation || 'last',
      interval: computeAutoInterval(timeRange.from),
    }
  }, [widget, timeRange])

  const effectiveRefresh = pageVisible && !isEditing && refreshInterval > 0
    ? refreshInterval * 1000
    : undefined

  const hasServiceIds = (widget.dataSource.service_ids?.length ?? 0) > 0
  const hasHostIds = (widget.dataSource.host_ids?.length ?? 0) > 0
  const hasCheckTypes = (widget.dataSource.check_types?.length ?? 0) > 0
  const queryEnabled = widget.dataSource.type !== 'summary' && (hasServiceIds || hasHostIds || hasCheckTypes)

  const { data: queryData, isLoading: queryLoading } = useDashboardQuery(query, {
    refetchInterval: effectiveRefresh,
    enabled: queryEnabled,
  })

  const { data: sparklineData } = useDashboardQuery(sparklineQuery, {
    refetchInterval: effectiveRefresh,
    enabled: !!sparklineQuery && queryEnabled,
  })

  // For summary widgets, use the status summary
  const { data: statusSummary } = useStatusSummary()
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
      <div className="h-full flex flex-col bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-700">
          <span className="text-sm font-medium text-gray-200">{widget.title}</span>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
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
