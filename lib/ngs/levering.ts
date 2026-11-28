/**
 * Levering van NextGenSolutions (verbeterplan fase 5, 27 nov 2026): na Closed Won
 * een leveringsproject met briefing, audit, user stories, plan met vaste prijs,
 * wekelijkse review en Care. Pure regels (client én server), getest in
 * tests/ngs-levering.test.ts. De pipeline zelf (lib/ngs/model.ts) verandert niet.
 */

import { bronRichting } from '@/lib/sales/bronnen'

// ── Projectfases ─────────────────────────────────────────────────────────────

export const PROJECT_FASES = [
  { key: 'briefing', label: 'Briefing' },
  { key: 'user_stories', label: 'User stories' },
  { key: 'akkoord', label: 'Wacht op akkoord' },
  { key: 'bouw', label: 'In bouw' },
  { key: 'review', label: 'Review klant' },
  { key: 'klaar', label: 'Klaar' },
  { key: 'care', label: 'Care' },
] as const
export type ProjectFase = (typeof PROJECT_FASES)[number]['key']
export const isProjectFase = (v: unknown): v is ProjectFase => PROJECT_FASES.some((f) => f.key === v)
export const projectFaseLabel = (f: string) => PROJECT_FASES.find((x) => x.key === f)?.label ?? f

// ── Briefing (vast formulier) ────────────────────────────────────────────────

export const BRIEFING_VELDEN = [
  { key: 'doel', label: 'Doel', hint: 'Wat moet er na het project beter zijn?', verplicht: true },
  { key: 'huidige_situatie', label: 'Hoe het nu gaat', hint: 'Welke stappen, wie doet wat, hoeveel tijd kost het?', verplicht: true },
  { key: 'gewenste_situatie', label: 'Hoe het moet gaan', hint: 'Wat doet de automatisatie of software straks?', verplicht: true },
  { key: 'systemen', label: 'Systemen en data', hint: 'Welke tools, koppelingen, bestanden?', verplicht: false },
  { key: 'betrokkenen', label: 'Wie is betrokken', hint: 'Wie gebruikt het, wie beslist, wie test?', verplicht: false },
  { key: 'succes', label: 'Wanneer is het geslaagd', hint: 'Meetbaar: bv. offerte in 5 minuten i.p.v. 1 uur.', verplicht: true },
  { key: 'randvoorwaarden', label: 'Randvoorwaarden', hint: 'Budget, deadline, privacy, wat zeker niet mag.', verplicht: false },
] as const
export type BriefingSleutel = (typeof BRIEFING_VELDEN)[number]['key']
export type Briefing = Record<BriefingSleutel, string>
export const LEGE_BRIEFING = Object.fromEntries(BRIEFING_VELDEN.map((v) => [v.key, ''])) as Briefing

export function netteBriefing(v: unknown): Briefing {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return Object.fromEntries(BRIEFING_VELDEN.map((x) => [x.key, String(r[x.key] ?? '').replace(/\r\n/g, '\n').trim().slice(0, 4000)])) as Briefing
}

/** Wat er nog ontbreekt in de briefing (de verplichte velden). Leeg = volledig. */
export const briefingOntbreekt = (b: Briefing): string[] => BRIEFING_VELDEN.filter((v) => v.verplicht && !b[v.key]?.trim()).map((v) => v.label)

// ── Tijdscan ─────────────────────────────────────────────────────────────────

/** Notitiesjabloon voor de audit (een meeting met de klant waarin we de processen doorlopen). */
export const TIJDSCAN_SJABLOON = [
  'Processen die we doorliepen:',
  '- ',
  '',
  'Wat kost nu veel tijd (en hoeveel per week):',
  '- ',
  '',
  'Systemen en tools:',
  '- ',
  '',
  'Wat moet sneller of zonder fouten:',
  '- ',
  '',
  'Prioriteit volgens de klant:',
  '- ',
  '',
  'Afspraken en volgende stap:',
  '- ',
].join('\n')

export const tijdscanLeeg = (t: string | null | undefined) => !t || t.replace(/[-\s:]/g, '') === TIJDSCAN_SJABLOON.replace(/[-\s:]/g, '')

// ── User stories ─────────────────────────────────────────────────────────────

