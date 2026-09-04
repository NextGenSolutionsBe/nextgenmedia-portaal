'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'

type Period = 'month' | 'quarter' | 'fy'

export function PeriodFilter() {
  const router = useRouter()
  const sp = useSearchParams()
  const pathname = usePathname()
  const now = new Date()

  const year = Number(sp.get('fy')) || now.getFullYear()
  const period = (['month', 'quarter', 'fy'].includes(sp.get('period') ?? '') ? sp.get('period') : 'fy') as Period
  const quarter = Math.min(4, Math.max(1, Number(sp.get('q')) || (Math.floor(now.getMonth() / 3) + 1)))
  const month = Math.min(12, Math.max(1, Number(sp.get('mo')) || (now.getMonth() + 1)))

  const update = (next: Record<string, string | number>) => {
    const params = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(next)) params.set(k, String(v))
    router.push(`${pathname}?${params.toString()}`)
  }

  const MONTHS = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']
  const PERIODS: { v: Period; l: string }[] = [
    { v: 'month', l: 'Maand' }, { v: 'quarter', l: 'Kwartaal' }, { v: 'fy', l: 'Boekjaar' },
  ]

  return (
    <div className="card-base flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1">
        <button onClick={() => update({ fy: year - 1 })} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Vorig jaar"><ChevronLeft className="h-4 w-4" /></button>
        <span className="font-semibold text-sm w-12 text-center">{year}</span>
        <button onClick={() => update({ fy: year + 1 })} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Volgend jaar"><ChevronRight className="h-4 w-4" /></button>
      </div>

      <div className="h-5 w-px bg-gray-200" />

      <div className="flex flex-wrap gap-1">
        {PERIODS.map((p) => (
          <button key={p.v} onClick={() => update({ period: p.v })}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${period === p.v ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50'}`}>
            {p.l}
          </button>
        ))}
      </div>

      {period === 'quarter' && (
        <div className="flex gap-1">
          {[1, 2, 3, 4].map((q) => (
            <button key={q} onClick={() => update({ q })}
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${quarter === q ? 'border-[#fff848] bg-[#fff848]/10 text-black font-medium' : 'border-gray-200 hover:bg-gray-50'}`}>
              Q{q}
            </button>
          ))}
        </div>
      )}

      {period === 'month' && (
        <select value={month} onChange={(e) => update({ mo: e.target.value })}
          className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#fff848]/50">
          {MONTHS.map((mlabel, i) => <option key={i} value={i + 1}>{mlabel}</option>)}
        </select>
      )}
    </div>
  )
}
