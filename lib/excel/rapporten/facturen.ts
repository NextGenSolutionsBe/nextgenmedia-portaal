import { SERVICE_LABELS } from '@/lib/utils'
import { INVOICE_STATUS_LABEL, monthLabel } from '@/lib/invoices'
import { type Werkmap, type Cel, euro, datum, formule, som, aantal, layoutVan, bladBereik } from '../spec'

/**
 * Excel-export van Facturen, opgebouwd in de browser uit precies de rijen die
 * het scherm al geladen heeft (de hele maand) — met de actieve filters
 * toegepast en bovenaan vermeld. Btw en incl.-bedragen zijn Excel-formules.
 */

export type FactuurExportRij = {
  kind: 'eenmalig' | 'recurring'
  client_id: string | null; service_slug: string | null; description: string | null
  amount_excl: number; vat_pct: number; amount_incl: number; status: string
  billing_date: string; clickup_task_id: string | null
  contract_title?: string | null; invoiceKind?: string; setterName?: string | null
  recurring_start?: string | null; recurring_end?: string | null
}

export type FactuurExportInvoer = {
  month: string                       // YYYY-MM
  rijen: FactuurExportRij[]           // NA filtering
  alleRijen: FactuurExportRij[]       // de hele maand (voor de kaarten)
  klantNaam: (id: string | null) => string
  filters: { label: string; waarde: string }[]
  summary: { omzetExcl: number; openExcl?: number; doneExcl?: number; pct: number }
  clickupEnabled: boolean
}

const SOORT: Record<string, string> = { client: 'Klantfactuur', wam: 'WAM · Vesting', setter_hours: 'Te betalen · uren setter', setter_commission: 'Te betalen · commissie setter' }

