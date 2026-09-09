export const dynamic = 'force-dynamic'

import { formatEuro } from '@/lib/utils'
import { TrendingDown, Repeat2, ArrowDownRight, PhoneCall } from 'lucide-react'
import { loadCore, readPeriodParams, MONTHS } from '@/lib/finance-data'
import { costActive, toMonthly, type CostEntry } from '@/lib/finance'
import { Kpi } from '../kpi'
import { KostenCharts } from '../kosten-charts'
import { CostForm } from '../cost-form'
import { CostTable } from '../cost-table'

function costYearValue(c: CostEntry, year: number): number {
  if (c.type === 'recurring') {
    let t = 0
    for (let mi = 0; mi < 12; mi++) if (costActive(c, year, mi)) t += toMonthly(Number(c.amount_excl), c.billing_frequency)
    return t
  }
  if (c.cost_date && new Date(c.cost_date).getFullYear() === year) return Number(c.amount_excl)
  return 0
}

export default async function KostenPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { year } = readPeriodParams(await searchParams)
  const c = await loadCore(year)

  const recurringCostFY = c.costs.filter(x => x.type === 'recurring').reduce((s, x) => s + costYearValue(x, year), 0)
  // Hoeveel abonnementen lopen er nu echt? Een bedrag zonder aantal zegt weinig,
  // en dit is het getal waarop je gaat opruimen.
  const nu = new Date()
  const abonnementenNu = c.costs.filter(x => x.type === 'recurring' && costActive(x, nu.getFullYear(), nu.getMonth())).length
  const oneTimeCostFY = c.costs.filter(x => x.type === 'one_time').reduce((s, x) => s + costYearValue(x, year), 0)
  // Setterkost (uren + commissie) telt gewoon mee als bedrijfskost.
  const totaalFY = c.kostenManualFY + c.socialAsCostFY + c.setterCostFY

  const monthlyChart = c.monthly.map(m => ({
    label: MONTHS[m.mi],
    kosten: Math.round(m.kostenManual + c.socialPerMonth + (c.setterPerMonth[m.mi] ?? 0)),
  }))

  const perCat: Record<string, number> = {}
  for (const x of c.costs) { const v = costYearValue(x, year); if (v > 0) { const cat = x.category || 'Overig'; perCat[cat] = (perCat[cat] ?? 0) + v } }
  if (c.socialAsCostFY > 0) perCat['Sociale bijdragen'] = (perCat['Sociale bijdragen'] ?? 0) + c.socialAsCostFY
  if (c.setterCostFY > 0) perCat['Appointment setters'] = (perCat['Appointment setters'] ?? 0) + c.setterCostFY
  const categories = Object.entries(perCat).sort(([, a], [, b]) => b - a).map(([name, value]) => ({ name, value: Math.round(value) }))
  const catTotal = categories.reduce((s, x) => s + x.value, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end"><CostForm /></div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Kpi label={`Totale kosten ${year}`} value={formatEuro(totaalFY)} sub="excl. btw" color="text-red-600" Icon={TrendingDown} />
        <Kpi label="Abonnementen" value={formatEuro(recurringCostFY)}
          sub={`${abonnementenNu} lopend · ${formatEuro(c.recurringCostNow)} per maand`}
          color="text-red-600" Icon={Repeat2} />
        <Kpi label="Eenmalige kosten" value={formatEuro(oneTimeCostFY)} color="text-orange-600" Icon={ArrowDownRight} />
        <Kpi label="Appointment setters" value={formatEuro(c.setterCostFY)}
          sub={`deze maand: ${formatEuro(c.setterPerMonth[new Date().getMonth()] ?? 0)}`}
          color="text-red-600" Icon={PhoneCall} />
      </div>

      {/* Deze post wordt niet ingetikt maar berekend, en dat hoort erbij te staan:
          anders zoek je je blauw naar de kostenregel die er niet is. */}
      {c.setterCostFY > 0 && (
        <p className="text-[11px] text-gray-500">
          De post <b>Appointment setters</b> wordt automatisch berekend uit gelogde uren en toegekende
          commissies, en loopt op terwijl er gebeld wordt. Je vindt de details onder Verkoop → Resultaten.
        </p>
      )}

      <KostenCharts monthly={monthlyChart} categories={categories} year={year} />

      <div className="card-base">
        <h2 className="font-semibold mb-1">Kosten per categorie</h2>
        <div className="text-xs text-gray-400 mb-4">Boekjaar {year}</div>
        {categories.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Geen kosten in dit boekjaar</p>
        ) : (
          <div className="space-y-3">
            {categories.map(({ name, value }) => {
              const pct = catTotal > 0 ? (value / catTotal) * 100 : 0
              return (
                <div key={name}>
                  <div className="flex justify-between text-sm mb-1"><span className="font-medium">{name}</span><span>{formatEuro(value)} <span className="text-gray-400">({pct.toFixed(0)}%)</span></span></div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-red-400 rounded-full" style={{ width: `${pct}%` }} /></div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <CostTable costs={c.costs} setterCostFY={c.setterCostFY} year={year} />
    </div>
  )
}
