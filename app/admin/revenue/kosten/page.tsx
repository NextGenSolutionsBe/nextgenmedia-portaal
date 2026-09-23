export const dynamic = 'force-dynamic'

import { formatEuro } from '@/lib/utils'
import { TrendingDown, Repeat2, ArrowDownRight, PhoneCall, Receipt, Contact } from 'lucide-react'
import { loadCore, readPeriodParams, MONTHS } from '@/lib/finance-data'
import { costActive, toMonthly, type CostEntry } from '@/lib/finance'
import { Kpi } from '../kpi'
import { KostenCharts } from '../kosten-charts'
import { CostForm } from '../cost-form'
import { CostTable } from '../cost-table'
import { ExportKnop } from '@/components/admin/export-knop'
import { KostenPerMaand, type MaandRij, type KostRegel } from '../kosten-per-maand'

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
  const { year, period, quarter, month } = readPeriodParams(await searchParams)
  const c = await loadCore(year)

  const recurringCostFY = c.costs.filter(x => x.type === 'recurring').reduce((s, x) => s + costYearValue(x, year), 0)
  // Hoeveel abonnementen lopen er nu echt? Een bedrag zonder aantal zegt weinig,
  // en dit is het getal waarop je gaat opruimen.
  const nu = new Date()
  const abonnementenNu = c.costs.filter(x => x.type === 'recurring' && costActive(x, nu.getFullYear(), nu.getMonth())).length
  // Personeelskosten (geboekt vanuit Personeel) apart van de gewone eenmalige kosten.
  const isPersoneel = (x: CostEntry) => (x as CostEntry & { bron?: string | null }).bron === 'personeel' || x.category === 'Personeel'
  const oneTimeCostFY = c.costs.filter(x => x.type === 'one_time' && !isPersoneel(x)).reduce((s, x) => s + costYearValue(x, year), 0)
  const personeelFY = c.costs.filter(x => x.type === 'one_time' && isPersoneel(x)).reduce((s, x) => s + costYearValue(x, year), 0)
  const facturenMetKost = new Set(c.factuurKostRegels.map((r) => r.invoice_id ?? `${r.recurring_id}:${r.maand}`)).size
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
  for (const r of c.factuurKostRegels) { const cat = `${r.categorie || 'Overig'} (bij facturen)`; perCat[cat] = (perCat[cat] ?? 0) + r.bedrag }
  if (c.kantoorKostFY > 0) perCat['Kantoor'] = (perCat['Kantoor'] ?? 0) + c.kantoorKostFY

  // ── Kosten per maand: elke bron apart, met de losse regels en een link naar waar ze vandaan komen ──
  const maandNamen = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
  const klant = (id: string | null) => (id ? c.clientMap.get(id) ?? 'Onbekende klant' : 'Geen klant')
  const perMaand: MaandRij[] = Array.from({ length: 12 }, (_, mi) => {
    const regels: KostRegel[] = []
    for (const x of c.costs) {
      if (x.type === 'recurring' && costActive(x, year, mi)) regels.push({ soort: 'abonnement', label: x.name || 'Abonnement', sub: [x.category, x.billing_frequency && x.billing_frequency !== 'monthly' ? 'omgerekend per maand' : null].filter(Boolean).join(' · ') || null, bedrag: toMonthly(Number(x.amount_excl), x.billing_frequency) })
      if (x.type === 'one_time' && x.cost_date) {
        const d = new Date(x.cost_date)
        if (d.getFullYear() === year && d.getMonth() === mi) regels.push(isPersoneel(x)
          ? { soort: 'personeel', label: x.name || 'Personeel', sub: 'goedgekeurde uren — details in Personeel', bedrag: Number(x.amount_excl), href: '/admin/personeel?tab=kosten' }
          : { soort: 'eenmalig', label: x.name || 'Eenmalige kost', sub: [x.category, x.cost_date.slice(8, 10) + '/' + x.cost_date.slice(5, 7)].filter(Boolean).join(' · '), bedrag: Number(x.amount_excl) })
      }
    }
    for (const r of c.factuurKostRegels) {
      if (Number(r.maand.slice(5, 7)) - 1 !== mi) continue
      regels.push({ soort: 'factuur', label: r.omschrijving || 'Kost', sub: [r.categorie, r.leverancier, `factuur ${klant(r.client_id)}${r.factuur ? ` — ${r.factuur}` : ''}`].filter(Boolean).join(' · '), bedrag: r.bedrag, href: r.invoice_id ? `/admin/invoices?factuur=${r.invoice_id}` : `/admin/invoices?maand=${r.maand}` })
    }
    if ((c.kantoorKostPerMonth[mi] ?? 0) > 0) regels.push({ soort: 'kantoor', label: 'Samenwerkingen in het Kantoor', bedrag: c.kantoorKostPerMonth[mi], href: '/admin/kantoor' })
    if ((c.setterPerMonth[mi] ?? 0) > 0) regels.push({ soort: 'setters', label: 'Appointment setters', sub: 'uren + commissies', bedrag: c.setterPerMonth[mi], href: '/admin/sales/resultaten' })
    if (c.socialPerMonth > 0) regels.push({ soort: 'sociaal', label: 'Sociale bijdragen (raming)', bedrag: c.socialPerMonth })
    regels.sort((a, b) => b.bedrag - a.bedrag)
    const per = { abonnement: 0, eenmalig: 0, personeel: 0, factuur: 0, kantoor: 0, setters: 0, sociaal: 0 }
    for (const r of regels) per[r.soort] += r.bedrag
    return { mi, label: maandNamen[mi], per, totaal: Object.values(per).reduce((t, v) => t + v, 0), regels }
  })
  const categories = Object.entries(perCat).sort(([, a], [, b]) => b - a).map(([name, value]) => ({ name, value: Math.round(value) }))
  const catTotal = categories.reduce((s, x) => s + x.value, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        <ExportKnop url={`/api/admin/export/financien?fy=${year}&period=${period}&q=${quarter}&mo=${month}`} />
        <CostForm />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Kpi label={`Totale kosten ${year}`} value={formatEuro(totaalFY)} sub="excl. btw" color="text-red-600" Icon={TrendingDown} />
        <Kpi label="Abonnementen" value={formatEuro(recurringCostFY)}
          sub={`${abonnementenNu} lopend · ${formatEuro(c.recurringCostNow)} per maand`}
          color="text-red-600" Icon={Repeat2} />
        <Kpi label="Eenmalige kosten" value={formatEuro(oneTimeCostFY)} color="text-orange-600" Icon={ArrowDownRight} />
        <Kpi label="Kosten bij facturen" value={formatEuro(c.factuurKostFY)}
          sub={c.factuurKostRegels.length ? `${c.factuurKostRegels.length} kost${c.factuurKostRegels.length === 1 ? '' : 'en'} op ${facturenMetKost} factu${facturenMetKost === 1 ? 'ur' : 'ren'} · onderaanneming, materiaal…` : 'log ze bij een factuur (Facturen → Kosten en winst)'}
          color="text-blue-700" Icon={Receipt} />
        {personeelFY > 0 && <Kpi label="Personeel" value={formatEuro(personeelFY)} sub="goedgekeurde uren (Personeel)" color="text-violet-700" Icon={Contact} />}
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

      <KostenPerMaand rijen={perMaand} year={year} actieveMaand={period === 'month' ? month - 1 : null} />

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
