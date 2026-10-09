import { SERVICE_LABELS } from '@/lib/utils'
import { INVOICE_STATUS_LABEL, monthLabel } from '@/lib/invoices'
import { KOSTEN_STATUS_LABEL, type KostenStatus } from '@/lib/facturen/kosten-winst'
import { type Werkmap, type Cel, type Blad, euro, datum, formule, som, aantal, layoutVan, bladBereik } from '../spec'

/**
 * Excel-export van Facturen, opgebouwd in de browser uit precies de rijen die
 * het scherm al geladen heeft (de hele maand) — met de actieve filters
 * toegepast en bovenaan vermeld. Btw, incl.-bedragen, werkelijke winst en
 * marge zijn Excel-formules; het blad "Kosten per factuur" bevat elke
 * gekoppelde kost.
 */

export type FactuurKostenExport = {
  directeKosten: number; winst: number; margePct: number | null; vestingWaarde: number; nietMeetellend: number
  status: KostenStatus; aantalKosten: number; kostenOnbekend: number; waarschuwingen: string[]
  details: { omschrijving: string; categorie: string | null; leverancier: string | null; kostprijs_excl: number | null; lijn: string | null; datum: string | null; status: string; bewijs_url: string | null }[]
}

export type FactuurExportRij = {
  kind: 'eenmalig' | 'recurring'
  sourceId?: string
  client_id: string | null; service_slug: string | null; description: string | null
  amount_excl: number; vat_pct: number; amount_incl: number; status: string
  billing_date: string
  contract_title?: string | null; invoiceKind?: string; setterName?: string | null
  recurring_start?: string | null; recurring_end?: string | null
  kosten?: FactuurKostenExport
}

export type FactuurExportInvoer = {
  month: string                       // YYYY-MM
  rijen: FactuurExportRij[]           // NA filtering
  alleRijen: FactuurExportRij[]       // de hele maand (voor de kaarten)
  klantNaam: (id: string | null) => string
  filters: { label: string; waarde: string }[]
  summary: { omzetExcl: number; openExcl?: number; doneExcl?: number; pct: number }
}

const SOORT: Record<string, string> = { client: 'Klantfactuur', wam: 'WAM · Vesting', setter_hours: 'Te betalen · uren setter', setter_commission: 'Te betalen · commissie setter' }

/** Factuurnummer/referentie: de app heeft geen eigen nummering; de unieke id (kort) is de referentie. */
export const factuurRef = (r: { kind: string; sourceId?: string; billing_date?: string }, maand?: string) =>
  r.sourceId ? `${r.kind === 'recurring' ? 'REC' : 'F'}-${r.sourceId.slice(0, 8).toUpperCase()}${r.kind === 'recurring' && maand ? `-${maand}` : ''}` : ''

