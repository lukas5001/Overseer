import { useState, useMemo, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ResponsiveGridLayout, useContainerWidth, type ResponsiveLayouts } from 'react-grid-layout'
import { verticalCompactor } from 'react-grid-layout/core'
import clsx from 'clsx'
import {
  usePublicDashboard,
  usePublicDashboardQuery,
  usePublicStatusSummary,
} from '../api/hooks'
import LoadingSpinner from '../components/LoadingSpinner'
import WidgetRenderer from '../components/widgets/WidgetRenderer'
import VariableBar from '../components/dashboard/VariableBar'
import type { DashboardQueryRequest } from '../types'

import 'react-grid-layout/css/styles.css'

const COLS = { lg: 24, md: 16, sm: 12 }
const ROW_HEIGHT = 30
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768 }

const TIME_RANGES = [
  { label: '15m', value: 'now-15m' },
  { label: '1h', value: 'now-1h' },
  { label: '6h', value: 'now-6h' },
  { label: '24h', value: 'now-24h' },
  { label: '7d', value: 'now-7d' },
  { label: '30d', value: 'now-30d' },
]

export default function PublicDashboardPage() {
  const { token } = useParams<{ token: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const isEmbed = searchParams.get('embed') === 'true'

  const { data: dashboard, isLoading, error } = usePublicDashboard(token)
  const { width, containerRef, mounted } = useContainerWidth()

  // Variable state
  const [variableValues, setVariableValues] = useState<Record<string, string | string[]>>({})

  const config = dashboard?.config
  const widgets = config?.widgets || {}
  const layouts = config?.layout || {}
  const variables = config?.variables || []
  const shareConfig = dashboard?.share_config || {}
  const fixedVariables = shareConfig.fixed_variables || []

  // Initialize variable values from URL params or share config
  const effectiveVariableValues = useMemo(() => {
    const vals: Record<string, string | string[]> = {}
    for (const v of variables) {
      // Priority: URL params > share config fixed values > user selection > default
      const urlVal = searchParams.get(`var-${v.name}`)
      if (urlVal) {
        vals[v.name] = v.multiSelect ? urlVal.split(',') : urlVal
      } else if (fixedVariables.includes(v.name) && shareConfig.fixed_variable_values?.[v.name]) {
        vals[v.name] = shareConfig.fixed_variable_values[v.name]
      } else if (variableValues[v.name] !== undefined) {
        vals[v.name] = variableValues[v.name]
      } else {
        vals[v.name] = v.defaultValue || '__all__'
      }
    }
    return vals
  }, [variables, searchParams, fixedVariables, shareConfig.fixed_variable_values, variableValues])

  function handleVariableChange(name: string, value: string | string[]) {
    setVariableValues(prev => ({ ...prev, [name]: value }))
    // Sync to URL
    const params = new URLSearchParams(searchParams)
    if (value === '__all__' || (Array.isArray(value) && value.includes('__all__'))) {
      params.delete(`var-${name}`)
    } else {
      params.set(`var-${name}`, Array.isArray(value) ? value.join(',') : value)
    }
    setSearchParams(params, { replace: true })
  }

  // Time range
  const timeFrom = searchParams.get('from') || config?.timeSettings?.from || 'now-1h'
  const timeTo = searchParams.get('to') || 'now'
  const refreshInterval = config?.timeSettings?.refreshInterval ?? 30

  function setTimeRange(from: string) {
    const params = new URLSearchParams(searchParams)
    params.set('from', from)
    params.set('to', 'now')
    setSearchParams(params, { replace: true })
  }

  // Create bound hooks for public query/summary
  const usePublicQuery = useCallback(
    (query: DashboardQueryRequest | null, options?: { refetchInterval?: number; enabled?: boolean }) =>
      usePublicDashboardQuery(token, query, options),
    [token]
  )
  const usePublicSummary = useCallback(
    () => usePublicStatusSummary(token),
    [token]
  )

  if (isLoading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><LoadingSpinner /></div>

  if (error) {
    const status = (error as any)?.response?.status
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-center">
        <div>
          <p className="text-4xl font-bold text-gray-400 mb-2">
            {status === 410 ? 'Link abgelaufen' : 'Nicht gefunden'}
          </p>
          <p className="text-gray-500">
            {status === 410
              ? 'Dieser Share-Link ist abgelaufen.'
              : 'Dashboard nicht gefunden oder Link ungültig.'}
          </p>
        </div>
      </div>
    )
  }

  if (!dashboard) return null

  const widgetEntries = Object.entries(widgets)

  return (
    <div className={clsx('min-h-screen bg-gray-950 flex flex-col', isEmbed && 'p-0')}>
      {/* Header (hidden in embed mode) */}
      {!isEmbed && (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 bg-gray-900/80 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-white">{dashboard.title}</h1>
          </div>
          <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5">
            {TIME_RANGES.map(tr => (
              <button
                key={tr.value}
                onClick={() => setTimeRange(tr.value)}
                className={clsx(
                  'px-2.5 py-1 text-xs rounded-md transition-colors',
                  timeFrom === tr.value
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                )}
              >
                {tr.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Variable Bar */}
      {variables.length > 0 && (
        <VariableBar
          variables={variables}
          values={effectiveVariableValues}
          onChange={handleVariableChange}
          fixedVariables={fixedVariables}
        />
      )}

      {/* Grid */}
      <div ref={containerRef as React.RefObject<HTMLDivElement>} className="flex-1 overflow-auto p-4">
        {widgetEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <p className="text-lg">Keine Widgets</p>
          </div>
        ) : mounted ? (
          <ResponsiveGridLayout
            className="layout"
            width={width}
            layouts={layouts as ResponsiveLayouts}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            rowHeight={ROW_HEIGHT}
            dragConfig={{ enabled: false }}
            resizeConfig={{ enabled: false }}
            compactor={verticalCompactor}
            margin={[12, 12] as const}
          >
            {widgetEntries.map(([id, widget]) => (
              <div key={id}>
                <WidgetRenderer
                  widget={widget}
                  timeRange={{ from: timeFrom, to: timeTo }}
                  refreshInterval={refreshInterval}
                  isEditing={false}
                  onConfigChange={() => {}}
                  variableValues={effectiveVariableValues}
                  useQueryHook={usePublicQuery as any}
                  useSummaryHook={usePublicSummary}
                />
              </div>
            ))}
          </ResponsiveGridLayout>
        ) : null}
      </div>
    </div>
  )
}
