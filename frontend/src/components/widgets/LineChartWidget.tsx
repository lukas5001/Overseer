import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { WidgetProps } from './registry'

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer])

const SERIES_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1',
]

export default function LineChartWidget({ config, data, isLoading }: WidgetProps) {
  const opts = config.options
  const allSeries = data?.series || []

  const echartsOption = useMemo(() => {
    if (allSeries.length === 0) return null

    const seriesData = allSeries
      .filter(s => s.data && s.data.length > 0)
      .map((s, i) => ({
        name: `${s.host} — ${s.metric}`,
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        data: s.data!.map(d => [d.time, d.value]),
        lineStyle: { width: 2 },
        itemStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length] },
        areaStyle: opts.fill ? { opacity: 0.15 } : undefined,
        stack: opts.stacked ? 'total' : undefined,
      }))

    if (seriesData.length === 0) return null

    const unit = allSeries[0]?.unit || ''

    return {
      animation: false,
      backgroundColor: 'transparent',
      grid: { left: 50, right: 16, top: seriesData.length > 1 ? 30 : 10, bottom: 30 },
      legend: seriesData.length > 1
        ? {
            show: true,
            top: 0,
            textStyle: { color: '#9ca3af', fontSize: 10 },
            icon: 'roundRect',
            itemWidth: 12,
            itemHeight: 3,
          }
        : { show: false },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1f2937',
        borderColor: '#374151',
        textStyle: { color: '#e5e7eb', fontSize: 12 },
        formatter: (params: any[]) => {
          if (!params || params.length === 0) return ''
          const time = new Date(params[0].value[0]).toLocaleString('de-DE')
          const lines = params.map((p: any) => {
            const val = p.value[1] != null ? Number(p.value[1]).toFixed(opts.decimals ?? 1) : 'N/A'
            return `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${val}${unit}</b>`
          })
          return `<div class="text-xs">${time}<br/>${lines.join('<br/>')}</div>`
        },
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: '#374151' } },
        axisLabel: { color: '#6b7280', fontSize: 10 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: '#6b7280',
          fontSize: 10,
          formatter: (v: number) => `${v}${unit}`,
        },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
      },
      dataZoom: [{ type: 'inside', zoomOnMouseWheel: true, moveOnMouseMove: true }],
      series: seriesData,
    }
  }, [allSeries, opts])

  return (
    <div className="h-full flex flex-col bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-700">
        <span className="text-sm font-medium text-gray-200 truncate">{config.title}</span>
      </div>
      <div className="flex-1 min-h-0">
        {isLoading && !data ? (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm">Laden...</div>
        ) : !echartsOption ? (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm">Keine Daten</div>
        ) : (
          <ReactECharts
            echarts={echarts}
            option={echartsOption}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />
        )}
      </div>
    </div>
  )
}
