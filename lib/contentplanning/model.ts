// Contentplanning — PUUR model (client-safe, getest in tests/contentplanning.test.ts).
//
// Chiara’s workflow: drie reeksen per maand (1 scripts & kwartaalmeetings,
// 2 content maken & shoots, 3 aanpassingen, definitief inplannen &
// statistieken), klanten in batches, per klant een ritme (maandelijks of
// driemaandelijks) en per activiteit een eigen afspraak. Een cyclus = één
// maand voor één klant; de taken daarvan worden één keer klaargezet en zijn
// daarna gewoon bewerkbaar. Niets hieronder verzint datums: reeksen per dag
// komen uit de bestaande Maandplanning (standaard + handmatige aanpassingen).

// ── Maandplanning-fases (bron van de reeksen per dag) ───────────────────────
export type FaseKey = 'ideeen' | 'intakes' | 'scripts' | 'shoots' | 'edit' | 'feedback' | 'aanpassingen' | 'stats'
export const FASE_KEYS: FaseKey[] = ['ideeen', 'intakes', 'scripts', 'shoots', 'edit', 'feedback', 'aanpassingen', 'stats']
export const FASE_LABEL: Record<FaseKey, string> = {
  ideeen: 'Contentkalender & scripts', intakes: 'Intakes & meetings', scripts: 'Aanpassingen kalender/scripts', shoots: 'Contentshoots',
  edit: 'Editen & inplannen', feedback: 'Klantfeedback', aanpassingen: 'Aanpassingen verwerken', stats: 'Statistieken',
}

/** Standaardfases voor werkdag i (1-based) van `totaal` werkdagen — exact de bestaande Maandplanning. */
export function standaardFases(i: number, totaal: number): FaseKey[] {
  const c: FaseKey[] = []
  if (i >= 1 && i <= 2) c.push('ideeen')
  if (i >= 3 && i <= 5) c.push('intakes')
  if (i >= 6 && i <= 8) c.push('scripts')
  if (i >= 6 && i <= 13) c.push('shoots')
  if (i >= 11 && i <= 18) c.push('edit')
  if (i >= 19 && i <= 21) c.push('feedback')
  if (i >= 19 && i <= 22) c.push('aanpassingen')
  if (i === totaal) c.push('stats')
  return c
}

// ── Datums (strings, UTC-rekenen) ───────────────────────────────────────────
const ms = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) }
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
export const plusDagen = (d: string, n: number) => iso(ms(d) + n * 86_400_000)
/** 1 = maandag … 7 = zondag. */
export const weekdagNr = (d: string) => ((new Date(ms(d)).getUTCDay() + 6) % 7) + 1
export const isWerkdag = (d: string) => weekdagNr(d) <= 5
export const maandVan = (d: string) => d.slice(0, 7)
export const maandStart = (ym: string) => `${ym}-01`
export function maandEind(ym: string): string { const [y, m] = ym.split('-').map(Number); return iso(Date.UTC(y, m, 0)) }
export function plusMaanden(ym: string, n: number): string { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7) }
export const maandag = (d: string) => plusDagen(d, -(weekdagNr(d) - 1))
export function werkdagenVanMaand(ym: string): string[] {
  const uit: string[] = []
  for (let d = maandStart(ym); maandVan(d) === ym; d = plusDagen(d, 1)) if (isWerkdag(d)) uit.push(d)
  return uit
}
/** n werkdagen na `d` (weekends tellen niet). 0 = dezelfde dag. */
export function plusWerkdagen(d: string, n: number): string {
  let x = d, over = Math.max(0, Math.round(n))
  while (over > 0) { x = plusDagen(x, 1); if (isWerkdag(x)) over-- }
  return x
}

// ── Reeksen ─────────────────────────────────────────────────────────────────
export type Reeks = 1 | 2 | 3
export const REEKSEN: { nr: Reeks; label: string; kort: string; kleur: string; zacht: string }[] = [
  { nr: 1, label: 'Reeks 1 · Contentkalender en meeting', kort: 'R1', kleur: 'bg-yellow-400', zacht: 'bg-yellow-50' },
  { nr: 2, label: 'Reeks 2 · Shoot', kort: 'R2', kleur: 'bg-purple-500', zacht: 'bg-purple-50' },
  { nr: 3, label: 'Reeks 3 · Editen, inplannen en feedback', kort: 'R3', kleur: 'bg-green-600', zacht: 'bg-green-50' },
]
export const isReeks = (v: unknown): v is Reeks => v === 1 || v === 2 || v === 3

