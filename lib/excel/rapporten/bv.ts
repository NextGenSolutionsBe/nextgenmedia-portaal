import {
  PERSOON_LABEL, RECHT_TYPES, BETAALD_DOOR_LABEL, STATUUT_LABEL,
  type Recht, type Kost, type Winstverdeling, type Aannames, type EzInvoer, type EzRaming,
  type RechtenPerPersoon, type Kerncijfers, type VerdelingBerekend,
} from '@/lib/bv-transitie'
import { type Werkmap, type Cel, euro, pct, formule, som, aantal, datum, getal } from '../spec'

/**
 * Excel-export van de BV-transitie, uit dezelfde berekende waarden als het
 * scherm (lib/bv-transitie.ts). Effecten, btw, incl., netto pot en saldo zijn
 * formules; de fiscale raming (schijven, bijdragen) staat als waarden, want
 * die volgt een trapsgewijze berekening die het scherm al gedaan heeft.
 */

export type BvExportInvoer = {
  jaar: number
  rechten: Recht[]; kosten: Kost[]; verdeling: Winstverdeling[]; aannames: Aannames
  ezInvoer: EzInvoer[]; perPersoon: RechtenPerPersoon[]; kern: Kerncijfers
  vd: { personen: VerdelingBerekend[]; totaalPot: number }; ez: EzRaming[]
}

