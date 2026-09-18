export const dynamic = 'force-dynamic'

import { formatEuro } from '@/lib/utils'
import { ArrowDownLeft, ArrowUpRight, Wallet, TrendingUp } from 'lucide-react'
import { loadCore, readPeriodParams, MONTHS } from '@/lib/finance-data'
import { Kpi, SectionTitle } from '../kpi'
import { FinanceChart } from '../finance-chart'

export default async function CashflowPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { year } = readPeriodParams(await searchParams)
  const c = await loadCore(year)
  const now = new Date()

  // Gerealiseerd t.e.m. nu binnen het boekjaar
  const lastRealized = year < now.getFullYear() ? 11 : year > now.getFullYear() ? -1 : now.getMonth()
  const realized = (key: 'omzet' | 'kosten') => c.monthly.slice(0, lastRealized + 1).reduce((s, m) => s + (key === 'omzet' ? m.omzet : m.kostenManual + c.socialPerMonth + (c.setterPerMonth[m.mi] ?? 0)), 0)
  const cashIn = realized('omzet')
  const cashOut = realized('kosten')
  const netto = cashIn - cashOut

  // Forecast op basis van recurring (actieve contracten)
  const recurringNetMonth = c.mrr - c.recurringCostNow
  const forecastMonth = recurringNetMonth
  const forecastQuarter = recurringNetMonth * 3

  const chartData = c.monthly.map(m => {
    // Setterkost telt mee in de maanduitgaven — die wordt ook echt betaald.
    const k = m.kostenManual + c.socialPerMonth + (c.setterPerMonth[m.mi] ?? 0)
    return { label: MONTHS[m.mi], omzet: Math.round(m.omzet), kosten: Math.round(k), winst: Math.round(m.omzet - k) }
  })

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>Cashflow boekjaar {year} (gerealiseerd)</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Kpi label="Cash In (ontvangen omzet)" value={formatEuro(cashIn)} color="text-green-600" Icon={ArrowDownLeft} />
          <Kpi label="Cash Out (uitgaven)" value={formatEuro(cashOut)} color="text-red-600" Icon={ArrowUpRight} />
          <Kpi label="Netto cashflow" value={formatEuro(netto)} color={netto >= 0 ? 'text-green-600' : 'text-red-600'} Icon={Wallet} />
        </div>
      </div>

      <div>
        <SectionTitle>Forecast (op basis van recurring omzet & kosten)</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Kpi label="Volgende maand (netto)" value={formatEuro(forecastMonth)} sub={`MRR ${formatEuro(c.mrr)} − recurring kosten ${formatEuro(c.recurringCostNow)}`} color={forecastMonth >= 0 ? 'text-green-600' : 'text-red-600'} Icon={TrendingUp} />
          <Kpi label="Volgend kwartaal (netto)" value={formatEuro(forecastQuarter)} sub="3 × recurring netto" color={forecastQuarter >= 0 ? 'text-green-600' : 'text-red-600'} Icon={TrendingUp} />
        </div>
      </div>

      <FinanceChart data={chartData} year={year} />

      <p className="text-[11px] text-gray-400 italic">
        Cashflow benadert de gerealiseerde omzet en uitgaven per maand. De forecast is gebaseerd op de huidige recurring omzet en kosten (actieve contracten) en houdt geen rekening met eenmalige posten of betalingstermijnen.
      </p>
    </div>
  )
}
