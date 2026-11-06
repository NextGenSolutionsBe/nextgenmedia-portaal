'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

interface ChartPoint {
  label: string
  recurring: number
  one_time: number
  total: number
}

const euroFmt = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

export function RevenueChart({ data, currentMonth }: { data: ChartPoint[]; currentMonth: number }) {
  if (data.every(d => d.total === 0)) return null

  return (
    <div className="card-base">
      <h2 className="font-semibold mb-4">Maandelijks omzetverloop</h2>
      <div className="text-xs text-gray-400 mb-3">Laatste 6 maanden + komende 6 maanden</div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#8c8c8c' }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: '#8c8c8c' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `€${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            formatter={(value: number) => euroFmt.format(value)}
            labelStyle={{ fontWeight: 600, marginBottom: 4 }}
          />
          <Legend
            iconType="square"
            iconSize={8}
            wrapperStyle={{ fontSize: 12 }}
          />
          <ReferenceLine x={data[currentMonth]?.label} stroke="#0f0f0f" strokeWidth={1.5} strokeDasharray="0" />
          <Bar dataKey="recurring" name="Recurring" fill="#272727" radius={[3, 3, 0, 0]} />
          <Bar dataKey="one_time" name="Eenmalig" fill="#a8a8a8" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
