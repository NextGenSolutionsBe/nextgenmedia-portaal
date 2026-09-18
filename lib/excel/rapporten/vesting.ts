import {
  STATUS_LABEL, ERKENNING_LABEL, JAAR_LABEL, TERMIJN_LABEL, FREQUENTIES, pct as pctTekst,
  type VestingOverzicht, type VestingInstellingen, type WamKost,
} from '@/lib/vesting'
import { type Werkmap, type Blad, type Cel, euro, pct, datum, aantal, getal, formule, som } from '../spec'

/**
 * Excel-export van Vesting, opgebouwd uit het reeds berekende overzicht
 * (`berekenVesting` in lib/vesting.ts) — dezelfde cijfers als op het scherm.
 * De toewijzing van de goedkope schijf is chronologisch en niet in één
 * Excel-formule te vatten; die kolommen staan er als waarden, mét de
 * tussenstappen (schijven, cumulatief) zodat alles narekenbaar is. Wat wél
 * een formule kan zijn (btw, incl., ontvangen = historiek + betaald,
 * openstaand, totalen) is er een.
 */

export type VestingExportInvoer = {
  v: VestingOverzicht
  inst: VestingInstellingen
  kosten: WamKost[]
  /** Het tabblad dat openstond, enkel ter vermelding. */
  tab?: string
}

