// De pure kern van de facturatieopdrachten: types, labels, de afleiding van
// het facturatieschema en de prioriteitsregel. GEEN 'server-only', geen
// databank — zo is dit los testbaar (scratch-facturatie-test.ts) en kan het
// scherm dezelfde labels gebruiken.

export type OpdrachtType = 'voorschot' | 'saldo' | 'periodiek' | 'volledig'
export type OpdrachtStatus = 'open' | 'controle_vereist' | 'afgehandeld' | 'geannuleerd'
export type SyncStatus = 'in_afwachting' | 'gesynchroniseerd' | 'mislukt' | 'controle_vereist'

export const TYPE_LABEL: Record<OpdrachtType, string> = { voorschot: 'Voorschot', saldo: 'Saldo', periodiek: 'Periodiek', volledig: 'Volledig bedrag' }
export const OPDRACHT_STATUS_LABEL: Record<OpdrachtStatus, string> = { open: 'Open', controle_vereist: 'Controle vereist', afgehandeld: 'Afgehandeld', geannuleerd: 'Geannuleerd' }
export const SYNC_LABEL: Record<SyncStatus, string> = { in_afwachting: 'In afwachting', gesynchroniseerd: 'Gesynchroniseerd', mislukt: 'Mislukt', controle_vereist: 'Controle vereist' }

export type Opdracht = {
  id: string; contract_id: string; client_id: string | null
  volgnr: number; aantal: number; type: OpdrachtType
  factuurdatum: string; periode: string | null
  bedrag_excl: number | null; btw_pct: number; bedrag_incl: number | null
  omschrijving: string | null; betalingstermijn_dagen: number | null
  status: OpdrachtStatus; ontbrekend: string[]; aandachtspunten: string[]
  sync_status: SyncStatus; clickup_task_id: string | null; clickup_url: string | null
  sync_fout: string | null; sync_pogingen: number; laatste_sync_op: string | null
  vingerafdruk: string | null; invoice_id: string | null; bron: string
  created_at: string; updated_at: string
}

export type ContractRij = {
  id: string; title: string | null; status: string | null; client_id: string | null; service_slug: string | null
  start_date: string | null; end_date: string | null; duration_type: string | null; signed_at: string | null
  signer_name: string | null; signer_email: string | null
  expected_invoice_count: number | null; invoice_frequency: string | null; expected_invoice_amount_excl: number | null
}
export type KlantRij = { id: string; company_name: string | null; contact_name: string | null; email: string | null; btw_nummer: string | null }

const n = (v: unknown): number | null => { if (v === null || v === undefined || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null }
const dag = (s: string | null | undefined): string | null => (s ? String(s).slice(0, 10) : null)
const vandaag = () => new Date().toISOString().slice(0, 10)
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Maanden per factuur voor de frequenties uit de Contractenmodule. */
const STAP: Record<string, number> = { maandelijks: 1, kwartaal: 3 }

export type Moment = {
  volgnr: number; aantal: number; type: OpdrachtType; factuurdatum: string; periode: string | null
  bedrag_excl: number | null; omschrijving: string
}
export type Schema = { momenten: Moment[]; ontbrekend: string[]; aandachtspunten: string[] }

/**
 * De facturatiemomenten van een contract, uit de bestaande velden
 * (aantal facturen, frequentie, bedrag per factuur, start/einde). Ontbreekt
 * iets essentieels (bedrag, of frequentie/aantal), dan komt er precies één
 * opdracht "Controle vereist" met de lijst van wat ontbreekt — nooit een
 * verzonnen schema.
 */
export function leidSchemaAf(c: ContractRij, klant: KlantRij | null, nu = vandaag()): Schema {
  const ontbrekend: string[] = []
  const aandachtspunten: string[] = []
  const bedrag = n(c.expected_invoice_amount_excl)
  const start = dag(c.start_date) ?? dag(c.signed_at) ?? nu
  const titel = c.title ?? 'Contract'

  if (!c.client_id || !klant) ontbrekend.push('klant (geen klantendossier gekoppeld aan het contract)')
  if (bedrag === null || bedrag <= 0) ontbrekend.push('bedrag per factuur excl. btw (facturatieafspraken op het contract)')
  if (klant && !klant.btw_nummer) aandachtspunten.push('ondernemingsnummer ontbreekt in het klantendossier')
  if (klant && !klant.email) aandachtspunten.push('e-mailadres ontbreekt in het klantendossier')
  aandachtspunten.push('facturatieadres staat niet in het klantendossier — controleer op de factuur')
  aandachtspunten.push('betalingstermijn is niet vastgelegd in het contract')

  const freq = (c.invoice_frequency ?? '').trim()
  const aantalOpgegeven = n(c.expected_invoice_count)
  const eenmalig = freq === 'eenmalig' || (!freq && (c.duration_type === 'eenmalig' || aantalOpgegeven === 1))

  let aantal: number | null = null
  let stap = 0
  if (eenmalig) { aantal = 1 }
  else if (freq === 'aangepast') {
    ontbrekend.push("facturatieschema staat op 'aangepast' — bepaal de facturatiemomenten handmatig")
  } else if (STAP[freq]) {
    stap = STAP[freq]
    if (aantalOpgegeven && aantalOpgegeven > 0) aantal = Math.round(aantalOpgegeven)
    else if (c.start_date && c.end_date) {
      const a = new Date(c.start_date), b = new Date(c.end_date)
      const maanden = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1
      aantal = Math.max(1, Math.ceil(maanden / stap))
    } else ontbrekend.push('aantal facturen (of een einddatum) op het contract')
  } else {
    ontbrekend.push('facturatiefrequentie (eenmalig, maandelijks of per kwartaal) op het contract')
  }
  if (aantal !== null && aantal > 60) { ontbrekend.push(`aantal facturen (${aantal}) is onwaarschijnlijk hoog — controleer de facturatieafspraken`); aantal = null }

  if (ontbrekend.length) {
    return {
      momenten: [{ volgnr: 1, aantal: 1, type: eenmalig || !stap ? 'volledig' : 'periodiek', factuurdatum: start, periode: start.slice(0, 7), bedrag_excl: bedrag, omschrijving: titel }],
      ontbrekend, aandachtspunten,
    }
  }

  const s = new Date(start + 'T00:00:00')
  const momenten: Moment[] = []
  for (let i = 0; i < (aantal ?? 1); i++) {
    const m = new Date(s.getFullYear(), s.getMonth() + i * stap, 1)
    const laatste = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()
    const d = new Date(m.getFullYear(), m.getMonth(), Math.min(s.getDate(), laatste))
    const periode = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    momenten.push({
      volgnr: i + 1, aantal: aantal ?? 1, type: (aantal ?? 1) === 1 ? 'volledig' : 'periodiek',
      factuurdatum: ymd(d), periode, bedrag_excl: bedrag,
      omschrijving: (aantal ?? 1) === 1 ? titel : `${titel} · termijn ${i + 1}/${aantal} (${periode})`,
    })
  }
  return { momenten, ontbrekend, aandachtspunten }
}

/** Binnen twee werkdagen (weekend telt niet mee) → prioriteit High. */
export function binnenTweeWerkdagen(factuurdatum: string, nu = new Date()): boolean {
  const doel = new Date(factuurdatum + 'T00:00:00')
  const start = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate())
  if (doel <= start) return true
  let werkdagen = 0
  const d = new Date(start)
  while (d < doel) { d.setDate(d.getDate() + 1); const wd = d.getDay(); if (wd !== 0 && wd !== 6) werkdagen++ }
  return werkdagen <= 2
}
