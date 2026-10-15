'use client'

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

export interface FinancePoint {
  label: string
  omzet: number
  kosten: number
  winst: number
}

const euroFmt = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

export function FinanceChart({ data, year }: { data: FinancePoint[]; year: number }) {
  return (
    <div className="card-base">
      <h2 className="font-semibold mb-1">Omzet, kosten & winst per maand</h2>
      <div className="text-xs text-gray-400 mb-3">Boekjaar {year}</div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `€${(v / 1000).toFixed(0)}k`} />
          <Tooltip formatter={(value: number) => euroFmt.format(value)} labelStyle={{ fontWeight: 600, marginBottom: 4 }} />
          <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="omzet" name="Omzet" fill="#22c55e" radius={[3, 3, 0, 0]} />
          <Bar dataKey="kosten" name="Kosten" fill="#ef4444" radius={[3, 3, 0, 0]} />
          <Line dataKey="winst" name="Winst" type="monotone" stroke="#111827" strokeWidth={2} dot={{ r: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
