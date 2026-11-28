// NextGenSolutions — eigen pipeline en cijfers. Puur (client én server),
// getest in tests/ngs.test.ts. Staat los van de rest van de app: geen klanten,
// projecten of facturen, enkel deals van NextGen Solutions.

import { leesGetal } from '@/lib/getal'
import { BRONNEN_LIJST, isBronKey, bronNaam, VERLIES_REDENEN } from '@/lib/sales/bronnen'

// ── Fases ───────────────────────────────────────────────────────────────────

export const FASES = [
  { key: 'afspraak', label: 'Afspraak', kort: 'Afspraak', kans: 0.2 },
  { key: 'voorstel', label: 'Voorstel', kort: 'Voorstel', kans: 0.4 },
  { key: 'opvolgen', label: 'Opvolgen voorstel', kort: 'Opv. voorstel', kans: 0.6 },
  { key: 'audit', label: 'Audit', kort: 'Audit', kans: 0.75 },
  { key: 'opvolgen_rapport', label: 'Opvolgen rapport', kort: 'Opv. rapport', kans: 0.85 },
  { key: 'won', label: 'Closed Won', kort: 'Won', kans: 1 },
  { key: 'lost', label: 'Closed Lost', kort: 'Lost', kans: 0 },
] as const
export type Fase = (typeof FASES)[number]['key']
export const OPEN_FASES: Fase[] = ['afspraak', 'voorstel', 'opvolgen', 'audit', 'opvolgen_rapport']
/** In deze fases bellen we op: één keer per week (Instellingen → Werking), tenzij anders afgesproken. */
export const OPVOLG_FASES: Fase[] = ['opvolgen', 'opvolgen_rapport']
export const isOpvolgFase = (f: string) => (OPVOLG_FASES as string[]).includes(f)
export const isFase = (v: unknown): v is Fase => FASES.some((f) => f.key === v)
export const faseLabel = (f: string) => FASES.find((x) => x.key === f)?.label ?? f
export const isOpen = (f: string) => (OPEN_FASES as string[]).includes(f)

/** Wat NextGenSolutions doet (22 nov 2026: geen keuze meer in het formulier, de info is vrije tekst). */
export const DIENSTEN = [
  { key: 'ai', label: 'AI-automatisatie' },
  { key: 'software', label: 'Software op maat' },
] as const
export const dienstLabel = (k: string) => DIENSTEN.find((d) => d.key === k)?.label ?? k

/** Eén bronnenlijst voor de hele app (fase 6, lib/sales/bronnen.ts); inbound, doorverwijzing en andere van vroeger blijven geldig. */
export const BRONNEN: { key: string; label: string }[] = BRONNEN_LIJST.map((b) => ({ key: b.key, label: b.label }))
export const bronLabel = (k: string | null) => bronNaam(k)

export const VERLOREN_REDENEN = VERLIES_REDENEN

/** Zonder looptijd tellen we het maandbedrag voor één jaar in de waarde. */
export const STANDAARD_LOOPTIJD = 12

export type Deal = {
  id: string
  bedrijf: string
  contactpersoon: string | null
  email: string | null
  telefoon: string | null
  /** Vrije info: wat de klant wil, budget, timing … (vrijblijvend). */
  titel: string | null
  /** Niet meer in te vullen (22 nov 2026); oude waarden blijven bewaard. */
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
  /** Fase 5: de klant in de app (optioneel; de pipeline werkt ook zonder). */
  client_id?: string | null
  /** Nieuwe werking (28 nov 2026): de vervolgafspraak na het voorstel en de gegevens van de audit. */
  vervolg_op?: string | null
  vervolg_meeting_id?: string | null
  processen?: number | null
  audit_prijs?: number | null
  audit_contract_id?: string | null
  audit_buiten_app?: boolean
  audit_buiten_notitie?: string | null
  auditdag_op?: string | null
  presentatie_op?: string | null
  audit_checklist?: Record<string, string | null>
}

export type DealInvoer = Omit<Deal, 'id' | 'fase' | 'fase_sinds' | 'gewonnen_op' | 'verloren_op' | 'verloren_reden' | 'created_at' | 'created_by' | 'client_id' | 'vervolg_op' | 'vervolg_meeting_id' | 'processen' | 'audit_prijs' | 'audit_contract_id' | 'audit_buiten_app' | 'audit_buiten_notitie' | 'auditdag_op' | 'presentatie_op' | 'audit_checklist'>

