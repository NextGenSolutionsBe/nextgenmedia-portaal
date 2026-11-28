export const dynamic = 'force-dynamic'

import { formatEuro } from '@/lib/utils'
import { Wallet, Landmark, TrendingUp, ArrowDownRight, PiggyBank } from 'lucide-react'
import { loadCore, readPeriodParams } from '@/lib/finance-data'
import { Kpi } from '../kpi'

export default async function AandeelhoudersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { year } = readPeriodParams(await searchParams)
  const c = await loadCore(year)

  const draws = Number(c.settings.partner_draws)
  const uitkeerbaar = c.netFY - draws

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Kpi label="Winst voor belasting" value={formatEuro(c.winstFY)} sub={`boekjaar ${year}`} color={c.winstFY >= 0 ? 'text-gray-900' : 'text-red-600'} Icon={Wallet} />
        <Kpi label="Vennootschapsbelasting (indic.)" value={formatEuro(c.taxFY)} color="text-red-600" Icon={Landmark} />
        <Kpi label="Nettowinst" value={formatEuro(c.netFY)} color={c.netFY >= 0 ? 'text-green-600' : 'text-red-600'} Icon={TrendingUp} />
        <Kpi label="Opnames vennoten" value={formatEuro(draws)} sub="instelbaar bij Instellingen" color="text-amber-600" Icon={ArrowDownRight} />
        <Kpi label="Beschikbaar uitkeerbaar resultaat" value={formatEuro(uitkeerbaar)} sub="nettowinst − opnames" color={uitkeerbaar >= 0 ? 'text-green-600' : 'text-red-600'} Icon={PiggyBank} />
      </div>

      <div className="card-base bg-amber-50/40 border-amber-200/60">
        <p className="text-sm text-amber-800">
          <strong>Disclaimer.</strong> Geen officiële fiscale of boekhoudkundige rapportering. Alle bedragen zijn indicatieve berekeningen
          op basis van de ingestelde parameters. Raadpleeg steeds uw boekhouder voor definitieve cijfers en uitkeringsbeslissingen.
        </p>
      </div>
    </div>
  )
}
