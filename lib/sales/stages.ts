// Pipeline-fases voor de Verkoop-module — de kolommen van het kanbanbord.
// Pure module — geen server-only imports, bruikbaar in client- én servercode.
//
// ÉÉN BORD, ACHT KOLOMMEN + TWEE INSTROOMKOLOMMEN. De fase zegt waar de
// volgende stap ligt, niet wat er allemaal gebeurd is; de volledige historiek
// staat op de tijdlijn (sales_lead_events) en in de activiteiten
// (sales_activiteiten).
//
// `key` is STABIEL: hij staat in sales_leads.stage_key, in sales_stages en
// wordt door Harrie gebruikt om op te matchen. `label` is vrije tekst.
//
// De vorige fase-set (to_contact, contacted_call, …) leeft nog in oude rijen en
// in oude tijdlijnregels. LEGACY_STAGE_MAP vertaalt die naar de nieuwe
// kolommen; normaliseerStage() past die vertaling toe op alles wat gelezen
// wordt, zodat het bord ook klopt vóór de migratie de rijen bijwerkt.

export const STAGES = [
  { key: 'outbound',        label: 'Outbound leads',     position: 1 },
  { key: 'inbound',         label: 'Inbound leads',      position: 2 },
  { key: 'gebeld',          label: 'Gebeld',             position: 3 },
  { key: 'email_verstuurd', label: 'E-mail verstuurd',   position: 4 },
  { key: 'opvolgen',        label: 'Opvolgen',           position: 5 },
  { key: 'afspraak',        label: 'Afspraak gepland',   position: 6 },
  { key: 'voorstel',        label: 'Voorstel verstuurd', position: 7 },
  { key: 'gewonnen',        label: 'Gewonnen',           position: 8, isWon: true },
  { key: 'verloren',        label: 'Verloren',           position: 9, isLost: true },
] as const

export type StageKey = (typeof STAGES)[number]['key']

export const STAGE_KEYS = STAGES.map((s) => s.key) as StageKey[]

/**
 * Oude sleutel → nieuwe kolom. Alles wat hier niet in staat en ook geen nieuwe
 * sleutel is, landt op 'outbound' — liever zichtbaar in de eerste kolom dan
 * onzichtbaar in geen enkele.
 */
export const LEGACY_STAGE_MAP: Record<string, StageKey> = {
  to_contact: 'outbound',
  contacted_call: 'gebeld',
  // LinkedIn is schriftelijk contact, geen gesprek: hoort bij "E-mail verstuurd".
  contacted_linkedin: 'email_verstuurd',
  contacted_mail: 'email_verstuurd',
  email_after_call: 'opvolgen',
  email_sent: 'email_verstuurd',
  not_interested: 'verloren',
  appointment: 'afspraak',
  max_pogingen: 'opvolgen',
  won: 'gewonnen',
  lost: 'verloren',
}

export const LEGACY_STAGE_KEYS = Object.keys(LEGACY_STAGE_MAP)

export const isStageKey = (v: unknown): v is StageKey =>
  typeof v === 'string' && (STAGE_KEYS as string[]).includes(v)

/** Eender welke (oude of nieuwe) sleutel naar een geldige kolom. */
export function normaliseerStage(key: string | null | undefined): StageKey {
  if (isStageKey(key)) return key
  if (key && LEGACY_STAGE_MAP[key]) return LEGACY_STAGE_MAP[key]
  return 'outbound'
}

/**
 * Alle sleutels die in de databank voor deze kolom kunnen staan: de nieuwe
 * plus de oude die erop uitkomen. Voor server-side filters (`.in('stage_key',
 * …)`), zodat rijen met een oude sleutel niet wegvallen.
 */
export function stageKeysVoor(key: StageKey): string[] {
  return [key, ...LEGACY_STAGE_KEYS.filter((k) => LEGACY_STAGE_MAP[k] === key)]
}

export const stageLabel =(key: string | null | undefined): string => {
  const k = normaliseerStage(key)
  return STAGES.find((s) => s.key === k)?.label ?? String(key ?? '—')
}

export const isWonStage = (key: string | null | undefined): boolean => normaliseerStage(key) === 'gewonnen'
export const isLostStage = (key: string | null | undefined): boolean => normaliseerStage(key) === 'verloren'
/** Gesloten: er komt geen volgende stap meer. */
export const isGesloten = (key: string | null | undefined): boolean => isWonStage(key) || isLostStage(key)

/**
 * Hoe ver staat een lead? Harrie gebruikt dit om te bewaken dat een lead NOOIT
 * terugvalt naar een vroegere fase door een late contactmelding: staat er al
 * een afspraak en meldt Harrie nog een verstuurde mail, dan is dat een regel op
 * de tijdlijn en geen stap terug.
 */
