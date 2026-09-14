import { VAT_PCT, TIJDSBELASTING, monthLabel } from '@/lib/sales/earnings'
import { type Werkmap, type Cel, euro, pct, formule, som, aantal, getal } from '../spec'

/**
 * Excel-export van Verkoop → Resultaten. De rijen komen uit /api/admin/sales/stats
 * (lib/sales/setters.ts, in cent); hier enkel omgezet naar euro. Formules waar
 * ze zeker gelden: totaal = loon + commissie, resultaat = gewogen − kost,
 * ROI = resultaat / kost, gewogen = projectwaarde × factor, incl. btw.
 */

export type ResultaatStat = {
  setter: { id: string; name: string; hourly_rate_cents: number; commission_pct: number }
  seconds: number; earnedCents: number; appointments: number; won: number; lost: number; open: number
  dealValueCents: number; commissionCents: number; totalCents: number; gewogenOmzetCents: number; resultaatCents: number; roi: number | null
  deals: { id: string; bedrijf: string; dealValueCents: number; tijdsbelasting: number | null; gewogenCents: number; commissionCents: number }[]
}
export type ResultaatPayout = { setterId: string; setterName: string; month: string; kind: 'hours' | 'commission'; amountCents: number; status: 'open' | 'paid'; paidAt: string | null }

export type ResultatenExportInvoer = {
  monthParam: string          // YYYY-MM-01
  stats: ResultaatStat[]
  payouts: ResultaatPayout[]
  isAdmin: boolean
  focusNaam?: string | null
}

const e = (cents: number) => Math.round(cents) / 100
const factorLabel = (f: number | null) => TIJDSBELASTING.find((t) => Math.abs(t.factor - (f ?? 1)) < 1e-9)?.label ?? (f === null ? 'Niet ingevuld' : String(f))

