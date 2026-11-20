// Salesactiviteiten — pure module (geen server-imports), gedeeld door het
// bord, de dialogen, de statistieken en de tests.
//
// Een activiteit is wat een MEDEWERKER deed op een lead: gebeld, gemaild,
// notitie, opvolgdatum gezet, afspraak gepland, voorstel verstuurd, deal
// gewonnen/verloren, fase gewijzigd. Hier draaien de statistieken op. De
// tijdlijn (sales_lead_events) blijft de leesbare historiek; elke activiteit
// schrijft daar ook een regel (zie lib/sales/activiteiten.ts).
//
// BELANGRIJK: een kaart naar "Gebeld" slepen registreert GEEN gesprek. Enkel
// het dialoogvenster "Gesprek registreren" doet dat. Anders telt de statistiek
// gesprekken die nooit gevoerd zijn.

export const ACTIVITEIT_TYPES = [
  'telefoongesprek',
  'email_verstuurd',
  'lead_afgehandeld',
  'opvolging',
  'afspraak_gepland',
  'voorstel_verstuurd',
  'deal_gewonnen',
  'deal_verloren',
  'interne_notitie',
  'fase_gewijzigd',
] as const

export type ActiviteitType = (typeof ACTIVITEIT_TYPES)[number]

export const isActiviteitType = (v: unknown): v is ActiviteitType =>
  typeof v === 'string' && (ACTIVITEIT_TYPES as readonly string[]).includes(v)

export const ACTIVITEIT_LABEL: Record<ActiviteitType, string> = {
  telefoongesprek: 'Telefoongesprek',
  email_verstuurd: 'E-mail verstuurd',
  lead_afgehandeld: 'Lead afgehandeld',
  opvolging: 'Opvolgdatum gezet',
  afspraak_gepland: 'Afspraak gepland',
  voorstel_verstuurd: 'Voorstel verstuurd',
  deal_gewonnen: 'Deal gewonnen',
  deal_verloren: 'Deal verloren',
  interne_notitie: 'Interne notitie',
  fase_gewijzigd: 'Fase gewijzigd',
}

/** Uitkomst van een telefoongesprek. */
export const UITKOMSTEN = [
  { key: 'niet_opgenomen',   label: 'Niet opgenomen',   contact: false },
  { key: 'voicemail',        label: 'Voicemail',        contact: false },
  { key: 'contact_gehad',    label: 'Contact gehad',    contact: true },
  { key: 'terugbellen',      label: 'Terugbellen',      contact: true },
  { key: 'geen_interesse',   label: 'Geen interesse',   contact: true },
  { key: 'afspraak_gepland', label: 'Afspraak gepland', contact: true },
] as const

export type Uitkomst = (typeof UITKOMSTEN)[number]['key']

export const isUitkomst = (v: unknown): v is Uitkomst =>
  typeof v === 'string' && UITKOMSTEN.some((u) => u.key === v)

export const uitkomstLabel = (key: string | null | undefined): string =>
  UITKOMSTEN.find((u) => u.key === key)?.label ?? (key ?? '—')

/**
 * Telt deze gespreksuitkomst als "geslaagd contact" voor de statistiek?
 * Contact gehad, terugbellen, geen interesse en afspraak gepland: er is met
 * iemand gesproken. Niet opgenomen en voicemail tellen niet.
 */
export const GESLAAGD_CONTACT = new Set<string>(['contact_gehad', 'terugbellen', 'geen_interesse', 'afspraak_gepland'])

/** Seconden → "m:ss" (of "u:mm:ss" boven het uur). */
export function formatDuur(seconden: number | null | undefined): string {
  if (seconden === null || seconden === undefined || !Number.isFinite(seconden) || seconden < 0) return '—'
  const s = Math.round(seconden)
  const u = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (u > 0) return `${u}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return `${m}:${String(r).padStart(2, '0')}`
}

/** "3:20", "03:20", "200" (seconden) of "1:02:05" → seconden. Null bij onzin. */
export function parseDuur(tekst: string | null | undefined): number | null {
  const t = (tekst ?? '').trim()
  if (!t) return null
  if (/^\d+$/.test(t)) { const n = Number(t); return n >= 0 ? n : null }
  const delen = t.split(':').map((d) => d.trim())
  if (delen.length < 2 || delen.length > 3 || delen.some((d) => !/^\d{1,2}$/.test(d))) return null
  const nums = delen.map(Number)
  const sec = delen.length === 3
    ? nums[0] * 3600 + nums[1] * 60 + nums[2]
    : nums[0] * 60 + nums[1]
  return Number.isFinite(sec) ? sec : null
}

export type Activiteit = {
  id: string
  lead_id: string
  medewerker_id: string | null
  medewerker_email: string | null
  type: ActiviteitType | string
  duur_seconden: number | null
  uitkomst: string | null
  notitie: string | null
  opvolgdatum: string | null
  naar_fase: string | null
  afspraak_id: string | null
  verwijderd_op: string | null
  created_at: string
}