const DAG = /^\d{4}-\d{2}-\d{2}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const rond = (x: number) => Math.round(x * 100) / 100
const geldigeDag = (d: string) => DAG.test(d) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d
const tekst = (v: unknown, max: number) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return t ? t.slice(0, max) : null }
/** Vrije tekst met regels (de info bij een deal): regels blijven, lege regels vallen weg. */
const metRegels = (v: unknown, max: number) => { const t = String(v ?? '').split(/\r?\n/).map((r) => r.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n'); return t ? t.slice(0, max) : null }
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
      bedrijf, contactpersoon: tekst(b.contactpersoon, 160), email, telefoon: tekst(b.telefoon, 40), titel: metRegels(b.titel, 2000),
      diensten: DIENSTEN.map((d) => d.key).filter((k) => lijst.includes(k)),
      afspraak_op: afspraak, waarde_eenmalig: eenmalig, waarde_maandelijks: maandelijks, looptijd_maanden: looptijd, start_datum: start,
      bron: isBronKey(b.bron) ? String(b.bron) : null,
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
    const lijst = d.diensten.length ? d.diensten : ['geen']
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


// ── Nieuwe werking (28 nov 2026): vervolgafspraak, belpogingen, audit ─────────

const plusDag = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

/**
 * Na een belpoging: de volgende opvolging, standaard `dagen` later (Instellingen →
 * Werking). Valt dat in het weekend, dan de maandag erna. Altijd aan te passen.
 */
export function volgendeBelDatum(vandaag: string, dagen: number): string {
  let d = plusDag(vandaag, dagen)
  const wd = new Date(`${d}T12:00:00Z`).getUTCDay()
  if (wd === 6) d = plusDag(d, 2)
  if (wd === 0) d = plusDag(d, 1)
  return d
}

/** De vervolgafspraak: een geplande meeting gaat voor op een met de hand ingevulde datum. */
export function vervolgVan(d: Pick<Deal, 'vervolg_op'>, meeting: { starts_at: string } | null | undefined): string | null {
  return meeting?.starts_at ?? d.vervolg_op ?? null
}

/** In Voorstel zonder vervolgafspraak (of een die al voorbij is): een gele waarschuwing. */
export function vervolgOntbreekt(d: Pick<Deal, 'fase'>, vervolg: string | null, nu: string): boolean {
  if (d.fase !== 'voorstel') return false
  return !vervolg || vervolg < nu
}

/** De checklist in de fase Audit. `wie` komt uit Instellingen → Werking. */
export const AUDIT_STAPPEN = [
  { key: 'auditdag', titel: 'Auditdag ter plaatse', wie: 'auditdag' },
  { key: 'briefing', titel: 'Briefing van 30 minuten aan de bouwer', wie: 'auditdag' },
  { key: 'rapport', titel: 'Rapport', wie: 'rapport' },
  { key: 'presentatie', titel: 'Presentatie van het rapport', wie: 'auditdag' },
] as const
export type AuditStap = (typeof AUDIT_STAPPEN)[number]['key']
export const isAuditStap = (v: unknown): v is AuditStap => AUDIT_STAPPEN.some((s) => s.key === v)

/** Richtlijn voor de presentatie: ongeveer x minuten per proces. */
export const presentatieMinuten = (processen: number | null | undefined, perProces: number) => Math.max(1, processen ?? 1) * perProces

export type AuditInvoer = {
  processen: number; audit_prijs: number; audit_contract_id: string | null; audit_buiten_app: boolean; audit_buiten_notitie: string | null
  auditdag_op: string; presentatie_op: string
}

/**
 * Naar Audit: aantal processen (1 tot max), de prijs (basis + per proces, uit de
 * instellingen), een getekend voorstel (contract uit de app of "getekend buiten de
 * app"), de auditdag en de presentatie. De presentatie ligt op of na de auditdag;
 * later dan `maxDagen` erna mag, met een waarschuwing.
 */
export function controleerAudit(b: Record<string, unknown>, v: { max_processen: number; presentatie_max_dagen: number; prijs: (n: number) => number }):
  { ok: true; audit: AuditInvoer; waarschuwing: string | null } | { ok: false; fout: string } {
  const n = Number(b.processen)
  if (!Number.isInteger(n) || n < 1 || n > v.max_processen) return { ok: false, fout: `Hoeveel processen? Tussen 1 en ${v.max_processen}.` }
  const contract = typeof b.audit_contract_id === 'string' && /^[0-9a-f-]{36}$/i.test(b.audit_contract_id) ? b.audit_contract_id : null
  const buiten = b.audit_buiten_app === true
  if (!contract && !buiten) return { ok: false, fout: 'Kies het getekende voorstel, of duid aan dat het buiten de app getekend werd.' }
  const auditdag = typeof b.auditdag_op === 'string' && geldigeDag(b.auditdag_op) ? b.auditdag_op : null
  if (!auditdag) return { ok: false, fout: 'Wanneer is de auditdag?' }
  const presentatie = typeof b.presentatie_op === 'string' && geldigeDag(b.presentatie_op) ? b.presentatie_op : null
  if (!presentatie) return { ok: false, fout: 'Wanneer is de presentatie van het rapport?' }
  if (presentatie < auditdag) return { ok: false, fout: 'De presentatie ligt na de auditdag.' }
  const verschil = Math.round((Date.parse(`${presentatie}T12:00:00Z`) - Date.parse(`${auditdag}T12:00:00Z`)) / 86_400_000)
  const waarschuwing = verschil > v.presentatie_max_dagen ? `De presentatie ligt ${verschil} dagen na de auditdag (richtlijn: hoogstens ${v.presentatie_max_dagen}).` : null
  return {
    ok: true, waarschuwing,
    audit: {
      processen: n, audit_prijs: v.prijs(n), audit_contract_id: contract, audit_buiten_app: buiten && !contract,
      audit_buiten_notitie: buiten && !contract ? tekst(b.audit_buiten_notitie, 300) : null, auditdag_op: auditdag, presentatie_op: presentatie,
    },
  }
}

/** De checklist netjes: per stap wanneer ze afgevinkt werd (of niet). */
export function leesChecklist(v: unknown): Record<AuditStap, string | null> {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return Object.fromEntries(AUDIT_STAPPEN.map((s) => [s.key, typeof r[s.key] === 'string' ? (r[s.key] as string) : null])) as Record<AuditStap, string | null>
}
