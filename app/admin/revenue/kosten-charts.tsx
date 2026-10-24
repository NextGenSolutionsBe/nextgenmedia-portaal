'use client'

import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

const euro = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const COLORS = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b', '#14b8a6']

export function KostenCharts({ monthly, categories, year }: {
  monthly: { label: string; kosten: number }[]
  categories: { name: string; value: number }[]
  year: number
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card-base">
        <h2 className="font-semibold mb-1">Kostenontwikkeling</h2>
        <div className="text-xs text-gray-400 mb-3">Boekjaar {year} · per maand (excl. btw)</div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={monthly} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `€${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => euro.format(v)} labelStyle={{ fontWeight: 600 }} />
            <Bar dataKey="kosten" name="Kosten" fill="#ef4444" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card-base">
        <h2 className="font-semibold mb-1">Kostenverdeling</h2>
        <div className="text-xs text-gray-400 mb-3">Boekjaar {year} · per categorie</div>
        {categories.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-16">Geen kosten</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={categories} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} innerRadius={45} paddingAngle={2}>
                {categories.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => euro.format(v)} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
