export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { formatEuro, SERVICE_LABELS, SERVICE_SLUGS } from '@/lib/utils'
import { TrendingUp, Receipt, Clock, Wallet, ArrowRight } from 'lucide-react'
import { loadCore, readPeriodParams, periodRange, MONTHS } from '@/lib/finance-data'
import { Kpi } from '../kpi'
import { OmzetCharts } from '../omzet-charts'
import { FinanceWidget } from '../../finance-widget'

// Omzet is GEEN prognose meer: het zijn de feiten uit je facturen. Hier log je
// enkel kosten (tab Kosten); winst = omzet (facturen) − kosten.
export default async function FinanceOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { year, period, quarter, month } = readPeriodParams(await searchParams)
  const c = await loadCore(year)

  const [aMi, bMi] = periodRange(period, quarter, month)
  const slice = c.monthly.slice(aMi, bMi + 1)
  const omzetPeriod = slice.reduce((s, m) => s + m.omzet, 0)
  const invoicedPeriod = slice.reduce((s, m) => s + m.omzetInvoiced, 0)
  const openPeriod = slice.reduce((s, m) => s + m.omzetOpen, 0)
  const setterPeriod = slice.reduce((s, m) => s + (c.setterPerMonth[m.mi] ?? 0), 0)
  const kostenPeriod = slice.reduce((s, m) => s + m.kostenManual, 0) + setterPeriod
  const winstPeriod = omzetPeriod - kostenPeriod
  const periodLabel = period === 'fy' ? `boekjaar ${year}` : period === 'quarter' ? `Q${quarter} ${year}` : `${MONTHS[month - 1]} ${year}`

  const monthlyChart = c.monthly.map((m) => ({ label: MONTHS[m.mi], recurring: Math.round(m.omzetInvoiced), eenmalig: Math.round(m.omzetOpen) }))
  const quarters = [0, 1, 2, 3].map((q) => ({ label: `Q${q + 1}`, omzet: Math.round(c.monthly.slice(q * 3, q * 3 + 3).reduce((s, m) => s + m.omzet, 0)) }))

  // Omzet per dienst, uit de facturen van dit boekjaar.
  const perService: Record<string, number> = {}
  for (const i of c.invoices) {
    if ((i.status ?? '') === 'geannuleerd') continue
    const slug = i.service_slug || 'overig'
    perService[slug] = (perService[slug] ?? 0) + Number(i.amount_excl ?? 0)
  }
  const serviceTotal = Object.values(perService).reduce((s, v) => s + v, 0)
  const orderedServices = [...(SERVICE_SLUGS as readonly string[]), 'overig'].filter((s) => perService[s])

  return (
    <div className="space-y-6">
      <FinanceWidget />

      <p className="text-xs text-gray-500">
        Omzet komt automatisch uit je <b>facturen</b> (excl. btw, geannuleerde niet meegeteld) — je hoeft hier niets in te vullen.
        Alleen <b>kosten</b> log je zelf onder het tabblad Kosten. Winst = omzet − kosten.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label={`Omzet ${periodLabel}`} value={formatEuro(omzetPeriod)} sub={period !== 'fy' ? `Boekjaar: ${formatEuro(c.omzetFY)}` : undefined} color="text-green-600" Icon={TrendingUp} />
        <Kpi label="Gefactureerd" value={formatEuro(invoicedPeriod)} sub="verstuurd of betaald" color="text-green-600" Icon={Receipt} />
        <Kpi label="Nog te factureren" value={formatEuro(openPeriod)} color={openPeriod > 0 ? 'text-amber-600' : 'text-gray-600'} Icon={Clock} />
        <Kpi label="Winst" value={formatEuro(winstPeriod)}
          sub={setterPeriod > 0
            ? `Kosten: ${formatEuro(kostenPeriod)} · waarvan ${formatEuro(setterPeriod)} appointment setting`
            : `Kosten: ${formatEuro(kostenPeriod)}`}
          color={winstPeriod >= 0 ? 'text-green-600' : 'text-red-600'} Icon={Wallet} />
      </div>

      <OmzetCharts monthly={monthlyChart} quarters={quarters} year={year} />

      <div className="card-base">
        <h2 className="font-semibold mb-1">Omzet per dienst</h2>
        <div className="text-xs text-gray-400 mb-4">Boekjaar {year} · uit facturen</div>
        {orderedServices.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Nog geen facturen in dit boekjaar</p>
        ) : (
          <div className="space-y-3">
            {orderedServices.map((slug) => {
              const amount = perService[slug]
              const pct = serviceTotal > 0 ? (amount / serviceTotal) * 100 : 0
              return (
                <div key={slug}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">{SERVICE_LABELS[slug] ?? 'Overig'}</span>
                    <span>{formatEuro(amount)} <span className="text-gray-400">({pct.toFixed(0)}%)</span></span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-[#fff848] rounded-full" style={{ width: `${pct}%` }} /></div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="card-base flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold">Omzet aanpassen?</h2>
          <p className="text-sm text-gray-500">Omzet volgt je facturen. Voeg daar een factuur toe of pas er een aan.</p>
        </div>
        <Link href="/admin/invoices" className="btn-primary text-sm">Naar Facturen<ArrowRight className="h-4 w-4" /></Link>
      </div>
    </div>
  )
}
