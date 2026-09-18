import type { FinanceCore } from '@/lib/finance-data'
import { MONTHS, periodRange } from '@/lib/finance-data'
import { costActive, toMonthly, type CostEntry } from '@/lib/finance'
import { SERVICE_LABELS, SERVICE_SLUGS } from '@/lib/utils'
import { INVOICE_STATUS_LABEL } from '@/lib/invoices'
import { KOSTEN_STATUS_LABEL } from '@/lib/facturen/kosten-winst'
import type { DirecteKostenJaar } from '@/lib/facturen/kosten-data'
import {
  type Werkmap, type Blad, type Cel, layoutVan, bladBereik, euro, pct, datum, aantal, formule, som,
} from '../spec'

/**
 * Excel-export van Financiën (Overzicht + Kosten), opgebouwd uit dezelfde
 * FinanceCore die de pagina's zelf gebruiken (lib/finance-data.ts). Er wordt
 * hier niets herrekend: de maandcijfers komen uit `core.monthly`, en de
 * Excel-formules (omzet = gefactureerd + open, winst = omzet − kosten, totalen)
 * volgen de definities van de schermen, zodat het bestand blijft kloppen als
 * iemand een cel aanpast.
 */

export type FinancienExportInvoer = {
  core: FinanceCore
  year: number
  period: 'month' | 'quarter' | 'fy'
  quarter: number
  month: number
  /** Kostenlaag van de facturen (directe kosten, winst, status); optioneel. */
  kosten?: DirecteKostenJaar | null
}

const FREQ_LABEL: Record<string, string> = { monthly: 'maandelijks', quarterly: 'per kwartaal', 'semi-annual': 'per half jaar', annual: 'jaarlijks' }

/** Zelfde regel als kosten/page.tsx (daar lokaal): wat kost deze post in dit boekjaar? */
function kostWaardeJaar(c: CostEntry, year: number): number {
  if (c.type === 'recurring') {
    let t = 0
    for (let mi = 0; mi < 12; mi++) if (costActive(c, year, mi)) t += toMonthly(Number(c.amount_excl), c.billing_frequency)
    return t
  }
  if (c.cost_date && new Date(c.cost_date).getFullYear() === year) return Number(c.amount_excl)
  return 0
}

