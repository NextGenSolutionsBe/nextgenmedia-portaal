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
  /** Werkwijze (stappenplan) per reeks, sleutel '1' | '2' | '3', in het tekstformaat van `leesWerkwijze`. */
  reeks_detail: Record<string, string>
  /** Vaste klant met een eigen weekworkflow (INN · SLL · K · J): korte taken, per week afvinken. */
  vaste_naam: string
  vaste_sub: string
  vaste_taken: VasteTaak[]
  /** Klanten die niet op het Klantenbatches-bord horen (bv. geen social media). */
  bord_verborgen: string[]
}
export type VasteTaak = { key: string; titel: string; detail: string }

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
  // De dagelijkse Inner Stance-checks zijn vervangen door de weektaken van INN · SLL · K · J (vaste_taken).
  routine: [],
  routine_links: [
    { label: 'Notion', url: 'https://www.notion.so' },
    { label: 'Frame.io', url: 'https://app.frame.io' },
    { label: 'Metricool', url: 'https://app.metricool.com' },
  ],
  reeks_detail: {
    1: `! Eerste werkdag van de maand: reeksen verschuiven en de klantenbatches (badges) van de klanten aanpassen.
# Notities bekijken
- Welke klanten zitten in de batch
- Per klant: 1 of 3 maanden
- Werk inplannen 1 à 2 dagen vóór elke meeting
# Contentkalender genereren [portaal]
- Per klant genereren voor 1 of 3 maanden
# Content invullen [Claude]
- Bestaande klant: eerst evalueren wat beter kan dan vorige periode
- Richting meegeven
- Claude levert: concept per post, concept per story, scripts bij reels
# Reelscripts doornemen met Bram
# Contentkalender naar ClickUp [portaal]
- Op de knop in de app drukken
- Wordt automatisch weggeschreven naar ClickUp
# Meetings
## Onboarding
- Verloop volgen uit het portaal
## Kwartaalmeeting
- Statistieken
- Ontbrekende content opvragen
- Content shoot vastleggen
# Aanpassingen doorgeven aan Claude
- Alles uit de meetings terugkoppelen
- Posts en scripts worden aangepast in het portaal`,
    2: `! Pitch Please als eerste editen.
# Volgorde bepalen
- Per klant vastleggen wanneer je edit, op basis van de shootdata
# Posts & stories [Claude Design]
- Foto's en video's staan per klant in je notities
- Input geven: welke foto's, aantal slides
- Bijsturen
- Inplannen als draft
# Reels
- Foto's en video's staan per klant in je notities
- Zelf editen
- Captions door AI, met input over de inhoud
- Als draft in Metricool
# Afronden per klant
- Alles compleet: posts, stories, reels, captions
- Metricool nakijken
- Doorsturen ter goedkeuring
# Opvolgtaak zetten [ClickUp]
- Werkdagen tellen vanaf het versturen
- Op die datum: "Aanpassingen + definitief inplannen"
## Termijn
- 3 werkdagen · alle klanten
- 7 werkdagen · Pitch Please
# Goedkeuringstermijn aanduiden [portaal]
- Aanduiden dat de termijn loopt vanaf vandaag
- Klant krijgt zo te zien hoeveel dagen er nog zijn
- Mail sturen naar de klant
# Materiaal zoeken
- Altijd eerst de app checken voor nieuwe foto's van projecten
- Contentshoots van Bram: in de map met naam 'video's RAW F maand x V maand x - maand y'
- Per klant: zie "Materiaal per klant" hieronder`,
    3: `# Meetings voor volgende maand inplannen (eerste dag van reeks 3)
- Per socialmediaklant bekijken of er een meeting nodig is
- Link en mail sturen
# Aanpassingen + definitief inplannen
- Feedback verwerken
- Definitief inplannen in Metricool
- Daarna afvinken in ClickUp
# Statistieken [Metricool]
## Nieuwe klant
- Automatische stats aanvinken
- Doorsturing instellen
## Bestaande klant
- Doorsturing checken`,
  },
  vaste_naam: 'INN · SLL · K · J',
  vaste_sub: 'Inner Stance, Straight Line Leadership en de persoonlijke kanalen van Kristof en Johan',
  vaste_taken: [
    { key: 'inn_copy', titel: 'Copy controleren en aanpassen', detail: `# Dagelijks in Notion controleren
- Staat er voor de week erna ‘Copy changes needed’?
- De status kan dagelijks veranderen: controleer op verschillende dagen en vink per week af
# Indien nodig [Claude]
- Claude inschakelen om de copy aan te passen
- De wijzigingen controleren
- Status op ‘Copy ready for review’ zetten` },
    { key: 'inn_inplannen', titel: 'Content inplannen en schedulen', detail: `# In Notion controleren
- Staat alle content op ‘Ready’?
# Captions inplannen [Claude]
- Claude plant de captions in Metricool in op de juiste data, accounts en kanalen
- Specifieke instructies voor LinkedIn en YouTube volgen
- LinkedIn en Facebook samen inplannen
- Waar nodig een first comment toevoegen
# Zelf afronden
- Content downloaden
- Aan de juiste captions koppelen
- Alles officieel schedulen` },
  ],
  bord_verborgen: [],
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
    reeks_detail: { ...STANDAARD_CP.reeks_detail, ...(r.reeks_detail && typeof r.reeks_detail === 'object' ? r.reeks_detail : {}) },
    vaste_naam: typeof r.vaste_naam === 'string' && r.vaste_naam.trim() ? r.vaste_naam : STANDAARD_CP.vaste_naam,
    vaste_sub: typeof r.vaste_sub === 'string' ? r.vaste_sub : STANDAARD_CP.vaste_sub,
    vaste_taken: Array.isArray(r.vaste_taken) ? r.vaste_taken.filter((t) => t && typeof t.key === 'string').map((t) => ({ key: t.key, titel: String(t.titel ?? ''), detail: String(t.detail ?? '') })) : STANDAARD_CP.vaste_taken,
    bord_verborgen: Array.isArray(r.bord_verborgen) ? r.bord_verborgen.filter((x): x is string => typeof x === 'string') : [],
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

