// Op te volgen (Command Center): per regel een duidelijk label met wanneer het
// moet gebeuren. Pure regels, client-safe, getest in tests/opvolging-label.test.ts.
//
// "Vandaag te doen", "3 dagen te laat", "Te doen op do 27 nov", "Nog 1 dag
// beschikbaar", "Morgen 14:00". Staat er een open taak bij de regel, dan telt
// de datum van die taak (dat is het moment dat we zelf afspraken).

export type LabelToon = 'te_laat' | 'vandaag' | 'binnenkort' | 'later' | 'info'
export type OpvolgLabel = { tekst: string; toon: LabelToon; datum: string | null }

/** De open taak die bij een regel hoort (ClickUp en de app). */
export type OpvolgTaak = { omschrijving: string; deadline: string | null; wie: string | null; url: string | null }

/** Wat het venster "Taak" nodig heeft om een taak bij deze regel te maken. */
export type TaakVoorstel = {
  /** Waar de taak naartoe gaat: een teamtaak of een taak bij het project. */
  basis: string
  /** Koppeling voor teamtaken ("contracten:<id>"), zodat de regel de taak terugvindt. */
  ref: string | null
  voorstellen: string[]
  klant: string | null
  client_id: string | null
}

const DAG = 86_400_000
const dagNr = (dag: string) => Date.parse(`${dag.slice(0, 10)}T12:00:00Z`)

/** De dag (JJJJ-MM-DD) in Belgische tijd. */
export const brusselDag = (iso: string | Date) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })

/** Aantal kalenderdagen van vandaag tot die dag (negatief = voorbij). */
export const dagenTot = (dag: string, vandaag: string) => Math.round((dagNr(dag) - dagNr(vandaag)) / DAG)

export function plusDagen(dag: string, n: number): string {
  const d = new Date(dagNr(dag)); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** n werkdagen later (zaterdag en zondag tellen niet). Valt de start in het weekend, dan telt maandag als eerste. */
export function plusWerkdagen(dag: string, n: number): string {
  const d = new Date(dagNr(dag))
  let over = n
  while (over > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) over--
  }
  return d.toISOString().slice(0, 10)
}

/** "do 27 nov" */
export const dagKortNaam = (dag: string) => new Date(dagNr(dag)).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
/** "donderdag 27 november 2026" (voor de tooltip) */
export const dagLangNaam = (dag: string) => new Date(dagNr(dag)).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

const meer = (n: number, een: string, veel: string) => `${n} ${n === 1 ? een : veel}`

/** Iets wat tegen die dag moet gebeuren. */
export function teDoen(deadline: string, vandaag: string): OpvolgLabel {
  const n = dagenTot(deadline, vandaag)
  if (n < 0) return { tekst: `${meer(-n, 'dag', 'dagen')} te laat`, toon: 'te_laat', datum: deadline.slice(0, 10) }
  if (n === 0) return { tekst: 'Vandaag te doen', toon: 'vandaag', datum: deadline.slice(0, 10) }
  if (n === 1) return { tekst: 'Morgen te doen', toon: 'binnenkort', datum: deadline.slice(0, 10) }
  return { tekst: `Te doen op ${dagKortNaam(deadline)}`, toon: 'later', datum: deadline.slice(0, 10) }
}

/** De gewenste datum van een klant (aanvragen). */
export function gewenst(dag: string, vandaag: string): OpvolgLabel {
  const n = dagenTot(dag, vandaag)
  if (n < 0) return { tekst: `Gewenste datum ${meer(-n, 'dag', 'dagen')} voorbij`, toon: 'te_laat', datum: dag.slice(0, 10) }
  if (n === 0) return { tekst: 'Gewenst vandaag', toon: 'vandaag', datum: dag.slice(0, 10) }
  if (n === 1) return { tekst: 'Gewenst morgen', toon: 'binnenkort', datum: dag.slice(0, 10) }
  return { tekst: `Gewenst op ${dagKortNaam(dag)}`, toon: n <= 7 ? 'binnenkort' : 'later', datum: dag.slice(0, 10) }
}

/** Hoe lang de klant iets nog kan bekijken of downloaden (opleveringen). */
export function beschikbaar(verlooptOp: string, nu: Date): OpvolgLabel {
  const ms = new Date(verlooptOp).getTime() - nu.getTime()
  const dag = brusselDag(verlooptOp)
  if (ms <= 0) return { tekst: 'Verlopen', toon: 'te_laat', datum: dag }
  if (ms < DAG) return { tekst: `Nog ${meer(Math.max(1, Math.ceil(ms / 3_600_000)), 'uur', 'uur')} beschikbaar`, toon: 'vandaag', datum: dag }
  const d = Math.max(1, Math.round(ms / DAG))
  return { tekst: `Nog ${meer(d, 'dag', 'dagen')} beschikbaar`, toon: d <= 1 ? 'binnenkort' : 'later', datum: dag }
}

/** Een meeting: "Vandaag 14:00", "Morgen 9:30", "do 27 nov 10:00". */
export function meeting(start: string, vandaag: string): OpvolgLabel {
  const dag = brusselDag(start)
  const uur = new Date(start).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })
  const n = dagenTot(dag, vandaag)
  if (n <= 0) return { tekst: `Vandaag ${uur}`, toon: 'vandaag', datum: dag }
  if (n === 1) return { tekst: `Morgen ${uur}`, toon: 'binnenkort', datum: dag }
  return { tekst: `${dagKortNaam(dag)} ${uur}`, toon: 'later', datum: dag }
}

/** Iets wat op die dag afloopt (website-onderhoud). */
export function looptAf(einde: string, vandaag: string): OpvolgLabel {
  const n = dagenTot(einde, vandaag)
  if (n < 0) return { tekst: `${meer(-n, 'dag', 'dagen')} verlopen`, toon: 'te_laat', datum: einde.slice(0, 10) }
  if (n === 0) return { tekst: 'Loopt vandaag af', toon: 'vandaag', datum: einde.slice(0, 10) }
  return { tekst: `Loopt af over ${meer(n, 'dag', 'dagen')}`, toon: n <= 7 ? 'binnenkort' : 'later', datum: einde.slice(0, 10) }
}

export const info = (tekst: string, toon: LabelToon = 'info'): OpvolgLabel => ({ tekst, toon, datum: null })

/** Het label van een open taak: de datum die we zelf kozen. */
export function taakLabel(t: Pick<OpvolgTaak, 'deadline'>, vandaag: string): OpvolgLabel {
  return t.deadline ? teDoen(t.deadline, vandaag) : info('Taak zonder datum')
}

const RANG: Record<LabelToon, number> = { te_laat: 0, vandaag: 1, binnenkort: 2, later: 3, info: 4 }

/** Te laat eerst (het langst te laat bovenaan), dan vandaag, morgen, later; zonder label achteraan. */
export function vergelijkLabels(a: OpvolgLabel | null | undefined, b: OpvolgLabel | null | undefined): number {
  const ra = a ? RANG[a.toon] : 5
  const rb = b ? RANG[b.toon] : 5
  if (ra !== rb) return ra - rb
  return (a?.datum ?? '9999').localeCompare(b?.datum ?? '9999')
}

/** De standaarddatum voor een nieuwe taak: vandaag als het al moest, anders de dag zelf. */
export function standaardTaakDag(l: OpvolgLabel | null | undefined, vandaag: string): string {
  if (!l?.datum || l.datum < vandaag || l.toon === 'te_laat') return vandaag
  return l.datum
}

/** Is de ref van een teamtaak geldig ("contracten:<uuid>")? */
export const REF = /^[a-z]{3,20}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