/** Fases van elke dag in de maand: standaard per werkdag, tenzij de Maandplanning ze aanpaste. */
export function fasesVanMaand(ym: string, aanpassingen: Record<string, string[]>): Map<string, FaseKey[]> {
  const uit = new Map<string, FaseKey[]>()
  const wd = werkdagenVanMaand(ym)
  wd.forEach((d, i) => uit.set(d, standaardFases(i + 1, wd.length)))
  for (const [d, cats] of Object.entries(aanpassingen)) if (maandVan(d) === ym) uit.set(d, cats.filter((c): c is FaseKey => (FASE_KEYS as string[]).includes(c)))
  return uit
}
export function reeksenVanDag(fases: FaseKey[], koppeling: Record<string, Reeks>): Reeks[] {
  return [...new Set(fases.map((f) => koppeling[f]).filter(isReeks))].sort()
}

// ── Onderdelen, statussen, routine: allemaal aanpasbaar ─────────────────────
export type Ritme = 'maandelijks' | 'driemaandelijks'
export type ActiviteitRitme = 'elke_cyclus' | 'per_kwartaal' | 'nvt'
export const ACTIVITEIT_RITME_LABEL: Record<ActiviteitRitme, string> = { elke_cyclus: 'Elke cyclus', per_kwartaal: 'Per kwartaal', nvt: 'Niet van toepassing' }
export type Onderdeel = { key: string; label: string; reeks: Reeks | null; standaard: ActiviteitRitme; actief: boolean }
export type Status = { key: string; label: string; kleur: string; klaar: boolean }
export type Routine = { key: string; titel: string; dagen: number[] }
export type Link = { label: string; url: string }

export type CpInstellingen = {
  onderdelen: Onderdeel[]
  statussen: Status[]
  /** Termijn voor aanpassingen in werkdagen, vanaf het moment dat de feedback binnen is. */
  aanpassing_werkdagen: number
  /** Standaard goedkeuringstermijn in werkdagen; null = per klant in te vullen. */
  goedkeuring_werkdagen: number | null
  /** Welke Maandplanning-fase hoort bij welke reeks. */
  fase_reeks: Record<string, Reeks>
  routine_naam: string
  routine: Routine[]
  routine_links: Link[]
}

export const STANDAARD_STATUSSEN: Status[] = [
  { key: 'nog_in_te_plannen', label: 'Nog in te plannen', kleur: 'bg-white text-gray-800 border-gray-300', klaar: false },
  { key: 'ingepland', label: 'Ingepland', kleur: 'bg-blue-50 text-blue-800 border-blue-300', klaar: false },
  { key: 'in_uitvoering', label: 'In uitvoering', kleur: 'bg-amber-50 text-amber-900 border-amber-300', klaar: false },
  { key: 'wacht_op_klant', label: 'Wacht op klant', kleur: 'bg-purple-50 text-purple-800 border-purple-300', klaar: false },
  { key: 'afgerond', label: 'Afgerond', kleur: 'bg-[#166534] text-white border-[#166534]', klaar: true },
  { key: 'nvt', label: 'Niet van toepassing', kleur: 'bg-gray-100 text-gray-500 border-gray-200', klaar: true },
]

export const STANDAARD_CP: CpInstellingen = {
  onderdelen: [
    { key: 'script', label: 'Contentkalender en scripts', reeks: 1, standaard: 'elke_cyclus', actief: true },
    { key: 'meeting', label: 'Kwartaalmeeting', reeks: 1, standaard: 'per_kwartaal', actief: true },
    { key: 'shoot', label: 'Shoot', reeks: 2, standaard: 'elke_cyclus', actief: true },
    { key: 'edit', label: 'Editen', reeks: 3, standaard: 'elke_cyclus', actief: true },
    { key: 'feedback', label: 'Feedback en goedkeuring', reeks: 3, standaard: 'elke_cyclus', actief: true },
    { key: 'aanpassingen', label: 'Aanpassingen', reeks: 3, standaard: 'elke_cyclus', actief: true },
    { key: 'inplannen', label: 'Definitief inplannen', reeks: 3, standaard: 'elke_cyclus', actief: true },
    { key: 'statistieken', label: 'Statistieken', reeks: 3, standaard: 'elke_cyclus', actief: true },
  ],
  statussen: STANDAARD_STATUSSEN,
  aanpassing_werkdagen: 3,
  goedkeuring_werkdagen: null,
  fase_reeks: { ideeen: 1, intakes: 1, scripts: 1, shoots: 2, edit: 3, feedback: 3, aanpassingen: 3, stats: 3 },
  routine_naam: 'Inner Stance',
  routine: [
    { key: 'is_copy_volgende_week', titel: 'Controleren of copy voor volgende week klaarstaat', dagen: [1, 2, 3, 4, 5] },
    { key: 'is_posts_ready', titel: 'Controleren of posts op ‘Ready’ staan', dagen: [1, 2, 3, 4, 5] },
    { key: 'is_copy_aanpassen', titel: 'Copy aanpassen', dagen: [4] },
    { key: 'is_content_inplannen', titel: 'Content inplannen', dagen: [5] },
  ],
  routine_links: [
    { label: 'Notion', url: 'https://www.notion.so' },
    { label: 'Frame.io', url: 'https://app.frame.io' },
    { label: 'Metricool', url: 'https://app.metricool.com' },
  ],
}

