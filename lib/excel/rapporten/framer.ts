import { type Werkmap, type Cel, type TabelBlok, euro, formule, som, aantal, datum, getal } from '../spec'

/**
 * Excel-export van Financiën → Framer: de sites zoals het scherm ze toont,
 * met "per maand" als formule (jaarlijks gefactureerd = bedrag / 12).
 */

export type FramerSite = {
  naam: string; client_naam: string | null; site_url: string | null; plan: string | null
  bedrag_excl: number; vat_pct: number; facturatie: 'monthly' | 'annual'
  renew_op: string | null; opgezegd_op: string | null; notitie: string | null
  volgende_verlenging: string | null; dagen_tot: number | null; per_maand: number
}

export type FramerExportInvoer = { lopend: FramerSite[]; gestopt: FramerSite[]; perMaandTotaal: number }

function tabel(titel: string, sites: FramerSite[], leeg: string): TabelBlok {
  return {
    soort: 'tabel', titel,
    kolommen: [
      { kop: 'Site' }, { kop: 'Klant' }, { kop: 'URL' }, { kop: 'Plan' }, { kop: 'Facturatie' },
      { kop: 'Bedrag excl. btw', stijl: 'euro' }, { kop: 'Btw %', stijl: 'getal' }, { kop: 'Incl. btw', stijl: 'euro' }, { kop: 'Per maand', stijl: 'euro' }, { kop: 'Per jaar', stijl: 'euro' },
      { kop: 'Verlengt op', stijl: 'datum' }, { kop: 'Dagen tot', stijl: 'aantal' }, { kop: 'Opgezegd op', stijl: 'datum' }, { kop: 'Notitie' },
    ],
    rijen: sites.map((s) => [
      s.naam, s.client_naam ?? '', s.site_url ?? '', s.plan ?? '', s.facturatie === 'annual' ? 'Jaarlijks' : 'Maandelijks',
      euro(s.bedrag_excl), getal(s.vat_pct), formule('F{R}*(1+G{R}/100)', Math.round(s.bedrag_excl * (1 + s.vat_pct / 100) * 100) / 100),
      formule('IF(E{R}="Jaarlijks",F{R}/12,F{R})', s.per_maand), formule('I{R}*12', s.per_maand * 12),
      datum(s.volgende_verlenging), s.dagen_tot === null ? null : aantal(s.dagen_tot), datum(s.opgezegd_op), s.notitie ?? '',
    ] as Cel[]),
    totaal: ['Totaal', null, null, null, null, som('F'), null, som('H'), som('I'), som('J'), null, null, null, null],
    leeg,
  }
}

export function framerWerkmap(inv: FramerExportInvoer): Werkmap {
  return {
    bestandsnaam: 'NextGenMedia_Framer_sites', titel: 'Financiën — Framer-sites',
    bladen: [{
      naam: 'Framer-sites', titel: 'Framer-sites',
      toelichting: [`Lopend: ${inv.lopend.length} sites · € ${Math.round(inv.perMaandTotaal)} per maand · € ${Math.round(inv.perMaandTotaal * 12)} per jaar.`],
      blokken: [
        tabel('Lopende sites', inv.lopend, 'Geen lopende sites.'),
        tabel('Gestopte sites', inv.gestopt, 'Geen gestopte sites.'),
      ],
    }],
  }
}
