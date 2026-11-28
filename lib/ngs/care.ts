/**
 * Care bij NextGenSolutions (nieuwe werking fase 6, 28 nov 2026): pakketten met
 * limieten, uren per maand, supportvragen met een reactietijd in werkuren,
 * monitoring en de overdracht zonder Care. Alle getallen komen uit Instellingen →
 * Werking → Care (nooit vast in de code). Pure regels, getest in tests/ngs-care.test.ts.
 */
import type { CarePakket, CarePakketKey, WerkingInstellingen } from '@/lib/werking/instellingen'

export type CareInst = WerkingInstellingen['care']
const rond1 = (x: number) => Math.round(x * 10) / 10

export const pakketVan = (key: string | null | undefined, inst: CareInst): CarePakket | null => inst.pakketten.find((p) => p.key === key) ?? null
/** Het pakket erboven (Basis → Plus → Pro), of null als het al het hoogste is. */
export function volgendPakket(key: string | null | undefined, inst: CareInst): CarePakket | null {
  const i = inst.pakketten.findIndex((p) => p.key === key)
  return i >= 0 && i < inst.pakketten.length - 1 ? inst.pakketten[i + 1] : null
}

/** Een werkdag in uren, uit de werkuren (09:00–17:00 = 8). */
export function werkdagUren(inst: Pick<CareInst, 'werkdag_van' | 'werkdag_tot'>): number {
  const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  return Math.max(1, (min(inst.werkdag_tot) - min(inst.werkdag_van)) / 60)
}
/** "2 werkdagen", "1 werkdag" of "4 werkuren". */
export function reactieLabel(werkuren: number, inst: Pick<CareInst, 'werkdag_van' | 'werkdag_tot'>): string {
  const dag = werkdagUren(inst)
  if (werkuren % dag === 0) { const n = werkuren / dag; return `${n} ${n === 1 ? 'werkdag' : 'werkdagen'}` }
  return `${werkuren} ${werkuren === 1 ? 'werkuur' : 'werkuren'}`
}

// ── Opslag ──────────────────────────────────────────────────────────────────

export type Meting = { gebruikt: number | null; limiet: number; pct: number | null }
export type OpslagStand = { db: Meting; bestanden: Meting; hoogste: number | null; waarschuwing: boolean; voorstel: CarePakket | null }

/** Hoe vol de databank en de bestanden zitten tegenover het pakket. Vanaf 80% een waarschuwing met het pakket erboven. */
export function opslagStand(g: { db_gb: number | null; bestanden_gb: number | null }, pakket: CarePakket | null, inst: CareInst, drempel = 80): OpslagStand | null {
  if (!pakket) return null
  const m = (gebruikt: number | null, limiet: number): Meting => ({ gebruikt, limiet, pct: gebruikt === null || !(limiet > 0) ? null : rond1((gebruikt / limiet) * 100) })
  const db = m(g.db_gb, pakket.db_gb), bestanden = m(g.bestanden_gb, pakket.bestanden_gb)
  const pcts = [db.pct, bestanden.pct].filter((x): x is number => x !== null)
  const hoogste = pcts.length ? Math.max(...pcts) : null
  const waarschuwing = hoogste !== null && hoogste >= drempel
  return { db, bestanden, hoogste, waarschuwing, voorstel: waarschuwing ? volgendPakket(pakket.key, inst) : null }
}

/** De zin voor het belletje bij 80% of meer. */
export function opslagMelding(naam: string, s: OpslagStand | null): string | null {
  if (!s?.waarschuwing || s.hoogste === null) return null
  const wat = (s.db.pct ?? -1) >= (s.bestanden.pct ?? -1)
    ? `de databank (${s.db.gebruikt} van ${s.db.limiet} GB)`
    : `de bestanden (${s.bestanden.gebruikt} van ${s.bestanden.limiet} GB)`
  return `${naam}: ${s.hoogste.toLocaleString('nl-BE')}% van ${wat}. ${s.voorstel ? `Stel ${s.voorstel.naam} voor.` : 'Het hoogste pakket is bereikt: bespreek een oplossing.'}`
}

// ── Uren aanpassingen per maand ─────────────────────────────────────────────

/** De uren van deze maand: elke eerste van de maand opnieuw, niets schuift door. */
export function urenDezeMaand(rijen: { datum: string; uren: number }[], vandaag: string, pakket: CarePakket | null): { gebruikt: number; beschikbaar: number; resterend: number; over: boolean } {
  const maand = vandaag.slice(0, 7)
  const gebruikt = rond1(rijen.filter((r) => r.datum.slice(0, 7) === maand).reduce((s, r) => s + Number(r.uren || 0), 0))
  const beschikbaar = pakket?.uren_per_maand ?? 0
  return { gebruikt, beschikbaar, resterend: rond1(Math.max(0, beschikbaar - gebruikt)), over: gebruikt > beschikbaar }
}

// ── Reactietijd in werkuren (Belgische tijd) ────────────────────────────────

/** Het verschil tussen Brussel en UTC op dat moment, in minuten (zomer- en wintertijd). */
export function brusselOffsetMin(d: Date): number {
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', timeZoneName: 'shortOffset' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+1'
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(t)
  if (!m) return 60
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0))
}

/**
 * Tegen wanneer we moeten reageren: `werkuren` later, enkel van maandag tot vrijdag
 * binnen de werkuren. Een vraag op vrijdag 16:00 met 4 werkuren = maandag 12:00.
 */
