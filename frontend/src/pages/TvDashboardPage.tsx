import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ResponsiveGridLayout, useContainerWidth, type ResponsiveLayouts } from 'react-grid-layout'
import { verticalCompactor } from 'react-grid-layout/core'
import { useDashboard } from '../api/hooks'
import WidgetRenderer from '../components/widgets/WidgetRenderer'
import LoadingSpinner from '../components/LoadingSpinner'

import 'react-grid-layout/css/styles.css'

const COLS = { lg: 24, md: 16, sm: 12 }
const ROW_HEIGHT = 30
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768 }

export default function TvDashboardPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const dashboardIds = (searchParams.get('ids') || '').split(',').filter(Boolean)
  const singleId = searchParams.get('id')
  const rotateInterval = parseInt(searchParams.get('interval') || '60') || 60

  // Auth token for TV mode
  useEffect(() => {
    if (token) {
      localStorage.setItem('overseer_token', token)
    }
  }, [token])

  // All IDs (single or multiple)
  const allIds = useMemo(() => {
    if (singleId) return [singleId]
    return dashboardIds
  }, [singleId, dashboardIds])

  const [currentIndex, setCurrentIndex] = useState(0)

  // Rotate through dashboards
  useEffect(() => {
    if (allIds.length <= 1) return
    const timer = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % allIds.length)
    }, rotateInterval * 1000)
    return () => clearInterval(timer)
  }, [allIds.length, rotateInterval])

  const currentId = allIds[currentIndex]

  if (!currentId) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">
        <p>Kein Dashboard angegeben. Nutze ?id=... oder ?ids=id1,id2</p>
      </div>
    )
  }

  return (
    <TvDashboardView
      key={currentId}
      dashboardId={currentId}
      showRotationIndicator={allIds.length > 1}
      currentIndex={currentIndex}
      totalDashboards={allIds.length}
    />
  )
}

function TvDashboardView({
  dashboardId,
  showRotationIndicator,
  currentIndex,
  totalDashboards,
}: {
  dashboardId: string
  showRotationIndicator: boolean
  currentIndex: number
  totalDashboards: number
}) {
  const { data: dashboard, isLoading } = useDashboard(dashboardId)
  const { width, containerRef, mounted } = useContainerWidth()

  const config = dashboard?.config
  const widgets = config?.widgets || {}
  const layouts = config?.layout || {}
  const timeFrom = config?.timeSettings?.from || 'now-1h'
  const timeTo = config?.timeSettings?.to || 'now'
  const refreshInterval = config?.timeSettings?.refreshInterval ?? 30

  if (isLoading) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><LoadingSpinner /></div>
  }
  if (!dashboard) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">Dashboard nicht gefunden</div>
  }

  const widgetEntries = Object.entries(widgets)

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Minimal header */}
      <div className="flex items-center justify-between px-6 py-3 flex-shrink-0">
        <h1 className="text-xl font-bold text-white">{dashboard.title}</h1>
        <div className="flex items-center gap-4">
          {showRotationIndicator && (
            <div className="flex items-center gap-1">
              {Array.from({ length: totalDashboards }).map((_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full ${i === currentIndex ? 'bg-blue-500' : 'bg-gray-700'}`}
                />
              ))}
            </div>
          )}
          <span className="text-sm text-gray-600">
            {new Date().toLocaleString('de-DE')}
          </span>
        </div>
      </div>

      {/* Grid */}
      <div ref={containerRef as React.RefObject<HTMLDivElement>} className="flex-1 overflow-auto px-4 pb-4">
        {widgetEntries.length > 0 && mounted ? (
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
                />
              </div>
            ))}
          </ResponsiveGridLayout>
        ) : null}
      </div>
    </div>
  )
}