// ── Reeksen per maand aanpassen (stap 2) ────────────────────────────────────
//
// Een fase loopt over werkdagen van de maand (1 = eerste werkdag). Verleng,
// verkort of verschuif je een fase, dan schuiven de fases die NA haar oude
// einde beginnen evenveel werkdagen mee (instelbaar). Alles wordt bewaard als
// de bestaande Maandplanning-aanpassingen, zodat elke weergave meeloopt.
export type FasePlan = Record<FaseKey, number[]>

export const eersteWerkdag = (ym: string): string => werkdagenVanMaand(ym)[0]

/** Per fase de werkdag-indexen (1-based) van de maand. */
export function faseplanVanMaand(ym: string, aanpassingen: Record<string, string[]>): FasePlan {
  const wd = werkdagenVanMaand(ym)
  const f = fasesVanMaand(ym, aanpassingen)
  const plan = Object.fromEntries(FASE_KEYS.map((k) => [k, [] as number[]])) as FasePlan
  wd.forEach((d, i) => { for (const k of f.get(d) ?? []) plan[k].push(i + 1) })
  return plan
}

/** Aaneensluitende stukken: [3,4,5,9] → [[3,5],[9,9]]. */
export function segmenten(idx: number[]): [number, number][] {
  const s = [...new Set(idx)].sort((a, b) => a - b)
  const uit: [number, number][] = []
  for (const i of s) { const l = uit[uit.length - 1]; if (l && i === l[1] + 1) l[1] = i; else uit.push([i, i]) }
  return uit
}

/**
 * Eén stuk van een fase aanpassen: van [oudVan, oudTot] naar [nieuwVan, nieuwTot].
 * Met meeschuiven verplaatsen fases die pas na het oude einde beginnen mee met
 * het verschil van het einde. Alles blijft binnen de werkdagen van de maand.
 */
export function pasFaseAan(plan: FasePlan, fase: FaseKey, oud: [number, number], nieuw: [number, number], meeschuiven: boolean, totaal: number): FasePlan {
  const klem = (i: number) => Math.max(1, Math.min(totaal, i))
  const [nv, nt] = [klem(Math.min(nieuw[0], nieuw[1])), klem(Math.max(nieuw[0], nieuw[1]))]
  const uit = Object.fromEntries(FASE_KEYS.map((k) => [k, [...plan[k]]])) as FasePlan
  const rest = uit[fase].filter((i) => i < oud[0] || i > oud[1])
  uit[fase] = [...new Set([...rest, ...Array.from({ length: nt - nv + 1 }, (_, j) => nv + j)])].sort((a, b) => a - b)
  const delta = nt - oud[1]
  if (meeschuiven && delta !== 0) {
    for (const k of FASE_KEYS) {
      if (k === fase || !uit[k].length) continue
      if (Math.min(...plan[k]) > oud[1]) uit[k] = [...new Set(plan[k].map((i) => klem(i + delta)))].sort((a, b) => a - b)
    }
  }
  return uit
}