export const STORY_STATUSSEN = [
  { key: 'voorstel', label: 'Voorstel' },
  { key: 'goedgekeurd', label: 'Goedgekeurd' },
  { key: 'bouw', label: 'In bouw' },
  { key: 'review', label: 'Review' },
  { key: 'klaar', label: 'Klaar' },
] as const
export type StoryStatus = (typeof STORY_STATUSSEN)[number]['key']
export const isStoryStatus = (v: unknown): v is StoryStatus => STORY_STATUSSEN.some((s) => s.key === v)
export const storyStatusLabel = (s: string) => STORY_STATUSSEN.find((x) => x.key === s)?.label ?? s

/** Definitie van klaar: standaard per user story, aan te vullen per story. */
export const DOD_STANDAARD = [
  'Alle acceptatiecriteria getest',
  'Getest met echte gegevens van de klant',
  'Foutmeldingen en uitzonderingen afgehandeld',
  'Handleiding of uitleg bijgewerkt',
  'Klant heeft het gezien en goedgekeurd',
]

export type DodPunt = { titel: string; gedaan: boolean }
export type UserStory = {
  id: string
  project_id: string
  nummer: number
  titel: string
  als: string
  wil: string
  zodat: string
  acceptatiecriteria: string[]
  schatting_uren: number | null
  bestede_uren: number
  status: StoryStatus
  dod: DodPunt[]
  klant_akkoord_op: string | null
  klant_akkoord_door: string | null
  volgorde: number
  /** De workflow uit het auditrapport waar deze story bij hoort (nieuwe werking fase 4). */
  workflow_id?: string | null
}

const regels = (v: unknown, max = 30): string[] =>
  (Array.isArray(v) ? v : String(v ?? '').split('\n')).map((s) => String(s ?? '').replace(/^\s*[-*•]\s*/, '').trim().slice(0, 400)).filter(Boolean).slice(0, max)
const uren = (v: unknown): number | null => {
  if (v === null || v === undefined || String(v).trim() === '') return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) && n >= 0 && n <= 2000 ? Math.round(n * 4) / 4 : null
}

export type StoryInvoer = Pick<UserStory, 'titel' | 'als' | 'wil' | 'zodat' | 'acceptatiecriteria' | 'schatting_uren'>

export function controleerStory(b: Record<string, unknown>): { ok: true; story: StoryInvoer } | { ok: false; fout: string } {
  const titel = String(b.titel ?? '').trim().slice(0, 160)
  if (!titel) return { ok: false, fout: 'Geef de user story een korte titel.' }
  const acceptatiecriteria = regels(b.acceptatiecriteria)
  return {
    ok: true,
    story: {
      titel, als: String(b.als ?? '').trim().slice(0, 200), wil: String(b.wil ?? '').trim().slice(0, 600), zodat: String(b.zodat ?? '').trim().slice(0, 600),
      acceptatiecriteria, schatting_uren: uren(b.schatting_uren),
    },
  }
}

/** "Als … wil ik … zodat …" in één zin (leeg als niets ingevuld). */
export function storyZin(s: Pick<UserStory, 'als' | 'wil' | 'zodat'>): string {
  if (!s.als && !s.wil && !s.zodat) return ''
  return [s.als && `Als ${s.als}`, s.wil && `wil ik ${s.wil}`, s.zodat && `zodat ${s.zodat}`].filter(Boolean).join(', ') + '.'
}

export const nieuweDod = (): DodPunt[] => DOD_STANDAARD.map((titel) => ({ titel, gedaan: false }))
export function netteDod(v: unknown): DodPunt[] {
  const lijst = Array.isArray(v) ? v : []
  return lijst.map((p) => ({ titel: String((p as DodPunt)?.titel ?? '').trim().slice(0, 200), gedaan: (p as DodPunt)?.gedaan === true })).filter((p) => p.titel).slice(0, 20)
}

/** Mag een story op Klaar? Elk punt van de definitie van klaar moet afgevinkt zijn. */
export function waaromNietKlaar(s: Pick<UserStory, 'dod' | 'acceptatiecriteria'>): string | null {
  if (!s.acceptatiecriteria.length) return 'Er staan nog geen acceptatiecriteria bij.'
  const open = s.dod.filter((p) => !p.gedaan)
  return open.length ? `Nog af te vinken: ${open.map((p) => p.titel.toLowerCase()).join(', ')}.` : null
}

