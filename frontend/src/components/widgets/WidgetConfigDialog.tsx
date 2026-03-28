import { useState, useEffect } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { useDashboardMetaHosts, useDashboardMetaServices } from '../../api/hooks'
import type { DashboardWidget, DashboardVariable, WidgetDataSource, WidgetDisplayOptions, WidgetThreshold } from '../../types'

interface WidgetConfigDialogProps {
  widget: DashboardWidget
  widgetId: string
  open: boolean
  onClose: () => void
  onChange: (widget: DashboardWidget) => void
  variables?: DashboardVariable[]
}

type Tab = 'data' | 'display'

const AGGREGATIONS = [
  { label: 'Letzter Wert', value: 'last' },
  { label: 'Durchschnitt', value: 'avg' },
  { label: 'Minimum', value: 'min' },
  { label: 'Maximum', value: 'max' },
  { label: 'Summe', value: 'sum' },
]

const UNITS = [
  { label: 'Keine', value: '' },
  { label: 'Prozent (%)', value: '%' },
  { label: 'Bytes', value: ' B' },
  { label: 'Megabytes', value: ' MB' },
  { label: 'Gigabytes', value: ' GB' },
  { label: 'Millisekunden', value: 'ms' },
  { label: 'Sekunden', value: 's' },
  { label: 'Anzahl', value: '' },
]