export function financienWerkmap(inv: FinancienExportInvoer): Werkmap {
  const { core: c, year, period, quarter, month, kosten: dk } = inv
  const [aMi, bMi] = periodRange(period, quarter, month)
  const periodLabel = period === 'fy' ? `boekjaar ${year}` : period === 'quarter' ? `Q${quarter} ${year}` : `${MONTHS[month - 1]} ${year}`
  const slice = c.monthly.slice(aMi, bMi + 1)
  const omzetPeriod = slice.reduce((s, m) => s + m.omzet, 0)
  const invoicedPeriod = slice.reduce((s, m) => s + m.omzetInvoiced, 0)
  const openPeriod = slice.reduce((s, m) => s + m.omzetOpen, 0)
  const setterPeriod = slice.reduce((s, m) => s + (c.setterPerMonth[m.mi] ?? 0), 0)
  const kostenPeriod = slice.reduce((s, m) => s + m.kostenManual, 0) + setterPeriod
  const winstPeriod = omzetPeriod - kostenPeriod

  const filters = [
    { label: 'Boekjaar', waarde: String(year) },
    { label: 'Periode', waarde: periodLabel },
  ]
  const werkmap: Werkmap = { bestandsnaam: 'NextGenMedia_Financien', titel: 'Financiën', filters, bladen: [] }

  // ── Per maand ──────────────────────────────────────────────────────────────
  const maandBlad: Blad = {
    naam: 'Per maand', titel: `Omzet, kosten en winst per maand — ${year}`,
    toelichting: ['Omzet = gefactureerd + nog te factureren (excl. btw, geannuleerde facturen niet meegeteld). Winst = omzet − kosten − appointment setters, zoals op het Overzicht.'],
    blokken: [{
      soort: 'tabel', titel: 'Maandcijfers',
      kolommen: [
        { kop: 'Maand' }, { kop: 'Gefactureerd', stijl: 'euro' }, { kop: 'Nog te factureren', stijl: 'euro' }, { kop: 'Omzet', stijl: 'euro' },
        { kop: 'Kosten (ingevoerd)', stijl: 'euro' }, { kop: 'Appointment setters', stijl: 'euro' }, { kop: 'Totale kosten', stijl: 'euro' }, { kop: 'Winst', stijl: 'euro' },
        { kop: 'Sociale bijdragen (info)', stijl: 'euro' }, { kop: 'Kantoor omzet (info)', stijl: 'euro' }, { kop: 'Kantoor kosten (info)', stijl: 'euro' },
      ],
      rijen: c.monthly.map((m) => {
        const setter = c.setterPerMonth[m.mi] ?? 0
        return [
          `${MONTHS[m.mi]} ${year}`, euro(m.omzetInvoiced), euro(m.omzetOpen),
          formule('B{R}+C{R}', m.omzet), euro(m.kostenManual), euro(setter),
          formule('E{R}+F{R}', m.kostenManual + setter), formule('D{R}-G{R}', m.omzet - m.kostenManual - setter),
          euro(c.socialPerMonth), euro(c.kantoorOmzetPerMonth[m.mi] ?? 0), euro(c.kantoorKostPerMonth[m.mi] ?? 0),
        ] as Cel[]
      }),
      totaal: ['Boekjaar', som('B', c.omzetInvoicedFY), som('C', c.omzetOpenFY), som('D', c.omzetFY), som('E', c.kostenManualFY), som('F', c.setterCostFY),
        som('G', c.kostenManualFY + c.setterCostFY), som('H', c.omzetFY - c.kostenManualFY - c.setterCostFY), som('I', c.socialAsCostFY), som('J', c.kantoorOmzetFY), som('K', c.kantoorKostFY)],
    }],
  }

  // ── Omzet per dienst (uit facturen, zoals het Overzicht) ───────────────────
  const perService: Record<string, number> = {}
  for (const i of c.invoices) {
    if ((i.status ?? '') === 'geannuleerd') continue
    const slug = i.service_slug || 'overig'
    perService[slug] = (perService[slug] ?? 0) + Number(i.amount_excl ?? 0)
  }
  const serviceTotal = Object.values(perService).reduce((s, v) => s + v, 0)
  const orderedServices = [...(SERVICE_SLUGS as readonly string[]), 'overig'].filter((s) => perService[s])
  const dienstBlad: Blad = {
    naam: 'Omzet per dienst', titel: `Omzet per dienst — boekjaar ${year}`,
    toelichting: ['Uit de facturen van het boekjaar, excl. btw; geannuleerde facturen tellen niet mee.'],
    blokken: [{
      soort: 'tabel', titel: 'Per dienst',
      kolommen: [{ kop: 'Dienst' }, { kop: 'Omzet excl. btw', stijl: 'euro' }, { kop: 'Aandeel', stijl: 'pct' }],
      rijen: orderedServices.map((slug) => [SERVICE_LABELS[slug] ?? 'Overig', euro(perService[slug]), formule('IFERROR(B{R}/SUM(B{R1}:B{R2}),0)', serviceTotal > 0 ? perService[slug] / serviceTotal : 0)]),
      totaal: ['Totaal', som('B', serviceTotal), formule('IFERROR(SUM(C{R1}:C{R2}),0)', serviceTotal > 0 ? 1 : 0, 'totaal_pct')],
    }],
  }

  // ── Facturen van het boekjaar ──────────────────────────────────────────────
  const factuurBlad: Blad = {
    naam: 'Facturen', titel: `Facturen — boekjaar ${year}`,
    toelichting: ['Alle facturen die de omzet van dit boekjaar bepalen. Soort "client" = klantomzet; andere soorten (bv. WAM, setter) tellen niet als NGM-omzet.'],
    blokken: [{
      soort: 'tabel', titel: 'Facturen',
      kolommen: [{ kop: 'Maand' }, { kop: 'Klant' }, { kop: 'Dienst' }, { kop: 'Status' }, { kop: 'Soort' }, { kop: 'Excl. btw', stijl: 'euro' }],
      rijen: [...c.invoices]
        .sort((a, b) => (a.invoice_month ?? '').localeCompare(b.invoice_month ?? '') || (c.clientMap.get(a.client_id ?? '') ?? '').localeCompare(c.clientMap.get(b.client_id ?? '') ?? ''))
        .map((i) => [
          i.invoice_month ?? '', i.client_id ? (c.clientMap.get(i.client_id) ?? '—') : '—',
          i.service_slug ? (SERVICE_LABELS[i.service_slug] ?? i.service_slug) : '—',
          INVOICE_STATUS_LABEL[i.status ?? ''] ?? (i.status ?? '—'), i.kind ?? 'client', euro(Number(i.amount_excl ?? 0)),
        ]),
      totaal: ['Totaal', null, null, null, null, som('F', c.invoices.reduce((s, i) => s + Number(i.amount_excl ?? 0), 0))],
    }],
  }

  // ── Kosten en winst per factuur (kostenlaag) ───────────────────────────────
  const kfacturen = (dk?.facturen ?? []).filter((f) => f.kop.kind === 'client')
  const ref = (f: (typeof kfacturen)[number]) => f.kop.ref.invoice_id ? `F-${f.kop.ref.invoice_id.slice(0, 8).toUpperCase()}` : `REC-${(f.kop.ref.recurring_id ?? '').slice(0, 8).toUpperCase()}-${f.kop.ref.maand}`
  const winstBlad: Blad = {
    naam: 'Winst per factuur', titel: `Omzet, directe kosten en winst per factuur — ${year}`,
    toelichting: ['Werkelijke winst = omzet excl. btw − directe kosten excl. btw (formule). Vesting-/investeringswaarde = werkelijke winst; niet-meetellend = de doorgerekende kosten. Status "Nog niet gecontroleerd" = nog geen kosten of bevestiging.'],
    blokken: [{
      soort: 'tabel', titel: 'Per factuur',
      kolommen: [
        { kop: 'Factuurnr.' }, { kop: 'Maand' }, { kop: 'Klant' }, { kop: 'Project / omschrijving' }, { kop: 'Status' },
        { kop: 'Omzet excl. btw', stijl: 'euro' }, { kop: 'Btw', stijl: 'euro' }, { kop: 'Omzet incl. btw', stijl: 'euro' },
        { kop: 'Directe kosten excl. btw', stijl: 'euro' }, { kop: 'Werkelijke winst', stijl: 'euro' }, { kop: 'Marge', stijl: 'pct' }, { kop: 'Vesting-/investeringswaarde', stijl: 'euro' }, { kop: 'Niet-meetellend', stijl: 'euro' }, { kop: 'Kostenstatus' },
      ],
      rijen: kfacturen.map((f) => [
        ref(f), f.kop.invoice_month ?? '', f.kop.client_id ? (c.clientMap.get(f.kop.client_id) ?? '—') : '—', f.kop.omschrijving ?? '', INVOICE_STATUS_LABEL[f.kop.factuurstatus] ?? f.kop.factuurstatus,
        euro(f.berekend.omzetExcl), euro(f.berekend.btw), formule('F{R}+G{R}', f.berekend.omzetIncl),
        euro(f.berekend.directeKosten), formule('F{R}-I{R}', f.berekend.winst), formule('IFERROR(J{R}/F{R},"")', f.berekend.margePct ?? ''), formule('J{R}', f.berekend.vestingWaarde), formule('I{R}', f.berekend.nietMeetellend),
        KOSTEN_STATUS_LABEL[f.berekend.status],
      ] as Cel[]),
      totaal: ['Totaal', null, null, null, null, som('F'), som('G'), som('H'), som('I', dk?.totaal), som('J'), formule('IFERROR(SUM(J{R1}:J{R2})/SUM(F{R1}:F{R2}),"")', undefined, 'totaal_pct'), som('L'), som('M'), null],
      leeg: 'Nog geen kostenlaag beschikbaar.',
    }, {
      soort: 'tabel', titel: 'Kosten per factuur',
      kolommen: [{ kop: 'Factuurnr.' }, { kop: 'Klant' }, { kop: 'Kost' }, { kop: 'Categorie' }, { kop: 'Leverancier' }, { kop: 'Kostprijs excl. btw', stijl: 'euro' }, { kop: 'Status' }, { kop: 'Gekoppelde lijn' }, { kop: 'Datum', stijl: 'datum' }, { kop: 'Bewijsstuk' }],
      rijen: kfacturen.flatMap((f) => f.kosten.map((k) => [
        ref(f), f.kop.client_id ? (c.clientMap.get(f.kop.client_id) ?? '—') : '—', k.omschrijving, k.categorie ?? '', k.leverancier ?? '',
        k.kostprijs_excl === null ? null : euro(k.kostprijs_excl), k.kostprijs_excl === null ? 'Kostprijs nog aan te vullen' : (k.status === 'geannuleerd' ? 'Geannuleerd' : 'Actief'),
        k.line_id ? (f.lijnen.find((l) => l.id === k.line_id)?.omschrijving ?? '—') : 'Hele factuur', datum(k.datum), k.bewijs_url ?? '',
      ] as Cel[])),
      totaal: ['Totaal (actief)', null, null, null, null, formule('SUMIF(G{R1}:G{R2},"Actief",F{R1}:F{R2})', dk?.totaal, 'totaal_euro'), null, null, null, null],
      leeg: 'Geen kosten gekoppeld.',
    }],
  }

  // ── Kosten ─────────────────────────────────────────────────────────────────
  const kostenRijen: Cel[][] = c.costs.map((k) => {
    const waarde = kostWaardeJaar(k, year)
    return [
      k.name ?? '—', k.category ?? 'Overig', k.type === 'recurring' ? 'Abonnement' : 'Eenmalig',
      k.type === 'recurring' ? (FREQ_LABEL[k.billing_frequency ?? 'monthly'] ?? k.billing_frequency ?? '') : '',
      datum(k.type === 'recurring' ? k.start_date : k.cost_date), datum(k.type === 'recurring' ? k.end_date : null),
      euro(Number(k.amount_excl)), Number(k.vat_pct ?? 0), formule('IFERROR(G{R}*H{R}/100,0)', Number(k.amount_excl) * Number(k.vat_pct ?? 0) / 100), formule('G{R}+I{R}', Number(k.amount_excl) * (1 + Number(k.vat_pct ?? 0) / 100)),
      euro(waarde),
    ]
  })
  if (c.setterCostFY > 0) {
    kostenRijen.push(['Appointment setters', 'Appointment setters', 'Berekend', 'uren + commissie', null, null, euro(c.setterCostFY), 0, formule('IFERROR(G{R}*H{R}/100,0)', 0), formule('G{R}+I{R}', c.setterCostFY), euro(c.setterCostFY)])
  }
  const perCat: Record<string, number> = {}
  for (const x of c.costs) { const v = kostWaardeJaar(x, year); if (v > 0) { const cat = x.category || 'Overig'; perCat[cat] = (perCat[cat] ?? 0) + v } }
  if (c.socialAsCostFY > 0) perCat['Sociale bijdragen'] = (perCat['Sociale bijdragen'] ?? 0) + c.socialAsCostFY
  if (c.setterCostFY > 0) perCat['Appointment setters'] = (perCat['Appointment setters'] ?? 0) + c.setterCostFY
  const categories = Object.entries(perCat).sort(([, a], [, b]) => b - a).map(([name, value]) => ({ name, value: Math.round(value) }))
  const catTotal = categories.reduce((s, x) => s + x.value, 0)
  const nu = new Date()
  const recurringCostFY = c.costs.filter((x) => x.type === 'recurring').reduce((s, x) => s + kostWaardeJaar(x, year), 0)
  const abonnementenNu = c.costs.filter((x) => x.type === 'recurring' && costActive(x, nu.getFullYear(), nu.getMonth())).length
  const oneTimeCostFY = c.costs.filter((x) => x.type === 'one_time').reduce((s, x) => s + kostWaardeJaar(x, year), 0)

  const kostenBlad: Blad = {
    naam: 'Kosten', titel: `Kosten — boekjaar ${year}`,
    toelichting: [`"Waarde ${year}" = wat de post in dit boekjaar kost (abonnementen per actieve maand, eenmalige kosten in hun maand). De post Appointment setters wordt berekend uit uren en commissies.`],
    blokken: [
      {
        soort: 'tabel', titel: 'Kostenposten',
        kolommen: [
          { kop: 'Naam' }, { kop: 'Categorie' }, { kop: 'Type' }, { kop: 'Frequentie' }, { kop: 'Start / datum', stijl: 'datum' }, { kop: 'Einde', stijl: 'datum' },
          { kop: 'Excl. btw', stijl: 'euro' }, { kop: 'Btw %', stijl: 'getal' }, { kop: 'Btw', stijl: 'euro' }, { kop: 'Incl. btw', stijl: 'euro' }, { kop: `Waarde ${year}`, stijl: 'euro' },
        ],
        rijen: kostenRijen,
        totaal: ['Totaal', null, null, null, null, null, null, null, null, null, som('K', c.kostenManualFY + c.setterCostFY)],
      },
      {
        soort: 'tabel', titel: 'Kosten per categorie',
        kolommen: [{ kop: 'Categorie' }, { kop: 'Bedrag', stijl: 'euro' }, { kop: 'Aandeel', stijl: 'pct' }],
        rijen: categories.map((k) => [k.name, euro(k.value), formule('IFERROR(B{R}/SUM(B{R1}:B{R2}),0)', catTotal > 0 ? k.value / catTotal : 0)]),
        totaal: ['Totaal', som('B', catTotal), formule('IFERROR(SUM(C{R1}:C{R2}),0)', catTotal > 0 ? 1 : 0, 'totaal_pct')],
      },
    ],
  }

  // ── Samenvatting: formules naar het maandblad, zodat alles blijft kloppen ──
  const bladen = [maandBlad, dienstBlad, factuurBlad, winstBlad, kostenBlad]
  const L = layoutVan(werkmap, maandBlad)[0]
  const van = L.eersteDataRij! + aMi
  const tot = L.eersteDataRij! + bMi
  const maandSom = (kol: string) => `SUM(${bladBereik(maandBlad.naam, kol, van, tot)})`
  const jaarSom = (kol: string) => `SUM(${bladBereik(maandBlad.naam, kol, L.eersteDataRij!, L.laatsteDataRij!)})`
  const samenvatting: Blad = {
    naam: 'Samenvatting', titel: `Financiën — samenvatting ${periodLabel}`,
    toelichting: ['Dezelfde kengetallen als op het dashboard. De formules verwijzen naar het blad "Per maand".'],
    blokken: [
      {
        soort: 'kpis', titel: `Periode: ${periodLabel}`,
        items: [
          { label: `Omzet ${periodLabel}`, waarde: formule(maandSom('D'), omzetPeriod), stijl: 'euro' },
          { label: 'Gefactureerd', waarde: formule(maandSom('B'), invoicedPeriod), stijl: 'euro', toelichting: 'verstuurd of betaald' },
          { label: 'Nog te factureren', waarde: formule(maandSom('C'), openPeriod), stijl: 'euro' },
          { label: 'Kosten', waarde: formule(maandSom('G'), kostenPeriod), stijl: 'euro', toelichting: 'ingevoerde kosten + appointment setters' },
          { label: 'waarvan appointment setting', waarde: formule(maandSom('F'), setterPeriod), stijl: 'euro' },
          { label: 'Winst', waarde: formule(maandSom('H'), winstPeriod), stijl: 'euro' },
          { label: 'Doorgerekende (directe) kosten op facturen', waarde: euro(dk ? dk.perMaand.slice(aMi, bMi + 1).reduce((s, v) => s + v, 0) : 0), toelichting: 'tellen niet als winst; zie blad "Winst per factuur"' },
          { label: 'Omzet die bijdraagt aan de winst', waarde: euro(dk ? dk.omzetPerMaand.slice(aMi, bMi + 1).reduce((s, v) => s + v, 0) - dk.perMaand.slice(aMi, bMi + 1).reduce((s, v) => s + v, 0) : omzetPeriod), toelichting: 'factuuromzet − doorgerekende kosten (vesting-/investeringswaarde)' },
        ],
      },
      {
        soort: 'kpis', titel: `Boekjaar ${year}`,
        items: [
          { label: 'Omzet boekjaar', waarde: formule(jaarSom('D'), c.omzetFY), stijl: 'euro' },
          { label: 'Totale kosten boekjaar', waarde: euro(c.kostenManualFY + c.socialAsCostFY + c.setterCostFY), toelichting: 'ingevoerd + sociale bijdragen + appointment setters (tab Kosten)' },
          { label: 'Abonnementen', waarde: euro(recurringCostFY), toelichting: `${abonnementenNu} lopend · ${Math.round(c.recurringCostNow)} per maand` },
          { label: 'Eenmalige kosten', waarde: euro(oneTimeCostFY) },
          { label: 'Appointment setters', waarde: formule(jaarSom('F'), c.setterCostFY), stijl: 'euro' },
          { label: 'Sociale bijdragen', waarde: euro(c.socialAsCostFY) },
          { label: 'MRR (huidige maand)', waarde: euro(c.mrr) },
          { label: 'Aantal facturen', waarde: aantal(c.invoices.length) },
          { label: 'Aandeel gefactureerd', waarde: formule(`IFERROR(${jaarSom('B')}/${jaarSom('D')},0)`, c.omzetFY > 0 ? c.omzetInvoicedFY / c.omzetFY : 0), stijl: 'pct' },
        ],
      },
    ],
  }
  werkmap.bladen = [samenvatting, ...bladen]
  return werkmap
}

// Onbenut maar bewust geëxporteerd voor wie een procentcel nodig heeft.
export { pct }
