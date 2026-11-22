// NextGenSolutions — eigen pipeline en cijfers. Puur (client én server),
// getest in tests/ngs.test.ts. Staat los van de rest van de app: geen klanten,
// projecten of facturen, enkel deals van NextGen Solutions.

import { leesGetal } from '@/lib/getal'

// ── Fases ───────────────────────────────────────────────────────────────────

export const FASES = [
  { key: 'afspraak', label: 'Afspraak', kort: 'Afspraak', kans: 0.2 },
  { key: 'voorstel', label: 'Voorstel maken', kort: 'Voorstel', kans: 0.4 },
  { key: 'opvolgen', label: 'Opvolgen', kort: 'Opvolgen', kans: 0.6 },
  { key: 'won', label: 'Closed Won', kort: 'Won', kans: 1 },
  { key: 'lost', label: 'Closed Lost', kort: 'Lost', kans: 0 },
] as const
export type Fase = (typeof FASES)[number]['key']
export const OPEN_FASES: Fase[] = ['afspraak', 'voorstel', 'opvolgen']
export const isFase = (v: unknown): v is Fase => FASES.some((f) => f.key === v)
export const faseLabel = (f: string) => FASES.find((x) => x.key === f)?.label ?? f
export const isOpen = (f: string) => (OPEN_FASES as string[]).includes(f)

export const DIENSTEN = [
  { key: 'website', label: 'Website' },
  { key: 'webshop', label: 'Webshop' },
  { key: 'seo', label: 'SEO' },
  { key: 'google_ads', label: 'Google Ads' },
  { key: 'ai', label: 'AI-automatisatie' },
  { key: 'software', label: 'Software op maat' },
  { key: 'hosting', label: 'Hosting en onderhoud' },
  { key: 'andere', label: 'Andere' },
] as const
export const dienstLabel = (k: string) => DIENSTEN.find((d) => d.key === k)?.label ?? k

export const BRONNEN = [
  { key: 'inbound', label: 'Inbound' },
  { key: 'outbound', label: 'Outbound' },
  { key: 'netwerk', label: 'Netwerk' },
  { key: 'doorverwijzing', label: 'Doorverwezen' },
  { key: 'andere', label: 'Andere' },
] as const
export const bronLabel = (k: string | null) => BRONNEN.find((b) => b.key === k)?.label ?? 'Onbekend'

export const VERLOREN_REDENEN = ['Te duur', 'Geen budget of timing', 'Koos een andere partij', 'Geen reactie meer', 'Niet de juiste fit']

/** Zonder looptijd tellen we het maandbedrag voor één jaar in de waarde. */
export const STANDAARD_LOOPTIJD = 12

export type Deal = {
  id: string
  bedrijf: string
  contactpersoon: string | null
  email: string | null
  telefoon: string | null
  titel: string | null
  diensten: string[]
  fase: Fase
  fase_sinds: string
  afspraak_op: string | null
  waarde_eenmalig: number | null
  waarde_maandelijks: number | null
  looptijd_maanden: number | null
  start_datum: string | null
  bron: string | null
  verantwoordelijke: string | null
  gewonnen_op: string | null
  verloren_op: string | null
  verloren_reden: string | null
  created_at: string
  created_by: string | null
}

export type DealInvoer = Omit<Deal, 'id' | 'fase' | 'fase_sinds' | 'gewonnen_op' | 'verloren_op' | 'verloren_reden' | 'created_at' | 'created_by'>

const DAG = /^\d{4}-\d{2}-\d{2}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const rond = (x: number) => Math.round(x * 100) / 100
const geldigeDag = (d: string) => DAG.test(d) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d
const tekst = (v: unknown, max: number) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return t ? t.slice(0, max) : null }
const bedrag = (v: unknown): number | null | false => {
  if (v === null || v === undefined || String(v).trim() === '') return null
  const n = leesGetal(v)
  return n === null || n < 0 || n > 10_000_000 ? false : rond(n)
}

