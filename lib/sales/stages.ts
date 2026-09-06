// Pipeline-fases voor de Verkoop-module (§3).
// Pure module — geen server-only imports, bruikbaar in client- én servercode.

export const STAGES = [
  { key: 'to_contact',   label: 'Nog te contacteren', position: 1 },
  { key: 'contacted',    label: 'Gecontacteerd',      position: 2 },
  { key: 'interested',   label: 'Interesse',          position: 3 },
  { key: 'not_interested', label: 'Geen interesse',   position: 4 },
  { key: 'email_todo',   label: 'E-mail versturen',   position: 5 },
  { key: 'email_sent',   label: 'E-mail verstuurd',   position: 6 },
  { key: 'appointment',  label: 'Afspraak ingepland', position: 7 },
  // Zes keer vergeefs gebeld. Bewust een eigen fase en geen "geen interesse":
  // deze mensen hébben niets gezegd, en dat is iets anders dan nee. Zo blijven
  // ze terugvindbaar voor een latere poging of een mailronde.
  { key: 'max_pogingen', label: 'Max. belpogingen',   position: 8 },
  { key: 'won',          label: 'Closed Won',         position: 9, isWon: true },
  { key: 'lost',         label: 'Closed Lost',        position: 10, isLost: true },
] as const

export type StageKey = (typeof STAGES)[number]['key']

export const STAGE_KEYS = STAGES.map((s) => s.key) as StageKey[]
export const stageLabel = (key: string): string =>
  STAGES.find((s) => s.key === key)?.label ?? key
export const isStageKey = (v: unknown): v is StageKey =>
  typeof v === 'string' && (STAGE_KEYS as string[]).includes(v)

/**
 * "Afspraak ingepland" ontstaat UITSLUITEND door een geslaagde boeking (§3, §6).
 * Daarom staat die fase nergens in een dropdown en kan hij niet via de gewone
 * status-API gezet worden — enkel de boekingsroute mag hem toekennen.
 */
export const APPOINTMENT_STAGE: StageKey = 'appointment'

/** Fases die een mens handmatig mag kiezen. */
export const MANUAL_STAGES: StageKey[] = STAGE_KEYS.filter((k) => k !== APPOINTMENT_STAGE)

/**
 * Mag deze overgang handmatig? Setters bewegen vrij door alle belfases; alleen
 * "Afspraak ingepland" is verboden als doel. Bewust ruim: een setter die aan de
 * telefoon hangt moet niet vechten met een statusmachine — de enige harde regel
 * is dat een afspraak-status altijd een échte afspraak weerspiegelt.
 */
export function canTransition(from: string, to: string): boolean {
  if (!isStageKey(to)) return false
  if (to === APPOINTMENT_STAGE) return false      // alleen via een boeking
  if (from === to) return false
  return true
}

/** Reden waarom een overgang geweigerd wordt (voor een nette melding). */
export function transitionError(from: string, to: string): string | null {
  if (canTransition(from, to)) return null
  if (to === APPOINTMENT_STAGE) {
    return 'Deze status ontstaat automatisch zodra je een afspraak boekt in Appointment setting.'
  }
  if (!isStageKey(to)) return 'Onbekende status.'
  if (from === to) return 'De lead staat al op deze status.'
  return 'Deze statuswijziging is niet toegestaan.'
}

/** Sneltoetsen in Focus Mode (§4). null = geen fasewissel, enkel loggen. */
export const FOCUS_ACTIONS: { key: string; label: string; stage: StageKey | null; opensBooking?: boolean }[] = [
  { key: '1', label: 'Geen antwoord',   stage: 'contacted' },
  { key: '2', label: 'Gesproken',       stage: 'contacted' },
  { key: '3', label: 'Interesse',       stage: 'interested' },
  { key: '4', label: 'Afspraak boeken', stage: null, opensBooking: true },
  { key: '5', label: 'E-mail versturen', stage: 'email_todo' },
  { key: '6', label: 'Geen interesse',  stage: 'not_interested' },
]