// ── Plan met vaste prijs ─────────────────────────────────────────────────────

/** Uren en prijs uit de goedgekeurde stories (alles behalve een voorstel). Zonder uurtarief geen prijs. */
export function planUitStories(stories: Pick<UserStory, 'status' | 'schatting_uren'>[], uurtarief: number | null): { stories: number; uren: number; zonderSchatting: number; prijs: number | null } {
  const tellen = stories.filter((s) => s.status !== 'voorstel')
  const uren = tellen.reduce((t, s) => t + (s.schatting_uren ?? 0), 0)
  const zonderSchatting = tellen.filter((s) => s.schatting_uren === null).length
  return { stories: tellen.length, uren, zonderSchatting, prijs: uurtarief && uurtarief > 0 ? Math.round(uren * uurtarief * 100) / 100 : null }
}

/** Uren: geschat tegenover besteed, per project. */
export function urenStand(stories: Pick<UserStory, 'status' | 'schatting_uren' | 'bestede_uren'>[]): { geschat: number; besteed: number; pct: number | null; over: boolean } {
  const tellen = stories.filter((s) => s.status !== 'voorstel')
  const geschat = tellen.reduce((t, s) => t + (s.schatting_uren ?? 0), 0)
  const besteed = tellen.reduce((t, s) => t + (s.bestede_uren ?? 0), 0)
  return { geschat, besteed, pct: geschat > 0 ? Math.round((besteed / geschat) * 100) : null, over: geschat > 0 && besteed > geschat }
}

const dagenTussen = (van: string, tot: string) => Math.round((Date.parse(`${tot}T12:00:00Z`) - Date.parse(`${van}T12:00:00Z`)) / 86_400_000)

/** Waarschuwing: 5 dagen na de audit nog geen goedgekeurd plan. */
export function planTeLaat(p: { tijdscan_op: string | null; plan_goedgekeurd_op: string | null; fase: string }, vandaag: string): number | null {
  if (!p.tijdscan_op || p.plan_goedgekeurd_op) return null
  if (!['briefing', 'user_stories', 'akkoord'].includes(p.fase)) return null
  const d = dagenTussen(p.tijdscan_op.slice(0, 10), vandaag)
  return d > 5 ? d : null
}

// ── Fases: wat moet er klaar zijn ───────────────────────────────────────────

export type ProjectStand = {
  fase: ProjectFase
  briefing_bevestigd_op: string | null
  plan_goedgekeurd_op: string | null
}

/** Waarom kan een project (nog) niet naar die fase? Null = het mag. Terug kan altijd. */
export function waaromNietNaar(p: ProjectStand, naar: ProjectFase, stories: Pick<UserStory, 'status' | 'dod' | 'acceptatiecriteria'>[], metWorkflows = false): string | null {
  const volgorde = PROJECT_FASES.map((f) => f.key) as string[]
  if (volgorde.indexOf(naar) <= volgorde.indexOf(p.fase)) return null
  if (naar !== 'briefing' && !p.briefing_bevestigd_op) return 'Bevestig eerst de briefing: zonder briefing geen user stories.'
  if (['akkoord', 'bouw', 'review', 'klaar', 'care'].includes(naar) && !stories.some((s) => s.status !== 'voorstel')) return 'Keur eerst minstens één user story goed.'
  // Met workflows uit het auditrapport (fase 4) ligt de vaste prijs al vast in het rapport.
  if (['bouw', 'review', 'klaar', 'care'].includes(naar) && !p.plan_goedgekeurd_op && !metWorkflows) return 'Het plan met de vaste prijs is nog niet goedgekeurd door de klant.'
  if (['klaar', 'care'].includes(naar)) {
    const open = stories.filter((s) => s.status !== 'voorstel' && s.status !== 'klaar')
    if (open.length) return `Nog ${open.length} user ${open.length === 1 ? 'story' : 'stories'} niet klaar.`
  }
  return null
}

// ── Wekelijkse review: actiepunten ───────────────────────────────────────────

