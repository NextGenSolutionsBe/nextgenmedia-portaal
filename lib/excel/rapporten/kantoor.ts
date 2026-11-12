import { SOORTEN, STATUSSEN, type ZichtbareOpdracht, type Samenvatting } from '@/lib/kantoor/model'
import { type Werkmap, type Cel, euro, formule, som, aantal, datum, getal } from '../spec'

/**
 * Excel-export van het Kantoor: precies de opdrachten die het actieve bedrijf
 * mag zien (de server heeft al gefilterd; bedragen die hier ontbreken zijn
 * nooit verstuurd). Bedragen in cent → euro.
 */

export type KantoorExportInvoer = {
  bedrijfNaam: string
  rijen: ZichtbareOpdracht[]          // na zoekfilter
  alleRijen: ZichtbareOpdracht[]
  cijfers: Samenvatting | null
  zoekterm?: string
}

const e = (c: number | null) => (c === null ? null : Math.round(c) / 100)

export function kantoorWerkmap(inv: KantoorExportInvoer): Werkmap {
  const filters = [{ label: 'Bedrijf', waarde: inv.bedrijfNaam }]
  if (inv.zoekterm) filters.push({ label: 'Zoekterm', waarde: inv.zoekterm })
  const werkmap: Werkmap = { bestandsnaam: 'NextGenMedia_Kantoor', titel: `Kantoor — ${inv.bedrijfNaam}`, filters, bladen: [] }

  const soort = (k: string) => SOORTEN.find((s) => s.key === k)?.label ?? k
  const status = (k: string) => STATUSSEN.find((s) => s.key === k)?.label ?? k

  const opdrachten = {
    naam: 'Samenwerkingen', titel: `Samenwerkingen — ${inv.bedrijfNaam}`,
    toelichting: ['"Mijn bedrag" = wat dit bedrijf aan de opdracht overhoudt (ontvangt of betaalt). Een leeg totaal of lege marge betekent: niet zichtbaar voor dit bedrijf.'],
    blokken: [{
      soort: 'tabel' as const, titel: 'Opdrachten',
      kolommen: [
        { kop: 'Titel' }, { kop: 'Klant' }, { kop: 'Soort' }, { kop: 'Tegenpartij' }, { kop: 'Richting' }, { kop: 'Status' },
        { kop: 'Totaal', stijl: 'euro' as const }, { kop: 'Vergoeding %', stijl: 'getal' as const }, { kop: 'Vergoeding', stijl: 'euro' as const }, { kop: 'Marge', stijl: 'euro' as const }, { kop: 'Mijn bedrag', stijl: 'euro' as const },
        { kop: 'Aangemaakt', stijl: 'datum' as const }, { kop: 'Afgerond op', stijl: 'datum' as const }, { kop: 'Omschrijving' },
      ],
      rijen: inv.rijen.map((o) => [
        o.titel, o.klant_naam ?? '', soort(o.soort), o.tegenpartij_naam, o.ik_ontvang ? 'Ik ontvang' : 'Ik betaal', status(o.status),
        e(o.totaal_cents) === null ? null : euro(e(o.totaal_cents)), o.vergoeding_pct === null ? null : getal(o.vergoeding_pct), euro(e(o.vergoeding_cents)),
        o.marge_cents === null ? null : euro(e(o.marge_cents)), euro(e(o.mijn_bedrag_cents)),
        datum(o.created_at?.slice(0, 10)), datum(o.afgerond_op), o.omschrijving ?? '',
      ] as Cel[]),
      totaal: ['Totaal', null, null, null, null, null, som('G'), null, som('I'), som('J'), som('K'), null, null, null],
      leeg: 'Geen samenwerkingen voor deze selectie.',
    }],
  }

  const c = inv.cijfers
  const samenvatting = {
    naam: 'Samenvatting', titel: `Kantoor — ${inv.bedrijfNaam}`,
    blokken: [
      {
        soort: 'kpis' as const, titel: 'Kerncijfers (alle samenwerkingen van dit bedrijf)',
        items: [
          { label: 'Verdiend (afgerond)', waarde: euro(e(c?.verdiendCents ?? 0)) },
          { label: 'Staat nog open (lopend)', waarde: euro(e(c?.openCents ?? 0)) },
          { label: 'Lopende samenwerkingen', waarde: aantal(c?.aantalLopend ?? inv.alleRijen.filter((o) => o.status === 'lopend').length) },
          { label: 'Afgeronde samenwerkingen', waarde: aantal(c?.aantalAfgerond ?? inv.alleRijen.filter((o) => o.status === 'afgerond').length) },
          { label: 'Geëxporteerde rijen', waarde: formule(`COUNTA('Samenwerkingen'!A:A)-COUNTA('Samenwerkingen'!A1:A${8 + filters.length})`, inv.rijen.length), stijl: 'aantal' as const },
        ],
      },
      {
        soort: 'tabel' as const, titel: 'Per partner',
        kolommen: [{ kop: 'Partner' }, { kop: 'Verdiend', stijl: 'euro' as const }, { kop: 'Open', stijl: 'euro' as const }, { kop: 'Aantal', stijl: 'aantal' as const }],
        rijen: (c?.perPartner ?? []).map((p) => [p.naam, euro(e(p.verdiendCents)), euro(e(p.openCents)), aantal(p.aantal)] as Cel[]),
        totaal: ['Totaal', som('B'), som('C'), som('D', undefined, 'totaal_aantal')],
        leeg: 'Nog geen partners.',
      },
    ],
  }

  werkmap.bladen = [samenvatting, opdrachten]
  return werkmap
}
