import { useState, useCallback } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { ResponsiveGridLayout, useContainerWidth, type Layout, type ResponsiveLayouts } from 'react-grid-layout'
import { verticalCompactor } from 'react-grid-layout/core'
import {
  Pencil, Save, X, Plus, ArrowLeft, Settings,
  RefreshCw, History, Wrench,
} from 'lucide-react'
import clsx from 'clsx'
import { useDashboard, useUpdateDashboard, useDashboardVersions, useRestoreDashboardVersion } from '../api/hooks'
import LoadingSpinner from '../components/LoadingSpinner'
import WidgetRenderer from '../components/widgets/WidgetRenderer'
import WidgetPicker from '../components/widgets/WidgetPicker'
import WidgetConfigDialog from '../components/widgets/WidgetConfigDialog'
import { type WidgetTypeDefinition } from '../components/widgets/registry'
import type { DashboardConfig, DashboardLayoutItem, DashboardWidget } from '../types'

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

const REFRESH_OPTIONS = [
  { label: 'Aus', value: 0 },
  { label: '10s', value: 10 },
  { label: '30s', value: 30 },
  { label: '1min', value: 60 },
  { label: '5min', value: 300 },
]

export default function CustomDashboardViewPage() {
  const { dashboardId } = useParams<{ dashboardId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()

  const { data: dashboard, isLoading } = useDashboard(dashboardId)
  const updateMut = useUpdateDashboard()
  const { data: versions } = useDashboardVersions(dashboardId)
  const restoreMut = useRestoreDashboardVersion()

  const { width, containerRef, mounted } = useContainerWidth()

  const [isEditing, setIsEditing] = useState(false)
  const [editConfig, setEditConfig] = useState<DashboardConfig | null>(null)
  const [showVersions, setShowVersions] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showWidgetPicker, setShowWidgetPicker] = useState(false)
  const [configWidgetId, setConfigWidgetId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')

  // Time range from URL
  const timeFrom = searchParams.get('from') || dashboard?.config?.timeSettings?.from || 'now-1h'
  const timeTo = searchParams.get('to') || 'now'
  const refreshInterval = dashboard?.config?.timeSettings?.refreshInterval ?? 30
  const [autoRefresh, setAutoRefresh] = useState(refreshInterval)

  const config = isEditing && editConfig ? editConfig : dashboard?.config
  const widgets = config?.widgets || {}
  const layouts = config?.layout || {}

  function enterEdit() {
    if (!dashboard) return
    setEditConfig(structuredClone(dashboard.config))
    setEditTitle(dashboard.title)
    setEditDesc(dashboard.description || '')
    setIsEditing(true)
  }

  function discardEdit() {
    setEditConfig(null)
    setIsEditing(false)
    setConfigWidgetId(null)
  }

  async function saveEdit() {
    if (!dashboardId || !editConfig) return
    try {
      await updateMut.mutateAsync({
        id: dashboardId,
        title: editTitle !== dashboard?.title ? editTitle : undefined,
        description: editDesc !== (dashboard?.description || '') ? editDesc : undefined,
        config: editConfig as unknown as Record<string, unknown>,
      })
      setIsEditing(false)
      setEditConfig(null)
      setConfigWidgetId(null)
    } catch {
      // handled by mutation
    }
  }

  const handleLayoutChange = useCallback((_layout: Layout, allLayouts: ResponsiveLayouts) => {
    if (!isEditing || !editConfig) return
    setEditConfig(prev => prev ? { ...prev, layout: allLayouts as unknown as Record<string, DashboardLayoutItem[]> } : prev)
  }, [isEditing, editConfig])

  function setTimeRange(from: string) {
    setSearchParams({ from, to: 'now' })
  }

  function addWidgetFromPicker(typeDef: WidgetTypeDefinition) {
    if (!editConfig) return
    const id = `widget-${Date.now()}`
    const newConfig = structuredClone(editConfig)
    newConfig.widgets[id] = {
      type: typeDef.type,
      title: typeDef.displayName,
      dataSource: { ...typeDef.defaultDataSource },
      options: { ...typeDef.defaultOptions },
    }
    // Add to layout at bottom
    const lgLayout = [...(newConfig.layout.lg || [])]
    const maxY = lgLayout.reduce((max, item) => Math.max(max, item.y + item.h), 0)
    lgLayout.push({
      i: id,
      x: 0,
      y: maxY,
      w: typeDef.defaultSize.w,
      h: typeDef.defaultSize.h,
      minW: typeDef.minSize.w,
      minH: typeDef.minSize.h,
    })
    newConfig.layout.lg = lgLayout
    setEditConfig(newConfig)
    // Auto-open config dialog for the new widget
    setConfigWidgetId(id)
  }

  function removeWidget(widgetId: string) {
    if (!editConfig) return
    const newConfig = structuredClone(editConfig)
    delete newConfig.widgets[widgetId]
    for (const bp of Object.keys(newConfig.layout)) {
      newConfig.layout[bp] = newConfig.layout[bp].filter(item => item.i !== widgetId)
    }
    setEditConfig(newConfig)
    if (configWidgetId === widgetId) setConfigWidgetId(null)
  }

  function updateWidgetConfig(widgetId: string, widget: DashboardWidget) {
    if (!editConfig) return
    const newConfig = structuredClone(editConfig)
    newConfig.widgets[widgetId] = widget
    setEditConfig(newConfig)
  }

  async function handleRestore(version: number) {
    if (!dashboardId) return
    await restoreMut.mutateAsync({ id: dashboardId, version })
    setShowVersions(false)
  }

  if (isLoading) return <div className="p-6"><LoadingSpinner /></div>
  if (!dashboard) return <div className="p-6 text-gray-400">Dashboard nicht gefunden</div>

  const widgetEntries = Object.entries(widgets)
  const configWidget = configWidgetId ? widgets[configWidgetId] : null

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 bg-gray-900/80 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/custom-dashboards" className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          {isEditing ? (
            <input
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              className="text-lg font-bold text-white bg-transparent border-b border-gray-600 focus:border-blue-500 outline-none px-1 py-0.5"
            />
          ) : (
            <h1 className="text-lg font-bold text-white">{dashboard.title}</h1>
          )}
          {dashboard.is_default && (
            <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-medium">DEFAULT</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Time Range Picker */}
          {!isEditing && (
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
          )}

          {/* Auto Refresh */}
          {!isEditing && (
            <div className="flex items-center gap-1.5 ml-2">
              <RefreshCw className="w-3.5 h-3.5 text-gray-500" />
              <select
                value={autoRefresh}
                onChange={e => setAutoRefresh(Number(e.target.value))}
                className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-xs text-gray-300"
              >
                {REFRESH_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Edit mode buttons */}
          {isEditing ? (
            <>
              <button
                onClick={() => setShowWidgetPicker(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 transition-colors"
              >
                <Plus className="w-4 h-4" /> Widget
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className="p-1.5 text-gray-400 hover:text-white transition-colors"
                title="Einstellungen"
              >
                <Settings className="w-4 h-4" />
              </button>
              <button
                onClick={discardEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors"
              >
                <X className="w-4 h-4" /> Verwerfen
              </button>
              <button
                onClick={saveEdit}
                disabled={updateMut.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors"
              >
                <Save className="w-4 h-4" /> {updateMut.isPending ? 'Speichern...' : 'Speichern'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setShowVersions(true)}
                className="p-1.5 text-gray-400 hover:text-white transition-colors"
                title="Versionen"
              >
                <History className="w-4 h-4" />
              </button>
              <button
                onClick={enterEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"
              >
                <Pencil className="w-4 h-4" /> Bearbeiten
              </button>
            </>
          )}
        </div>
      </div>

      {/* Grid */}
      <div
        ref={containerRef as React.RefObject<HTMLDivElement>}
        className={clsx('flex-1 overflow-auto p-4', isEditing && 'bg-[repeating-linear-gradient(0deg,transparent,transparent_29px,rgba(255,255,255,0.03)_29px,rgba(255,255,255,0.03)_30px)]')}
      >
        {widgetEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <p className="text-lg mb-2">Keine Widgets</p>
            <p className="text-sm mb-4">Klicke auf "Bearbeiten" um Widgets hinzuzufügen.</p>
          </div>
        ) : mounted ? (
          <ResponsiveGridLayout
            className="layout"
            width={width}
            layouts={layouts as ResponsiveLayouts}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            rowHeight={ROW_HEIGHT}
            dragConfig={{ enabled: isEditing, handle: '.widget-drag-handle', bounded: false, threshold: 3 }}
            resizeConfig={{ enabled: isEditing, handles: ['se'] }}
            onLayoutChange={handleLayoutChange}
            compactor={verticalCompactor}
            margin={[12, 12] as const}
          >
            {widgetEntries.map(([id, widget]) => (
              <div key={id} className="relative group">
                {isEditing && (
                  <div className="widget-drag-handle absolute inset-x-0 top-0 h-8 cursor-grab z-10" />
                )}
                <WidgetRenderer
                  widget={widget}
                  timeRange={{ from: timeFrom, to: timeTo }}
                  refreshInterval={autoRefresh}
                  isEditing={isEditing}
                  onConfigChange={w => updateWidgetConfig(id, w)}
                />
                {isEditing && (
                  <>
                    <button
                      onClick={() => setConfigWidgetId(id)}
                      className="absolute top-1 right-8 w-6 h-6 bg-gray-700 text-gray-300 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20 hover:bg-gray-600"
                      title="Widget konfigurieren"
                    >
                      <Wrench className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => removeWidget(id)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20 hover:bg-red-500"
                      title="Widget entfernen"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </ResponsiveGridLayout>
        ) : null}
      </div>

      {/* Widget Picker */}
      <WidgetPicker
        open={showWidgetPicker}
        onClose={() => setShowWidgetPicker(false)}
        onSelect={addWidgetFromPicker}
      />

      {/* Widget Config Dialog */}
      {configWidgetId && configWidget && (
        <WidgetConfigDialog
          widgetId={configWidgetId}
          widget={configWidget}
          open={true}
          onClose={() => setConfigWidgetId(null)}
          onChange={w => updateWidgetConfig(configWidgetId, w)}
        />
      )}

      {/* Versions side panel */}
      {showVersions && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setShowVersions(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-80 bg-gray-800 border-l border-gray-700 h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <h3 className="text-sm font-semibold text-white">Versionen</h3>
              <button onClick={() => setShowVersions(false)} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 space-y-2">
              {versions?.map(v => (
                <div key={v.id} className="flex items-center justify-between bg-gray-900 rounded-lg px-3 py-2">
                  <div>
                    <span className="text-sm text-white">Version {v.version}</span>
                    <p className="text-xs text-gray-500">
                      {new Date(v.created_at).toLocaleString('de-DE')}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRestore(v.version)}
                    disabled={restoreMut.isPending}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Wiederherstellen
                  </button>
                </div>
              ))}
              {(!versions || versions.length === 0) && (
                <p className="text-sm text-gray-500 text-center py-4">Keine Versionen</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings modal */}
      {showSettings && isEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowSettings(false)}>
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-white mb-4">Dashboard-Einstellungen</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Titel</label>
                <input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Beschreibung</label>
                <input
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end mt-5">
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"
              >
                Fertig
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
