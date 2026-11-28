/**
 * Levering per workflow bij NextGenSolutions (nieuwe werking fase 4, 28 nov 2026).
 * Elke workflow uit het auditrapport gaat apart door Gepland → In bouw →
 * Oplevering → Nazorg → Klaar. De termijnen (bouwdagen, nazorgweken) komen uit
 * Instellingen → Werking, nooit vast in de code. Pure regels (client én server),
 * getest in tests/ngs-workflow-levering.test.ts.
 */
import type { WerkingInstellingen } from '@/lib/werking/instellingen'
import type { ProjectFase } from '@/lib/ngs/levering'
import { plusDagen } from '@/lib/opvolging-label'

export type Levering = WerkingInstellingen['levering']

export const WF_FASES = [
  { key: 'gepland', label: 'Gepland' },
  { key: 'bouw', label: 'In bouw' },
  { key: 'oplevering', label: 'Oplevering' },
  { key: 'nazorg', label: 'Nazorg' },
  { key: 'klaar', label: 'Klaar' },
] as const
export type WfFase = (typeof WF_FASES)[number]['key']
export const isWfFase = (v: unknown): v is WfFase => WF_FASES.some((f) => f.key === v)
export const wfFaseLabel = (f: string) => WF_FASES.find((x) => x.key === f)?.label ?? f
const volgorde = (f: string) => WF_FASES.findIndex((x) => x.key === f)

/** Een nazorgcall die niet via de Meeting Inplanner liep (zelf ingevuld). */
export type ZelfCall = { op: string; notitie: string | null }

export type WfLevering = {
  id: string; project_id: string | null; deal_id: string | null; naam: string; oplossing: string | null
  maat: string | null; prijs: number | null; interface_of_logboek: boolean; volgorde: number
  fase: WfFase; fase_sinds: string | null; bouw_start: string | null
  wacht_op_klant: boolean; wacht_reden: string | null; wacht_sinds: string | null; wacht_dagen: number
  opname_link: string | null; video_link: string | null; video_gestuurd_op: string | null
  oplevering_op: string | null; nazorg_start: string | null; nazorg_calls: ZelfCall[]; klaar_op: string | null
  verantwoordelijke: string | null
}

const dag = (iso: string) => iso.slice(0, 10)
const dagNr = (d: string) => Date.parse(`${dag(d)}T12:00:00Z`) / 86_400_000
export const dagenTussen = (van: string, tot: string) => Math.round(dagNr(tot) - dagNr(van))

// ── Bouw en wachten op de klant ──────────────────────────────────────────────

/** De dagen in bouw die tellen: sinds de start, zonder de dagen dat we op de klant wachtten. */
export function bouwDagenGeteld(w: Pick<WfLevering, 'bouw_start' | 'oplevering_op' | 'wacht_op_klant' | 'wacht_sinds' | 'wacht_dagen'>, vandaag: string): number | null {
  if (!w.bouw_start) return null
  const eind = w.oplevering_op ? dag(w.oplevering_op) : vandaag
  let d = dagenTussen(w.bouw_start, eind) - (w.wacht_dagen || 0)
  if (w.wacht_op_klant && w.wacht_sinds) d -= dagenTussen(w.wacht_sinds, eind)
  return Math.max(0, d)
}

/** Tegen wanneer de bouw af moet: start + bouwdagen, plus de dagen dat we wachtten. Wacht ze nu, dan geen datum. */
export function bouwDeadline(w: Pick<WfLevering, 'fase' | 'bouw_start' | 'wacht_op_klant' | 'wacht_dagen'>, L: Pick<Levering, 'bouw_dagen'>): string | null {
  if (w.fase !== 'bouw' || !w.bouw_start || w.wacht_op_klant) return null
  return plusDagen(dag(w.bouw_start), L.bouw_dagen + (w.wacht_dagen || 0))
}

/** Hoeveel dagen de bouw over tijd is (null = niet te laat, of we wachten op de klant). */
export function bouwTeLaat(w: Pick<WfLevering, 'fase' | 'bouw_start' | 'wacht_op_klant' | 'wacht_dagen'>, vandaag: string, L: Pick<Levering, 'bouw_dagen'>): number | null {
  const d = bouwDeadline(w, L)
  if (!d) return null
  const x = dagenTussen(d, vandaag)
  return x > 0 ? x : null
}