export function vestingWerkmap({ v, inst, kosten, tab }: VestingExportInvoer): Werkmap {
  const werkmap: Werkmap = {
    bestandsnaam: 'NextGenMedia_Vesting', titel: 'Vesting — vestigingsprincipe',
    filters: tab ? [{ label: 'Geopend tabblad', waarde: tab }] : [],
    bladen: [],
  }

  const overzicht: Blad = {
    naam: 'Overzicht', titel: 'Vesting — overzicht',
    toelichting: ['Uitsluitend informatief; wijzigt geen aandelen. Hele procenten, afgekapt, zoals in de samenwerkingsovereenkomst.'],
    blokken: [
      {
        soort: 'kpis', titel: 'Kengetallen',
        items: [
          { label: 'Meetellende contractwaarde', waarde: euro(v.meetellendeWaarde), toelichting: 'WAM netto + contracten' },
          { label: 'Marco voorlopig', waarde: pct(v.marcoVoorlopig), toelichting: `van maximaal ${pctTekst(inst.max_aandeel_marco)}` },
          { label: 'Marco definitief', waarde: pct(v.marcoDefinitief), toelichting: 'enkel voltooide contracten' },
          { label: 'Uitgevallen waarde', waarde: euro(v.uitgevallenWaarde), toelichting: 'stopgezet, niet betaald, WAM-kosten' },
          { label: 'Nog te verwerven', waarde: pct(Math.max(0, inst.max_aandeel_marco - v.marcoVoorlopig)) },
          { label: 'Tot de volgende %', waarde: v.volgendeProcent ? euro(v.volgendeProcent.nodig) : 'Maximum', toelichting: v.volgendeProcent ? `aan € ${v.volgendeProcent.tarief} per %` : undefined },
        ],
      },
      {
        soort: 'tabel', titel: 'Actuele aandelenverdeling (voorlopig)',
        kolommen: [{ kop: 'Aandeelhouder' }, { kop: 'Aandeel', stijl: 'pct' }, { kop: 'Toelichting' }],
        rijen: [
          ['Bram Reinquin', pct(v.bram), `start ${pctTekst(inst.startaandeel_bram)} · krijgt wat Marco niet verwerft`],
          ['Chiara Walmagh', pct(v.chiara), 'vast — wijzigt nooit'],
          ['Marco Castermans', pct(v.marcoVoorlopig), `definitief ${pctTekst(v.marcoDefinitief)} · maximum ${pctTekst(inst.max_aandeel_marco)}`],
        ],
        totaal: ['Totaal', som('B', v.bram + v.chiara + v.marcoVoorlopig, 'totaal_pct'), null],
        filter: false,
      },
      {
        soort: 'tabel', titel: 'Samenvatting per contractjaar',
        kolommen: [{ kop: 'Contractjaar' }, { kop: 'Periode ondertekening' }, { kop: `Tarief boven ${pctTekst(inst.einde_goedkope_schijf)}`, stijl: 'euro' }, { kop: 'Meetellende omzet', stijl: 'euro' }, { kop: 'Ruwe vesting', stijl: 'pct' }, { kop: 'Contracten', stijl: 'aantal' }],
        rijen: v.perJaar.map((j) => [j.label, j.periode ? `${j.periode.van} t.e.m. ${j.periode.tot}` : '—', j.tarief ? euro(j.tarief) : null, euro(j.meetellend), pct(j.ruweVesting), aantal(j.aantal)]),
        totaal: ['Totaal', null, null, som('D', v.perJaar.reduce((s, j) => s + j.meetellend, 0)), som('E', v.perJaar.reduce((s, j) => s + j.ruweVesting, 0), 'totaal_pct'), som('F', v.perJaar.reduce((s, j) => s + j.aantal, 0), 'totaal_aantal')],
        filter: false,
      },
    ],
  }

  const contracten: Blad = {
    naam: 'Contracten', titel: 'Contracten',
    toelichting: ['Ondertekeningsdatum bepaalt het contractjaar en vergrendelt het tarief. Goedkope schijf en jaarschijf tonen hoe het meetellende bedrag verdeeld werd; cumulatief = meetellende waarde vóór dit contract (chronologisch).'],
    blokken: [{
      soort: 'tabel', titel: 'Contractenregister',
      kolommen: [
        { kop: 'Nr.' }, { kop: 'Klant' }, { kop: 'Ondertekend', stijl: 'datum' }, { kop: 'Contractjaar' }, { kop: 'Dienst' }, { kop: 'Model' },
        { kop: 'Maandbedrag', stijl: 'euro' }, { kop: 'Duur (mnd)', stijl: 'aantal' }, { kop: 'Totaal', stijl: 'euro' }, { kop: 'Uitgesloten kosten', stijl: 'euro' }, { kop: 'Netto', stijl: 'euro' },
        { kop: 'Factor', stijl: 'pct' }, { kop: 'Meetellend', stijl: 'euro' }, { kop: 'Goedkope schijf', stijl: 'euro' }, { kop: 'Jaarschijf', stijl: 'euro' }, { kop: 'Cumulatief vóór', stijl: 'euro' },
        { kop: 'Ruwe vesting', stijl: 'pct' }, { kop: 'Erkenning' }, { kop: 'Status' }, { kop: 'Betalingen op schema' }, { kop: 'Uitgevallen', stijl: 'euro' }, { kop: 'Gekoppeld contract' }, { kop: 'Notitie' },
      ],
      rijen: v.contracten.map((c) => [
        c.nr, c.klant, datum(c.ondertekend_op), JAAR_LABEL[c.jaar], c.dienst ?? '—', c.facturatiemodel === 'maandcontract' ? 'Maandcontract' : 'Eenmalig project',
        c.maandbedrag !== null ? euro(c.maandbedrag) : null, c.duur !== null ? aantal(c.duur) : null,
        c.totaal !== null ? euro(c.totaal) : null, euro(c.uitgesloten_kosten),
        c.totaal !== null ? formule('MAX(0,I{R}-J{R})', c.netto ?? 0) : null,
        pct(c.factor), euro(c.meetellend), euro(c.goedkopeSchijf), euro(c.jaarschijf), euro(c.cumulatiefVoor),
        pct(c.ruweVesting), ERKENNING_LABEL[c.erkenning], STATUS_LABEL[c.status], c.betalingen_op_schema ? 'Ja' : 'Nee', euro(c.uitgevallen),
        c.contract_id ? `/admin/contracts/${c.contract_id}` : '', c.notitie ?? '',
      ] as Cel[]),
      totaal: ['Totaal', null, null, null, null, null, null, null,
        som('I', v.contracten.reduce((s, c) => s + (c.totaal ?? 0), 0)), som('J'), som('K', v.contracten.reduce((s, c) => s + (c.netto ?? 0), 0)),
        null, som('M', v.contracten.reduce((s, c) => s + c.meetellend, 0)), som('N'), som('O'), null,
        som('Q', v.contracten.reduce((s, c) => s + c.ruweVesting, 0), 'totaal_pct'), null, null, null, som('U', v.contracten.reduce((s, c) => s + c.uitgevallen, 0)), null, null],
      leeg: 'Nog geen contracten.',
    }],
  }

  const w = v.wam
  const wamKlanten: Blad = {
    naam: 'WAM-klanten', titel: 'WAM-portefeuille — klanten',
    toelichting: [`Elke volle € ${inst.wam_bedrag_per_pct} netto ontvangen = 1%, tot ${pctTekst(inst.wam_max_aandeel)}. Ontvangen = historiek (vóór de app) + betaalde termijnen; alleen dat telt. Prognose = historiek + alle niet-geannuleerde termijnen.`],
    blokken: [
      {
        soort: 'kpis', titel: 'Kengetallen',
        items: [
          { label: 'Prognose omzet', waarde: euro(w.prognose) },
          { label: 'Gefactureerd', waarde: euro(w.gefactureerd) },
          { label: 'Effectief ontvangen', waarde: euro(w.nettoOntvangen) },
          { label: 'Openstaand', waarde: euro(w.openstaand) },
          { label: 'Kosten bij WAM', waarde: euro(w.kosten) },
          { label: 'Netto meetellend', waarde: euro(w.nettoMeetellend) },
          { label: 'Voorlopig aandeel', waarde: pct(w.voorlopig) },
          { label: 'Definitief aandeel', waarde: pct(w.definitief) },
          { label: 'Volgende drempel', waarde: w.volgendeDrempel === null ? 'Maximum' : euro(w.volgendeDrempel) },
        ],
      },
      {
        soort: 'tabel', titel: 'Klanten',
        kolommen: [
          { kop: 'Nr.' }, { kop: 'Klant' }, { kop: 'Start facturatie', stijl: 'datum' }, { kop: 'Looptijd (mnd)', stijl: 'aantal' }, { kop: 'Bedrag per factuur', stijl: 'euro' }, { kop: 'Frequentie' },
          { kop: 'Contractwaarde', stijl: 'euro' }, { kop: 'Historiek (vóór de app)', stijl: 'euro' }, { kop: 'Prognose', stijl: 'euro' }, { kop: 'Gefactureerd', stijl: 'euro' }, { kop: 'Betaald (termijnen)', stijl: 'euro' },
          { kop: 'Ontvangen', stijl: 'euro' }, { kop: 'Openstaand', stijl: 'euro' }, { kop: 'Meetellend', stijl: 'euro' }, { kop: 'Erkenning' }, { kop: 'Status' }, { kop: 'Notitie' },
        ],
        rijen: w.rijen.map((r) => [
          r.nr, r.klant, datum(r.start_datum), r.contract_maanden !== null ? aantal(r.contract_maanden) : null, r.bedrag_per_factuur !== null ? euro(r.bedrag_per_factuur) : null,
          FREQUENTIES.find((f) => f.key === r.frequentie)?.label ?? '',
          euro(r.contractwaarde), euro(r.netto_ontvangen), euro(r.prognose), euro(r.gefactureerd), euro(r.betaald),
          formule('H{R}+K{R}', r.ontvangen), formule('MAX(0,J{R}-K{R})', r.openstaand), euro(r.meetellend), ERKENNING_LABEL[r.erkenning], STATUS_LABEL[r.status], r.notitie ?? '',
        ] as Cel[]),
        totaal: ['Totaal', null, null, null, null, null, som('G'), som('H'), som('I', w.prognose), som('J', w.gefactureerd), som('K', w.betaald), som('L', w.nettoOntvangen), som('M', w.openstaand), som('N'), null, null, null],
        leeg: 'Nog geen WAM-klanten.',
      },
      {
        soort: 'tabel', titel: 'Kosten bij WAM',
        kolommen: [{ kop: 'Datum', stijl: 'datum' }, { kop: 'Omschrijving' }, { kop: 'Bedrag', stijl: 'euro' }],
        rijen: kosten.map((k) => [datum(k.datum), k.omschrijving, euro(k.bedrag)]),
        totaal: ['Totaal', null, som('C', w.kosten)],
        leeg: 'Geen kosten.',
      },
    ],
  }

  const termijnen: Blad = {
    naam: 'WAM-termijnen', titel: 'WAM-portefeuille — termijnen',
    toelichting: ['Eén rij per facturatiemoment. Incl. btw is een formule op basis van excl. en btw %.'],
    blokken: [{
      soort: 'tabel', titel: 'Termijnen',
      kolommen: [
        { kop: 'Klant' }, { kop: 'Nr.' }, { kop: '#', stijl: 'aantal' }, { kop: 'Periode' }, { kop: 'Factuurdatum', stijl: 'datum' },
        { kop: 'Excl. btw', stijl: 'euro' }, { kop: 'Btw %', stijl: 'getal' }, { kop: 'Incl. btw', stijl: 'euro' }, { kop: 'Status' }, { kop: 'Betaald op', stijl: 'datum' }, { kop: 'Factuur' }, { kop: 'ClickUp-taak' }, { kop: 'Notitie' },
      ],
      rijen: w.rijen.flatMap((r) => r.termijnen.map((t) => [
        r.klant, r.nr, aantal(t.volgnr), t.periode, datum(t.factuurdatum),
        euro(t.bedrag_excl), getal(t.btw_pct), formule('F{R}*(1+G{R}/100)', Math.round(t.bedrag_excl * (1 + t.btw_pct / 100) * 100) / 100),
        TERMIJN_LABEL[t.status], datum(t.betaald_op), t.invoice_id ? `/admin/invoices?maand=${t.periode}` : '', t.clickup_task_id ? `https://app.clickup.com/t/${t.clickup_task_id}` : '', t.notitie ?? '',
      ] as Cel[])),
      totaal: ['Totaal', null, null, null, null, som('F'), null, som('H'), null, null, null, null, null],
      leeg: 'Nog geen termijnen.',
    }],
  }

  const perJaar: Blad = {
    naam: 'Per contractjaar', titel: 'Per contractjaar',
    blokken: [
      {
        soort: 'tabel', titel: 'Contractjaren',
        kolommen: [{ kop: 'Contractjaar' }, { kop: 'Van', stijl: 'datum' }, { kop: 'Tot en met', stijl: 'datum' }, { kop: `Tarief boven ${pctTekst(inst.einde_goedkope_schijf)}`, stijl: 'euro' }, { kop: 'Meetellende omzet', stijl: 'euro' }, { kop: 'Ruwe vesting', stijl: 'pct' }, { kop: 'Contracten', stijl: 'aantal' }],
        rijen: v.perJaar.map((j) => [j.label, datum(j.periode?.van ?? null), datum(j.periode?.tot ?? null), j.tarief ? euro(j.tarief) : null, euro(j.meetellend), pct(j.ruweVesting), aantal(j.aantal)]),
        totaal: ['Totaal', null, null, null, som('E'), som('F', undefined, 'totaal_pct'), som('G', undefined, 'totaal_aantal')],
        filter: false,
      },
    ],
  }

  const instellingen: Blad = {
    naam: 'Instellingen', titel: 'Instellingen (parameters van het model)',
    blokken: [{
      soort: 'tabel', titel: 'Parameters',
      kolommen: [{ kop: 'Parameter' }, { kop: 'Waarde', stijl: 'getal' }, { kop: 'Toelichting' }],
      rijen: [
        ['Maximaal aandeel Marco', pct(inst.max_aandeel_marco), 'fractie'],
        ['Vast aandeel Chiara', pct(inst.vast_aandeel_chiara), ''],
        ['Startaandeel Marco', pct(inst.startaandeel_marco), ''],
        ['Startaandeel Bram', pct(inst.startaandeel_bram), ''],
        ['WAM: € netto per 1%', euro(inst.wam_bedrag_per_pct), ''],
        ['Maximaal aandeel via WAM', pct(inst.wam_max_aandeel), ''],
        ['Regulier tarief (€ per 1%)', euro(inst.regulier_tarief), 'geldt tot het einde van de goedkope schijf'],
        ['Einde goedkope schijf', pct(inst.einde_goedkope_schijf), 'totaal, WAM inbegrepen'],
        ['Jaar 1 — van', datum(inst.jaar1_start), ''], ['Jaar 1 — t.e.m.', datum(inst.jaar1_eind), ''], ['Jaar 1 — € per 1%', euro(inst.jaar1_tarief), ''],
        ['Jaar 2 — van', datum(inst.jaar2_start), ''], ['Jaar 2 — t.e.m.', datum(inst.jaar2_eind), ''], ['Jaar 2 — € per 1%', euro(inst.jaar2_tarief), ''],
        ['Jaar 3 — van', datum(inst.jaar3_start), ''], ['Jaar 3 — t.e.m.', datum(inst.jaar3_eind), ''], ['Jaar 3 — € per 1%', euro(inst.jaar3_tarief), ''],
      ],
      filter: false,
    }],
  }

  werkmap.bladen = [overzicht, contracten, perJaar, wamKlanten, termijnen, instellingen]
  return werkmap
}