const RANG: Record<StageKey, number> = {
  outbound: 10, inbound: 10,
  gebeld: 20, email_verstuurd: 20,
  opvolgen: 30,
  afspraak: 50,
  voorstel: 60,
  verloren: 90,
  gewonnen: 99,
}
export const stageRang = (key: string): number => RANG[normaliseerStage(key)] ?? 0

/** De fase die een geslaagde boeking zet. */
export const APPOINTMENT_STAGE: StageKey = 'afspraak'
export const WON_STAGE: StageKey = 'gewonnen'
export const LOST_STAGE: StageKey = 'verloren'

/** Fases die een mens handmatig mag kiezen — alle, dus. */
export const MANUAL_STAGES: StageKey[] = [...STAGE_KEYS]

/**
 * Mag deze overgang handmatig? Iedereen beweegt vrij door alle kolommen; het
 * bord is een werkinstrument, geen statusmachine. Enkel een onbekend doel of
 * "naar dezelfde kolom" wordt geweigerd.
 */
export function canTransition(from: string, to: string): boolean {
  if (!isStageKey(to)) return false
  if (normaliseerStage(from) === to) return false
  return true
}

/** Reden waarom een overgang geweigerd wordt (voor een nette melding). */
export function transitionError(from: string, to: string): string | null {
  if (canTransition(from, to)) return null
  if (!isStageKey(to)) return 'Onbekende fase.'
  if (normaliseerStage(from) === to) return 'De lead staat al in deze fase.'
  return 'Deze fasewijziging is niet toegestaan.'
}

/**
 * Sneltoetsen in Focus Mode. Elke knop REGISTREERT een echte activiteit (die
 * telt in de statistieken) en schuift de lead hoogstens VOORUIT naar `stage`
 * — nooit terug: een lead in "Opvolgen" die je opnieuw belt, blijft daar.
 *
 * "Interesse" is geen fase maar een warme markering bovenop "contact gehad".
 * "Geen interesse" vraagt een reden en zet de lead op Verloren.
 */
export const FOCUS_ACTIONS: {
  key: string; label: string
  /** Welke activiteit de knop registreert; null = geen (enkel boeken). */
  activiteit: 'telefoongesprek' | 'email_verstuurd' | null
  /** Gespreksuitkomst bij een telefoongesprek. */
  uitkomst?: 'niet_opgenomen' | 'contact_gehad' | 'geen_interesse' | 'afspraak_gepland'
  /** Doelkolom (enkel vooruit). */
  stage: StageKey | null
  opensBooking?: boolean
  /** Zet de warme markering: deze prospect toonde zelf interesse. */
  markeerWarm?: boolean
  /** Vraagt eerst een reden (geen interesse). */
  vraagtReden?: boolean
}[] = [
  { key: '1', label: 'Geen antwoord',    activiteit: 'telefoongesprek', uitkomst: 'niet_opgenomen', stage: 'gebeld' },
  { key: '2', label: 'Gesproken',        activiteit: 'telefoongesprek', uitkomst: 'contact_gehad', stage: 'gebeld' },
  { key: '3', label: 'Interesse',        activiteit: 'telefoongesprek', uitkomst: 'contact_gehad', stage: 'gebeld', markeerWarm: true },
  { key: '4', label: 'Afspraak boeken',  activiteit: 'telefoongesprek', uitkomst: 'afspraak_gepland', stage: null, opensBooking: true },
  { key: '5', label: 'E-mail versturen', activiteit: 'email_verstuurd', stage: 'email_verstuurd' },
  { key: '6', label: 'Geen interesse',   activiteit: 'telefoongesprek', uitkomst: 'geen_interesse', stage: 'verloren', vraagtReden: true },
]

/** De doelkolom van een Focus-actie, maar enkel als dat VOORUIT is. */
export function focusDoelFase(huidig: string, doel: StageKey | null): StageKey | null {
  if (!doel) return null
  return stageRang(doel) > stageRang(huidig) ? doel : null
}

/** Kleur per kolom voor chips en kolomkoppen. */
export const STAGE_STYLE: Record<StageKey, string> = {
  outbound: 'bg-gray-100 text-gray-700',
  inbound: 'bg-sky-100 text-sky-800',
  gebeld: 'bg-blue-100 text-blue-700',
  email_verstuurd: 'bg-amber-100 text-amber-800',
  opvolgen: 'bg-orange-100 text-orange-800',
  afspraak: 'bg-[#fff848] text-black',
  voorstel: 'bg-violet-100 text-violet-800',
  gewonnen: 'bg-green-200 text-green-900',
  verloren: 'bg-red-100 text-red-700',
}