/** Wachten op de klant: enkel in bouw, altijd met een reden. */
export function wachtStart(w: Pick<WfLevering, 'fase' | 'wacht_op_klant'>, reden: unknown, nu: string): { ok: true; patch: Partial<WfLevering> } | { ok: false; fout: string } {
  if (w.fase !== 'bouw') return { ok: false, fout: 'Wachten op de klant kan enkel tijdens de bouw.' }
  if (w.wacht_op_klant) return { ok: false, fout: 'Deze workflow wacht al op de klant.' }
  const r = String(reden ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
  if (r.length < 3) return { ok: false, fout: 'Waarop wachten we? Vul een reden in.' }
  return { ok: true, patch: { wacht_op_klant: true, wacht_reden: r, wacht_sinds: nu } }
}

/** Niet meer wachten: de gewachte dagen tellen op en tellen niet mee in de bouw. */
export function wachtStop(w: Pick<WfLevering, 'wacht_op_klant' | 'wacht_sinds' | 'wacht_dagen'>, nu: string): Partial<WfLevering> | null {
  if (!w.wacht_op_klant) return null
  const extra = w.wacht_sinds ? Math.max(0, dagenTussen(w.wacht_sinds, nu)) : 0
  return { wacht_op_klant: false, wacht_sinds: null, wacht_dagen: (w.wacht_dagen || 0) + extra }
}

// ── Nazorg ───────────────────────────────────────────────────────────────────

export type NazorgStand = { nodig: number; gehouden: number; gepland: number; volgendeTegen: string | null; teLaat: number | null }

/**
 * Nazorg: één call per week, zo veel weken als de instelling zegt. Een week
 * zonder call (gehouden of gepland) = te laat. Calls = meetings uit de Meeting
 * Inplanner aan deze workflow + wat je zelf invulde.
 */
export function nazorgStand(w: Pick<WfLevering, 'fase' | 'nazorg_start'>, calls: { op: string }[], vandaag: string, L: Pick<Levering, 'nazorg_weken'>): NazorgStand {
  const gehouden = calls.filter((c) => dag(c.op) <= vandaag).map((c) => dag(c.op)).sort()
  const gepland = calls.filter((c) => dag(c.op) > vandaag).length
  const nodig = L.nazorg_weken
  if (w.fase !== 'nazorg' || !w.nazorg_start || gehouden.length >= nodig) return { nodig, gehouden: gehouden.length, gepland, volgendeTegen: null, teLaat: null }
  const laatste = gehouden.length ? [dag(w.nazorg_start), gehouden[gehouden.length - 1]].sort()[1] : dag(w.nazorg_start)
  const volgendeTegen = plusDagen(laatste, 7)
  const x = dagenTussen(volgendeTegen, vandaag)
  return { nodig, gehouden: gehouden.length, gepland, volgendeTegen, teLaat: !gepland && x > 0 ? x : null }
}

/** Zelf ingevulde calls netjes: een geldige datum, een korte notitie. */
export function leesZelfCalls(v: unknown): ZelfCall[] {
  if (!Array.isArray(v)) return []
  return v.slice(0, 20).map((x) => {
    const r = (x ?? {}) as Record<string, unknown>
    const op = String(r.op ?? '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(op) || Number.isNaN(Date.parse(op))) return null
    const n = String(r.notitie ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
    return { op, notitie: n || null }
  }).filter((x): x is ZelfCall => !!x)
}

// ── Definitie van klaar en de fases ─────────────────────────────────────────

/** Klaar = interface of logboek, opname gedeeld, video bij de klant, alle (goedgekeurde) stories klaar. */
export function dodVan(w: Pick<WfLevering, 'interface_of_logboek' | 'opname_link' | 'video_gestuurd_op'>, stories: { status: string }[]): { titel: string; ok: boolean }[] {
  const tellen = stories.filter((s) => s.status !== 'voorstel')
  return [
    { titel: 'Interface of minstens een logboek', ok: !!w.interface_of_logboek },
    { titel: 'Opname gedeeld', ok: !!w.opname_link },
    { titel: 'Video bij de klant', ok: !!w.video_gestuurd_op },
    { titel: tellen.length ? `Alle user stories klaar (${tellen.filter((s) => s.status === 'klaar').length}/${tellen.length})` : 'Alle user stories klaar', ok: tellen.every((s) => s.status === 'klaar') },
  ]
}

/** Waarom kan een workflow (nog) niet naar die fase? Null = het mag. Terug kan altijd. */
export function waaromNietNaarWf(w: Pick<WfLevering, 'fase' | 'opname_link' | 'video_link' | 'video_gestuurd_op' | 'interface_of_logboek'>, naar: WfFase, stories: { status: string }[]): string | null {
  if (volgorde(naar) <= volgorde(w.fase)) return null
  if (volgorde(naar) >= volgorde('nazorg')) {
    if (!w.opname_link || !w.video_link) return 'Vul eerst de link naar de opname en naar de video in.'
    if (!w.video_gestuurd_op) return 'Stuur eerst de video naar de klant (knop Video naar de klant).'
  }
  if (naar === 'klaar') {
    const open = dodVan(w, stories).filter((d) => !d.ok).map((d) => d.titel.replace(/ \(.*\)$/, '').toLowerCase())
    if (open.length) return `Nog niet klaar: ${open.join(', ')}.`
  }
  return null
}

/**
 * Wat er verandert bij een andere fase: de eerste keer in een fase krijgt ze
 * haar datum; terug naar een eerdere fase wist de datums erna (de telling loopt
 * dan opnieuw). Wie de bouw verlaat terwijl ze wacht, stopt het wachten.
 */
export function faseWissel(w: WfLevering, naar: WfFase, nu: string): Partial<WfLevering> {
  const p: Partial<WfLevering> = { fase: naar, fase_sinds: nu }
  const n = volgorde(naar)
  if (naar !== 'bouw' && w.wacht_op_klant) Object.assign(p, wachtStop(w, nu))
  if (n >= volgorde('bouw') && !w.bouw_start) p.bouw_start = nu
  if (n >= volgorde('oplevering') && !w.oplevering_op) p.oplevering_op = nu
  if (n >= volgorde('nazorg') && !w.nazorg_start) p.nazorg_start = nu
  if (n >= volgorde('klaar') && !w.klaar_op) p.klaar_op = nu
  if (n < volgorde('klaar')) p.klaar_op = null
  if (n < volgorde('nazorg')) p.nazorg_start = null
  if (n < volgorde('oplevering')) p.oplevering_op = null
  if (n < volgorde('bouw')) { p.bouw_start = null; p.wacht_dagen = 0 }
  return p
}

/** Een link naar de opname of de video: enkel http(s). Leeg = weghalen. */
export function leesLink(v: unknown): { ok: true; link: string | null } | { ok: false; fout: string } {
  const t = String(v ?? '').trim()
  if (!t) return { ok: true, link: null }
  try {
    const u = new URL(t)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, fout: 'Enkel een link die met http of https begint.' }
    return { ok: true, link: u.toString().slice(0, 1000) }
  } catch { return { ok: false, fout: 'Dat is geen geldige link.' } }
}

// ── Het project volgt de workflows ──────────────────────────────────────────

const NAAR_PROJECT: Record<WfFase, ProjectFase> = { gepland: 'akkoord', bouw: 'bouw', oplevering: 'review', nazorg: 'review', klaar: 'klaar' }

/**
 * De fase van het project uit zijn workflows: die van de vroegste die nog loopt.
 * Alles klaar = Klaar (Care blijft Care). Staat alles nog op Gepland, dan blijft
 * de fase van het project (briefing, user stories, akkoord). Null = niets veranderen.
 */
export function projectFaseUitWorkflows(ws: Pick<WfLevering, 'fase' | 'volgorde'>[], huidig: ProjectFase): ProjectFase | null {
  if (!ws.length) return null
  const lopend = ws.filter((w) => w.fase === 'bouw' || w.fase === 'oplevering' || w.fase === 'nazorg').sort((a, b) => a.volgorde - b.volgorde)
  let fase: ProjectFase | null = null
  if (lopend.length) fase = NAAR_PROJECT[lopend[0].fase]
  else if (ws.every((w) => w.fase === 'klaar')) fase = huidig === 'care' ? 'care' : 'klaar'
  else if (ws.some((w) => w.fase === 'klaar')) fase = 'bouw'
  return fase && fase !== huidig ? fase : null
}

/** Een eenvoudige tijdlijn: per workflow een balk van de start van de bouw tot klaar (of vandaag). In procenten. */
export function tijdlijnBalken(ws: Pick<WfLevering, 'id' | 'naam' | 'fase' | 'bouw_start' | 'klaar_op' | 'volgorde'>[], vandaag: string): { van: string; tot: string; balken: { id: string; naam: string; fase: WfFase; links: number; breedte: number; van: string; tot: string }[] } | null {
  const met = ws.filter((w) => w.bouw_start).sort((a, b) => a.volgorde - b.volgorde)
  if (!met.length) return null
  const rij = met.map((w) => ({ w, van: dag(w.bouw_start!), tot: w.klaar_op ? dag(w.klaar_op) : vandaag }))
  const van = rij.map((r) => r.van).sort()[0]
  const tot = rij.map((r) => r.tot).sort().reverse()[0]
  const span = Math.max(1, dagenTussen(van, tot) + 1)
  return {
    van, tot,
    balken: rij.map(({ w, van: a, tot: b }) => {
      const links = Math.round((dagenTussen(van, a) / span) * 1000) / 10
      const breedte = Math.max(2, Math.round(((dagenTussen(a, b) + 1) / span) * 1000) / 10)
      return { id: w.id, naam: w.naam, fase: w.fase, links, breedte: Math.min(breedte, 100 - links), van: a, tot: b }
    }),
  }
}

// ── Wat de klant ziet en leest ──────────────────────────────────────────────

export const KLANT_WF_UITLEG: Record<WfFase, string> = {
  gepland: 'Staat gepland. We starten binnenkort met bouwen.',
  bouw: 'We bouwen.',
  oplevering: 'Klaar. We tonen je in een korte video hoe het werkt.',
  nazorg: 'In gebruik. We bellen je even om bij te sturen waar nodig.',
  klaar: 'Opgeleverd.',
}
export type KlantWfLevering = { id: string; naam: string; oplossing: string | null; fase: WfFase; faseLabel: string; uitleg: string; wachtOpJou: boolean; video: string | null }
/** Enkel dit gaat naar de klantapp: nooit prijs, uren, interne notities of wie bouwt. */
export function klantWfLevering(w: WfLevering): KlantWfLevering {
  return {
    id: w.id, naam: w.naam, oplossing: w.oplossing, fase: w.fase, faseLabel: wfFaseLabel(w.fase),
    uitleg: w.wacht_op_klant ? 'We wachten op iets van jou. We laten weten wat we nodig hebben.' : KLANT_WF_UITLEG[w.fase],
    wachtOpJou: w.wacht_op_klant, video: w.video_gestuurd_op ? w.video_link : null,
  }
}

/** De mail met de video: een voorstel, altijd na te kijken in het mailvenster. */
export function videoMail(i: { naam: string; nazorgWeken: number; afzender: string | null }): { onderwerp: string; tekst: string; knop: string } {
  const tekst = [
    'Hallo [voornaam],',
    `${i.naam} staat klaar. In deze korte video laten we zien hoe het werkt en waar je wat terugvindt.`,
    i.nazorgWeken > 0
      ? 'Kijk hem rustig na. Loopt er iets anders dan je verwacht, laat het gerust weten. De komende weken bellen we je ook nog even om bij te sturen.'
      : 'Kijk hem rustig na. Loopt er iets anders dan je verwacht, laat het gerust weten.',
    ['Groeten,', i.afzender, 'NextGenSolutions'].filter(Boolean).join('\n'),
  ].join('\n\n')
  return { onderwerp: `${i.naam}: zo werkt het`, tekst, knop: 'Video bekijken' }
}
