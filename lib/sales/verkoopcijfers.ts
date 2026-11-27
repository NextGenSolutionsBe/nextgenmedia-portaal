/**
 * Verkoopcijfers (verbeterplan fase 6, punten 71–77): trechter per bedrijf met
 * conversie per stap, bronnen, redenen van verlies, salesactiviteit uit de
 * ABM-belresultaten en geplande tegenover gedane salesuren. Pure regels,
 * getest in tests/sales-fase6.test.ts. Enkel lezen: niets wordt aangepast.
 */
import { kolomVan, kolomRang } from '@/lib/opdrachten-kanban'
import { bronNaam, verliesGroep } from './bronnen'

export type Stap = { label: string; aantal: number; conversie: number | null }

const conversies = (labels: string[], bereikt: number[]): Stap[] =>
  labels.map((label, i) => ({ label, aantal: bereikt[i], conversie: i === 0 ? null : bereikt[i - 1] ? Math.round((bereikt[i] / bereikt[i - 1]) * 100) : null }))

// ── Media (en Solutions-kaarten) op het bord Projecten ──────────────────────

export type KaartKort = { status: string | null; bron: string | null; stop_reden: string | null; offerte_op: string | null; offerte_via: string | null; contract_id: string | null; created_at: string; bedrijf: string | null }

export const MEDIA_STAPPEN = ['Opvolging', 'Offerte gestuurd', 'Contract verstuurd', 'Contract getekend', 'Afgerond']
const DREMPEL = [0, 1, 3, 4, 6] // kolomRang van elke stap

/**
 * Tot welke stap kwam een kaart? Uit de huidige kolom; een verloren kaart telt
 * tot de offerte of het contract als die er waren (verder weten we het niet).
 */
export function bereikteStap(k: KaartKort): number {
  const kolom = kolomVan(k.status)
  if (kolom === 'stopgezet') return k.contract_id ? 2 : (k.offerte_op || k.offerte_via) ? 1 : 0
  const rang = kolomRang(kolom)
  let stap = 0
  DREMPEL.forEach((d, i) => { if (rang >= d) stap = i })
  return stap
}

export function mediaTrechter(kaarten: KaartKort[]): { stappen: Stap[]; verloren: number; open: number } {
  const bereikt = MEDIA_STAPPEN.map(() => 0)
  let verloren = 0, open = 0
  for (const k of kaarten) {
    const s = bereikteStap(k)
    for (let i = 0; i <= s; i++) bereikt[i]++
    const kolom = kolomVan(k.status)
    if (kolom === 'stopgezet') verloren++
    else if (kolomRang(kolom) < 4) open++
  }
  return { stappen: conversies(MEDIA_STAPPEN, bereikt), verloren, open }
}

// ── Solutions-pipeline ───────────────────────────────────────────────────────

export type DealKort = { fase: string; bron: string | null; verloren_reden: string | null; created_at: string }
export const SOLUTIONS_STAPPEN = ['Afspraak', 'Voorstel', 'Opvolgen', 'Closed Won']
const DEAL_RANG: Record<string, number> = { afspraak: 0, voorstel: 1, opvolgen: 2, won: 3, lost: 0 }

export function solutionsTrechter(deals: DealKort[]): { stappen: Stap[]; verloren: number; open: number } {
  const bereikt = SOLUTIONS_STAPPEN.map(() => 0)
  let verloren = 0, open = 0
  for (const d of deals) {
    const s = DEAL_RANG[d.fase] ?? 0
    for (let i = 0; i <= s; i++) bereikt[i]++
    if (d.fase === 'lost') verloren++
    else if (d.fase !== 'won') open++
  }
  return { stappen: conversies(SOLUTIONS_STAPPEN, bereikt), verloren, open }
}

// ── Bronnen en verlies ───────────────────────────────────────────────────────

/** Per bron: hoeveel kaarten of deals, hoeveel gewonnen en verloren. */
export function perBron(rijen: { bron: string | null; gewonnen: boolean; verloren: boolean }[]): { bron: string; totaal: number; gewonnen: number; verloren: number }[] {
  const m = new Map<string, { totaal: number; gewonnen: number; verloren: number }>()
  for (const r of rijen) {
    const k = bronNaam(r.bron)
    const v = m.get(k) ?? { totaal: 0, gewonnen: 0, verloren: 0 }
    v.totaal++; if (r.gewonnen) v.gewonnen++; if (r.verloren) v.verloren++
    m.set(k, v)
  }
  return [...m.entries()].map(([bron, v]) => ({ bron, ...v })).sort((a, b) => b.totaal - a.totaal)
}

export function verliesRedenen(redenen: (string | null)[]): { reden: string; aantal: number }[] {
  const m = new Map<string, number>()
  for (const r of redenen) { const g = verliesGroep(r); m.set(g, (m.get(g) ?? 0) + 1) }
  return [...m.entries()].map(([reden, aantal]) => ({ reden, aantal })).sort((a, b) => b.aantal - a.aantal)
}

// ── Salesactiviteit uit ABM (punt 71) ───────────────────────────────────────

export type AbmNotitie = { door: string | null; uitkomst: string | null; soort: string | null; created_at: string }

export type Activiteit = { wie: string; gesprekken: number; gesproken: number; interesse: number; terugbellen: number; nietOpgenomen: number }

/** Per persoon: hoeveel gesprekken (elke notitie met een uitkomst) en wat eruit kwam. */
export function salesActiviteit(notities: AbmNotitie[]): Activiteit[] {
  const m = new Map<string, Activiteit>()
  for (const n of notities) {
    if (!n.uitkomst) continue
    const wie = (n.door ?? 'Onbekend').trim() || 'Onbekend'
    const a = m.get(wie) ?? { wie, gesprekken: 0, gesproken: 0, interesse: 0, terugbellen: 0, nietOpgenomen: 0 }
    a.gesprekken++
    const u = n.uitkomst.toLowerCase()
    if (u.includes('interesse')) { a.interesse++; a.gesproken++ }
    else if (u.includes('gesproken')) a.gesproken++
    else if (u.includes('terugbellen')) { a.terugbellen++; a.gesproken++ }
    else if (u.includes('niet opgenomen') || u.includes('voicemail')) a.nietOpgenomen++
    m.set(wie, a)
  }
  return [...m.values()].sort((a, b) => b.gesprekken - a.gesprekken)
}

// ── Salesuren (punt 72) ─────────────────────────────────────────────────────

/** Uren uit tijdvakken (ms), afgerond op een kwartier. */
export const urenVan = (vakken: { start: number; end: number }[]) => Math.round((vakken.reduce((t, v) => t + Math.max(0, v.end - v.start), 0) / 3_600_000) * 4) / 4

/** Hoeveel van de geplande salesuren werden een gehouden verkoopafspraak? */
export function salesUren(gepland: number, gedaan: number): { gepland: number; gedaan: number; pct: number | null } {
  return { gepland, gedaan, pct: gepland > 0 ? Math.round((gedaan / gepland) * 100) : null }
}