/** De gegevens van een deal (niet de fase: die verandert enkel via verplaatsen). */
export function controleerDeal(b: Record<string, unknown>): { ok: true; waarde: DealInvoer } | { ok: false; fout: string } {
  const bedrijf = tekst(b.bedrijf, 160)
  if (!bedrijf) return { ok: false, fout: 'Vul de naam van het bedrijf in.' }
  const email = tekst(b.email, 200)
  if (email && !EMAIL.test(email)) return { ok: false, fout: 'Het e-mailadres klopt niet.' }
  const eenmalig = bedrag(b.waarde_eenmalig)
  const maandelijks = bedrag(b.waarde_maandelijks)
  if (eenmalig === false || maandelijks === false) return { ok: false, fout: 'Een bedrag klopt niet.' }
  let looptijd: number | null = null
  if (b.looptijd_maanden !== null && b.looptijd_maanden !== undefined && String(b.looptijd_maanden).trim() !== '') {
    const n = Number(b.looptijd_maanden)
    if (!Number.isInteger(n) || n < 1 || n > 120) return { ok: false, fout: 'De looptijd is een aantal maanden (1 tot 120).' }
    looptijd = n
  }
  let afspraak: string | null = null
  if (b.afspraak_op) {
    const d = new Date(String(b.afspraak_op))
    if (Number.isNaN(d.getTime())) return { ok: false, fout: 'De datum van de afspraak klopt niet.' }
    afspraak = d.toISOString()
  }
  const start = tekst(b.start_datum, 10)
  if (start && !geldigeDag(start)) return { ok: false, fout: 'De startdatum klopt niet.' }
  const lijst = Array.isArray(b.diensten) ? b.diensten : []
  return {
    ok: true,
    waarde: {
      bedrijf, contactpersoon: tekst(b.contactpersoon, 160), email, telefoon: tekst(b.telefoon, 40), titel: tekst(b.titel, 200),
      diensten: DIENSTEN.map((d) => d.key).filter((k) => lijst.includes(k)),
      afspraak_op: afspraak, waarde_eenmalig: eenmalig, waarde_maandelijks: maandelijks, looptijd_maanden: looptijd, start_datum: start,
      bron: BRONNEN.some((x) => x.key === b.bron) ? String(b.bron) : null,
      verantwoordelijke: tekst(b.verantwoordelijke, 80),
    },
  }
}

/** Wat een deal waard is: eenmalig + maandbedrag × looptijd (zonder looptijd: één jaar). */
export function dealWaarde(d: Pick<Deal, 'waarde_eenmalig' | 'waarde_maandelijks' | 'looptijd_maanden'>): number {
  return rond((d.waarde_eenmalig ?? 0) + (d.waarde_maandelijks ?? 0) * (d.looptijd_maanden ?? STANDAARD_LOOPTIJD))
}

/**
 * Naar een andere fase: wat er op de deal verandert. Won zet de datum (en de
 * start van het maandbedrag als die er nog niet is); lost vraagt een reden;
 * terug naar een open fase maakt won/lost weer leeg.
 */
export function verplaatsing(d: Pick<Deal, 'start_datum'>, naar: unknown, opties: { datum?: unknown; reden?: unknown }, vandaag: string, nu: string):
  { ok: true; patch: Partial<Deal> } | { ok: false; fout: string } {
  if (!isFase(naar)) return { ok: false, fout: 'Onbekende fase.' }
  const datum = typeof opties.datum === 'string' && geldigeDag(opties.datum) ? opties.datum : vandaag
  if (datum > vandaag) return { ok: false, fout: 'Die datum ligt in de toekomst.' }
  const basis: Partial<Deal> = { fase: naar, fase_sinds: nu }
  if (naar === 'won') return { ok: true, patch: { ...basis, gewonnen_op: datum, start_datum: d.start_datum ?? datum, verloren_op: null, verloren_reden: null } }
  if (naar === 'lost') {
    const reden = tekst(opties.reden, 300)
    if (!reden) return { ok: false, fout: 'Waarom ging de deal niet door?' }
    return { ok: true, patch: { ...basis, verloren_op: datum, verloren_reden: reden, gewonnen_op: null } }
  }
  return { ok: true, patch: { ...basis, gewonnen_op: null, verloren_op: null, verloren_reden: null } }
}