export default function WidgetConfigDialog({ widget, open, onClose, onChange, variables = [] }: WidgetConfigDialogProps) {
  const [tab, setTab] = useState<Tab>('data')
  const [localWidget, setLocalWidget] = useState<DashboardWidget>(widget)
  const [selectedHostId, setSelectedHostId] = useState<string>('')

  const { data: hosts } = useDashboardMetaHosts()
  const { data: services } = useDashboardMetaServices(selectedHostId || undefined)

  useEffect(() => {
    setLocalWidget(widget)
    // Try to detect host from existing service selection
    if (widget.dataSource.service_ids?.length && services) {
      const svc = services.find(s => s.id === widget.dataSource.service_ids![0])
      if (svc) setSelectedHostId(svc.host_id)
    }
  }, [widget, open])

  if (!open) return null

  const ds = localWidget.dataSource
  const opts = localWidget.options

  function update(partial: Partial<DashboardWidget>) {
    const updated = { ...localWidget, ...partial }
    setLocalWidget(updated)
    onChange(updated)
  }

  function updateDataSource(partial: Partial<WidgetDataSource>) {
    update({ dataSource: { ...ds, ...partial } })
  }

  function updateOptions(partial: Partial<WidgetDisplayOptions>) {
    update({ options: { ...opts, ...partial } })
  }

  function toggleServiceId(id: string) {
    const current = ds.service_ids || []
    const next = current.includes(id)
      ? current.filter(s => s !== id)
      : [...current, id]
    updateDataSource({ service_ids: next })
  }

  function addThreshold() {
    const current = opts.thresholds || []
    updateOptions({ thresholds: [...current, { value: 80, color: '#f59e0b' }] })
  }

  function updateThreshold(idx: number, partial: Partial<WidgetThreshold>) {
    const current = [...(opts.thresholds || [])]
    current[idx] = { ...current[idx], ...partial }
    updateOptions({ thresholds: current })
  }

  function removeThreshold(idx: number) {
    const current = [...(opts.thresholds || [])]
    current.splice(idx, 1)
    updateOptions({ thresholds: current })
  }

  const isSummaryType = ds.type === 'summary'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Widget konfigurieren</h2>
            <span className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full uppercase">
              {localWidget.type}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Title */}
        <div className="px-4 pt-3">
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Titel</label>
          <input
            value={localWidget.title}
            onChange={e => update({ title: e.target.value })}
            className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Tabs */}
        {!isSummaryType && (
          <div className="flex px-4 pt-3 gap-1">
            {(['data', 'display'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={clsx(
                  'px-3 py-1.5 text-xs rounded-md transition-colors',
                  tab === t
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700'
                )}
              >
                {t === 'data' ? 'Daten' : 'Darstellung'}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isSummaryType ? (
            /* Summary config: just field picker */
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Feld</label>
              <select
                value={ds.field || ''}
                onChange={e => updateDataSource({ field: e.target.value })}
                className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200"
              >
                <option value="total">Total</option>
                <option value="total_hosts">Total Hosts</option>
                <option value="ok">OK</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
                <option value="unknown">Unknown</option>
                <option value="no_data">No Data</option>
              </select>
              <div className="mt-3">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Farbe</label>
                <input
                  type="color"
                  value={opts.color || '#ffffff'}
                  onChange={e => updateOptions({ color: e.target.value })}
                  className="w-10 h-8 bg-transparent border border-gray-300 dark:border-gray-600 rounded cursor-pointer"
                />
              </div>
            </div>
          ) : tab === 'data' ? (
            <>
              {/* Host filter */}
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Host</label>
                <select
                  value={selectedHostId}
                  onChange={e => {
                    const val = e.target.value
                    setSelectedHostId(val)
                    if (val.startsWith('$')) {
                      updateDataSource({ service_ids: [], host_ids: [val] })
                    } else {
                      updateDataSource({ service_ids: [], host_ids: val ? [val] : [] })
                    }
                  }}
                  className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200"
                >
                  <option value="">Alle Hosts</option>
                  {variables.filter(v => v.query === 'all_hosts' || v.type === 'custom').map(v => (
                    <option key={`$${v.name}`} value={`$${v.name}`}>$ {v.label || v.name}</option>
                  ))}
                  {hosts?.map(h => (
                    <option key={h.id} value={h.id}>{h.display_name}</option>
                  ))}
                </select>
              </div>

              {/* Service selection */}
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  Services {ds.service_ids?.length ? `(${ds.service_ids.length} gewählt)` : ''}
                </label>
                <div className="max-h-48 overflow-y-auto bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg">
                  {services?.map(s => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={ds.service_ids?.includes(s.id) || false}
                        onChange={() => toggleServiceId(s.id)}
                        className="rounded border-gray-300 dark:border-gray-600"
                      />
                      <span className="text-sm text-gray-600 dark:text-gray-300 truncate">
                        {s.host} — {s.name}
                      </span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto">{s.check_type}</span>
                    </label>
                  ))}
                  {(!services || services.length === 0) && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 p-3 text-center">Keine Services gefunden</p>
                  )}
                </div>
              </div>

              {/* Aggregation */}
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Aggregation</label>
                <select
                  value={ds.aggregation || 'last'}
                  onChange={e => updateDataSource({ aggregation: e.target.value as any })}
                  className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200"
                >
                  {AGGREGATIONS.map(a => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            /* Display tab */
            <>
              {/* Unit */}
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Einheit</label>
                <select
                  value={opts.unit || ''}
                  onChange={e => updateOptions({ unit: e.target.value })}
                  className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200"
                >
                  {UNITS.map(u => (
                    <option key={u.label} value={u.value}>{u.label}</option>
                  ))}
                </select>
              </div>

              {/* Decimals */}
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Dezimalstellen</label>
                <select
                  value={opts.decimals ?? 1}
                  onChange={e => updateOptions({ decimals: Number(e.target.value) })}
                  className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200"
                >
                  <option value={0}>0</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </div>

              {/* Gauge-specific: min/max */}
              {localWidget.type === 'gauge' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Min</label>
                    <input
                      type="number"
                      value={opts.min ?? 0}
                      onChange={e => updateOptions({ min: Number(e.target.value) })}
                      className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Max</label>
                    <input
                      type="number"
                      value={opts.max ?? 100}
                      onChange={e => updateOptions({ max: Number(e.target.value) })}
                      className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200"
                    />
                  </div>
                </div>
              )}

              {/* Line chart specific */}
              {localWidget.type === 'line_chart' && (
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={opts.fill || false}
                      onChange={e => updateOptions({ fill: e.target.checked })}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    Fläche füllen
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={opts.stacked || false}
                      onChange={e => updateOptions({ stacked: e.target.checked })}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    Gestapelt
                  </label>
                </div>
              )}

              {/* Sparkline for stat */}
              {localWidget.type === 'stat' && (
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={opts.showSparkline !== false}
                    onChange={e => updateOptions({ showSparkline: e.target.checked })}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  Sparkline anzeigen
                </label>
              )}

              {/* Thresholds */}
              {(localWidget.type === 'stat' || localWidget.type === 'gauge') && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-gray-500 dark:text-gray-400">Schwellwerte</label>
                    <button
                      onClick={addThreshold}
                      className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Hinzufügen
                    </button>
                  </div>
                  <div className="space-y-2">
                    {(opts.thresholds || []).map((t, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 dark:text-gray-500 w-4">≥</span>
                        <input
                          type="number"
                          value={t.value}
                          onChange={e => updateThreshold(i, { value: Number(e.target.value) })}
                          className="flex-1 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm text-gray-700 dark:text-gray-200"
                        />
                        <input
                          type="color"
                          value={t.color}
                          onChange={e => updateThreshold(i, { color: e.target.value })}
                          className="w-8 h-7 bg-transparent border border-gray-300 dark:border-gray-600 rounded cursor-pointer"
                        />
                        <button
                          onClick={() => removeThreshold(i)}
                          className="text-gray-400 dark:text-gray-500 hover:text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Color for stat */}
              {localWidget.type === 'stat' && (
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Standard-Farbe</label>
                  <input
                    type="color"
                    value={opts.color || '#ffffff'}
                    onChange={e => updateOptions({ color: e.target.value })}
                    className="w-10 h-8 bg-transparent border border-gray-300 dark:border-gray-600 rounded cursor-pointer"
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"
          >
            Fertig
          </button>
        </div>
      </div>
    </div>
  )
}
