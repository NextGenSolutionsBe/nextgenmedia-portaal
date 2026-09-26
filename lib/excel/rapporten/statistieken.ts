import { percentage, type Cijfers, type Rij, type Statistieken } from '@/lib/sales/statistieken'
import { type Werkmap, type Cel, type TabelBlok, euro, formule, aantal, getal, pct } from '../spec'

/**
 * Excel-export van Verkoop → Statistieken (salesactiviteiten).
 *
 * Ratio's zijn formules op de aantallen ernaast, met IFERROR voor een lege
 * noemer — dezelfde definities als op het scherm:
 *   gemiddelde duur   = beltijd ÷ gesprekken MET duur
 *   closing rate      = gewonnen ÷ (gewonnen + verloren)
 *   appointment rate  = leads met afspraak ÷ leads met geslaagd contact
 *   contact rate      = leads met geslaagd contact ÷ unieke behandelde leads
 * "Beltijd (min)" = totale GESPREKSDUUR (som van de duur per gesprek);
 * "Gelogde beltijd (min)" = som van de belsessies. Nooit opgeteld.
 * De totaalrij bevat de TEAMcijfers (unieke leads zijn niet op te tellen over
 * medewerkers heen: één lead kan door twee mensen behandeld zijn).
 */

export type StatistiekenExportInvoer = {
  stats: Statistieken
  bereik: { van: string; tot: string }
  medewerkerNaam?: string | null
  filters?: { label: string; waarde: string }[]
  isAdmin: boolean
}

const p = (deel: number, geheel: number) => { const x = percentage(deel, geheel); return x === null ? '' : x / 100 }
const minuten = (sec: number) => Math.round((sec / 60) * 10) / 10
const gelogd = (c: Cijfers) => (c.gelogdeBeltijdSeconden === null || c.gelogdeBeltijdSeconden === undefined ? '' : minuten(c.gelogdeBeltijdSeconden))

function rijCellen(label: string, c: Cijfers): Cel[] {
  return [
    label,
    aantal(c.telefoongesprekken),
    aantal(c.gesprekkenMetDuur),
    getal(minuten(c.beltijdSeconden)),
    formule('IFERROR(D{R}/C{R},"")', c.gemiddeldeDuurSeconden === null ? '' : minuten(c.gemiddeldeDuurSeconden), 'getal'),
    aantal(c.emails),
    aantal(c.uniekeLeads),
    aantal(c.opvolgingen),
    aantal(c.afspraken),
    aantal(c.voorstellen),
    aantal(c.gewonnen),
    aantal(c.verloren),
    formule('IFERROR(K{R}/(K{R}+L{R}),"")', p(c.gewonnen, c.gewonnen + c.verloren), 'pct'),
    aantal(c.leadsMetContact),
    aantal(c.leadsMetAfspraak),
    formule('IFERROR(O{R}/N{R},"")', p(c.leadsMetAfspraak, c.leadsMetContact), 'pct'),
    formule('IFERROR(N{R}/G{R},"")', p(c.leadsMetContact, c.uniekeLeads), 'pct'),
    euro(c.waardeGewonnenCent / 100),
    getal(gelogd(c)),
  ]
}

function totaalCellen(c: Cijfers): Cel[] {
  return [
    'Team',
    { v: c.telefoongesprekken, stijl: 'totaal_aantal' },
    { v: c.gesprekkenMetDuur, stijl: 'totaal_aantal' },
    { v: minuten(c.beltijdSeconden), stijl: 'totaal_getal' },
    { v: c.gemiddeldeDuurSeconden === null ? '' : minuten(c.gemiddeldeDuurSeconden), stijl: 'totaal_getal' },
    { v: c.emails, stijl: 'totaal_aantal' },
    { v: c.uniekeLeads, stijl: 'totaal_aantal' },
    { v: c.opvolgingen, stijl: 'totaal_aantal' },
    { v: c.afspraken, stijl: 'totaal_aantal' },
    { v: c.voorstellen, stijl: 'totaal_aantal' },
    { v: c.gewonnen, stijl: 'totaal_aantal' },
    { v: c.verloren, stijl: 'totaal_aantal' },
    { v: p(c.gewonnen, c.gewonnen + c.verloren), stijl: 'totaal_pct' },
    { v: c.leadsMetContact, stijl: 'totaal_aantal' },
    { v: c.leadsMetAfspraak, stijl: 'totaal_aantal' },
    { v: p(c.leadsMetAfspraak, c.leadsMetContact), stijl: 'totaal_pct' },
    { v: p(c.leadsMetContact, c.uniekeLeads), stijl: 'totaal_pct' },
    { v: c.waardeGewonnenCent / 100, stijl: 'totaal_euro' },
    { v: gelogd(c), stijl: 'totaal_getal' },
  ]
}

const KOLOMMEN = (eerste: string): TabelBlok['kolommen'] => [
  { kop: eerste },
  { kop: 'Telefoongesprekken', stijl: 'aantal' },
  { kop: 'Gesprekken met duur', stijl: 'aantal' },
  { kop: 'Gespreksduur (min)', stijl: 'getal' },
  { kop: 'Gem. gespreksduur (min)', stijl: 'getal' },
  { kop: 'E-mails', stijl: 'aantal' },
  { kop: 'Unieke leads', stijl: 'aantal' },
  { kop: 'Opvolgingen', stijl: 'aantal' },
  { kop: 'Afspraken', stijl: 'aantal' },
  { kop: 'Voorstellen', stijl: 'aantal' },
  { kop: 'Gewonnen', stijl: 'aantal' },
  { kop: 'Verloren', stijl: 'aantal' },
  { kop: 'Closing rate', stijl: 'pct' },
  { kop: 'Leads met contact', stijl: 'aantal' },
  { kop: 'Leads met afspraak', stijl: 'aantal' },
  { kop: 'Appointment setting rate', stijl: 'pct' },
  { kop: 'Contact rate', stijl: 'pct' },
  { kop: 'Waarde gewonnen deals', stijl: 'euro' },
  // Achteraan, zodat de formules hierboven (kolomletters) niet verschuiven.
  { kop: 'Gelogde beltijd (min)', stijl: 'getal' },
]

