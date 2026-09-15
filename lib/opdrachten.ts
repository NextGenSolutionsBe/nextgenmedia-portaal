// Opdrachten — pure module, ook bruikbaar in clientcomponenten.
//
// Een opdracht is werk dat binnenkomt en opgevolgd moet worden: een
// contentshoot die gepland staat, een voorstel dat de deur uit is, iets waar
// we op de klant wachten. Zulke dingen blijven anders liggen omdat ze nergens
// staan — dat is precies wat deze module oplost.

export type OpdrachtStatus = 'open' | 'bezig' | 'wacht' | 'afgerond' | 'geannuleerd'

export type StatusInfo = {
  key: OpdrachtStatus
  label: string
  /** Korte uitleg in de UI, zodat iedereen dezelfde status hetzelfde gebruikt. */
  hint: string
  badge: string
  /** Telt deze status mee als "nog te doen"? */
  openstaand: boolean
}

export const STATUSSEN: StatusInfo[] = [
  {
    key: 'open', label: 'Te doen', openstaand: true,
    hint: 'Binnengekomen, nog niet aan begonnen.',
    badge: 'bg-gray-100 text-gray-700 border-gray-200',
  },
  {
    key: 'bezig', label: 'Bezig', openstaand: true,
    hint: 'We zijn ermee bezig.',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  {
    key: 'wacht', label: 'Wacht op klant', openstaand: true,
    hint: 'Bal ligt bij de klant — voorstel verstuurd, materiaal gevraagd, …',
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  {
    key: 'afgerond', label: 'Afgerond', openstaand: false,
    hint: 'Klaar.',
    badge: 'bg-green-50 text-green-700 border-green-200',
  },
  {
    key: 'geannuleerd', label: 'Geannuleerd', openstaand: false,
    hint: 'Gaat niet door.',
    badge: 'bg-gray-50 text-gray-400 border-gray-200 line-through',
  },
]

export const statusInfo = (key: string | null | undefined): StatusInfo =>
  STATUSSEN.find((s) => s.key === key) ?? STATUSSEN[0]

/** Statussen die nog aandacht vragen. */
export const OPEN_STATUSSEN: OpdrachtStatus[] = STATUSSEN.filter((s) => s.openstaand).map((s) => s.key)

export type Opdracht = {
  id: string
  client_id: string | null
  klant_vrij: string | null
  titel: string
  omschrijving: string | null
  status: OpdrachtStatus
  deadline: string | null
  wie: string | null
  afgerond_op: string | null
  created_at: string
  /** Meegeleverd door de API, niet in de tabel. */
  klant_naam?: string | null
}

/** Vandaag in Brussel als YYYY-MM-DD — een deadline is een DAG, geen moment. */
export function vandaagISO(nu: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(nu)
}

/**
 * Te laat? Alleen open werk met een deadline die vóór vandaag ligt.
 *
 * Vandaag zelf telt bewust NIET als te laat: je hebt de hele dag nog. Wie
 * "vandaag" apart wil zien, gebruikt isVandaag().
 */
export function isTeLaat(o: Pick<Opdracht, 'status' | 'deadline'>, nu: Date = new Date()): boolean {
  if (!o.deadline) return false
  if (!OPEN_STATUSSEN.includes(o.status)) return false
  return o.deadline < vandaagISO(nu)
}

export function isVandaag(o: Pick<Opdracht, 'status' | 'deadline'>, nu: Date = new Date()): boolean {
  if (!o.deadline) return false
  if (!OPEN_STATUSSEN.includes(o.status)) return false
  return o.deadline === vandaagISO(nu)
}

/** "3 dagen te laat", "vandaag", "over 5 dagen" — in gewone taal. */
export function deadlineTekst(deadline: string | null, nu: Date = new Date()): string | null {
  if (!deadline) return null
  const vandaag = vandaagISO(nu)
  if (deadline === vandaag) return 'vandaag'
  // Dagen tellen via UTC-middag: zo kan zomertijd de uitkomst niet verschuiven.
  const d = (s: string) => Date.parse(`${s}T12:00:00Z`)
  const dagen = Math.round((d(deadline) - d(vandaag)) / 86400000)
  if (dagen === 1) return 'morgen'
  if (dagen === -1) return '1 dag te laat'
  if (dagen < 0) return `${Math.abs(dagen)} dagen te laat`
  return `over ${dagen} dagen`
}

/**
 * Sorteervolgorde van de lijst: eerst wat aandacht vraagt.
 * Open werk boven afgerond, daarbinnen op deadline (zonder deadline achteraan),
 * en gelijke gevallen op aanmaakdatum zodat de volgorde niet zomaar wisselt.
 */
export function sorteer(a: Opdracht, b: Opdracht): number {
  const openA = OPEN_STATUSSEN.includes(a.status) ? 0 : 1
  const openB = OPEN_STATUSSEN.includes(b.status) ? 0 : 1
  if (openA !== openB) return openA - openB
  if (a.deadline !== b.deadline) {
    if (!a.deadline) return 1
    if (!b.deadline) return -1
    return a.deadline < b.deadline ? -1 : 1
  }
  return (b.created_at ?? '').localeCompare(a.created_at ?? '')
}
