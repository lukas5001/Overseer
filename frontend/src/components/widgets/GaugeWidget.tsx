import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import * as echarts from 'echarts/core'
import { GaugeChart } from 'echarts/charts'
import { CanvasRenderer } from 'echarts/renderers'
import type { WidgetProps } from './registry'

echarts.use([GaugeChart, CanvasRenderer])

function formatValue(value: number | null | undefined, decimals = 1): string {
  if (value == null) return 'N/A'
  return Number(value).toFixed(decimals)
}

export default function GaugeWidget({ config, data, isLoading }: WidgetProps) {
  const opts = config.options
  const series = data?.series?.[0]
  const value = series?.value ?? null
  const unit = opts.unit || series?.unit || ''
  const decimals = opts.decimals ?? 1
  const min = opts.min ?? 0
  const max = opts.max ?? 100

  const thresholds = opts.thresholds || []
  const sortedThresholds = [...thresholds].sort((a, b) => a.value - b.value)

  const echartsOption = useMemo(() => {
    // Build color segments from thresholds
    const range = max - min || 1
    const colorStops: [number, string][] = []

    if (sortedThresholds.length === 0) {
      colorStops.push([1, '#10b981'])
    } else {
      let lastEnd = 0
      for (const t of sortedThresholds) {
        const pos = (t.value - min) / range
        if (pos > lastEnd) {
          colorStops.push([pos, '#10b981'])
        }
        lastEnd = pos
      }
      // Assign threshold colors to the segments after their value
      for (let i = 0; i < sortedThresholds.length; i++) {
        const end = i < sortedThresholds.length - 1
          ? (sortedThresholds[i + 1].value - min) / range
          : 1
        colorStops.push([end, sortedThresholds[i].color])
      }
    }

    // Deduplicate and sort
    const seen = new Set<number>()
    const finalStops = colorStops.filter(([pos]) => {
      if (seen.has(pos)) return false
      seen.add(pos)
      return true
    }).sort((a, b) => a[0] - b[0])

    return {
      series: [
        {
          type: 'gauge',
          startAngle: 180,
          endAngle: 0,
          min,
          max,
          splitNumber: 4,
          radius: '95%',
          center: ['50%', '70%'],
          axisLine: {
            lineStyle: {
              width: 20,
              color: finalStops.length > 0 ? finalStops : [[1, '#10b981']],
            },
          },
          pointer: {
            length: '60%',
            width: 4,
            itemStyle: { color: '#cbd5e1' },
          },
          axisTick: { show: false },
          splitLine: {
            length: 10,
            lineStyle: { color: 'rgba(255,255,255,0.2)', width: 1 },
          },
          axisLabel: {
            color: '#9ca3af',
            fontSize: 10,
            distance: 10,
            formatter: (v: number) => Math.round(v).toString(),
          },
          detail: {
            fontSize: 28,
            fontWeight: 'bold',
            color: '#fff',
            offsetCenter: [0, '20%'],
            formatter: () => value != null ? `${formatValue(value, decimals)}${unit}` : 'N/A',
          },
          data: [{ value: value ?? 0 }],
          animation: false,
        },
      ],
    }
  }, [value, min, max, unit, decimals, sortedThresholds])

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{config.title}</span>
        {series && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate ml-2">{series.host}</span>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {isLoading && !data ? (
          <div className="h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">Laden...</div>
        ) : (
          <ReactECharts
            echarts={echarts}
            option={echartsOption}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        )}
      </div>
    </div>
  )
}