// ── Periodes ────────────────────────────────────────────────────────────────

const MAANDNAAM = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
const MAANDKORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
export const maandLabel = (ym: string) => { const [j, m] = ym.split('-').map(Number); return `${MAANDNAAM[m - 1]} ${j}` }
export const maandKort = (ym: string) => { const [j, m] = ym.split('-').map(Number); return `${MAANDKORT[m - 1]} ${String(j).slice(2)}` }
export function plusMaanden(ym: string, n: number): string {
  const [j, m] = ym.split('-').map(Number)
  const t = j * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}
export function maandenTussen(van: string, tot: string): string[] {
  const uit: string[] = []
  for (let m = van; m <= tot && uit.length < 600; m = plusMaanden(m, 1)) uit.push(m)
  return uit
}

export type PeriodeSoort = 'maand' | 'kwartaal' | 'jaar'
export type Periode = { soort: PeriodeSoort; ref: string; maanden: string[]; label: string }
export function periodeVan(soort: PeriodeSoort, ref: string): Periode {
  const [j, m] = ref.split('-').map(Number)
  if (soort === 'maand') return { soort, ref, maanden: [ref], label: maandLabel(ref) }
  if (soort === 'kwartaal') {
    const q = Math.floor((m - 1) / 3)
    const eerste = `${j}-${String(q * 3 + 1).padStart(2, '0')}`
    return { soort, ref: eerste, maanden: maandenTussen(eerste, plusMaanden(eerste, 2)), label: `Q${q + 1} ${j}` }
  }
  return { soort, ref: `${j}-01`, maanden: maandenTussen(`${j}-01`, `${j}-12`), label: String(j) }
}
export const verschuif = (p: Periode, stap: number) => periodeVan(p.soort, plusMaanden(p.ref, stap * (p.soort === 'maand' ? 1 : p.soort === 'kwartaal' ? 3 : 12)))

// ── Omzet en cijfers ────────────────────────────────────────────────────────

export type MaandOmzet = { maand: string; eenmalig: number; terugkerend: number; totaal: number }

/**
 * Omzet per maand uit de gewonnen deals: het eenmalige bedrag in de maand van
 * gewonnen, het maandbedrag elke maand vanaf de start, zolang de looptijd loopt
 * (zonder looptijd: door).
 */
export function omzetPerMaand(deals: Deal[], maanden: string[]): MaandOmzet[] {
  const per = new Map(maanden.map((m) => [m, { maand: m, eenmalig: 0, terugkerend: 0, totaal: 0 }]))
  for (const d of deals) {
    if (d.fase !== 'won' || !d.gewonnen_op) continue
    const e = per.get(d.gewonnen_op.slice(0, 7))
    if (e && d.waarde_eenmalig) e.eenmalig += d.waarde_eenmalig
    if (!d.waarde_maandelijks) continue
    const start = (d.start_datum ?? d.gewonnen_op).slice(0, 7)
    const einde = d.looptijd_maanden ? plusMaanden(start, d.looptijd_maanden - 1) : null
    for (const m of maanden) if (m >= start && (!einde || m <= einde)) per.get(m)!.terugkerend += d.waarde_maandelijks
  }
  return Array.from(per.values()).map((x) => ({ ...x, eenmalig: rond(x.eenmalig), terugkerend: rond(x.terugkerend), totaal: rond(x.eenmalig + x.terugkerend) }))
}

/** Wat er nu elke maand binnenkomt: gewonnen deals met een maandbedrag die vandaag lopen. */
export function lopendeMrr(deals: Deal[], vandaag: string): number {
  const nu = vandaag.slice(0, 7)
  return rond(deals.filter((d) => d.fase === 'won' && d.gewonnen_op && d.waarde_maandelijks).reduce((s, d) => {
    const start = (d.start_datum ?? d.gewonnen_op!).slice(0, 7)
    const einde = d.looptijd_maanden ? plusMaanden(start, d.looptijd_maanden - 1) : null
    return start <= nu && (!einde || nu <= einde) ? s + d.waarde_maandelijks! : s
  }, 0))
}