/** Instellingen uit de databank, aangevuld met de standaard (nooit een leeg scherm). */
export function leesCp(ruw: unknown): CpInstellingen {
  const r = (ruw && typeof ruw === 'object' ? ruw : {}) as Partial<CpInstellingen>
  const s = { ...STANDAARD_CP, ...r }
  return {
    ...s,
    onderdelen: Array.isArray(r.onderdelen) && r.onderdelen.length ? r.onderdelen : STANDAARD_CP.onderdelen,
    statussen: Array.isArray(r.statussen) && r.statussen.length ? r.statussen : STANDAARD_CP.statussen,
    routine: Array.isArray(r.routine) ? r.routine : STANDAARD_CP.routine,
    routine_links: Array.isArray(r.routine_links) ? r.routine_links : STANDAARD_CP.routine_links,
    fase_reeks: { ...STANDAARD_CP.fase_reeks, ...(r.fase_reeks ?? {}) },
    aanpassing_werkdagen: Number.isFinite(Number(r.aanpassing_werkdagen)) ? Math.max(0, Math.round(Number(r.aanpassing_werkdagen))) : 3,
    goedkeuring_werkdagen: r.goedkeuring_werkdagen === null || r.goedkeuring_werkdagen === undefined ? null : Math.max(0, Math.round(Number(r.goedkeuring_werkdagen))),
  }
}

export const isKlaar = (status: string, statussen: Status[]) => statussen.find((s) => s.key === status)?.klaar ?? false
export const statusVan = (status: string, statussen: Status[]): Status => statussen.find((s) => s.key === status) ?? { key: status, label: status, kleur: 'bg-white text-gray-800 border-gray-300', klaar: false }

// ── Wie is aan de beurt? ────────────────────────────────────────────────────
export type KlantInstelling = { ritme: Ritme | null; activiteiten: Record<string, ActiviteitRitme>; batch_start_maand: number | null }
export type Beurt = { onderdeel: string; aanDeBeurt: boolean | null; reden: string | null }

/** Is `ym` een kwartaalmaand voor een batch die start in maand `start` (0 = januari)? */
export function isKwartaalmaand(ym: string, start: number): boolean {
  const m = Number(ym.slice(5, 7)) - 1
  return ((m - start) % 3 + 3) % 3 === 0
}

/** Het ritme dat telt voor één activiteit: klantafspraak per activiteit gaat voor. */
export function ritmeVan(o: Onderdeel, k: KlantInstelling): ActiviteitRitme | null {
  const eigen = k.activiteiten?.[o.key]
  if (eigen) return eigen
  if (!k.ritme) return null
  if (k.ritme === 'driemaandelijks') return o.standaard === 'nvt' ? 'nvt' : 'per_kwartaal'
  return o.standaard
}

/**
 * Per onderdeel: hoort het deze maand bij de klant? `null` = kan niet bepaald
 * worden omdat er een instelling ontbreekt (dan zeggen we dat, we gokken niet).
 */
export function beurten(ym: string, onderdelen: Onderdeel[], k: KlantInstelling): Beurt[] {
  return onderdelen.filter((o) => o.actief).map((o) => {
    const r = ritmeVan(o, k)
    if (r === null) return { onderdeel: o.key, aanDeBeurt: null, reden: 'Ritme van de klant is nog niet ingesteld.' }
    if (r === 'nvt') return { onderdeel: o.key, aanDeBeurt: false, reden: null }
    if (r === 'elke_cyclus') return { onderdeel: o.key, aanDeBeurt: true, reden: null }
    if (k.batch_start_maand === null || k.batch_start_maand === undefined) return { onderdeel: o.key, aanDeBeurt: null, reden: 'Batch (met startmaand) ontbreekt; nodig voor wat per kwartaal gebeurt.' }
    return { onderdeel: o.key, aanDeBeurt: isKwartaalmaand(ym, k.batch_start_maand), reden: null }
  })
}