function tabel(titel: string, eerste: string, rijen: Rij[], team: Cijfers): TabelBlok {
  return {
    soort: 'tabel', titel, kolommen: KOLOMMEN(eerste),
    rijen: rijen.map((r) => rijCellen(r.label, r)),
    totaal: totaalCellen(team),
    leeg: 'Geen activiteiten in deze periode.',
  }
}

export function statistiekenWerkmap(inv: StatistiekenExportInvoer): Werkmap {
  const t = inv.stats.team
  const filters = [{ label: 'Periode', waarde: `${inv.bereik.van} t.e.m. ${inv.bereik.tot}` }]
  if (inv.medewerkerNaam) filters.push({ label: 'Medewerker', waarde: inv.medewerkerNaam })
  for (const f of inv.filters ?? []) filters.push(f)
  const werkmap: Werkmap = {
    bestandsnaam: `NextGenMedia_Salesstatistieken_${inv.bereik.van}_${inv.bereik.tot}`,
    titel: 'Verkoop — statistieken', filters, bladen: [],
  }

  const samenvatting = {
    naam: 'Samenvatting', titel: 'Teamtotalen',
    blokken: [
      {
        soort: 'kpis' as const, titel: 'Kerncijfers',
        items: [
          { label: 'Telefoongesprekken', waarde: aantal(t.telefoongesprekken), toelichting: `${t.uniekeLeads} unieke leads behandeld` },
          { label: 'Gelogde beltijd (min)', waarde: getal(gelogd(t)), toelichting: 'belsessies (start/stop of handmatig)' },
          { label: 'Totale gespreksduur (min)', waarde: getal(minuten(t.beltijdSeconden)), toelichting: 'som van de duur per gesprek' },
          { label: 'Gemiddelde gespreksduur (min)', waarde: getal(t.gemiddeldeDuurSeconden === null ? '' : minuten(t.gemiddeldeDuurSeconden)), toelichting: `over ${t.gesprekkenMetDuur} gesprekken met duur` },
          { label: 'E-mails', waarde: aantal(t.emails) },
          { label: 'Opvolgingen', waarde: aantal(t.opvolgingen) },
          { label: 'Geplande afspraken', waarde: aantal(t.afspraken) },
          { label: 'Voorstellen', waarde: aantal(t.voorstellen) },
          { label: 'Gewonnen / verloren', waarde: `${t.gewonnen} / ${t.verloren}` },
          { label: 'Closing rate', waarde: pct(p(t.gewonnen, t.gewonnen + t.verloren)) },
          { label: 'Appointment setting rate', waarde: pct(p(t.leadsMetAfspraak, t.leadsMetContact)) },
          { label: 'Contact rate', waarde: pct(p(t.leadsMetContact, t.uniekeLeads)) },
          { label: 'Waarde gewonnen deals', waarde: euro(t.waardeGewonnenCent / 100) },
        ],
      },
      ...(inv.stats.vergelijking.length ? [{
        soort: 'tabel' as const, titel: 'Vergelijking',
        kolommen: [{ kop: 'Wat' }, { kop: 'Wie' }, { kop: 'Waarde' }],
        rijen: inv.stats.vergelijking.map((v) => [v.titel, v.naam, v.waarde] as Cel[]),
        filter: false,
      }] : []),
    ],
  }

  const perMedewerker = {
    naam: 'Per medewerker', titel: 'Per medewerker',
    blokken: [tabel('Per medewerker', 'Medewerker', inv.stats.perMedewerker, t)],
  }
  const perBron = {
    naam: 'Per leadbron', titel: 'Resultaten per leadbron',
    blokken: [tabel('Per leadbron', 'Leadbron', inv.stats.perLeadbron, t)],
  }
  const trend = {
    naam: 'Trend', titel: `Trend per ${inv.stats.trendPer}`,
    blokken: [{
      soort: 'tabel' as const, titel: `Per ${inv.stats.trendPer}`,
      kolommen: [
        { kop: inv.stats.trendPer === 'week' ? 'Week van' : inv.stats.trendPer === 'maand' ? 'Maand' : 'Dag' },
        { kop: 'Telefoongesprekken', stijl: 'aantal' as const }, { kop: 'E-mails', stijl: 'aantal' as const },
        { kop: 'Afspraken', stijl: 'aantal' as const }, { kop: 'Gewonnen', stijl: 'aantal' as const },
      ],
      rijen: inv.stats.trend.map((r) => [r.sleutel, aantal(r.telefoongesprekken), aantal(r.emails), aantal(r.afspraken), aantal(r.gewonnen)] as Cel[]),
      leeg: 'Geen activiteiten in deze periode.',
      filter: false,
    }],
  }

  werkmap.bladen = inv.isAdmin ? [samenvatting, perMedewerker, perBron, trend] : [samenvatting, perBron, trend]
  return werkmap
}
