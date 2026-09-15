// Genormaliseerde contractstatussen. We bewaren bestaande statuswaarden in de DB
// (draft/sent/viewed/signed/expired/cancelled/vervangen) ZONDER risicovolle datamigratie,
// en tonen overal de fase-2 vocabulaire. Oude én nieuwe waarden mappen op één canonieke key.

export type ContractStatusKey =
  | 'template'
  | 'klaar_voor_verzenden'
  | 'verzonden'
  | 'geopend'
  | 'ingevuld'
  | 'getekend'
  | 'geannuleerd'
  | 'verlopen'
  | 'vervangen'

export type ContractStatusInfo = { key: ContractStatusKey; label: string; cls: string }

const INFO: Record<ContractStatusKey, { label: string; cls: string }> = {
  template:             { label: 'Template',             cls: 'bg-purple-100 text-purple-700' },
  klaar_voor_verzenden: { label: 'Klaar voor verzenden', cls: 'bg-gray-100 text-gray-600' },
  verzonden:            { label: 'Verzonden',            cls: 'bg-blue-100 text-blue-700' },
  geopend:              { label: 'Geopend',              cls: 'bg-amber-100 text-amber-700' },
  ingevuld:             { label: 'Ingevuld',             cls: 'bg-amber-100 text-amber-700' },
  getekend:             { label: 'Getekend',             cls: 'bg-green-100 text-green-700' },
  geannuleerd:          { label: 'Geannuleerd',          cls: 'bg-gray-100 text-gray-500' },
  verlopen:             { label: 'Verlopen',             cls: 'bg-red-100 text-red-700' },
  vervangen:            { label: 'Vervangen',            cls: 'bg-orange-100 text-orange-700' },
}

// Oude/varianten → canonieke key.
const ALIAS: Record<string, ContractStatusKey> = {
  template: 'template',
  draft: 'klaar_voor_verzenden',
  klaar_voor_verzenden: 'klaar_voor_verzenden',
  sent: 'verzonden',
  verzonden: 'verzonden',
  viewed: 'geopend',
  geopend: 'geopend',
  opened: 'geopend',
  ingevuld: 'ingevuld',
  filled: 'ingevuld',
  signed: 'getekend',
  getekend: 'getekend',
  cancelled: 'geannuleerd',
  canceled: 'geannuleerd',
  geannuleerd: 'geannuleerd',
  expired: 'verlopen',
  verlopen: 'verlopen',
  vervangen: 'vervangen',
  replaced: 'vervangen',
}

/** Canonieke key voor een opgeslagen status (oud of nieuw). */
export function canonicalStatus(status: string | null | undefined): ContractStatusKey {
  if (!status) return 'klaar_voor_verzenden'
  return ALIAS[status.toLowerCase()] ?? 'klaar_voor_verzenden'
}

/** Label + stijl voor weergave. */
export function statusInfo(status: string | null | undefined): ContractStatusInfo {
  const key = canonicalStatus(status)
  return { key, ...INFO[key] }
}

/** Filteropties (canonieke keys) voor de admin-lijst. */
export const STATUS_FILTER_OPTIONS: { value: ContractStatusKey; label: string }[] = [
  { value: 'klaar_voor_verzenden', label: 'Klaar voor verzenden' },
  { value: 'verzonden',            label: 'Verzonden' },
  { value: 'geopend',              label: 'Geopend' },
  { value: 'getekend',             label: 'Getekend' },
  { value: 'verlopen',             label: 'Verlopen' },
  { value: 'geannuleerd',          label: 'Geannuleerd' },
  { value: 'vervangen',            label: 'Vervangen' },
]

/** Opvolging/reminders: bepaalt of een contract aandacht vereist (geen automail). */
export type FollowUp = { needs: boolean; level: 'none' | 'warn' | 'urgent'; reason: string }

export function followUp(c: {
  status: string | null | undefined
  sent_at?: string | null
  created_at?: string | null
  expires_at?: string | null
}): FollowUp {
  const key = canonicalStatus(c.status)
  const now = Date.now()
  const days = (d?: string | null) => (d ? Math.floor((now - new Date(d).getTime()) / 86400000) : null)

  // Verlopen → urgent.
  if (key === 'verlopen') return { needs: true, level: 'urgent', reason: 'Tekenlink verlopen' }
  if (c.expires_at && String(c.expires_at).slice(0, 10) < new Date().toISOString().slice(0, 10) && key !== 'getekend' && key !== 'geannuleerd') {
    return { needs: true, level: 'urgent', reason: 'Tekenlink verlopen' }
  }

  // Verzonden/geopend en al een tijd geen handtekening.
  if (key === 'verzonden' || key === 'geopend' || key === 'ingevuld') {
    const age = days(c.sent_at) ?? days(c.created_at)
    if (age !== null && age >= 7) return { needs: true, level: 'urgent', reason: `${age} dagen open` }
    if (age !== null && age >= 3) return { needs: true, level: 'warn', reason: `${age} dagen open` }
  }
  return { needs: false, level: 'none', reason: '' }
}

/** Gemiddelde tekentijd (in dagen) over getekende contracten met sent_at + signed_at. */
export function averageSignDays(contracts: Array<{ status: string | null; sent_at?: string | null; signed_at?: string | null }>): number | null {
  const spans: number[] = []
  for (const c of contracts) {
    if (canonicalStatus(c.status) !== 'getekend') continue
    if (!c.sent_at || !c.signed_at) continue
    const d = (new Date(c.signed_at).getTime() - new Date(c.sent_at).getTime()) / 86400000
    if (Number.isFinite(d) && d >= 0) spans.push(d)
  }
  if (spans.length === 0) return null
  return Math.round((spans.reduce((a, b) => a + b, 0) / spans.length) * 10) / 10
}

/** Contracttypes (verplicht bij aanmaken). */
export const CONTRACT_TYPES = [
  'Klantcontract',
  'Websitecontract',
  'Social Media contract',
  'Brandingcontract',
  'Foto/videografiecontract',
  'Partnercontract',
  'Onderaannemerscontract',
  'Freelancecontract',
  'Samenwerkingsovereenkomst',
  'NDA / geheimhouding',
  'Overige',
] as const

/** Contractduur-types. */
export const DURATION_TYPES: { value: string; label: string; months?: number }[] = [
  { value: 'eenmalig', label: 'Eenmalig' },
  { value: 'maandelijks', label: 'Maandelijks', months: 1 },
  { value: '3m', label: '3 maanden', months: 3 },
  { value: '6m', label: '6 maanden', months: 6 },
  { value: '12m', label: '12 maanden', months: 12 },
  { value: 'onbepaald', label: 'Onbepaalde duur' },
  { value: 'aangepast', label: 'Aangepast' },
]

export function durationLabel(value: string | null | undefined): string {
  return DURATION_TYPES.find((d) => d.value === value)?.label ?? '—'
}

/** Contracttemplate-categorieën (vaste lijst). */
export const TEMPLATE_CATEGORIES = [
  'Social Media pakket 1',
  'Social Media pakket 2',
  'Social Media pakket 3',
  'Webdesign',
  'Branding',
  'Fotografie',
  'Videografie',
  'Marketing Consultancy',
  'Partnerovereenkomst',
  'Overige',
] as const
