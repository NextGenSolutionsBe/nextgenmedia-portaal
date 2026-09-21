// Gedeelde types voor het kanbanbord, het detailpaneel en de dialogen.

/** Wat Harrie per lead meestuurt. Alles optioneel: hij vult wat hij weet. */
export type HarrieBlok = {
  kanaal?: string | null
  stap?: number | null
  berichtenVerstuurd?: number | null
  laatsteContact?: string | null
  dagenSindsContact?: number | null
  reageerde?: boolean | null
  laatsteReactie?: string | null
  afspraak?: string | null
  nogBezig?: boolean | null
  uitgeschreven?: boolean | null
  /** De ene regel die een setter moet lezen vóór hij belt. */
  belAdvies?: string | null
}

export type Lead = {
  id: string
  stage_key: string
  labels: string[]
  callback_at: string | null
  callback_note?: string | null
  geen_gehoor_count?: number | null
  pipeline_id?: string | null
  merken?: string[] | null
  assigned_to: string | null
  do_not_call: boolean
  updated_at: string
  created_at?: string
  lost_reason: string | null
  reden_code?: string | null
  warm?: boolean | null
  harrie?: HarrieBlok | null
  laatste_notitie?: string | null
  laatste_notitie_op?: string | null
  leadbron?: string | null
  positie?: number | null
  dienst?: string | null
  opvolgdatum?: string | null
  deal_waarde_cents?: number | null
  gesloten_op?: string | null
  verlies_reden?: string | null
  sales_companies: {
    id: string; name: string; website: string | null; sector: string | null
    city: string | null; region: string | null; phone: string | null
    email?: string | null
    gatekeeper_naam?: string | null; dmu_naam?: string | null; dmu_functie?: string | null
  } | null
  sales_contacts: {
    id: string; name: string | null; email: string | null; phone: string | null
    mobile: string | null; role: string | null
  } | null
}

export type Pipeline = { id: string; name: string; key: string }
export type Medewerker = { id: string; naam: string }

export const telefoonVan = (l: Lead): string =>
  l.sales_contacts?.phone || l.sales_contacts?.mobile || l.sales_companies?.phone || ''

export const emailVan = (l: Lead): string =>
  l.sales_contacts?.email || l.sales_companies?.email || ''

/** Het vastgelegde merk van een lead (leeg tot er een afspraak staat). */
export function merkenVan(lead: { merken?: string[] | null }, pipelines: Pipeline[]): Pipeline[] {
  const keys = lead.merken ?? []
  return pipelines.filter((p) => keys.includes(p.key))
}

/** Vandaag als JJJJ-MM-DD (lokale tijd). */
export function vandaag(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** JJJJ-MM-DD → "21 sep". */
export function korteDatum(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return ''
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })
}

export const euro = (cents: number | null | undefined): string =>
  typeof cents === 'number'
    ? new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cents / 100)
    : '—'
