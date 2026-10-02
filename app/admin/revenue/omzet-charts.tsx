'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

const euro = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

export function OmzetCharts({ monthly, quarters, year }: {
  monthly: { label: string; recurring: number; eenmalig: number }[]
  quarters: { label: string; omzet: number }[]
  year: number
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card-base">
        <h2 className="font-semibold mb-1">Omzet per maand</h2>
        <div className="text-xs text-gray-400 mb-3">Boekjaar {year} · recurring + eenmalig</div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={monthly} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `€${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => euro.format(v)} labelStyle={{ fontWeight: 600 }} />
            <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="recurring" name="Recurring" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} />
            <Bar dataKey="eenmalig" name="Eenmalig" stackId="a" fill="#3b82f6" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card-base">
        <h2 className="font-semibold mb-1">Omzet per kwartaal</h2>
        <div className="text-xs text-gray-400 mb-3">Boekjaar {year}</div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={quarters} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `€${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => euro.format(v)} labelStyle={{ fontWeight: 600 }} />
            <Bar dataKey="omzet" name="Omzet" fill="#22c55e" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