/**
 * Klantenbatches: per maand duidt Chiara per klant aan welke reeksen die maand
 * van toepassing zijn (✓ / ✗). Dat bord gaat VOOR op ritme en batch:
 *  · reeks ✗ → geen taken van die reeks
 *  · reeks ✓ → de onderdelen van die reeks (behalve wat voor de klant "niet van
 *    toepassing" is); iets dat per kwartaal gebeurt (bv. kwartaalmeeting) volgt
 *    nog altijd de batch
 *  · niets aangeduid → de gewone regel (ritme + batch)
 */
export type Bord = Partial<Record<Reeks, boolean>>
export function beurtenMetBord(ym: string, onderdelen: Onderdeel[], k: KlantInstelling, bord: Bord): Beurt[] {
  const gewoon = new Map(beurten(ym, onderdelen, k).map((b) => [b.onderdeel, b]))
  return onderdelen.filter((o) => o.actief).map((o) => {
    const keuze = o.reeks ? bord[o.reeks] : undefined
    if (keuze === undefined) return gewoon.get(o.key)!
    if (keuze === false) return { onderdeel: o.key, aanDeBeurt: false, reden: null }
    const eigen = k.activiteiten?.[o.key] ?? o.standaard
    if (eigen === 'nvt') return { onderdeel: o.key, aanDeBeurt: false, reden: null }
    if (eigen === 'elke_cyclus') return { onderdeel: o.key, aanDeBeurt: true, reden: null }
    if (k.batch_start_maand === null || k.batch_start_maand === undefined) return { onderdeel: o.key, aanDeBeurt: null, reden: `Batch ontbreekt; nodig voor ${o.label.toLowerCase()} (per kwartaal).` }
    return { onderdeel: o.key, aanDeBeurt: isKwartaalmaand(ym, k.batch_start_maand), reden: null }
  })
}

/**
 * Welke taken moeten er voor een cyclus nog klaargezet worden? Enkel wat aan
 * de beurt is én nog niet bestaat — ook niet als (zacht) verwijderde taak:
 * wat Chiara bewust weghaalde, komt niet terug.
 */
export function teMakenTaken(onderdelen: Onderdeel[], b: Beurt[], bestaandeSleutels: Set<string>): { onderdeel: string; titel: string; reeks: Reeks | null; sjabloon_sleutel: string; volgorde: number }[] {
  const per = new Map(onderdelen.map((o, i) => [o.key, { o, i }]))
  return b.filter((x) => x.aanDeBeurt === true && !bestaandeSleutels.has(x.onderdeel)).map((x) => {
    const { o, i } = per.get(x.onderdeel)!
    return { onderdeel: o.key, titel: o.label, reeks: o.reeks, sjabloon_sleutel: o.key, volgorde: i }
  })
}

// ── Termijnen ───────────────────────────────────────────────────────────────
/** Verwachte reactiedatum: vanaf het vastgelegde startmoment + N werkdagen. Geen startmoment = geen datum. */
export const verwachteDatum = (startmoment: string | null | undefined, werkdagen: number | null | undefined): string | null =>
  startmoment && werkdagen !== null && werkdagen !== undefined ? plusWerkdagen(startmoment, werkdagen) : null

export type TaakLicht = { werkdatum: string | null; deadline: string | null; status: string; verwijderd_op?: string | null }
export function isAchterstallig(t: TaakLicht, vandaag: string, statussen: Status[]): boolean {
  if (t.verwijderd_op || isKlaar(t.status, statussen)) return false
  return (!!t.werkdatum && t.werkdatum < vandaag) || (!!t.deadline && t.deadline < vandaag)
}
export const deadlineVerstreken = (t: TaakLicht, vandaag: string, statussen: Status[]) => !t.verwijderd_op && !isKlaar(t.status, statussen) && !!t.deadline && t.deadline < vandaag

// ── Inner Stance-routine ────────────────────────────────────────────────────
export const routineVoorDag = (routine: Routine[], datum: string) => routine.filter((r) => r.dagen.includes(weekdagNr(datum)))
export const DAG_KORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']
