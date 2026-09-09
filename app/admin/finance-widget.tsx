import Link from 'next/link'

import { loadCore } from '@/lib/finance-data'
import { formatEuro } from '@/lib/utils'
import {
  thisMonthYM, monthLabel,
} from '@/lib/invoices'
import { TrendingUp, Receipt, ArrowRight } from 'lucide-react'

// "Deze maand": Omzet · Gefactureerd · Kosten · Winst + voortgangsbalk Facturatie
// voltooid. Omzet = facturen (los + terugkerend), niet langer een handmatige prognose.
export async function FinanceWidget() {
  let omzet = 0, gefactureerd = 0, teFactureren = 0, kosten = 0
  let month = thisMonthYM()
  try {
    month = thisMonthYM()
    const core = await loadCore(Number(month.slice(0, 4)))
    const mi = Number(month.slice(5, 7)) - 1
    const m = core.monthly[mi]
    gefactureerd = m?.omzetInvoiced ?? 0
    teFactureren = m?.omzetOpen ?? 0
    omzet = m?.omzet ?? 0
    // Appointment setting hoort bij de kosten van de maand, net als elders.
    kosten = (m?.kostenManual ?? 0) + (core.setterPerMonth[mi] ?? 0)
  } catch {
    return null // tabellen nog niet aangemaakt → widget verbergen
  }

  if (omzet === 0 && kosten === 0) return null

  const winst = omzet - kosten
  const pct = omzet > 0 ? Math.min(100, Math.round((gefactureerd / omzet) * 100)) : 0
  const pctColor = pct >= 100 ? 'bg-green-500' : pct > 0 ? 'bg-amber-500' : 'bg-red-500'

  const cells = [
    { label: 'Omzet', value: formatEuro(omzet), color: 'text-gray-900' },
    { label: 'Gefactureerd', value: formatEuro(gefactureerd), color: 'text-green-600' },
    { label: 'Nog te factureren', value: formatEuro(teFactureren), color: teFactureren > 0 ? 'text-amber-600' : 'text-gray-600' },
    { label: 'Winst', value: formatEuro(winst), color: winst >= 0 ? 'text-green-600' : 'text-red-600' },
  ]

  return (
    <div className="card-base">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-gray-400" />Deze maand · <span className="capitalize font-normal text-gray-500">{monthLabel(month)}</span></h2>
        <Link href="/admin/invoices" className="text-xs text-gray-400 hover:text-black flex items-center gap-1"><Receipt className="h-3 w-3" />Facturen <ArrowRight className="h-3 w-3" /></Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        {cells.map((c) => (
          <div key={c.label} className="rounded-xl border border-gray-100 p-3">
            <div className="text-[11px] text-gray-500">{c.label}</div>
            <div className={`mt-0.5 text-lg font-bold ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1"><span>Facturatie voltooid</span><span className="font-semibold">{pct}%</span></div>
      <div className="h-3 w-full rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${pctColor} transition-all`} style={{ width: `${pct}%` }} /></div>
    </div>
  )
}
