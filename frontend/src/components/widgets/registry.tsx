import type { ReactNode } from 'react'
import { Gauge, TrendingUp, Table2, Hash } from 'lucide-react'
import type { DashboardWidget, DashboardQueryResponse, WidgetDataSource, WidgetDisplayOptions } from '../../types'

// ── Widget Props (passed to every widget component) ──

export interface WidgetProps {
  config: DashboardWidget
  data: DashboardQueryResponse | null
  summaryData?: Record<string, number>
  isLoading: boolean
  isEditing: boolean
  timeRange: { from: string; to: string }
  onConfigChange: (config: DashboardWidget) => void
}

// ── Widget Type Registration ──

export interface WidgetTypeDefinition {
  type: string
  displayName: string
  description: string
  icon: ReactNode
  defaultSize: { w: number; h: number }
  minSize: { w: number; h: number }
  component: React.FC<WidgetProps>
  defaultDataSource: WidgetDataSource
  defaultOptions: WidgetDisplayOptions
}

// ── Registry ──

const registry = new Map<string, WidgetTypeDefinition>()

export function registerWidget(def: WidgetTypeDefinition) {
  registry.set(def.type, def)
}

export function getWidgetType(type: string): WidgetTypeDefinition | undefined {
  return registry.get(type)
}

export function getAllWidgetTypes(): WidgetTypeDefinition[] {
  return Array.from(registry.values())
}

// ── Lazy imports (registered after module loads) ──

import StatWidget from './StatWidget'
import GaugeWidget from './GaugeWidget'
import LineChartWidget from './LineChartWidget'
import TableWidget from './TableWidget'

registerWidget({
  type: 'stat',
  displayName: 'Einzelwert',
  description: 'Großer einzelner Metrik-Wert',
  icon: <Hash className="w-6 h-6" />,
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 3, h: 3 },
  component: StatWidget,
  defaultDataSource: { type: 'query', aggregation: 'last' },
  defaultOptions: { decimals: 1, showSparkline: true },
})

registerWidget({
  type: 'gauge',
  displayName: 'Gauge',
  description: 'Tachometer mit Schwellwerten',
  icon: <Gauge className="w-6 h-6" />,
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 4, h: 4 },
  component: GaugeWidget,
  defaultDataSource: { type: 'query', aggregation: 'last' },
  defaultOptions: {
    min: 0,
    max: 100,
    unit: '%',
    decimals: 1,
    thresholds: [
      { value: 70, color: '#f59e0b' },
      { value: 90, color: '#ef4444' },
    ],
  },
})

registerWidget({
  type: 'line_chart',
  displayName: 'Liniendiagramm',
  description: 'Zeitreihen-Daten als Linie',
  icon: <TrendingUp className="w-6 h-6" />,
  defaultSize: { w: 12, h: 8 },
  minSize: { w: 6, h: 4 },
  component: LineChartWidget,
  defaultDataSource: { type: 'query', aggregation: 'avg' },
  defaultOptions: { fill: false, stacked: false },
})

registerWidget({
  type: 'table',
  displayName: 'Tabelle',
  description: 'Tabellarische Daten (Hosts, Status)',
  icon: <Table2 className="w-6 h-6" />,
  defaultSize: { w: 12, h: 8 },
  minSize: { w: 6, h: 4 },
  component: TableWidget,
  defaultDataSource: { type: 'status_table' },
  defaultOptions: { columns: ['host', 'service', 'status', 'value', 'last_check'] },
})
