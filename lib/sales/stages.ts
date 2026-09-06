// Pipeline-fases voor de Verkoop-module (§3).
// Pure module — geen server-only imports, bruikbaar in client- én servercode.
//
// ÉÉN LIJST, DRIE KANALEN. Dezelfde pipeline bedient cold calling (in deze app)
// en cold e-mail plus LinkedIn (door Harrie, ons acquisitiesysteem). Daarom is
// "Gecontacteerd" gesplitst per kanaal: je zag vroeger wel DÁT er contact was,
// maar niet waarlangs — en dus niet waar de opvolging hoort te gebeuren.
//
// DE FASE ZEGT WAAR DE VOLGENDE STAP LIGT, niet wat er allemaal gebeurd is.
// Een lead kan langs drie kanalen benaderd zijn; de volledige geschiedenis
// staat op de tijdlijn.
//
// `key` is STABIEL en wordt door Harrie gebruikt om op te matchen. `label` is
// vrije tekst en mag veranderen.

export const STAGES = [
  { key: 'to_contact',         label: 'Nog te contacteren',        position: 1 },
  { key: 'contacted_call',     label: 'Gecontacteerd · Bellen',    position: 2 },
  { key: 'contacted_linkedin', label: 'Gecontacteerd · LinkedIn',  position: 3 },
  { key: 'contacted_mail',     label: 'Gecontacteerd · Mail',      position: 4 },
  { key: 'email_after_call',   label: 'E-mail versturen na bellen', position: 5 },
  { key: 'email_sent',         label: 'E-mail verstuurd',          position: 6 },
  { key: 'not_interested',     label: 'Geen interesse',            position: 7 },
  { key: 'appointment',        label: 'Afspraak ingepland',        position: 8 },
  // Onbereikbaar na MAX_GEEN_GEHOOR pogingen. Bewust een eigen fase en geen
  // "geen interesse": deze mensen hébben niets gezegd, en dat is iets anders
  // dan nee. Zo blijven ze terugvindbaar voor een mailronde.
  { key: 'max_pogingen',       label: 'Max. belpogingen',          position: 9 },
  { key: 'won',                label: 'Closed Won',                position: 10, isWon: true },
  { key: 'lost',               label: 'Closed Lost',               position: 11, isLost: true },
] as const

export type StageKey = (typeof STAGES)[number]['key']

export const STAGE_KEYS = STAGES.map((s) => s.key) as StageKey[]
export const stageLabel = (key: string): string =>
  STAGES.find((s) => s.key === key)?.label ?? key
export const isStageKey = (v: unknown): v is StageKey =>
  typeof v === 'string' && (STAGE_KEYS as string[]).includes(v)

/** De drie "gecontacteerd"-fases, per kanaal. */
export const CONTACTED_STAGES: StageKey[] = ['contacted_call', 'contacted_linkedin', 'contacted_mail']

/** Het kanaal waarlangs het laatste contact liep, of null. */
export function stageKanaal(key: string): 'bellen' | 'linkedin' | 'mail' | null {
  if (key === 'contacted_call') return 'bellen'
  if (key === 'contacted_linkedin') return 'linkedin'
  if (key === 'contacted_mail' || key === 'email_sent') return 'mail'
  return null
}

/**
 * Hoe ver staat een lead? Gebruikt om te bewaken dat een lead NOOIT terugvalt
 * naar een vroegere fase: staat er al een afspraak en meldt Harrie nog een
 * verstuurde mail, dan is dat een regel op de tijdlijn en geen stap terug.
 *
 * De eindfases krijgen bewust een hoge rang. Een "sent" op iemand die al nee
 * zei, mag hem niet terug op "Gecontacteerd · Mail" zetten.
 */
const RANG: Record<string, number> = {
  to_contact: 10,
  contacted_call: 20, contacted_linkedin: 20, contacted_mail: 20,
  email_after_call: 30,
  email_sent: 40,
  appointment: 50,
  max_pogingen: 80,
  not_interested: 90,
  lost: 95,
  won: 99,
}
export const stageRang = (key: string): number => RANG[key] ?? 0

/**
 * "Afspraak ingepland" ontstaat UITSLUITEND door een geslaagde boeking (§3, §6).
 * Daarom staat die fase nergens in een dropdown en kan hij niet via de gewone
 * status-API gezet worden — enkel de boekingsroute en Harrie's boeking mogen
 * hem toekennen.
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

/**
 * Sneltoetsen in Focus Mode (§4). null = geen fasewissel, enkel loggen.
 *
 * "Interesse" zet GEEN eigen fase meer. Die bestond wel, maar met drie kanalen
 * zou je daarmee het kanaal weggooien: een lead die interessant klonk aan de
 * telefoon hoort op "Gecontacteerd · Bellen" te blijven staan, met een warme
 * markering erbij. Precies hetzelfde gebeurt als iemand op Harrie's mail
 * antwoordt — één begrip, één weergave.
 */
export const FOCUS_ACTIONS: {
  key: string; label: string; stage: StageKey | null
  opensBooking?: boolean
  /** Zet de warme markering: deze prospect toonde zelf interesse. */
  markeerWarm?: boolean
}[] = [
  { key: '1', label: 'Geen antwoord',    stage: 'contacted_call' },
  { key: '2', label: 'Gesproken',        stage: 'contacted_call' },
  { key: '3', label: 'Interesse',        stage: 'contacted_call', markeerWarm: true },
  { key: '4', label: 'Afspraak boeken',  stage: null, opensBooking: true },
  { key: '5', label: 'E-mail versturen', stage: 'email_after_call' },
  { key: '6', label: 'Geen interesse',   stage: 'not_interested' },
]
