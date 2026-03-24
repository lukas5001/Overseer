import { LineChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { format } from 'date-fns'
import type { HistoryBucket } from '../types'

interface Props {
  data: HistoryBucket[]
  thresholdWarn?: number | null
  thresholdCrit?: number | null
  unit?: string | null
}

export default function MiniGraph({ data, thresholdWarn, thresholdCrit, unit }: Props) {
  if (!data.length) {
    return <div className="h-24 flex items-center justify-center text-xs text-gray-400">Keine Daten</div>
  }

  const formatted = data.map(d => ({
    ...d,
    time: new Date(d.bucket).getTime(),
    value: d.avg_value,
  }))

  return (
    <ResponsiveContainer width="100%" height={100}>
      <LineChart data={formatted} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
        <XAxis
          dataKey="time"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={v => format(new Date(v), 'HH:mm')}
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis hide domain={['auto', 'auto']} />
        <Tooltip
          labelFormatter={v => format(new Date(v as number), 'dd.MM. HH:mm')}
          formatter={(v: unknown) => [`${Number(v)?.toFixed(1)}${unit ?? ''}`, 'Wert']}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke="#3b82f6"
          strokeWidth={1.5}
          dot={false}
          connectNulls
        />
        {thresholdWarn != null && (
          <ReferenceLine y={thresholdWarn} stroke="#f59e0b" strokeDasharray="4 2" strokeWidth={1} />
        )}
        {thresholdCrit != null && (
          <ReferenceLine y={thresholdCrit} stroke="#ef4444" strokeDasharray="4 2" strokeWidth={1} />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}