export function resultatenWerkmap(inv: ResultatenExportInvoer): Werkmap {
  const label = monthLabel(inv.monthParam)
  const filters = [{ label: 'Maand', waarde: label }]
  if (inv.focusNaam) filters.push({ label: 'Setter', waarde: inv.focusNaam })
  const werkmap: Werkmap = { bestandsnaam: `NextGenMedia_Resultaten_${inv.monthParam.slice(0, 7)}`, titel: `Verkoop — resultaten ${label}`, filters, bladen: [] }

  const totals = inv.stats.reduce((a, s) => ({ seconds: a.seconds + s.seconds, earned: a.earned + s.earnedCents, commission: a.commission + s.commissionCents, appointments: a.appointments + s.appointments, won: a.won + s.won, deal: a.deal + s.dealValueCents }),
    { seconds: 0, earned: 0, commission: 0, appointments: 0, won: 0, deal: 0 })

  const perSetter = {
    naam: 'Per setter', titel: `Per appointment setter — ${label}`,
    toelichting: ['Uren in decimalen (1,5 = anderhalf uur). Loon = uren × uurtarief; totaal = loon + commissie; resultaat = gewogen omzet − totaal; ROI = resultaat / totaal.'],
    blokken: [{
      soort: 'tabel' as const, titel: 'Setters',
      kolommen: [
        { kop: 'Setter' }, { kop: 'Uren', stijl: 'uren' as const }, { kop: 'Uurtarief', stijl: 'euro' as const }, { kop: 'Loon', stijl: 'euro' as const },
        { kop: 'Afspraken', stijl: 'aantal' as const }, { kop: 'Gewonnen', stijl: 'aantal' as const }, { kop: 'Verloren', stijl: 'aantal' as const }, { kop: 'Open', stijl: 'aantal' as const },
        { kop: 'Commissie %', stijl: 'getal' as const }, { kop: 'Commissie', stijl: 'euro' as const }, { kop: 'Totaal te betalen', stijl: 'euro' as const },
        { kop: 'Omzet eerste contracten', stijl: 'euro' as const }, { kop: 'Gewogen omzet', stijl: 'euro' as const }, { kop: 'Resultaat', stijl: 'euro' as const }, { kop: 'ROI', stijl: 'pct' as const },
      ],
      rijen: inv.stats.map((s) => [
        s.setter.name, { v: s.seconds / 3600, stijl: 'uren' as const }, euro(e(s.setter.hourly_rate_cents)), euro(e(s.earnedCents)),
        aantal(s.appointments), aantal(s.won), aantal(s.lost), aantal(s.open),
        getal(s.setter.commission_pct), euro(e(s.commissionCents)), formule('D{R}+J{R}', e(s.totalCents)),
        euro(e(s.dealValueCents)), euro(e(s.gewogenOmzetCents)), formule('M{R}-K{R}', e(s.resultaatCents)),
        formule('IF(K{R}>0,N{R}/K{R},"")', s.roi ?? ''),
      ] as Cel[]),
      totaal: ['Totaal', som('B', totals.seconds / 3600, 'totaal_uren'), null, som('D', e(totals.earned)), som('E', totals.appointments, 'totaal_aantal'), som('F', totals.won, 'totaal_aantal'), som('G', undefined, 'totaal_aantal'), som('H', undefined, 'totaal_aantal'),
        null, som('J', e(totals.commission)), som('K', e(totals.earned + totals.commission)), som('L', e(totals.deal)), som('M'), som('N'), formule('IF(SUM(K{R1}:K{R2})>0,SUM(N{R1}:N{R2})/SUM(K{R1}:K{R2}),"")', undefined, 'totaal_pct')],
      leeg: 'Nog geen cijfers voor deze maand.',
    }],
  }

  const deals = {
    naam: 'Gewonnen deals', titel: `Gewonnen deals — ${label}`,
    toelichting: ['Gewogen = projectwaarde × tijdsbelastingfactor (1 / 0,9 / 0,75 / 0,6 / 0,4).'],
    blokken: [{
      soort: 'tabel' as const, titel: 'Deals',
      kolommen: [{ kop: 'Bedrijf' }, { kop: 'Setter' }, { kop: 'Projectwaarde', stijl: 'euro' as const }, { kop: 'Tijdsbelasting' }, { kop: 'Factor', stijl: 'getal' as const }, { kop: 'Gewogen', stijl: 'euro' as const }, { kop: 'Commissie', stijl: 'euro' as const }],
      rijen: inv.stats.flatMap((s) => s.deals.map((d) => [d.bedrijf, s.setter.name, euro(e(d.dealValueCents)), factorLabel(d.tijdsbelasting), getal(d.tijdsbelasting ?? 1), formule('C{R}*E{R}', e(d.gewogenCents)), euro(e(d.commissionCents))] as Cel[])),
      totaal: ['Totaal', null, som('C'), null, null, som('F'), som('G')],
      leeg: 'Geen gewonnen deals deze maand.',
    }],
  }

  const uitbetalingen = {
    naam: 'Uitbetalingen', titel: `Uit te betalen — ${label}`,
    blokken: [{
      soort: 'tabel' as const, titel: 'Uitbetalingen',
      kolommen: [{ kop: 'Setter' }, { kop: 'Soort' }, { kop: 'Bedrag excl. btw', stijl: 'euro' as const }, { kop: 'Btw %', stijl: 'getal' as const }, { kop: 'Incl. btw', stijl: 'euro' as const }, { kop: 'Status' }, { kop: 'Betaald op' }],
      rijen: inv.payouts.map((p) => [p.setterName, p.kind === 'hours' ? 'Uren' : 'Commissie', euro(e(p.amountCents)), getal(VAT_PCT), formule('C{R}*(1+D{R}/100)', Math.round(p.amountCents * (1 + VAT_PCT / 100)) / 100), p.status === 'paid' ? 'Betaald' : 'Open', p.paidAt ? p.paidAt.slice(0, 10) : ''] as Cel[]),
      totaal: ['Totaal', null, som('C'), null, som('E'), null, null],
      leeg: inv.isAdmin ? 'Geen uitbetalingen deze maand.' : 'Uitbetalingen zijn enkel zichtbaar voor beheerders.',
    }],
  }

  const samenvatting = {
    naam: 'Samenvatting', titel: `Resultaten — ${label}`,
    blokken: [{
      soort: 'kpis' as const, titel: 'Kerncijfers',
      items: [
        { label: 'Gebeld (uren)', waarde: { v: totals.seconds / 3600, stijl: 'uren' as const } },
        { label: 'Loon voor gebelde uren', waarde: euro(e(totals.earned)) },
        { label: 'Afspraken', waarde: aantal(totals.appointments) },
        { label: 'Gewonnen', waarde: aantal(totals.won) },
        { label: 'Omzet eerste contracten', waarde: euro(e(totals.deal)) },
        { label: 'Commissie', waarde: euro(e(totals.commission)) },
        { label: 'Te betalen (loon + commissie)', waarde: euro(e(totals.earned + totals.commission)) },
        { label: 'Aandeel commissie in omzet', waarde: totals.deal > 0 ? pct(totals.commission / totals.deal) : '—' },
      ],
    }],
  }

  werkmap.bladen = [samenvatting, perSetter, deals, uitbetalingen]
  return werkmap
}
