// Agenda (ClickUp in de app) — pure regels, bruikbaar in browser en server.
// Getest in tests/agenda-model.test.ts.
//
// Structuur zoals in ClickUp: space → map (klant, freelancer …) → lijst → taak.
// Een item is een taak of een meeting. Met een uur erbij en begin en einde op
// dezelfde dag staat het in het uurrooster; al de rest bovenaan de dag.
import { dag, uur, zoneNaarIso, plusDagen, maandagVan, STANDAARD_TIJDZONE } from '@/lib/meetings/model'
import { schoonDocJson, markdownVanDoc } from './doc-opmaak'

export { dag, uur, zoneNaarIso, plusDagen, maandagVan }
export const TZ = STANDAARD_TIJDZONE

// ── Types ───────────────────────────────────────────────────────────────────

export type Persoon = { id: string; user_id: string | null; naam: string; email: string | null; kleur: string | null; actief: boolean }
export type Label = { id: string; naam: string; kleur: string; volgorde: number }
export type Space = { id: string; naam: string; kleur: string | null; prive: boolean; volgorde: number; clickup_id: string | null; verantwoordelijke_id?: string | null }
export type Map = { id: string; space_id: string; parent_id: string | null; naam: string; kleur: string | null; client_id: string | null; prive: boolean; volgorde: number; clickup_id: string | null; bedrijf?: string | null }
export type Lijst = { id: string; space_id: string; map_id: string | null; naam: string; kleur: string | null; client_id: string | null; prive: boolean; volgorde: number; clickup_id: string | null }
export type DocKort = { id: string; titel: string; space_id: string | null; map_id: string | null; lijst_id: string | null; prive: boolean; updated_at: string }
export type Boom = { spaces: Space[]; mappen: Map[]; lijsten: Lijst[]; docs: DocKort[] }

export type Soort = 'taak' | 'meeting'
export type Status = 'open' | 'klaar'

/** Een item zoals het scherm het krijgt. */
export type Item = {
  id: string
  /** 'ag' = agenda-item; 'meeting' = uit de Meeting Inplanner (klant_meetings, Google + Meet). */
  /** ag = taak in de agenda, meeting = Meeting Inplanner, shoot = Shoot planner (enkel tonen; openen gaat naar de planner), reeks = een keer uit een reeks. */
  bron: 'ag' | 'meeting' | 'shoot' | 'reeks'
  soort: Soort
  titel: string
  beschrijving: string | null
  status: Status
  clickup_status: string | null
  clickup_status_kleur: string | null
  urgent: boolean
  prioriteit: number | null
  start_op: string | null
  eind_op: string | null
  heel_dag: boolean
  /** Tegen wanneer het af moet (altijd met uur). Los van wanneer je eraan werkt (start_op/eind_op). */
  deadline_op: string | null
  lijst_id: string | null
  parent_id: string | null
  client_id: string | null
  labels: string[]
  kleur: string | null
  locatie: string | null
  meet_url: string | null
  prive: boolean
  eigenaar_id: string | null
  toegewezen: string[]
  afgerond_op: string | null
  afgerond_door: string | null
  clickup_url: string | null
  velden: Record<string, unknown> | null
  subtaken?: number
  updated_at: string
  /** Een keer uit een reeks (vast blok, herhalende afspraak of taak; lib/agenda/reeksen.ts). */
  reeks?: { id: string; soort: 'blok' | 'afspraak' | 'taak'; blok_type: string | null; datum: string }
  /** Meetings en shoots: het bedrijf dat erop staat (taken halen het uit hun map of klant, bedrijfVanItem). */
  bedrijf?: string | null
}

// ── Datums ──────────────────────────────────────────────────────────────────

export const vandaag = (nu: Date = new Date()) => dag(nu.toISOString(), TZ)
const minVan = (u: string) => { const [h, m] = u.split(':').map(Number); return h * 60 + m }

/** Valt dit tijdstip op het uur zonder minuten-uur? ClickUp zet een datum zonder uur op 04:00 Brusselse tijd. */
export function clickupHeeftUur(ms: number | null, vlag?: boolean | null): boolean {
  if (ms === null || !Number.isFinite(ms)) return false
  if (typeof vlag === 'boolean') return vlag
  return uur(new Date(ms).toISOString(), TZ) !== '04:00'
}

/** Waar staat een item: in het uurrooster (met begin en einde op dezelfde dag) of bovenaan de dag(en). */
export type Plaats =
  | { soort: 'rooster'; dag: string; vanMin: number; totMin: number }
  | { soort: 'dag'; van: string; tot: string }
  | null

type MetTijden = Pick<Item, 'start_op' | 'eind_op' | 'heel_dag'> & { deadline_op?: string | null }

/** Enkel een deadline (geen eigen tijdstip om eraan te werken): staat bovenaan de dag van de deadline. */
export function enkelDeadline(i: MetTijden): boolean {
  if (!i.deadline_op || i.start_op) return false
  return !i.eind_op || Date.parse(i.eind_op) === Date.parse(i.deadline_op)
}