export function facturenWerkmap(inv: FactuurExportInvoer): Werkmap {
  const label = monthLabel(inv.month)
  const werkmap: Werkmap = {
    bestandsnaam: `NextGenMedia_Facturen_${inv.month}`, titel: `Facturen ${label}`,
    filters: [{ label: 'Maand', waarde: label }, ...inv.filters],
    bladen: [],
  }
  const vandaag = new Date().toISOString().slice(0, 10)
  const klant = (r: FactuurExportRij) => (r.setterName ? r.setterName : inv.klantNaam(r.client_id))

  const rijen: Cel[][] = inv.rijen.map((r) => {
    const aandacht = r.status === 'geannuleerd' ? 'Geannuleerd'
      : r.status === 'te_versturen' && r.billing_date && r.billing_date < vandaag ? 'Factuurdatum voorbij — nog niet verstuurd'
      : 'In orde'
    const k = r.kosten
    const geannuleerd = r.status === 'geannuleerd'
    return [
      factuurRef(r, inv.month), klant(r),
      r.kind === 'recurring' ? 'Recurring' : 'Eenmalig',
      SOORT[r.invoiceKind ?? 'client'] ?? (r.invoiceKind ?? 'client'),
      r.service_slug ? (SERVICE_LABELS[r.service_slug] ?? r.service_slug) : '—',
      r.description ?? '', r.contract_title ?? '',
      datum(r.billing_date), INVOICE_STATUS_LABEL[r.status] ?? r.status,
      euro(r.amount_excl), Number(r.vat_pct ?? 0),
      formule('IFERROR(J{R}*K{R}/100,0)', r.amount_excl * Number(r.vat_pct ?? 0) / 100),
      formule('J{R}+L{R}', r.amount_incl),
      // Kosten en winst (intern): winst en marge als formule op omzet en directe kosten.
      euro(k ? k.directeKosten : 0),
      formule('IF(I{R}="Geannuleerd",0,J{R}-N{R})', geannuleerd ? 0 : (k ? k.winst : r.amount_excl)),
      formule('IFERROR(O{R}/J{R},"")', geannuleerd ? '' : (k ? (k.margePct ?? '') : 1)),
      formule('O{R}', geannuleerd ? 0 : (k ? k.vestingWaarde : r.amount_excl)),
      formule('N{R}', k ? k.nietMeetellend : 0),
      KOSTEN_STATUS_LABEL[k?.status ?? 'ongecontroleerd'],
      r.kind === 'recurring' && r.recurring_start ? `${r.recurring_start}${r.recurring_end ? ` → ${r.recurring_end}` : ' → onbepaald'}` : '',
      aandacht,
    ]
  })

  const factuurBlad: Blad = {
    naam: `Facturen ${inv.month}`, titel: `Facturen — ${label}`,
    toelichting: ['Excl. btw = omzet. Werkelijke winst = omzet excl. btw − directe kosten excl. btw; btw telt nooit mee. Vesting-/investeringswaarde = werkelijke winst; niet-meetellend = de doorgerekende kosten.'],
    blokken: [{
      soort: 'tabel', titel: 'Facturen',
      kolommen: [
        { kop: 'Factuurnr.' }, { kop: 'Klant' }, { kop: 'Type' }, { kop: 'Soort' }, { kop: 'Dienst' }, { kop: 'Omschrijving / project' }, { kop: 'Contract' },
        { kop: 'Factuurdatum', stijl: 'datum' }, { kop: 'Status' },
        { kop: 'Omzet excl. btw', stijl: 'euro' }, { kop: 'Btw %', stijl: 'getal' }, { kop: 'Btw', stijl: 'euro' }, { kop: 'Omzet incl. btw', stijl: 'euro' },
        { kop: 'Directe kosten excl. btw', stijl: 'euro' }, { kop: 'Werkelijke winst', stijl: 'euro' }, { kop: 'Marge', stijl: 'pct' }, { kop: 'Vesting-/investeringswaarde', stijl: 'euro' }, { kop: 'Niet-meetellend', stijl: 'euro' }, { kop: 'Kostenstatus' },
        { kop: 'Looptijd recurring' }, { kop: 'Aandachtspunt' },
      ],
      rijen,
      totaal: ['Totaal', null, null, null, null, null, null, null, null,
        som('J', inv.rijen.reduce((s, r) => s + r.amount_excl, 0)), null, som('L'), som('M', inv.rijen.reduce((s, r) => s + r.amount_incl, 0)),
        som('N'), som('O'), formule('IFERROR(SUM(O{R1}:O{R2})/SUM(J{R1}:J{R2}),"")', undefined, 'totaal_pct'), som('Q'), som('R'), null, null, null, null],
      leeg: 'Geen facturen voor deze maand en filters.',
    }],
  }

  // Kosten per factuur: elke gekoppelde kost, met de factuurreferentie.
  const kostenRijen: Cel[][] = inv.rijen.flatMap((r) => (r.kosten?.details ?? []).map((k) => [
    factuurRef(r, inv.month), klant(r), r.description ?? '', k.omschrijving, k.categorie ?? '', k.leverancier ?? '',
    k.kostprijs_excl === null ? null : euro(k.kostprijs_excl), k.kostprijs_excl === null ? 'Kostprijs nog aan te vullen' : (k.status === 'geannuleerd' ? 'Geannuleerd' : 'Actief'),
    k.lijn ?? 'Hele factuur', datum(k.datum), k.bewijs_url ?? '',
  ] as Cel[]))
  const kostenBlad: Blad = {
    naam: 'Kosten per factuur', titel: `Kosten per factuur — ${label}`,
    toelichting: ['Alle gekoppelde directe kosten. Een kost zonder kostprijs telt niet als €0: de winst van die factuur is voorlopig. Geannuleerde kosten tellen niet mee.'],
    blokken: [{
      soort: 'tabel', titel: 'Kosten',
      kolommen: [{ kop: 'Factuurnr.' }, { kop: 'Klant' }, { kop: 'Factuur' }, { kop: 'Kost' }, { kop: 'Categorie' }, { kop: 'Leverancier' }, { kop: 'Kostprijs excl. btw', stijl: 'euro' }, { kop: 'Status' }, { kop: 'Gekoppelde lijn' }, { kop: 'Datum', stijl: 'datum' }, { kop: 'Bewijsstuk' }],
      rijen: kostenRijen,
      totaal: ['Totaal (actief)', null, null, null, null, null, formule('SUMIF(H{R1}:H{R2},"Actief",G{R1}:G{R2})', inv.rijen.reduce((s, r) => s + (r.kosten?.directeKosten ?? 0), 0), 'totaal_euro'), null, null, null, null],
      leeg: 'Geen kosten gekoppeld aan de facturen van deze maand.',
    }],
  }

  const live = inv.alleRijen.filter((r) => r.status !== 'geannuleerd')
  const teVersturen = live.filter((r) => r.status === 'te_versturen').length
  const verstuurd = live.filter((r) => r.status === 'verstuurd').length
  const L = layoutVan(werkmap, factuurBlad)[0]
  const status = bladBereik(factuurBlad.naam, 'I', L.eersteDataRij!, L.laatsteDataRij!)
  const excl = bladBereik(factuurBlad.naam, 'J', L.eersteDataRij!, L.laatsteDataRij!)
  const kosten = bladBereik(factuurBlad.naam, 'N', L.eersteDataRij!, L.laatsteDataRij!)
  const winst = bladBereik(factuurBlad.naam, 'O', L.eersteDataRij!, L.laatsteDataRij!)
  const levend = inv.rijen.filter((r) => r.status !== 'geannuleerd')
  const kostenTot = levend.reduce((s, r) => s + (r.kosten?.directeKosten ?? 0), 0)
  const omzetTot = levend.reduce((s, r) => s + r.amount_excl, 0)

  const samenvatting: Blad = {
    naam: 'Samenvatting', titel: `Facturen ${label} — samenvatting`,
    toelichting: ['De kaarten van het dashboard gaan over de hele maand; de formules hieronder tellen over de geëxporteerde (gefilterde) rijen.'],
    blokken: [
      {
        soort: 'kpis', titel: 'Dashboardkaarten (hele maand)',
        items: [
          { label: 'Te versturen', waarde: aantal(teVersturen) },
          { label: 'Verstuurd', waarde: aantal(verstuurd) },
          { label: 'Openstaand bedrag (excl. btw)', waarde: euro(inv.summary.openExcl ?? 0) },
          { label: 'Verstuurd bedrag (excl. btw)', waarde: euro(inv.summary.doneExcl ?? 0) },
          { label: 'Omzet maand (excl. btw)', waarde: euro(inv.summary.omzetExcl) },
          { label: 'Facturatie voltooid', waarde: { v: inv.summary.pct / 100, stijl: 'pct' } },
        ],
      },
      {
        soort: 'kpis', titel: 'Omzet, doorgerekende kosten en winst (geëxporteerde rijen, zonder geannuleerd)',
        items: [
          { label: 'Omzet excl. btw', waarde: formule(`SUM(${excl})-SUMIF(${status},"${INVOICE_STATUS_LABEL.geannuleerd}",${excl})`, omzetTot), stijl: 'euro' },
          { label: 'Doorgerekende (directe) kosten', waarde: formule(`SUM(${kosten})`, kostenTot), stijl: 'euro' },
          { label: 'Omzet die bijdraagt aan de winst', waarde: formule(`SUM(${winst})`, omzetTot - kostenTot), stijl: 'euro' },
          { label: 'Marge', waarde: formule(`IFERROR(SUM(${winst})/(SUM(${excl})-SUMIF(${status},"${INVOICE_STATUS_LABEL.geannuleerd}",${excl})),"")`, omzetTot > 0 ? (omzetTot - kostenTot) / omzetTot : ''), stijl: 'pct' },
          { label: 'Facturen met kostenstatus "Volledig"', waarde: aantal(levend.filter((r) => r.kosten?.status === 'volledig').length) },
          { label: 'Voorlopig / controle vereist / nog niet gecontroleerd', waarde: `${levend.filter((r) => r.kosten?.status === 'voorlopig').length} / ${levend.filter((r) => r.kosten?.status === 'controle_vereist').length} / ${levend.filter((r) => (r.kosten?.status ?? 'ongecontroleerd') === 'ongecontroleerd').length}` },
        ],
      },
      {
        soort: 'kpis', titel: 'Geëxporteerde rijen (met filters)',
        items: [
          { label: 'Aantal rijen', waarde: aantal(inv.rijen.length) },
          { label: 'Te versturen (aantal)', waarde: formule(`COUNTIF(${status},"${INVOICE_STATUS_LABEL.te_versturen}")`, inv.rijen.filter((r) => r.status === 'te_versturen').length), stijl: 'aantal' },
          { label: 'Verstuurd (aantal)', waarde: formule(`COUNTIF(${status},"${INVOICE_STATUS_LABEL.verstuurd}")`, inv.rijen.filter((r) => r.status === 'verstuurd').length), stijl: 'aantal' },
          { label: 'Te versturen (excl. btw)', waarde: formule(`SUMIF(${status},"${INVOICE_STATUS_LABEL.te_versturen}",${excl})`, inv.rijen.filter((r) => r.status === 'te_versturen').reduce((s, r) => s + r.amount_excl, 0)), stijl: 'euro' },
          { label: 'Verstuurd (excl. btw)', waarde: formule(`SUMIF(${status},"${INVOICE_STATUS_LABEL.verstuurd}",${excl})`, inv.rijen.filter((r) => r.status === 'verstuurd').reduce((s, r) => s + r.amount_excl, 0)), stijl: 'euro' },
        ],
      },
    ],
  }
  werkmap.bladen = [samenvatting, factuurBlad, kostenBlad]
  return werkmap
}