export type Actiepunt = { id: string; tekst: string; wie: string | null; tegen: string | null; gedaan_op: string | null; uit_review: string | null }

/** Reviewnotities worden actiepunten: één per regel die met "-", "*", "•" of "[ ]" begint (zonder opsomming: elke regel). */
export function actiepuntenUit(notities: string): string[] {
  const lijnen = notities.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const opsomming = lijnen.filter((l) => /^([-*•]|\[ ?\])\s*/.test(l))
  return (opsomming.length ? opsomming : lijnen).map((l) => l.replace(/^([-*•]|\[ ?\])\s*/, '').trim()).filter((l) => l.length >= 3).map((l) => l.slice(0, 300)).slice(0, 30)
}

// ── Care ─────────────────────────────────────────────────────────────────────

export const CARE_STATUSSEN = [
  { key: 'actief', label: 'Actief' },
  { key: 'gepauzeerd', label: 'Gepauzeerd' },
  { key: 'gestopt', label: 'Gestopt' },
] as const
export type CareStatus = (typeof CARE_STATUSSEN)[number]['key']

export type CareItem = {
  id: string
  client_id: string | null
  project_id: string | null
  naam: string
  omschrijving: string | null
  systemen: string[]
  status: CareStatus
  care_contract: boolean
  maandbedrag: number | null
  controle_elke_dagen: number | null
  laatste_controle: string | null
  notitie: string | null
  /** Care-pakket (nieuwe werking fase 6): basis, plus of pro. */
  pakket?: string | null
}

export function controleerCare(b: Record<string, unknown>): { ok: true; care: Omit<CareItem, 'id'> } | { ok: false; fout: string } {
  const naam = String(b.naam ?? '').trim().slice(0, 160)
  if (!naam) return { ok: false, fout: 'Welke automatisatie of welk systeem?' }
  const status = CARE_STATUSSEN.find((s) => s.key === b.status)?.key ?? 'actief'
  const bedrag = b.maandbedrag === null || b.maandbedrag === undefined || String(b.maandbedrag).trim() === '' ? null : Number(String(b.maandbedrag).replace(',', '.'))
  if (bedrag !== null && (!Number.isFinite(bedrag) || bedrag < 0)) return { ok: false, fout: 'Het maandbedrag is geen geldig bedrag.' }
  const elke = b.controle_elke_dagen === null || b.controle_elke_dagen === undefined || String(b.controle_elke_dagen).trim() === '' ? null : Math.round(Number(b.controle_elke_dagen))
  if (elke !== null && (!Number.isFinite(elke) || elke < 1 || elke > 366)) return { ok: false, fout: 'Controle om de hoeveel dagen: tussen 1 en 366.' }
  const dag = typeof b.laatste_controle === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.laatste_controle) ? b.laatste_controle : null
  const UUID = /^[0-9a-f-]{36}$/i
  return {
    ok: true,
    care: {
      client_id: typeof b.client_id === 'string' && UUID.test(b.client_id) ? b.client_id : null,
      project_id: typeof b.project_id === 'string' && UUID.test(b.project_id) ? b.project_id : null,
      naam, omschrijving: String(b.omschrijving ?? '').trim().slice(0, 2000) || null, systemen: regels(b.systemen, 20),
      status, care_contract: b.care_contract === true, maandbedrag: bedrag === null ? null : Math.round(bedrag * 100) / 100,
      controle_elke_dagen: elke, laatste_controle: dag, notitie: String(b.notitie ?? '').trim().slice(0, 2000) || null,
    },
  }
}

/** Wanneer moet de volgende controle gebeuren, en is ze te laat? */
export function volgendeControle(c: Pick<CareItem, 'status' | 'controle_elke_dagen' | 'laatste_controle'>, vandaag: string): { op: string | null; teLaat: number | null } {
  if (c.status !== 'actief' || !c.controle_elke_dagen) return { op: null, teLaat: null }
  if (!c.laatste_controle) return { op: vandaag, teLaat: 0 }
  const op = new Date(Date.parse(`${c.laatste_controle}T12:00:00Z`) + c.controle_elke_dagen * 86_400_000).toISOString().slice(0, 10)
  const d = dagenTussen(op, vandaag)
  return { op, teLaat: d >= 0 ? d : null }
}