export function plaatsVan(i: MetTijden): Plaats {
  if (enkelDeadline(i)) { const d = dag(i.deadline_op!, TZ); return { soort: 'dag', van: d, tot: d } }
  const s = i.start_op, e = i.eind_op
  if (!s && !e) return null
  if (!i.heel_dag) {
    // Met uur: rooster als begin en einde op dezelfde dag vallen. Enkel een einde = 30 minuten ervoor.
    const eind = e ?? new Date(Date.parse(s!) + 30 * 60_000).toISOString()
    const begin = s ?? new Date(Date.parse(eind) - 30 * 60_000).toISOString()
    const d1 = dag(begin, TZ), d2 = dag(eind, TZ)
    const vanMin = minVan(uur(begin, TZ))
    let totMin = minVan(uur(eind, TZ))
    if (d1 === d2 && totMin > vanMin) return { soort: 'rooster', dag: d1, vanMin, totMin }
    if (d2 === plusDagen(d1, 1) && totMin === 0) { totMin = 1440; return { soort: 'rooster', dag: d1, vanMin, totMin } }
    if (d1 === d2) return { soort: 'rooster', dag: d1, vanMin, totMin: Math.min(1440, vanMin + 30) }
    return { soort: 'dag', van: d1, tot: d2 }
  }
  const van = s ? dag(s, TZ) : dag(e!, TZ)
  const tot = e ? dag(e, TZ) : van
  return { soort: 'dag', van: van <= tot ? van : tot, tot: tot >= van ? tot : van }
}

/** Raakt het item deze dag? */
export function opDag(i: MetTijden, d: string): boolean {
  const p = plaatsVan(i)
  if (!p) return false
  return p.soort === 'rooster' ? p.dag === d : p.van <= d && d <= p.tot
}

/** De deadline als label: "Deadline 17:00" (op die dag), "Deadline vr 17:00" of "Deadline morgen 17:00". */
export function deadlineLabel(iso: string, opDeDag?: string, nu: Date = new Date()): { tekst: string; teLaat: boolean; vandaag: boolean } {
  const d = dag(iso, TZ), u = uur(iso, TZ)
  const v = vandaag(nu)
  // Op de dag zelf enkel het uur; elders "vandaag", "morgen" of de dag erbij.
  const zelfde = opDeDag ? d === opDeDag : d === v
  const wanneer = zelfde ? '' : d === v ? 'vandaag ' : d === plusDagen(v, 1) ? 'morgen ' : `${kortDag(d)} `
  return { tekst: `Deadline ${wanneer}${u}`, teLaat: Date.parse(iso) < nu.getTime(), vandaag: d === v }
}

