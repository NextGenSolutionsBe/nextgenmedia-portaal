import { percentage, type Statistieken, type Groep, type SectorInteresse } from '@/lib/sales/statistieken'
import { type Werkmap, type Cel, type TabelBlok, euro, formule, som, aantal, pct } from '../spec'

/**
 * Excel-export van Verkoop → Statistieken. Percentages zijn formules op de
 * aantallen ernaast (boeking = afspraken / gesprekken, opkomst = doorgegaan /
 * afspraken, sluiting = gewonnen / (gewonnen + verloren), open afspraken tellen niet mee), met IFERROR voor lege noemers —
 * dezelfde definities als `percentage()` op het scherm.
 */

export type StatistiekenExportInvoer = {
  stats: Statistieken
  bereik: { van: string; tot: string }
  setterNaam?: string | null
  sector?: string | null
  leadInteresse?: { perSector: SectorInteresse[]; redenen: { reden: string; aantal: number }[] } | null
  isAdmin: boolean
}

const p = (deel: number, geheel: number) => { const x = percentage(deel, geheel); return x === null ? '' : x / 100 }

function groepTabel(titel: string, eersteKop: string, groepen: Groep[], leeg: string): TabelBlok {
  return {
    soort: 'tabel', titel,
    kolommen: [
      { kop: eersteKop }, { kop: 'Gesprekken', stijl: 'aantal' }, { kop: 'Unieke leads', stijl: 'aantal' }, { kop: 'Afspraken', stijl: 'aantal' }, { kop: 'Boeking', stijl: 'pct' },
      { kop: 'Doorgegaan', stijl: 'aantal' }, { kop: 'Opkomst', stijl: 'pct' }, { kop: 'No-shows', stijl: 'aantal' }, { kop: 'Geannuleerd', stijl: 'aantal' },
      { kop: 'Gewonnen', stijl: 'aantal' }, { kop: 'Verloren', stijl: 'aantal' }, { kop: 'Open', stijl: 'aantal' }, { kop: 'Sluiting', stijl: 'pct' }, { kop: 'Contractwaarde', stijl: 'euro' },
    ],
    rijen: groepen.map((g) => [
      g.label, aantal(g.gesprekken), aantal(g.leadsGebeld), aantal(g.afspraken), formule('IFERROR(D{R}/B{R},"")', p(g.afspraken, g.gesprekken)),
      aantal(g.doorgegaan), formule('IFERROR(F{R}/D{R},"")', p(g.doorgegaan, g.afspraken)), aantal(g.noShows), aantal(g.geannuleerd),
      aantal(g.gewonnen), aantal(g.verloren), aantal(g.open), formule('IFERROR(J{R}/(J{R}+K{R}),"")', p(g.gewonnen, g.gewonnen + g.verloren)), euro(g.dealWaardeCent / 100),
    ] as Cel[]),
    totaal: ['Totaal', som('B', undefined, 'totaal_aantal'), som('C', undefined, 'totaal_aantal'), som('D', undefined, 'totaal_aantal'), formule('IFERROR(SUM(D{R1}:D{R2})/SUM(B{R1}:B{R2}),"")', undefined, 'totaal_pct'),
      som('F', undefined, 'totaal_aantal'), formule('IFERROR(SUM(F{R1}:F{R2})/SUM(D{R1}:D{R2}),"")', undefined, 'totaal_pct'), som('H', undefined, 'totaal_aantal'), som('I', undefined, 'totaal_aantal'),
      som('J', undefined, 'totaal_aantal'), som('K', undefined, 'totaal_aantal'), som('L', undefined, 'totaal_aantal'), formule('IFERROR(SUM(J{R1}:J{R2})/(SUM(J{R1}:J{R2})+SUM(K{R1}:K{R2})),"")', undefined, 'totaal_pct'), som('N')],
    leeg,
  }
}