// ── AI-voorstel: user stories uit de tijdscan ────────────────────────────────

export type StoryVoorstel = StoryInvoer
export type BriefingVoorstel = Partial<Briefing>

/** Het antwoord van de AI nakijken: enkel wat bruikbaar is, nooit meer dan 25 stories. */
export function leesLeveringVoorstel(tekst: string): { briefing: BriefingVoorstel; stories: StoryVoorstel[] } | null {
  const m = tekst.match(/\{[\s\S]*\}/)
  if (!m) return null
  let j: Record<string, unknown>
  try { j = JSON.parse(m[0]) } catch { return null }
  const briefing: BriefingVoorstel = {}
  const b = (j.briefing && typeof j.briefing === 'object' ? j.briefing : {}) as Record<string, unknown>
  for (const v of BRIEFING_VELDEN) { const t = String(b[v.key] ?? '').trim(); if (t) briefing[v.key] = t.slice(0, 4000) }
  const stories: StoryVoorstel[] = []
  for (const s of (Array.isArray(j.stories) ? j.stories : []).slice(0, 25) as Record<string, unknown>[]) {
    const c = controleerStory(s ?? {})
    if (c.ok) stories.push(c.story)
  }
  if (!Object.keys(briefing).length && !stories.length) return null
  return { briefing, stories }
}

// ── Vesting: voorstel voor de commerciële verdeling (punt 31) ────────────────

/**
 * Voorstel voor de leadsoort van een contract in Vesting, uit het bedrijf en de
 * bron (en voor inbound Solutions wie closte). Enkel een voorstel: aanduiden en
 * tekenen blijft bij de drie vennoten, de rekenregels veranderen niet.
 */
export function leadSoortVoorstel(bedrijf: string | null | undefined, bron: string | null | undefined, verantwoordelijke: string | null | undefined): string | null {
  const richting = bronRichting(String(bron ?? '').toLowerCase())
  if (!richting) return null
  if (richting === 'outbound') return 'outbound'
  if (bedrijf === 'nextgenmedia') return 'inbound_ngm'
  if (bedrijf !== 'nextgensolutions') return null
  const w = String(verantwoordelijke ?? '').toLowerCase()
  if (w.startsWith('marco')) return 'inbound_ngs_marco'
  if (w.startsWith('bram')) return 'inbound_ngs_bram'
  return null
}

// ── Klantapp (verbeterplan K88, 27 nov 2026) ─────────────────────────────────

/** Vanaf deze fases ziet de klant de user stories (daarvoor zijn het nog werkversies van ons). */
export const KLANT_ZIET_STORIES: readonly ProjectFase[] = ['akkoord', 'bouw', 'review', 'klaar', 'care']
/** In deze fases kan de klant een user story zelf goedkeuren. */
export const KLANT_KEURT_GOED: readonly ProjectFase[] = ['akkoord', 'bouw', 'review']
export const klantZietStories = (fase: ProjectFase) => KLANT_ZIET_STORIES.includes(fase)
export function magKlantGoedkeuren(fase: ProjectFase, s: { klant_akkoord_op: string | null }): boolean {
  return KLANT_KEURT_GOED.includes(fase) && !s.klant_akkoord_op
}
/** Wat de klant over de fase leest: kort en zonder intern jargon. */
export const KLANT_FASE_UITLEG: Record<ProjectFase, string> = {
  briefing: 'We zetten samen op papier wat er moet gebeuren.',
  user_stories: 'We schrijven uit wat de oplossing precies moet kunnen.',
  akkoord: 'Klaar voor jouw akkoord. Kijk de user stories na en keur ze goed.',
  bouw: 'We bouwen.',
  review: 'Klaar om te testen. We overlopen het samen.',
  klaar: 'Opgeleverd.',
  care: 'Opgeleverd en in onderhoud (Care).',
}
/** De status van een story zoals de klant ze leest ("Goedgekeurd" is intern: door ons ingepland). */
export const KLANT_STORY_STATUS: Record<StoryStatus, string> = { voorstel: 'Voorstel', goedgekeurd: 'Gepland', bouw: 'In bouw', review: 'Te testen', klaar: 'Klaar' }