/** De weekdag (1 = ma … 7 = zo) van een datum. */
const weekdagVan = (d: string) => ((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
/** Snelle keuzes voor een deadline: vandaag 17:00, morgen 12:00, de eerstvolgende vrijdag 17:00. */
export function snelleDeadlines(nu: Date = new Date()): { label: string; iso: string }[] {
  const v = vandaag(nu)
  const vr = plusDagen(v, (5 - weekdagVan(v) + 7) % 7 || 7)
  const uit = [
    { label: 'Vandaag 17:00', iso: zoneNaarIso(v, '17:00') },
    { label: 'Morgen 12:00', iso: zoneNaarIso(plusDagen(v, 1), '12:00') },
    { label: 'Morgen 17:00', iso: zoneNaarIso(plusDagen(v, 1), '17:00') },
    { label: `Vrijdag 17:00`, iso: zoneNaarIso(vr, '17:00') },
  ]
  return uit.filter((x) => Date.parse(x.iso) > nu.getTime())
}

/**
 * De weergaven van de kalender. Werkweek = maandag tot vrijdag; Planning = de
 * week als lijst per dag (zoals Schedule in ClickUp).
 */
export type Weergave = 'dag' | 'werkweek' | 'week' | 'maand' | 'planning'
export const WEERGAVEN: { key: Weergave; label: string }[] = [
  { key: 'dag', label: 'Dag' }, { key: 'werkweek', label: 'Werkweek' }, { key: 'week', label: 'Week' }, { key: 'maand', label: 'Maand' }, { key: 'planning', label: 'Planning' },
]
export const isWeergave = (v: unknown): v is Weergave => WEERGAVEN.some((w) => w.key === v)
/** De dagen van een weergave. */
export function dagenVan(w: Weergave, d: string): string[] {
  if (w === 'dag') return [d]
  if (w === 'week' || w === 'planning' || w === 'werkweek') { const m = maandagVan(d); return Array.from({ length: w === 'werkweek' ? 5 : 7 }, (_, i) => plusDagen(m, i)) }
  // Maand: van de maandag vóór de eerste tot de zondag na de laatste dag.
  const [j, m] = d.split('-').map(Number)
  const eerste = maandagVan(`${d.slice(0, 7)}-01`)
  const laatste = new Date(Date.UTC(j, m, 0)).toISOString().slice(0, 10)
  const zondag = plusDagen(maandagVan(laatste), 6)
  const aantal = Math.round((Date.parse(`${zondag}T12:00:00Z`) - Date.parse(`${eerste}T12:00:00Z`)) / 86_400_000) + 1
  return Array.from({ length: aantal }, (_, i) => plusDagen(eerste, i))
}
/** Stap vooruit of achteruit in de weergave. */
export function verschuif(w: Weergave, d: string, n: number): string {
  if (w === 'dag') return plusDagen(d, n)
  if (w !== 'maand') return plusDagen(d, 7 * n)
  const [j, m] = d.split('-').map(Number)
  const t = new Date(Date.UTC(j, m - 1 + n, 1))
  return t.toISOString().slice(0, 10)
}
/**
 * Wat er op elke dag staat (iets over meerdere dagen op elk van die dagen):
 * eerst wat zonder uur of met enkel een deadline, dan op uur, afgevinkt onderaan.
 */
export function perDagVan<T extends MetTijden & { status?: string; titel?: string }>(items: T[], dagen: string[]): globalThis.Map<string, T[]> {
  const m = new globalThis.Map<string, T[]>()
  if (!dagen.length) return m
  const eerste = dagen[0], laatste = dagen[dagen.length - 1]
  const rang = new globalThis.Map<T, [number, string]>()
  for (const i of items) {
    const p = plaatsVan(i)
    if (!p) continue
    const van = p.soort === 'rooster' ? p.dag : p.van, tot = p.soort === 'rooster' ? p.dag : p.tot
    if (tot < eerste || van > laatste) continue
    rang.set(i, [p.soort === 'rooster' ? 1 : 0, p.soort === 'rooster' ? String(p.vanMin).padStart(4, '0') : ''])
    for (let d = van < eerste ? eerste : van, n = 0; d <= tot && d <= laatste && n < 45; d = plusDagen(d, 1), n++) m.set(d, [...(m.get(d) ?? []), i])
  }
  for (const [, l] of m) l.sort((a, b) => Number(a.status === 'klaar') - Number(b.status === 'klaar') || rang.get(a)![0] - rang.get(b)![0] || rang.get(a)![1].localeCompare(rang.get(b)![1]) || (a.titel ?? '').localeCompare(b.titel ?? ''))
  return m
}

/** Begin en einde (ISO) van wat we moeten laden voor deze weergave. */
export function bereikVan(w: Weergave, d: string): { van: string; tot: string } {
  const dagen = dagenVan(w, d)
  return { van: zoneNaarIso(dagen[0], '00:00', TZ), tot: zoneNaarIso(plusDagen(dagen[dagen.length - 1], 1), '00:00', TZ) }
}

// ── Uurrooster: overlappende afspraken naast elkaar ─────────────────────────

export type Blok<T> = { item: T; vanMin: number; totMin: number; kolom: number; kolommen: number }

/** Leg de afspraken van één dag uit: wie overlapt, krijgt een eigen kolom (zoals ClickUp en Google). */
export function legUit<T>(lijst: { item: T; vanMin: number; totMin: number }[]): Blok<T>[] {
  const gesorteerd = [...lijst].sort((a, b) => a.vanMin - b.vanMin || b.totMin - a.totMin)
  const uit: Blok<T>[] = []
  let groep: Blok<T>[] = []
  let groepEind = -1
  const sluitGroep = () => {
    const n = Math.max(1, ...groep.map((b) => b.kolom + 1))
    for (const b of groep) b.kolommen = n
    uit.push(...groep)
    groep = []
  }
  for (const x of gesorteerd) {
    const tot = Math.max(x.totMin, x.vanMin + 15)
    if (groep.length && x.vanMin >= groepEind) sluitGroep()
    const bezet = new Set(groep.filter((b) => Math.max(b.totMin, b.vanMin + 15) > x.vanMin).map((b) => b.kolom))
    let kolom = 0
    while (bezet.has(kolom)) kolom++
    groep.push({ item: x.item, vanMin: x.vanMin, totMin: tot, kolom, kolommen: 1 })
    groepEind = Math.max(groepEind, tot)
  }
  if (groep.length) sluitGroep()
  return uit
}

// ── Kleuren ─────────────────────────────────────────────────────────────────

export type KleurVolgens = 'map' | 'klant' | 'label' | 'lijst' | 'status' | 'bedrijf'
export const KLEUR_VOLGENS: { key: KleurVolgens; label: string }[] = [
  { key: 'map', label: 'Map' },
  { key: 'klant', label: 'Klant' },
  { key: 'label', label: 'Label' },
  { key: 'lijst', label: 'Lijst' },
  { key: 'status', label: 'Status' },
  { key: 'bedrijf', label: 'Bedrijf' },
]
/**
 * Klanten die maar bij één bedrijf klant zijn, uit de bedrijven op hun projecten,
 * contracten en offertes. Bij beide (of geen) staat de klant er niet in.
 */
export function enkelBedrijfPerKlant(rijen: { client_id: string | null; bedrijf: string | null }[]): Record<string, string> {
  const per = new globalThis.Map<string, Set<string>>()
  for (const r of rijen) {
    if (!r.client_id || (r.bedrijf !== 'nextgenmedia' && r.bedrijf !== 'nextgensolutions')) continue
    per.set(r.client_id, (per.get(r.client_id) ?? new Set()).add(r.bedrijf))
  }
  return Object.fromEntries([...per].filter(([, b]) => b.size === 1).map(([k, b]) => [k, [...b][0]]))
}
/** Kleur per bedrijf (verbeterplan E39): NextGenMedia woud, NextGenSolutions blauw, algemeen grijs. */
export const BEDRIJF_KLEUR: Record<string, string> = { nextgenmedia: '#4f6b5a', nextgensolutions: '#1e40af', algemeen: '#9ca3af' }
/** Een rustig palet voor klanten en lijsten zonder eigen kleur (vast per id, zodat het niet verspringt). */
export const PALET = ['#fde68a', '#fbcfe8', '#c7d2fe', '#bbf7d0', '#fed7aa', '#bae6fd', '#ddd6fe', '#fecaca', '#d9f99d', '#e5e7eb']
export function paletVoor(sleutel: string): string {
  let h = 0
  for (let i = 0; i < sleutel.length; i++) h = (h * 31 + sleutel.charCodeAt(i)) >>> 0
  return PALET[h % PALET.length]
}
export const isKleur = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

export type KleurContext = {
  klantKleuren: Record<string, string>
  labels: Record<string, Label>
  lijsten: Record<string, Lijst>
  mappen: Record<string, Map>
  /** Klanten die maar bij één bedrijf klant zijn (uit hun projecten, contracten en offertes). */
  klantBedrijf?: Record<string, string>
}
/** De klant van een item: eigen keuze, anders die van de lijst of de map. */
export function klantVan(i: Pick<Item, 'client_id' | 'lijst_id'>, c: Pick<KleurContext, 'lijsten' | 'mappen'>): string | null {
  if (i.client_id) return i.client_id
  const l = i.lijst_id ? c.lijsten[i.lijst_id] : null
  if (!l) return null
  return l.client_id ?? (l.map_id ? c.mappen[l.map_id]?.client_id ?? null : null)
}
/**
 * Waar een item bij hoort, als label op de kalender ("TM Technics"): de klant,
 * anders de bovenste map (zoals in de boom), anders de lijst als die direct in
 * de space staat. Niets bij iemands eigen privémap (daar weet je het al) en niets
 * zonder lijst of klant.
 */
export function herkomstVan(
  i: Pick<Item, 'client_id' | 'lijst_id'>,
  c: Pick<KleurContext, 'lijsten' | 'mappen'> & { klanten: Record<string, string>; leden?: Record<string, string[]> },
): { naam: string; mapId: string | null } | null {
  const l = i.lijst_id ? c.lijsten[i.lijst_id] : undefined
  const keten: Map[] = []
  for (let m = l?.map_id ? c.mappen[l.map_id] : undefined, n = 0; m && n < 8; n++) { keten.push(m); m = m.parent_id ? c.mappen[m.parent_id] : undefined }
  const top = keten[keten.length - 1] ?? null
  const eigen = (sleutel: string) => (c.leden?.[sleutel]?.length ?? 0) === 1
  const prive = (l && eigen(`lijst:${l.id}`)) || keten.some((m) => eigen(`map:${m.id}`))
  if (i.client_id && c.klanten[i.client_id]) return { naam: c.klanten[i.client_id], mapId: top?.id ?? null }
  if (prive) return null
  const klant = klantVan(i, c)
  if (klant && c.klanten[klant]) return { naam: c.klanten[klant], mapId: top?.id ?? null }
  if (top) return { naam: top.naam.trim(), mapId: top.id }
  if (l && l.naam.trim() && l.naam.trim().toLowerCase() !== 'list') return { naam: l.naam.trim(), mapId: null }
  return null
}
/**
 * De kleur van een map zoals je ze overal ziet (boom, kalender): de eigen kleur,
 * anders die van een bovenliggende map, anders een vaste kleur uit het palet.
 */
export function mapKleur(mapId: string | null, c: Pick<KleurContext, 'mappen' | 'klantKleuren'>, metPalet = true): string | null {
  let m = mapId ? c.mappen[mapId] : undefined
  const eerste = m
  for (let i = 0; m && i < 6; i++) {
    if (isKleur(m.kleur)) return m.kleur
    if (m.client_id && isKleur(c.klantKleuren[m.client_id])) return c.klantKleuren[m.client_id]
    m = m.parent_id ? c.mappen[m.parent_id] : undefined
  }
  return metPalet && eerste ? paletVoor(eerste.id) : null
}

/** De eigen bedrijven als map ("NextGenMedia", "NextGen Solutions"): dat is altijd dat bedrijf. */
function eigenBedrijfVanNaam(naam: string): string | null {
  const n = naam.toLowerCase().replace(/[^a-z]/g, '')
  return n === 'nextgenmedia' ? 'nextgenmedia' : n === 'nextgensolutions' ? 'nextgensolutions' : null
}
/**
 * Bij welk bedrijf een item hoort (verbeterplan E39), zonder te gokken: wat op een
 * meeting of shoot staat, anders wat op de map (of een map erboven) gekozen werd,
 * anders de eigen map van NextGenMedia of NextGenSolutions, anders de klant als die
 * maar bij één bedrijf klant is. Anders niets: dat staat dan in elke weergave.
 */
export function bedrijfVanItem(i: Pick<Item, 'client_id' | 'lijst_id'> & { bedrijf?: string | null }, c: Pick<KleurContext, 'lijsten' | 'mappen' | 'klantBedrijf'>): string | null {
  if (i.bedrijf) return i.bedrijf
  const l = i.lijst_id ? c.lijsten[i.lijst_id] : undefined
  for (let m = l?.map_id ? c.mappen[l.map_id] : undefined, n = 0; m && n < 8; n++) {
    if (m.bedrijf) return m.bedrijf
    const eigen = eigenBedrijfVanNaam(m.naam)
    if (eigen) return eigen
    m = m.parent_id ? c.mappen[m.parent_id] : undefined
  }
  const klant = klantVan(i, c)
  return klant ? c.klantBedrijf?.[klant] ?? null : null
}

/** De kleur van een item in de kalender. Een eigen kleur gaat altijd voor. */
export function kleurVan(i: Pick<Item, 'kleur' | 'client_id' | 'lijst_id' | 'labels' | 'clickup_status_kleur' | 'status' | 'bron' | 'bedrijf'>, c: KleurContext, volgens: KleurVolgens): string {
  if (isKleur(i.kleur)) return i.kleur
  const lijst = i.lijst_id ? c.lijsten[i.lijst_id] : null
  const klant = klantVan(i, c)
  const viaKlant = klant ? c.klantKleuren[klant] ?? paletVoor(klant) : null
  const viaLabel = i.labels.map((l) => c.labels[l]?.kleur).find(isKleur) ?? null
  const viaLijst = lijst ? (isKleur(lijst.kleur) ? lijst.kleur : paletVoor(lijst.id)) : null
  const viaStatus = isKleur(i.clickup_status_kleur) ? i.clickup_status_kleur : null
  // Map: de lijst zelf als die een kleur kreeg, anders de map (of een map erboven), anders de klant.
  const viaMap = lijst ? (isKleur(lijst.kleur) ? lijst.kleur : mapKleur(lijst.map_id, c)) : null
  const standaard = i.bron === 'meeting' ? '#bbf7d0' : '#e5e7eb'
  if (volgens === 'bedrijf') { const b = bedrijfVanItem(i, c); return (b && BEDRIJF_KLEUR[b]) || '#e5e7eb' }
  const volgorde = volgens === 'map' ? [viaMap, viaKlant, viaLabel, viaLijst] : volgens === 'klant' ? [viaKlant, viaLabel, viaLijst] : volgens === 'label' ? [viaLabel, viaKlant, viaLijst] : volgens === 'lijst' ? [viaLijst, viaKlant] : [viaStatus, viaLijst]
  return volgorde.find((x): x is string => !!x) ?? standaard
}
/** Leesbare tekstkleur op een achtergrond (zwart op licht, wit op donker). */
export function tekstOp(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0f0f0f' : '#ffffff'
}

// ── Prioriteit (zoals ClickUp) ──────────────────────────────────────────────

export const PRIORITEITEN: { id: number; label: string; kleur: string }[] = [
  { id: 1, label: 'Dringend', kleur: '#dc2626' },
  { id: 2, label: 'Hoog', kleur: '#f59e0b' },
  { id: 3, label: 'Normaal', kleur: '#3b82f6' },
  { id: 4, label: 'Laag', kleur: '#9ca3af' },
]
const PRIO_CLICKUP: Record<string, number> = { urgent: 1, high: 2, normal: 3, low: 4 }

// ── ClickUp → agenda ────────────────────────────────────────────────────────

export type ClickupTaak = {
  id: string; name: string; text_content?: string | null; description?: string | null; markdown_description?: string | null
  status?: { status?: string; color?: string; type?: string } | null
  date_closed?: string | null; date_done?: string | null; date_updated?: string | null; date_created?: string | null
  creator?: { id?: number; username?: string; email?: string } | null
  assignees?: { id: number; username?: string; email?: string }[] | null
  tags?: { name: string; tag_bg?: string; tag_fg?: string }[] | null
  parent?: string | null
  priority?: { priority?: string; id?: string } | null
  due_date?: string | null; start_date?: string | null
  due_date_time?: boolean | null; start_date_time?: boolean | null
  custom_fields?: { id: string; name: string; type: string; value?: unknown; type_config?: { options?: { id: string; name?: string; label?: string; orderindex?: number }[] } }[] | null
  checklists?: { name: string; items?: { name: string; resolved?: boolean }[] }[] | null
  list?: { id: string } | null
  url?: string | null
  archived?: boolean
}

const ms = (v: unknown): number | null => {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Is een gesloten ClickUp-status (type closed of done). */
export const clickupKlaar = (t: Pick<ClickupTaak, 'status'>) => t.status?.type === 'closed' || t.status?.type === 'done'

/** De waarde van een ClickUp-veld leesbaar (dropdown-naam, datum, tekst, link). */
export function veldWaarde(f: NonNullable<ClickupTaak['custom_fields']>[number]): unknown {
  const v = f.value
  if (v === undefined || v === null || v === '') return null
  const opties = f.type_config?.options ?? []
  if (f.type === 'drop_down') {
    const o = opties.find((x) => x.id === v || x.orderindex === Number(v))
    return o?.name ?? o?.label ?? v
  }
  if (f.type === 'labels' && Array.isArray(v)) return v.map((id) => { const o = opties.find((x) => x.id === id); return o?.label ?? o?.name ?? id })
  if (f.type === 'date') { const n = ms(v); return n ? new Date(n).toISOString() : null }
  if (typeof v === 'object') return v
  return v
}

/** Een ClickUp-taak in de velden van ag_items (zonder lijst, ouder, labels en toegewezenen: die koppelt de import). */
export function itemUitClickup(t: ClickupTaak): {
  titel: string; beschrijving: string | null; status: Status; clickup_status: string | null; clickup_status_kleur: string | null
  prioriteit: number | null; urgent: boolean; start_op: string | null; eind_op: string | null; deadline_op: string | null; heel_dag: boolean; soort: Soort
  afgerond_op: string | null; velden: Record<string, unknown> | null; clickup_url: string | null; clickup_bijgewerkt_op: string | null
} {
  const due = ms(t.due_date), start = ms(t.start_date)
  const dueUur = clickupHeeftUur(due, t.due_date_time), startUur = clickupHeeftUur(start, t.start_date_time)
  // Met uur = beide momenten met uur (of enkel een einde met uur). Een meeting = start én einde met uur, einde na begin.
  const metUur = due !== null ? dueUur && (start === null || startUur) : startUur
  const meeting = start !== null && due !== null && startUur && dueUur && due > start
  const velden: Record<string, unknown> = {}
  for (const f of t.custom_fields ?? []) { const w = veldWaarde(f); if (w !== null && w !== undefined && !(Array.isArray(w) && !w.length)) velden[f.name] = w }
  let beschrijving = (t.markdown_description ?? t.text_content ?? t.description ?? '').trim()
  for (const c of t.checklists ?? []) {
    const items = (c.items ?? []).map((x) => `- [${x.resolved ? 'x' : ' '}] ${x.name}`)
    if (items.length) beschrijving += `${beschrijving ? '\n\n' : ''}**${c.name}**\n${items.join('\n')}`
  }
  const klaar = clickupKlaar(t)
  const prioriteit = t.priority?.priority ? PRIO_CLICKUP[t.priority.priority] ?? null : null
  const iso = (n: number | null) => (n === null ? null : new Date(n).toISOString())
  return {
    titel: (t.name ?? '').trim().slice(0, 500) || '(zonder titel)',
    beschrijving: beschrijving || null,
    status: klaar ? 'klaar' : 'open',
    clickup_status: t.status?.status ?? null,
    clickup_status_kleur: isKleur(t.status?.color) ? t.status!.color! : null,
    prioriteit, urgent: prioriteit === 1,
    start_op: iso(start), eind_op: iso(due), heel_dag: !metUur,
    // Een einddatum met uur zonder start = tegen dan moet het af: de deadline.
    deadline_op: !meeting && start === null && due !== null && dueUur ? iso(due) : null,
    soort: meeting ? 'meeting' : 'taak',
    afgerond_op: klaar ? iso(ms(t.date_done) ?? ms(t.date_closed)) : null,
    velden: Object.keys(velden).length ? velden : null,
    clickup_url: t.url ?? null,
    clickup_bijgewerkt_op: iso(ms(t.date_updated)),
  }
}

/** Mag de import dit item overschrijven? Enkel als het in ClickUp nieuwer is dan wat we hebben, en niet nadien in de app aangepast. */
export function magOverschrijven(bestaand: { clickup_bijgewerkt_op: string | null; in_app_gewijzigd_op: string | null } | null, clickupBijgewerkt: string | null): boolean {
  if (!bestaand) return true
  if (!clickupBijgewerkt) return false
  const cu = Date.parse(clickupBijgewerkt)
  if (bestaand.clickup_bijgewerkt_op && cu <= Date.parse(bestaand.clickup_bijgewerkt_op)) return false
  if (bestaand.in_app_gewijzigd_op && cu <= Date.parse(bestaand.in_app_gewijzigd_op)) return false
  return true
}

/**
 * Verschil met ClickUp (verbeterplan fase 3): ClickUp kreeg een nieuwere versie, maar het item werd
 * nadien in de app aangepast, dus de import laat de app-versie staan. Is wat ClickUp zegt anders,
 * dan komt het op de lijst "Verschillen met ClickUp" (niets gaat stil verloren). Null = geen verschil.
 */
export type ClickupVerschil = { bijgewerkt: string; titel: string; status: string; start_op: string | null; eind_op: string | null; deadline_op: string | null }
export function clickupVerschil(
  bestaand: { clickup_bijgewerkt_op: string | null; in_app_gewijzigd_op: string | null; titel: string; status: string; start_op: string | null; eind_op: string | null; deadline_op: string | null; clickup_verschil?: { bijgewerkt?: string } | null } | null,
  v: { clickup_bijgewerkt_op: string | null; titel: string; status: string; start_op: string | null; eind_op: string | null; deadline_op: string | null },
): ClickupVerschil | null {
  if (!bestaand || !v.clickup_bijgewerkt_op || !bestaand.in_app_gewijzigd_op) return null
  const cu = Date.parse(v.clickup_bijgewerkt_op)
  if (bestaand.clickup_bijgewerkt_op && cu <= Date.parse(bestaand.clickup_bijgewerkt_op)) return null // niets nieuws in ClickUp
  if (cu > Date.parse(bestaand.in_app_gewijzigd_op)) return null // ClickUp is nieuwer: de import neemt het gewoon over
  if (bestaand.clickup_verschil?.bijgewerkt === v.clickup_bijgewerkt_op) return null // al gemeld (of al gezien)
  const zelfde = (a: string | null, b: string | null) => (a && b ? Date.parse(a) === Date.parse(b) : !a && !b)
  const anders = bestaand.titel !== v.titel || bestaand.status !== v.status || !zelfde(bestaand.start_op, v.start_op) || !zelfde(bestaand.eind_op, v.eind_op) || !zelfde(bestaand.deadline_op, v.deadline_op)
  return anders ? { bijgewerkt: v.clickup_bijgewerkt_op, titel: v.titel, status: v.status, start_op: v.start_op, eind_op: v.eind_op, deadline_op: v.deadline_op } : null
}

/** Klantnaam en mapnaam vergelijken (zonder rechtsvorm, hoofdletters of leestekens). */
export function naamSleutel(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(bv|bvba|nv|vzw|srl|sprl|vof|commv|cv|bvba)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

// ── Invoer controleren ──────────────────────────────────────────────────────

export type ItemInvoer = {
  titel?: unknown; beschrijving?: unknown; beschrijving_json?: unknown; soort?: unknown; status?: unknown; urgent?: unknown; prioriteit?: unknown
  start_op?: unknown; eind_op?: unknown; deadline_op?: unknown; heel_dag?: unknown; lijst_id?: unknown; parent_id?: unknown; client_id?: unknown
  labels?: unknown; kleur?: unknown; locatie?: unknown; meet_url?: unknown; prive?: unknown; toegewezen?: unknown
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)
const tekst = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const tijd = (v: unknown): string | null | undefined => {
  if (v === null || v === '') return null
  if (typeof v !== 'string') return undefined
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined
}

/** Velden die meekomen, nagekeken. Enkel wat meekomt wordt gezet. Een fout = Nederlandse tekst. */
export function controleerItem(b: ItemInvoer, nieuw: boolean): { velden: Record<string, unknown>; toegewezen?: string[]; fout?: string } {
  const v: Record<string, unknown> = {}
  const heeft = (k: keyof ItemInvoer) => Object.prototype.hasOwnProperty.call(b, k)
  if (heeft('titel') || nieuw) {
    const t = tekst(b.titel, 500)
    if (!t) return { velden: v, fout: 'Geef een titel.' }
    v.titel = t
  }
  if (heeft('beschrijving')) v.beschrijving = typeof b.beschrijving === 'string' ? b.beschrijving.slice(0, 100_000) : null
  // Opgemaakte beschrijving (editor in het taakvenster): de tekst ernaast maken we zelf uit de opmaak.
  if (heeft('beschrijving_json')) {
    if (b.beschrijving_json === null) v.beschrijving_json = null
    else {
      const doc = schoonDocJson(b.beschrijving_json)
      if (!doc) return { velden: v, fout: 'De opmaak van de beschrijving klopt niet.' }
      const md = markdownVanDoc(doc)
      v.beschrijving_json = (md.trim() || JSON.stringify(doc).includes('"image"')) ? doc : null
      v.beschrijving = md.trim() ? md.slice(0, 100_000) : null
    }
  }
  if (heeft('soort')) v.soort = b.soort === 'meeting' ? 'meeting' : 'taak'
  if (heeft('status')) v.status = b.status === 'klaar' ? 'klaar' : 'open'
  if (heeft('urgent')) { v.urgent = b.urgent === true; v.prioriteit = b.urgent === true ? 1 : null }
  if (heeft('prioriteit')) { const p = Number(b.prioriteit); v.prioriteit = [1, 2, 3, 4].includes(p) ? p : null; v.urgent = p === 1 }
  for (const k of ['start_op', 'eind_op', 'deadline_op'] as const) {
    if (!heeft(k)) continue
    const t = tijd(b[k])
    if (t === undefined) return { velden: v, fout: 'Een datum klopt niet.' }
    v[k] = t
  }
  if (typeof v.start_op === 'string' && typeof v.eind_op === 'string' && Date.parse(v.eind_op) < Date.parse(v.start_op)) return { velden: v, fout: 'Het einde ligt voor het begin.' }
  if (heeft('heel_dag')) v.heel_dag = b.heel_dag === true
  for (const k of ['lijst_id', 'parent_id', 'client_id'] as const) {
    if (!heeft(k)) continue
    if (b[k] === null || b[k] === '') v[k] = null
    else if (isUuid(b[k])) v[k] = b[k]
    else return { velden: v, fout: 'Ongeldige koppeling.' }
  }
  if (heeft('labels')) v.labels = Array.isArray(b.labels) ? [...new Set(b.labels.filter(isUuid))].slice(0, 20) : []
  if (heeft('kleur')) v.kleur = isKleur(b.kleur) ? b.kleur : null
  if (heeft('locatie')) v.locatie = tekst(b.locatie, 500)
  if (heeft('meet_url')) {
    const u = tekst(b.meet_url, 1000)
    if (u && !/^https:\/\//i.test(u)) return { velden: v, fout: 'De meetinglink moet met https:// beginnen.' }
    v.meet_url = u
  }
  if (heeft('prive')) v.prive = b.prive === true
  const toegewezen = heeft('toegewezen') ? (Array.isArray(b.toegewezen) ? [...new Set(b.toegewezen.filter(isUuid))].slice(0, 30) : []) : undefined
  return { velden: v, toegewezen }
}

/** Een korte tijdsaanduiding voor in een lijst of de pdf: "09:30–10:00", "Hele dag" of "Tot 14:00". */
export function tijdTekst(i: MetTijden, d?: string): string {
  const p = plaatsVan(i)
  if (!p) return 'Geen datum'
  if (enkelDeadline(i)) return `Tegen ${uur(i.deadline_op!, TZ)}`
  if (p.soort === 'dag') return p.van === p.tot ? 'Hele dag' : `${kortDag(p.van)} – ${kortDag(p.tot)}`
  const u = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
  if (!i.start_op) return `Tot ${u(p.totMin)}`
  return `${d && d !== p.dag ? `${kortDag(p.dag)} ` : ''}${u(p.vanMin)}–${u(p.totMin)}`
}
export function kortDag(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}


// ── Shoots uit de Shoot planner in de agenda (26 nov 2026) ─────────────────

export type ShootRij = { id: string; client_id: string | null; titel: string | null; shoot_date: string; start_time: string | null; end_time: string | null; location: string | null; status: string | null; betrokkenen: unknown; created_by: string | null; updated_at: string | null }

/**
 * Een shoot als item in de kalender: op het uur van het programma (begin en
 * einde uit de planner), zonder uur een hele dag; een einde dat ontbreekt = een uur.
 * Wie erbij is (op e-mail) en wie ze maakte staan erop, zodat ze in "Mijn agenda" staat.
 * Afgerond = afgevinkt. Een geannuleerde shoot komt er niet in (zie shootsInBereik).
 */
export function shootAlsItem(r: ShootRij, klant: string, perEmail: globalThis.Map<string, string>, perGebruiker: globalThis.Map<string, string>): Item {
  const uurVan = (t: string | null) => (t && /^\d{1,2}:\d{2}/.test(t) ? t.slice(0, 5).padStart(5, '0') : null)
  const plus = (t: string, min: number) => { const m = Math.min(23 * 60 + 59, Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) + min); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }
  const start = uurVan(r.start_time)
  let einde = uurVan(r.end_time)
  if (start && (!einde || einde <= start)) einde = plus(start, 60)
  const toegewezen: string[] = []
  for (const b of Array.isArray(r.betrokkenen) ? r.betrokkenen as { email?: string }[] : []) {
    const p = b?.email ? perEmail.get(String(b.email).toLowerCase()) : null
    if (p && !toegewezen.includes(p)) toegewezen.push(p)
  }
  const maker = r.created_by ? perGebruiker.get(r.created_by) ?? null : null
  if (maker && !toegewezen.includes(maker)) toegewezen.push(maker)
  const klaar = r.status === 'afgerond'
  return {
    id: r.id, bron: 'shoot', soort: 'meeting', titel: r.titel?.trim() || `Shoot${klant ? ` ${klant}` : ''}`, beschrijving: null,
    status: klaar ? 'klaar' : 'open', clickup_status: null, clickup_status_kleur: null, urgent: false, prioriteit: null,
    start_op: start ? zoneNaarIso(r.shoot_date, start) : null, eind_op: zoneNaarIso(r.shoot_date, start ? einde! : '00:00'), deadline_op: null, heel_dag: !start,
    lijst_id: null, parent_id: null, client_id: r.client_id, labels: [], kleur: null, locatie: r.location, meet_url: null, prive: false,
    eigenaar_id: maker, toegewezen, afgerond_op: klaar ? r.updated_at : null, afgerond_door: null, clickup_url: null, velden: null, updated_at: r.updated_at ?? '',
    bedrijf: 'nextgenmedia', // contentshoots zijn foto en video: een dienst van NextGen Media
  }
}