export function bvWerkmap(inv: BvExportInvoer): Werkmap {
  const werkmap: Werkmap = { bestandsnaam: `NextGenMedia_BV-transitie_${inv.jaar}`, titel: `BV-transitie ${inv.jaar}`, filters: [{ label: 'Jaar', waarde: String(inv.jaar) }], bladen: [] }
  const typeLabel = (t: string) => RECHT_TYPES.find((x) => x.type === t)?.label ?? t

  const overzicht = {
    naam: 'Overzicht', titel: 'BV-transitie — overzicht',
    blokken: [
      {
        soort: 'kpis' as const, titel: 'Kerncijfers',
        items: [
          { label: 'Totaal rechten', waarde: euro(inv.kern.totaalRechten) },
          { label: 'Opstartkosten', waarde: euro(inv.kern.opstartkosten) },
          { label: 'Privé verrekend', waarde: euro(inv.kern.priveVerrekend) },
          { label: 'Niet toegewezen', waarde: euro(inv.kern.nietToegewezen) },
        ],
      },
      {
        soort: 'tabel' as const, titel: 'Per persoon',
        kolommen: [{ kop: 'Persoon' }, { kop: 'Bruto rechten', stijl: 'euro' as const }, { kop: 'Privé voordelen via BV', stijl: 'euro' as const }, { kop: 'Netto recht in BV', stijl: 'euro' as const }, { kop: 'EZ-winst', stijl: 'euro' as const }, { kop: 'Sociale bijdrage', stijl: 'euro' as const }, { kop: 'EZ-belasting', stijl: 'euro' as const }, { kop: 'Netto na reservering', stijl: 'euro' as const }],
        rijen: inv.perPersoon.map((p) => {
          const e = inv.ez.find((x) => x.persoon === p.persoon)
          return [PERSOON_LABEL[p.persoon], euro(p.bruto), euro(p.priveVoordelen), formule('B{R}+C{R}', p.netto), euro(e?.winst ?? 0), euro(e?.socialeBijdragen ?? 0), euro(e?.ezBelasting ?? 0), euro(e?.netto ?? 0)] as Cel[]
        }),
        totaal: ['Totaal', som('B'), som('C'), som('D'), som('E'), som('F'), som('G'), som('H')],
        filter: false,
      },
    ],
  }

  const rechten = {
    naam: 'Rechtenbalans', titel: 'Rechtenbalans',
    toelichting: ['Effect = bedrag × richting (+1 recht opgebouwd, −1 recht verminderd).'],
    blokken: [{
      soort: 'tabel' as const, titel: 'Regels',
      kolommen: [{ kop: 'Datum', stijl: 'datum' as const }, { kop: 'Persoon' }, { kop: 'Type' }, { kop: 'Omschrijving' }, { kop: 'Bedrag excl.', stijl: 'euro' as const }, { kop: 'Richting', stijl: 'getal' as const }, { kop: 'Effect', stijl: 'euro' as const }, { kop: 'Bewijs' }, { kop: 'Notitie' }],
      rijen: inv.rechten.map((r) => [datum(r.datum), PERSOON_LABEL[r.persoon], typeLabel(r.type), r.omschrijving ?? '', euro(r.bedrag_excl), getal(r.richting), formule('E{R}*F{R}', r.bedrag_excl * r.richting), r.bewijs ?? '', r.notitie ?? ''] as Cel[]),
      totaal: ['Totaal', null, null, null, som('E'), null, som('G'), null, null],
      leeg: 'Nog geen regels.',
    }],
  }

  const kosten = {
    naam: 'BV-kosten', titel: 'BV-kosten',
    toelichting: ['Effect op recht = −bedrag excl. wanneer de kost met iemand verrekend wordt.'],
    blokken: [{
      soort: 'tabel' as const, titel: 'Kosten',
      kolommen: [{ kop: 'Datum', stijl: 'datum' as const }, { kop: 'Leverancier' }, { kop: 'Categorie' }, { kop: 'Omschrijving' }, { kop: 'Excl. btw', stijl: 'euro' as const }, { kop: 'Btw %', stijl: 'getal' as const }, { kop: 'Btw', stijl: 'euro' as const }, { kop: 'Incl. btw', stijl: 'euro' as const }, { kop: 'Betaald door' }, { kop: 'Verrekenen met' }, { kop: 'Effect op recht', stijl: 'euro' as const }],
      rijen: inv.kosten.map((k) => [datum(k.datum), k.leverancier ?? '', k.categorie ?? '', k.omschrijving ?? '', euro(k.bedrag_excl), getal(k.btw_pct), formule('IFERROR(E{R}*F{R}/100,0)', k.bedrag_excl * k.btw_pct / 100), formule('E{R}+G{R}', k.bedrag_excl * (1 + k.btw_pct / 100)), BETAALD_DOOR_LABEL[k.betaald_door], k.verrekenen_met ? PERSOON_LABEL[k.verrekenen_met] : '', formule('IF(J{R}<>"",-E{R},0)', k.verrekenen_met ? -k.bedrag_excl : 0)] as Cel[]),
      totaal: ['Totaal', null, null, null, som('E'), null, som('G'), som('H'), null, null, som('K')],
      leeg: 'Nog geen kosten.',
    }],
  }

  const verdeling = {
    naam: 'Winstverdeling', titel: 'Winstverdeling',
    toelichting: ['Netto pot = ontvangen + nog te ontvangen − zakelijke kosten. Recht = een derde van de totale pot. Saldo = recht − privé gebruikt − al ontvangen.'],
    blokken: [{
      soort: 'tabel' as const, titel: 'Per persoon',
      kolommen: [{ kop: 'Persoon' }, { kop: 'Ontvangen op rekening', stijl: 'euro' as const }, { kop: 'Nog te ontvangen', stijl: 'euro' as const }, { kop: 'Zakelijke kosten betaald', stijl: 'euro' as const }, { kop: 'Netto pot', stijl: 'euro' as const }, { kop: 'Recht (1/3)', stijl: 'euro' as const }, { kop: 'Privé gebruikt', stijl: 'euro' as const }, { kop: 'Al ontvangen', stijl: 'euro' as const }, { kop: 'Saldo', stijl: 'euro' as const }, { kop: 'Betekenis' }],
      rijen: inv.vd.personen.map((p) => [PERSOON_LABEL[p.persoon], euro(p.ontvangen_op_rekening), euro(p.nog_te_ontvangen), euro(p.zakelijke_kosten_betaald), formule('B{R}+C{R}-D{R}', p.nettoPot), formule('SUM(E{R1}:E{R2})/3', p.recht), euro(p.prive_gebruikt), euro(p.al_ontvangen), formule('F{R}-G{R}-H{R}', p.saldo), p.betekenis] as Cel[]),
      totaal: ['Totaal', som('B'), som('C'), som('D'), som('E', inv.vd.totaalPot), som('F'), som('G'), som('H'), som('I'), null],
      filter: false,
    }],
  }

  const ez = {
    naam: 'EZ-raming', titel: `EZ-raming ${inv.jaar}`,
    toelichting: ['Raming per persoon volgens de aannames; reserveren = (bijdragen + belasting) / winst.'],
    blokken: [{
      soort: 'tabel' as const, titel: 'Per persoon',
      kolommen: [{ kop: 'Persoon' }, { kop: 'Winst', stijl: 'euro' as const }, { kop: 'Andere inkomsten', stijl: 'euro' as const }, { kop: 'Aftrekken', stijl: 'euro' as const }, { kop: 'Statuut' }, { kop: 'Kwartalen', stijl: 'aantal' as const },
        { kop: 'Sociale bijdragen', stijl: 'euro' as const }, { kop: 'Belastbaar', stijl: 'euro' as const }, { kop: 'Federaal vóór vrijstelling', stijl: 'euro' as const }, { kop: 'Belastingkorting', stijl: 'euro' as const }, { kop: 'Federaal na', stijl: 'euro' as const }, { kop: 'Gemeentebelasting', stijl: 'euro' as const }, { kop: 'Totaal PB', stijl: 'euro' as const }, { kop: 'EZ-belasting', stijl: 'euro' as const }, { kop: 'Netto', stijl: 'euro' as const }, { kop: 'Reserveren', stijl: 'pct' as const }],
      rijen: inv.ez.map((e) => [PERSOON_LABEL[e.persoon], euro(e.winst), euro(e.andere_inkomsten), euro(e.aftrekken), STATUUT_LABEL[e.statuut], aantal(e.kwartalen), euro(e.socialeBijdragen), euro(e.belastbaar), euro(e.federaalVoorVrijstelling), euro(e.belastingkorting), euro(e.federaalNa), euro(e.gemeentebelasting), euro(e.totaalPB), euro(e.ezBelasting), euro(e.netto), pct(e.reserveren)] as Cel[]),
      filter: false,
    }],
  }

  const a = inv.aannames
  const aannames = {
    naam: 'Aannames', titel: 'Aannames',
    blokken: [{
      soort: 'tabel' as const, titel: 'Parameters',
      kolommen: [{ kop: 'Parameter' }, { kop: 'Waarde', stijl: 'getal' as const }],
      rijen: [
        ['Gemeentebelasting', pct(a.gemeentebelasting)], ['Beheerskost sociaal fonds', pct(a.beheerskost_fonds)],
        ['Sociale bijdrage laag', pct(a.soc_laag)], ['Sociale bijdrage hoog', pct(a.soc_hoog)], ['Grens 1', euro(a.soc_grens1)], ['Grens 2', euro(a.soc_grens2)],
        ['Minimum jaarbijdrage hoofdberoep', euro(a.min_jaarbijdrage_hoofd)], ['Vrijstelling bijberoep', euro(a.vrijstelling_bijberoep)], ['Belastingvrije som', euro(a.belastingvrije_som)],
        ['Schijf 1 grens', euro(a.schijf1_grens)], ['Schijf 1 tarief', pct(a.schijf1_tarief)], ['Schijf 2 grens', euro(a.schijf2_grens)], ['Schijf 2 tarief', pct(a.schijf2_tarief)],
        ['Schijf 3 grens', euro(a.schijf3_grens)], ['Schijf 3 tarief', pct(a.schijf3_tarief)], ['Schijf 4 tarief', pct(a.schijf4_tarief)],
      ] as Cel[][],
      filter: false,
    }],
  }

  werkmap.bladen = [overzicht, rechten, kosten, verdeling, ez, aannames]
  return werkmap
}