const dagenTussen = (van: string, tot: string) => Math.round((Date.parse(`${tot.slice(0, 10)}T12:00:00Z`) - Date.parse(`${van.slice(0, 10)}T12:00:00Z`)) / 86_400_000)

export type Cijfers = {
  omzet: number
  gewonnen: { aantal: number; waarde: number; nieuweMrr: number }
  verloren: number
  winrate: number | null
  gemiddeld: number | null
  doorlooptijd: number | null
  pipeline: { fase: Fase; aantal: number; waarde: number }[]
  pipelineWaarde: number
  gewogen: number
  perDienst: { dienst: string; aantal: number; waarde: number }[]
  perBron: { bron: string; gewonnen: number; verloren: number; waarde: number }[]
  redenen: { reden: string; aantal: number }[]
}

/** Alle cijfers voor een periode (gewonnen en verloren op hun datum) plus de open pipeline van nu. */
export function cijfersVoor(deals: Deal[], periode: Periode | null): Cijfers {
  const inPeriode = (d: string | null) => !!d && (!periode || periode.maanden.includes(d.slice(0, 7)))
  const won = deals.filter((d) => d.fase === 'won' && inPeriode(d.gewonnen_op))
  const lost = deals.filter((d) => d.fase === 'lost' && inPeriode(d.verloren_op))
  const waarde = rond(won.reduce((s, d) => s + dealWaarde(d), 0))
  const maanden = periode?.maanden ?? (() => {
    const eerste = deals.map((d) => (d.gewonnen_op ?? '').slice(0, 7)).filter(Boolean).sort()[0]
    const laatste = deals.map((d) => (d.gewonnen_op ?? '').slice(0, 7)).filter(Boolean).sort().pop()
    return eerste && laatste ? maandenTussen(eerste, laatste) : []
  })()
  const omzet = rond(omzetPerMaand(deals, maanden).reduce((s, m) => s + m.totaal, 0))
  const open = deals.filter((d) => isOpen(d.fase))
  const pipeline = OPEN_FASES.map((f) => {
    const l = open.filter((d) => d.fase === f)
    return { fase: f, aantal: l.length, waarde: rond(l.reduce((s, d) => s + dealWaarde(d), 0)) }
  })
  const kans = (f: Fase) => FASES.find((x) => x.key === f)!.kans
  const perDienst = new Map<string, { aantal: number; waarde: number }>()
  for (const d of won) {
    const lijst = d.diensten.length ? d.diensten : ['andere']
    for (const k of lijst) {
      const x = perDienst.get(k) ?? { aantal: 0, waarde: 0 }
      x.aantal += 1; x.waarde += dealWaarde(d) / lijst.length
      perDienst.set(k, x)
    }
  }
  const perBron = new Map<string, { gewonnen: number; verloren: number; waarde: number }>()
  for (const d of [...won, ...lost]) {
    const k = d.bron ?? 'onbekend'
    const x = perBron.get(k) ?? { gewonnen: 0, verloren: 0, waarde: 0 }
    if (d.fase === 'won') { x.gewonnen += 1; x.waarde += dealWaarde(d) } else x.verloren += 1
    perBron.set(k, x)
  }
  const redenen = new Map<string, number>()
  for (const d of lost) redenen.set(d.verloren_reden || 'Geen reden', (redenen.get(d.verloren_reden || 'Geen reden') ?? 0) + 1)
  const doorloop = won.filter((d) => d.gewonnen_op).map((d) => dagenTussen(d.created_at, d.gewonnen_op!)).filter((n) => n >= 0)
  return {
    omzet,
    gewonnen: { aantal: won.length, waarde, nieuweMrr: rond(won.reduce((s, d) => s + (d.waarde_maandelijks ?? 0), 0)) },
    verloren: lost.length,
    winrate: won.length + lost.length ? won.length / (won.length + lost.length) : null,
    gemiddeld: won.length ? rond(waarde / won.length) : null,
    doorlooptijd: doorloop.length ? Math.round(doorloop.reduce((s, n) => s + n, 0) / doorloop.length) : null,
    pipeline,
    pipelineWaarde: rond(pipeline.reduce((s, p) => s + p.waarde, 0)),
    gewogen: rond(open.reduce((s, d) => s + dealWaarde(d) * kans(d.fase), 0)),
    perDienst: Array.from(perDienst.entries()).map(([dienst, x]) => ({ dienst, aantal: x.aantal, waarde: rond(x.waarde) })).sort((a, b) => b.waarde - a.waarde),
    perBron: Array.from(perBron.entries()).map(([bron, x]) => ({ bron, ...x, waarde: rond(x.waarde) })).sort((a, b) => b.gewonnen - a.gewonnen || b.waarde - a.waarde),
    redenen: Array.from(redenen.entries()).map(([reden, aantal]) => ({ reden, aantal })).sort((a, b) => b.aantal - a.aantal),
  }
}