export function facturenWerkmap(inv: FactuurExportInvoer): Werkmap {
  const label = monthLabel(inv.month)
  const werkmap: Werkmap = {
    bestandsnaam: `NextGenMedia_Facturen_${inv.month}`, titel: `Facturen ${label}`,
    filters: [{ label: 'Maand', waarde: label }, ...inv.filters],
    bladen: [],
  }

  const rijen: Cel[][] = inv.rijen.map((r) => {
    const vandaag = new Date().toISOString().slice(0, 10)
    const aandacht = r.status === 'geannuleerd' ? 'Geannuleerd'
      : r.status === 'te_versturen' && r.billing_date && r.billing_date < vandaag ? 'Factuurdatum voorbij — nog niet verstuurd'
      : inv.clickupEnabled && !r.clickup_task_id ? 'Geen ClickUp-taak' : 'In orde'
    return [
      r.setterName ? r.setterName : inv.klantNaam(r.client_id),
      r.kind === 'recurring' ? 'Recurring' : 'Eenmalig',
      SOORT[r.invoiceKind ?? 'client'] ?? (r.invoiceKind ?? 'client'),
      r.service_slug ? (SERVICE_LABELS[r.service_slug] ?? r.service_slug) : '—',
      r.description ?? '', r.contract_title ?? '',
      datum(r.billing_date), INVOICE_STATUS_LABEL[r.status] ?? r.status,
      euro(r.amount_excl), Number(r.vat_pct ?? 0),
      formule('IFERROR(I{R}*J{R}/100,0)', r.amount_excl * Number(r.vat_pct ?? 0) / 100),
      formule('I{R}+K{R}', r.amount_incl),
      r.kind === 'recurring' && r.recurring_start ? `${r.recurring_start}${r.recurring_end ? ` → ${r.recurring_end}` : ' → onbepaald'}` : '',
      r.clickup_task_id ? `https://app.clickup.com/t/${r.clickup_task_id}` : '',
      aandacht,
    ]
  })

  const factuurBlad = {
    naam: `Facturen ${inv.month}`, titel: `Facturen — ${label}`,
    toelichting: ['Excl. btw = omzet. Btw en incl. btw zijn formules; pas het bedrag of het btw-percentage aan en de rest volgt.'],
    blokken: [{
      soort: 'tabel' as const, titel: 'Facturen',
      kolommen: [
        { kop: 'Klant' }, { kop: 'Type' }, { kop: 'Soort' }, { kop: 'Dienst' }, { kop: 'Omschrijving' }, { kop: 'Contract' },
        { kop: 'Factuurdatum', stijl: 'datum' as const }, { kop: 'Status' },
        { kop: 'Excl. btw', stijl: 'euro' as const }, { kop: 'Btw %', stijl: 'getal' as const }, { kop: 'Btw', stijl: 'euro' as const }, { kop: 'Incl. btw', stijl: 'euro' as const },
        { kop: 'Looptijd recurring' }, { kop: 'ClickUp-taak' }, { kop: 'Aandachtspunt' },
      ],
      rijen,
      totaal: ['Totaal', null, null, null, null, null, null, null,
        som('I', inv.rijen.reduce((s, r) => s + r.amount_excl, 0)), null, som('K'), som('L', inv.rijen.reduce((s, r) => s + r.amount_incl, 0)), null, null, null],
      leeg: 'Geen facturen voor deze maand en filters.',
    }],
  }

  const live = inv.alleRijen.filter((r) => r.status !== 'geannuleerd')
  const teVersturen = live.filter((r) => r.status === 'te_versturen').length
  const verstuurd = live.filter((r) => r.status === 'verstuurd').length
  const L = layoutVan(werkmap, factuurBlad)[0]
  const status = bladBereik(factuurBlad.naam, 'H', L.eersteDataRij!, L.laatsteDataRij!)
  const excl = bladBereik(factuurBlad.naam, 'I', L.eersteDataRij!, L.laatsteDataRij!)

  const samenvatting = {
    naam: 'Samenvatting', titel: `Facturen ${label} — samenvatting`,
    toelichting: ['De kaarten van het dashboard gaan over de hele maand; de formules hieronder tellen over de geëxporteerde (gefilterde) rijen.'],
    blokken: [
      {
        soort: 'kpis' as const, titel: 'Dashboardkaarten (hele maand)',
        items: [
          { label: 'Te versturen', waarde: aantal(teVersturen) },
          { label: 'Verstuurd', waarde: aantal(verstuurd) },
          { label: 'Openstaand bedrag (excl. btw)', waarde: euro(inv.summary.openExcl ?? 0) },
          { label: 'Verstuurd bedrag (excl. btw)', waarde: euro(inv.summary.doneExcl ?? 0) },
          { label: 'Omzet maand (excl. btw)', waarde: euro(inv.summary.omzetExcl) },
          { label: 'Facturatie voltooid', waarde: { v: inv.summary.pct / 100, stijl: 'pct' as const } },
        ],
      },
      {
        soort: 'kpis' as const, titel: 'Geëxporteerde rijen (met filters)',
        items: [
          { label: 'Aantal rijen', waarde: aantal(inv.rijen.length) },
          { label: 'Te versturen (aantal)', waarde: formule(`COUNTIF(${status},"${INVOICE_STATUS_LABEL.te_versturen}")`, inv.rijen.filter((r) => r.status === 'te_versturen').length), stijl: 'aantal' as const },
          { label: 'Verstuurd (aantal)', waarde: formule(`COUNTIF(${status},"${INVOICE_STATUS_LABEL.verstuurd}")`, inv.rijen.filter((r) => r.status === 'verstuurd').length), stijl: 'aantal' as const },
          { label: 'Te versturen (excl. btw)', waarde: formule(`SUMIF(${status},"${INVOICE_STATUS_LABEL.te_versturen}",${excl})`, inv.rijen.filter((r) => r.status === 'te_versturen').reduce((s, r) => s + r.amount_excl, 0)), stijl: 'euro' as const },
          { label: 'Verstuurd (excl. btw)', waarde: formule(`SUMIF(${status},"${INVOICE_STATUS_LABEL.verstuurd}",${excl})`, inv.rijen.filter((r) => r.status === 'verstuurd').reduce((s, r) => s + r.amount_excl, 0)), stijl: 'euro' as const },
          { label: 'Totaal excl. btw (zonder geannuleerd)', waarde: formule(`SUM(${excl})-SUMIF(${status},"${INVOICE_STATUS_LABEL.geannuleerd}",${excl})`, inv.rijen.filter((r) => r.status !== 'geannuleerd').reduce((s, r) => s + r.amount_excl, 0)), stijl: 'euro' as const },
        ],
      },
    ],
  }
  werkmap.bladen = [samenvatting, factuurBlad]
  return werkmap
}
