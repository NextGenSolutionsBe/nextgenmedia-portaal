// Taken uit de mail — pure regels (client-safe, getest in tests/mail-taken.test.ts).
//
// Uit het mailverkeer met klanten haalt de app wat wij nog moeten doen: wat we
// beloofden ("ik stuur je vrijdag het voorstel") en wat de klant vroeg of zelf
// als moment koos ("bel me na de vakantie"). Dat is een voorstel. Een mens kiest:
// Zet taak (wordt een ClickUp-taak, zelfde flow als Taken toewijzen) of Verwijder.
// Staat iets al in ClickUp, of is het daar al afgesloten, dan valt het vanzelf weg.

export type MailTaakStatus = 'voorstel' | 'ingepland' | 'in_clickup' | 'al_gedaan' | 'verwijderd'
export type MailTaakFilter = 'beslissen' | 'open' | 'gedaan' | 'verwijderd'

export const FILTERS: { key: MailTaakFilter; label: string }[] = [
  { key: 'beslissen', label: 'Te beslissen' },
  { key: 'open', label: 'Nog te doen' },
  { key: 'gedaan', label: 'Gedaan' },
  { key: 'verwijderd', label: 'Verwijderd' },
]

/** Is een ClickUp-status "af"? */
export const isAfInClickup = (type: string | null | undefined) => type === 'closed' || type === 'done'

/** In welke filter hoort een taak uit de mail? */
export function filterVan(t: { status: MailTaakStatus | string; clickup_status_type?: string | null; taak_af?: boolean | null }): MailTaakFilter {
  if (t.status === 'verwijderd') return 'verwijderd'
  if (t.status === 'voorstel') return 'beslissen'
  if (t.status === 'al_gedaan') return 'gedaan'
  if (t.taak_af || isAfInClickup(t.clickup_status_type)) return 'gedaan'
  return 'open'
}

const STOP = new Set([
  'de', 'het', 'een', 'en', 'of', 'van', 'voor', 'naar', 'met', 'aan', 'op', 'in', 'om', 'te', 'tot', 'bij', 'over', 'uit', 'die', 'dat', 'deze', 'dit', 'nog', 'ook', 'als',
  'klant', 'taak', 'mail', 'sturen', 'versturen', 'doorsturen', 'maken', 'opmaken', 'doen', 'bekijken', 'nakijken', 'laten', 'weten', 'contact', 'opnemen', 'the', 'and', 'for', 'to',
])
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Betekenisvolle woorden (min. 3 letters, zonder stopwoorden), licht gestamd. */
export function woorden(s: string): Set<string> {
  return new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => w.replace(/(en|s)$/, '')).filter((w) => w.length >= 3))
}

/**
 * Lijkt een ClickUp-taak op deze taak uit de mail? De klantnaam moet in de
 * taaknaam staan (als we de klant kennen) en minstens de helft van de woorden
 * van de taak, met minstens twee (of alle als het er maar één of twee zijn).
 */
export function lijktOp(t: { wat: string; klant: string | null }, taak: { naam: string }): boolean {
  const klantW = t.klant ? woorden(t.klant) : new Set<string>()
  const taakW = woorden(taak.naam)
  if (klantW.size && ![...klantW].some((w) => w.length >= 4 && taakW.has(w))) return false
  const W = [...woorden(t.wat)].filter((w) => !klantW.has(w))
  if (!W.length) return false
  const gedeeld = W.filter((w) => taakW.has(w)).length
  return W.length <= 2 ? gedeeld === W.length : gedeeld >= 2 && gedeeld / W.length >= 0.5
}

/** Standaarddeadline als de mail geen datum noemt: twee werkdagen na vandaag. */
export function standaardDeadline(vandaag: string): string {
  const d = new Date(`${vandaag}T12:00:00Z`)
  let n = 0
  while (n < 2) { d.setUTCDate(d.getUTCDate() + 1); const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) n++ }
  return d.toISOString().slice(0, 10)
}