// ── Opvolgen ────────────────────────────────────────────────────────────────

export type TaakKort = { deal_id: string; deadline: string | null; afgerond_op?: string | null; clickup_status_type?: string | null; sync_status?: string }
const taakAf = (t: TaakKort) => !!t.afgerond_op || t.clickup_status_type === 'closed' || t.clickup_status_type === 'done' || t.clickup_status_type === 'weg'

/** De eerstvolgende open opvolgtaak per deal (de vroegste deadline). */
export function volgendeOpvolging(taken: TaakKort[]): Map<string, string> {
  const uit = new Map<string, string>()
  for (const t of taken) {
    if (!t.deadline || taakAf(t)) continue
    const nu = uit.get(t.deal_id)
    if (!nu || t.deadline < nu) uit.set(t.deal_id, t.deadline)
  }
  return uit
}

/** "vandaag", "morgen", "over 3 dagen", "2 dagen te laat". */
export function wanneer(dag: string, vandaag: string): { tekst: string; telaat: boolean; vandaag: boolean } {
  const n = dagenTussen(vandaag, dag)
  if (n === 0) return { tekst: 'vandaag', telaat: false, vandaag: true }
  if (n === 1) return { tekst: 'morgen', telaat: false, vandaag: false }
  if (n > 1) return { tekst: `over ${n} dagen`, telaat: false, vandaag: false }
  return { tekst: n === -1 ? 'gisteren' : `${-n} dagen te laat`, telaat: true, vandaag: false }
}

/** Volgorde in een kolom: afspraken op datum, opvolgen op de eerstvolgende taak, de rest nieuwste eerst. */
export function sorteerKolom(deals: Deal[], fase: Fase, opvolging: Map<string, string>): Deal[] {
  const l = deals.filter((d) => d.fase === fase)
  if (fase === 'afspraak') return l.sort((a, b) => (a.afspraak_op ?? '9999').localeCompare(b.afspraak_op ?? '9999'))
  if (fase === 'opvolgen') return l.sort((a, b) => (opvolging.get(a.id) ?? '9999').localeCompare(opvolging.get(b.id) ?? '9999'))
  if (fase === 'won') return l.sort((a, b) => (b.gewonnen_op ?? '').localeCompare(a.gewonnen_op ?? ''))
  if (fase === 'lost') return l.sort((a, b) => (b.verloren_op ?? '').localeCompare(a.verloren_op ?? ''))
  return l.sort((a, b) => b.fase_sinds.localeCompare(a.fase_sinds))
}

export const zoekDeal = (d: Deal, q: string) => !q.trim() || `${d.bedrijf} ${d.contactpersoon ?? ''} ${d.titel ?? ''} ${d.email ?? ''} ${d.diensten.map(dienstLabel).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase())