/** Eén dag van een fase aan/uit zetten (fijnregelen). */
export function wisselDag(plan: FasePlan, fase: FaseKey, dag: number): FasePlan {
  const uit = Object.fromEntries(FASE_KEYS.map((k) => [k, [...plan[k]]])) as FasePlan
  uit[fase] = uit[fase].includes(dag) ? uit[fase].filter((i) => i !== dag) : [...uit[fase], dag].sort((a, b) => a - b)
  return uit
}

/** Plan → per werkdag de fases (zoals de Maandplanning ze bewaart). */
export function planNaarDagen(ym: string, plan: FasePlan): Record<string, FaseKey[]> {
  const wd = werkdagenVanMaand(ym)
  const uit: Record<string, FaseKey[]> = Object.fromEntries(wd.map((d) => [d, [] as FaseKey[]]))
  for (const k of FASE_KEYS) for (const i of plan[k]) { const d = wd[i - 1]; if (d) uit[d].push(k) }
  return uit
}

/** Van wanneer tot wanneer loopt elke reeks deze maand (eerste en laatste werkdag)? */
export function reeksPeriodes(ym: string, plan: FasePlan, koppeling: Record<string, Reeks>): Record<Reeks, { van: string; tot: string; dagen: number } | null> {
  const wd = werkdagenVanMaand(ym)
  const uit = { 1: null, 2: null, 3: null } as Record<Reeks, { van: string; tot: string; dagen: number } | null>
  for (const r of [1, 2, 3] as Reeks[]) {
    const idx = [...new Set(FASE_KEYS.filter((k) => koppeling[k] === r).flatMap((k) => plan[k]))].sort((a, b) => a - b)
    if (idx.length) uit[r] = { van: wd[idx[0] - 1], tot: wd[idx[idx.length - 1] - 1], dagen: idx.length }
  }
  return uit
}

/** Maandstart: op de eerste werkdag van ELKE maand vult Chiara Klantenbatches in en bekijkt ze de reeksen. */
export const MAANDSTART = [
  { key: 'maandstart_reeksen', titel: 'Reeksen van de maand bekijken en verschuiven', weergave: 'reeksen' as const },
  { key: 'maandstart_batches', titel: 'Klantenbatches (badges) van de klanten aanpassen', weergave: 'batches' as const },
]

/**
 * Klantenbatches → bord van één klant. Zodra het bord van de maand in gebruik is
 * (minstens één ✓), betekent "niet aangevinkt" = deze maand niet. Is er nog
 * niets aangevinkt, dan volgt de app het ritme en de batch van de klant.
 */
export function bordVanKlant(rijen: { client_id: string; reeks: Reeks; actief: boolean }[], cid: string): Bord {
  const b: Bord = {}
  if (rijen.some((x) => x.actief)) for (const r of [1, 2, 3] as Reeks[]) b[r] = false
  for (const x of rijen) if (x.client_id === cid) b[x.reeks] = x.actief
  return b
}

// ── Werkwijze per reeks: eenvoudig tekstformaat ─────────────────────────────
//   ! tekst          → let-op-melding
//   # Stap [badge]   → nieuwe stap (badge optioneel, bv. [portaal])
//   ## Blok          → deelblok binnen de stap (bv. Onboarding / Kwartaalmeeting)
//   - punt           → opsommingspunt (in het blok of in de stap)
//   andere tekst     → gewone uitleg
export type WerkStap = { titel: string; badge: string | null; punten: string[]; blokken: { titel: string; punten: string[] }[] }
export type Werkwijze = { letOp: string[]; intro: string[]; stappen: WerkStap[] }
export function leesWerkwijze(tekst: string): Werkwijze {
  const w: Werkwijze = { letOp: [], intro: [], stappen: [] }
  let stap: WerkStap | null = null
  let blok: { titel: string; punten: string[] } | null = null
  for (const ruw of (tekst ?? '').split(/\r?\n/)) {
    const l = ruw.trim(); if (!l) continue
    if (l.startsWith('!')) { w.letOp.push(l.slice(1).trim()); continue }
    if (l.startsWith('## ')) { if (!stap) { stap = { titel: '', badge: null, punten: [], blokken: [] }; w.stappen.push(stap) } blok = { titel: l.slice(3).trim(), punten: [] }; stap.blokken.push(blok); continue }
    if (l.startsWith('# ')) {
      const m = l.slice(2).trim().match(/^(.*?)\s*\[([^\]]+)\]\s*$/)
      stap = { titel: (m ? m[1] : l.slice(2)).trim(), badge: m ? m[2].trim() : null, punten: [], blokken: [] }; blok = null
      w.stappen.push(stap); continue
    }
    const punt = l.startsWith('- ') ? l.slice(2).trim() : l
    if (blok) blok.punten.push(punt); else if (stap) stap.punten.push(punt); else w.intro.push(punt)
  }
  return w
}