export function statistiekenWerkmap(inv: StatistiekenExportInvoer): Werkmap {
  const t = inv.stats.totaal
  const filters = [{ label: 'Periode', waarde: `${inv.bereik.van} t.e.m. ${inv.bereik.tot}` }]
  if (inv.setterNaam) filters.push({ label: 'Setter', waarde: inv.setterNaam })
  if (inv.sector) filters.push({ label: 'Sector', waarde: inv.sector })
  const werkmap: Werkmap = { bestandsnaam: `NextGenMedia_Statistieken_${inv.bereik.van}_${inv.bereik.tot}`, titel: 'Verkoop — statistieken', filters, bladen: [] }

  const samenvatting = {
    naam: 'Samenvatting', titel: 'Statistieken — trechter',
    blokken: [
      {
        soort: 'kpis' as const, titel: 'Kerncijfers',
        items: [
          { label: 'Gesprekken', waarde: aantal(t.gesprekken), toelichting: `${t.leadsGebeld} unieke leads` },
          { label: 'Afspraken', waarde: aantal(t.afspraken), toelichting: `${t.geannuleerd} geannuleerd` },
          { label: 'Boekingsratio (afspraken / gesprekken)', waarde: pct(p(t.afspraken, t.gesprekken)) },
          { label: 'Opkomst (doorgegaan / afspraken)', waarde: pct(p(t.doorgegaan, t.afspraken)), toelichting: `${t.noShows} no-shows` },
          { label: 'Sluitingsratio (gewonnen / besliste afspraken)', waarde: pct(p(t.gewonnen, t.gewonnen + t.verloren)), toelichting: `${t.gewonnen} gewonnen · ${t.verloren} verloren · ${t.open} open` },
          { label: 'Contractwaarde gewonnen deals', waarde: euro(t.dealWaardeCent / 100) },
        ],
      },
      {
        soort: 'tabel' as const, titel: 'Trechter',
        kolommen: [{ kop: 'Stap' }, { kop: 'Aantal', stijl: 'aantal' as const }, { kop: 'T.o.v. gesprekken', stijl: 'pct' as const }],
        rijen: [
          ['Gesprekken', aantal(t.gesprekken), null],
          ['Unieke leads gebeld', aantal(t.leadsGebeld), formule('IFERROR(B{R}/B{R1},"")', p(t.leadsGebeld, t.gesprekken))],
          ['Afspraken geboekt', aantal(t.afspraken), formule('IFERROR(B{R}/B{R1},"")', p(t.afspraken, t.gesprekken))],
          ['Afspraak doorgegaan', aantal(t.doorgegaan), formule('IFERROR(B{R}/B{R1},"")', p(t.doorgegaan, t.gesprekken))],
          ['Gewonnen', aantal(t.gewonnen), formule('IFERROR(B{R}/B{R1},"")', p(t.gewonnen, t.gesprekken))],
        ] as Cel[][],
        filter: false,
      },
    ],
  }

  const groepen = {
    naam: 'Per setter-sector-bron', titel: 'Per setter, sector en bron',
    blokken: [
      ...(inv.isAdmin ? [groepTabel('Per setter', 'Setter', inv.stats.perSetter, 'Geen gegevens.')] : []),
      groepTabel('Per sector', 'Sector', inv.stats.perSector, 'Geen gegevens.'),
      groepTabel('Per bron', 'Bron', inv.stats.perBron, 'Geen gegevens.'),
    ],
  }

  const verloop = {
    naam: 'Verloop', titel: 'Verloop in de tijd',
    blokken: [
      {
        soort: 'tabel' as const, titel: 'Per maand',
        kolommen: [{ kop: 'Maand' }, { kop: 'Gesprekken', stijl: 'aantal' as const }, { kop: 'Afspraken', stijl: 'aantal' as const }, { kop: 'Gewonnen', stijl: 'aantal' as const }, { kop: 'Boeking', stijl: 'pct' as const }],
        rijen: inv.stats.perMaand.map((m) => [m.maand, aantal(m.gesprekken), aantal(m.afspraken), aantal(m.gewonnen), formule('IFERROR(C{R}/B{R},"")', p(m.afspraken, m.gesprekken))] as Cel[]),
        totaal: ['Totaal', som('B', undefined, 'totaal_aantal'), som('C', undefined, 'totaal_aantal'), som('D', undefined, 'totaal_aantal'), formule('IFERROR(SUM(C{R1}:C{R2})/SUM(B{R1}:B{R2}),"")', undefined, 'totaal_pct')],
        filter: false,
      },
      {
        soort: 'tabel' as const, titel: 'Per weekdag',
        kolommen: [{ kop: 'Dag' }, { kop: 'Gesprekken', stijl: 'aantal' as const }, { kop: 'Afspraken', stijl: 'aantal' as const }, { kop: 'Boeking', stijl: 'pct' as const }],
        rijen: inv.stats.perWeekdag.map((d) => [d.dag, aantal(d.gesprekken), aantal(d.afspraken), formule('IFERROR(C{R}/B{R},"")', p(d.afspraken, d.gesprekken))] as Cel[]),
        filter: false,
      },
      {
        soort: 'tabel' as const, titel: 'Per uur',
        kolommen: [{ kop: 'Uur', stijl: 'aantal' as const }, { kop: 'Gesprekken', stijl: 'aantal' as const }, { kop: 'Afspraken', stijl: 'aantal' as const }, { kop: 'Boeking', stijl: 'pct' as const }],
        rijen: inv.stats.perUur.map((u) => [aantal(u.uur), aantal(u.gesprekken), aantal(u.afspraken), formule('IFERROR(C{R}/B{R},"")', p(u.afspraken, u.gesprekken))] as Cel[]),
        filter: false,
      },
    ],
  }

  const redenen = {
    naam: 'Interesse en redenen', titel: 'Interesse per sector en redenen',
    blokken: [
      {
        soort: 'tabel' as const, titel: 'Interesse per sector — hele pipeline',
        kolommen: [{ kop: 'Sector' }, { kop: 'Leads', stijl: 'aantal' as const }, { kop: 'Interesse', stijl: 'aantal' as const }, { kop: '% interesse', stijl: 'pct' as const }, { kop: 'Geen interesse', stijl: 'aantal' as const }, { kop: 'Nog bezig', stijl: 'aantal' as const }],
        rijen: (inv.leadInteresse?.perSector ?? []).map((s) => [s.sector, aantal(s.totaal), aantal(s.interesse), formule('IFERROR(C{R}/B{R},"")', p(s.interesse, s.totaal)), aantal(s.geenInteresse), aantal(s.bezig)] as Cel[]),
        totaal: ['Totaal', som('B', undefined, 'totaal_aantal'), som('C', undefined, 'totaal_aantal'), formule('IFERROR(SUM(C{R1}:C{R2})/SUM(B{R1}:B{R2}),"")', undefined, 'totaal_pct'), som('E', undefined, 'totaal_aantal'), som('F', undefined, 'totaal_aantal')],
        leeg: 'Geen gegevens.',
      },
      {
        soort: 'tabel' as const, titel: 'Afwijsredenen (pipeline)',
        kolommen: [{ kop: 'Reden' }, { kop: 'Aantal', stijl: 'aantal' as const }, { kop: 'Aandeel', stijl: 'pct' as const }],
        rijen: (inv.leadInteresse?.redenen ?? []).map((r) => [r.reden, aantal(r.aantal), formule('IFERROR(B{R}/SUM(B{R1}:B{R2}),"")')] as Cel[]),
        totaal: ['Totaal', som('B', undefined, 'totaal_aantal'), null],
        leeg: 'Geen afwijsredenen.',
      },
      {
        soort: 'tabel' as const, titel: 'Verliesredenen (afspraken)',
        kolommen: [{ kop: 'Reden' }, { kop: 'Aantal', stijl: 'aantal' as const }, { kop: 'Aandeel', stijl: 'pct' as const }],
        rijen: inv.stats.verliesredenen.map((r) => [r.reden, aantal(r.aantal), formule('IFERROR(B{R}/SUM(B{R1}:B{R2}),"")')] as Cel[]),
        totaal: ['Totaal', som('B', undefined, 'totaal_aantal'), null],
        leeg: 'Geen verliesredenen.',
      },
    ],
  }

  werkmap.bladen = [samenvatting, groepen, verloop, redenen]
  return werkmap
}