export function deadlineNaWerkuren(binnen: string | Date, werkuren: number, inst: Pick<CareInst, 'werkdag_van' | 'werkdag_tot'>): string {
  const start = typeof binnen === 'string' ? new Date(binnen) : binnen
  const off = brusselOffsetMin(start)
  // Rekenen in "Brusselse wandtijd" als UTC-getallen.
  let t = start.getTime() + off * 60_000
  const van = Number(inst.werkdag_van.slice(0, 2)) * 60 + Number(inst.werkdag_van.slice(3, 5))
  const tot = Number(inst.werkdag_tot.slice(0, 2)) * 60 + Number(inst.werkdag_tot.slice(3, 5))
  let rest = Math.round(werkuren * 60)
  const DAG = 86_400_000
  for (let i = 0; i < 400 && rest > 0; i++) {
    const d = new Date(t)
    const wd = d.getUTCDay() // 0 = zondag
    const dagStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    const minNu = (t - dagStart) / 60_000
    if (wd === 0 || wd === 6 || minNu >= tot) { t = dagStart + DAG + van * 60_000; continue }
    if (minNu < van) { t = dagStart + van * 60_000; continue }
    const kan = Math.min(rest, tot - minNu)
    t += kan * 60_000
    rest -= kan
  }
  const uit = new Date(t - brusselOffsetMin(new Date(t - off * 60_000)) * 60_000)
  return uit.toISOString()
}

export type SupportStatus = 'opgelost' | 'te_laat' | 'bijna' | 'loopt'
/** Komt de reactietijd in gevaar? Minder dan twee uur over = bijna, voorbij = te laat. */
export function supportStatus(v: { deadline: string; opgelost_op: string | null }, nu: Date = new Date()): { status: SupportStatus; minutenOver: number } {
  if (v.opgelost_op) return { status: 'opgelost', minutenOver: 0 }
  const over = Math.round((Date.parse(v.deadline) - nu.getTime()) / 60_000)
  return { status: over < 0 ? 'te_laat' : over < 120 ? 'bijna' : 'loopt', minutenOver: over }
}

export const SUPPORT_KANALEN = [
  { key: 'telefoon', label: 'Telefoon' },
  { key: 'mail', label: 'Mail' },
  { key: 'klantapp', label: 'Klantapp' },
] as const
export type SupportKanaal = (typeof SUPPORT_KANALEN)[number]['key']

// ── Monitoring (Pro) ────────────────────────────────────────────────────────

/** Twee mislukte checks na elkaar = alarm. `checks` van nieuw naar oud. */
export function monitoringAlarm(checks: { ok: boolean }[]): boolean {
  return checks.length >= 2 && !checks[0].ok && !checks[1].ok
}

// ── Overdracht zonder Care ──────────────────────────────────────────────────

export const OVERDRACHT_STAPPEN = [
  { key: 'vercel', label: 'Vercel-project overgedragen naar het account van de klant' },
  { key: 'supabase', label: 'Supabase-project overgedragen naar de organisatie van de klant' },
  { key: 'github', label: 'GitHub-repo overgedragen naar het account van de klant' },
  { key: 'bevestigd', label: 'Klant bevestigde dat alles werkt op de eigen accounts' },
] as const
export type OverdrachtStap = (typeof OVERDRACHT_STAPPEN)[number]['key']
export type Overdracht = Partial<Record<OverdrachtStap, { op: string; door: string | null }>>
export function leesOverdracht(v: unknown): Overdracht {
  const r = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, unknown>
  const uit: Overdracht = {}
  for (const s of OVERDRACHT_STAPPEN) {
    const x = r[s.key] as { op?: unknown; door?: unknown } | undefined
    if (x && typeof x.op === 'string') uit[s.key] = { op: x.op, door: typeof x.door === 'string' ? x.door : null }
  }
  return uit
}

/** Links naar het project: enkel http(s); een Supabase-ref is 20 kleine letters. */
export function leesCareLinks(b: Record<string, unknown>): { ok: true; waarde: Record<string, string | null> } | { ok: false; fout: string } {
  const out: Record<string, string | null> = {}
  for (const k of ['vercel_url', 'github_url', 'monitor_url'] as const) {
    if (!(k in b)) continue
    const t = String(b[k] ?? '').trim()
    if (!t) { out[k] = null; continue }
    try { const u = new URL(t); if (!/^https?:$/.test(u.protocol)) throw new Error(); out[k] = u.toString().slice(0, 500) } catch { return { ok: false, fout: 'Een link moet met http of https beginnen.' } }
  }
  if ('supabase_ref' in b) {
    const ref = String(b.supabase_ref ?? '').trim().toLowerCase()
    // Ook een plakte link (https://supabase.com/dashboard/project/<ref>) of de projecturl (<ref>.supabase.co).
    const m = /([a-z]{20})/.exec(ref)
    if (ref && !m) return { ok: false, fout: 'De Supabase-ref is 20 kleine letters (te vinden in de projectlink).' }
    out.supabase_ref = m ? m[1] : null
  }
  return { ok: true, waarde: out }
}

export const isPakketKey = (v: unknown): v is CarePakketKey => v === 'basis' || v === 'plus' || v === 'pro'

/**
 * Enkel publieke https-adressen worden door de monitoring opgevraagd: geen
 * localhost, geen interne of private IP-adressen (de server vraagt de link op).
 */
export function veiligeMonitorUrl(v: string | null | undefined): boolean {
  if (!v) return false
  let u: URL
  try { u = new URL(v) } catch { return false }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return false
  const ip4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (ip4) {
    const [a, b] = [Number(ip4[1]), Number(ip4[2])]
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false
  }
  if (h.includes(':')) return false // IPv6-adressen niet
  return true
}
