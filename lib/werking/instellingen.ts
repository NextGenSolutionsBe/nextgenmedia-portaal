/**
 * Instellingen van de nieuwe werking (28 nov 2026, docs/nieuwe-werking-plan.md).
 * Eén sleutel in app_settings: `werking`. Elke waarde heeft een beginwaarde en
 * wordt hier nagekeken; ongeldig of leeg = de beginwaarde. Nooit een bedrag,
 * termijn of drempel vast in de code: altijd via `leesWerking`.
 * Pure regels (client-safe), getest in tests/werking-instellingen.test.ts.
 */

// ── Domeinen (fase 1) ───────────────────────────────────────────────────────

export const DOMEINEN = [
  { key: 'solutions', label: 'Solutions' },
  { key: 'media', label: 'Media' },
  { key: 'financien_legal', label: 'Financiën & legal' },
  { key: 'interne_werking', label: 'Interne werking' },
] as const
export type Domein = (typeof DOMEINEN)[number]['key']
export const isDomein = (v: unknown): v is Domein => DOMEINEN.some((d) => d.key === v)
export const domeinLabel = (k: string | null | undefined) => DOMEINEN.find((d) => d.key === k)?.label ?? 'Meerdere domeinen'

// ── Planning Media (fase 1) ─────────────────────────────────────────────────

export const WERK_SOORTEN = [
  { key: 'management', label: 'Management', uitleg: 'planning, strategie, kalender, ad-hoc, meetings' },
  { key: 'uitvoering', label: 'Uitvoering', uitleg: 'posts, montage, visuals, folders, branding' },
  { key: 'shoot', label: 'Shoots', uitleg: 'de shoot en de shootbriefing' },
] as const
export type WerkSoort = (typeof WERK_SOORTEN)[number]['key']
export const isWerkSoort = (v: unknown): v is WerkSoort => WERK_SOORTEN.some((s) => s.key === v)

// ── Alle groepen ────────────────────────────────────────────────────────────

export type WerkingInstellingen = {
  /** Eigenaar per domein (voornaam). Een beslissing binnen één domein neemt die persoon. */
  domeinen: Record<Domein, string>
  /** Het vaste moment van het weekoverleg (1 = maandag … 5 = vrijdag). `reeks_id` = het vaste blok in de agenda, als het er staat. */
  weekoverleg: { dag: number; van: string; duur_min: number; reeks_id: string | null }
  /** Wie standaard welk soort werk doet in Planning Media (voornaam). */
  planning: Record<WerkSoort, string>
  /** Verkoop bij Solutions (fase 2): auditprijs, opvolgritme, presentatie. */
  verkoop: {
    audit_basis: number; audit_per_proces: number; max_processen: number
    opvolg_dagen: number; presentatie_max_dagen: number; presentatie_min_per_proces: number
    /** Wie de auditdag doet en wie het rapport schrijft (voornaam). */
    auditdag_door: string; rapport_door: string
  }
}

export const STANDAARD_WERKING: WerkingInstellingen = {
  domeinen: { solutions: 'Marco', media: 'Chiara', financien_legal: 'Bram', interne_werking: 'Marco' },
  weekoverleg: { dag: 5, van: '16:00', duur_min: 30, reeks_id: null },
  planning: { management: 'Chiara', uitvoering: 'Yasmine', shoot: 'Bram' },
  verkoop: { audit_basis: 450, audit_per_proces: 295, max_processen: 5, opvolg_dagen: 7, presentatie_max_dagen: 7, presentatie_min_per_proces: 10, auditdag_door: 'Marco', rapport_door: 'Jonathan' },
}

// ── Nakijken ────────────────────────────────────────────────────────────────

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
/** Een voornaam of korte naam: hoogstens 40 tekens, enkel letters, spaties, streepjes. */
export function naamOf(v: unknown, std: string): string {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 40) : ''
  return t && /^[\p{L}][\p{L} .'-]*$/u.test(t) ? t : std
}
/** Een geheel getal binnen grenzen, anders de beginwaarde. */
export function getalOf(v: unknown, std: number, min: number, max: number): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? n : std
}
export function uurOf(v: unknown, std: string): string {
  const t = typeof v === 'string' ? v.trim() : ''
  const m = /^(\d{1,2})[:.u](\d{2})$/.exec(t)
  if (!m) return std
  const u = Number(m[1]), mi = Number(m[2])
  return u <= 23 && mi <= 59 ? `${String(u).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : std
}
const UUID = /^[0-9a-f-]{36}$/i

export function leesWerking(ruw: unknown): WerkingInstellingen {
  const r = obj(ruw)
  const S = STANDAARD_WERKING
  const dom = obj(r.domeinen), ov = obj(r.weekoverleg), pl = obj(r.planning), vk = obj(r.verkoop)
  const V = S.verkoop
  return {
    domeinen: Object.fromEntries(DOMEINEN.map((d) => [d.key, naamOf(dom[d.key], S.domeinen[d.key])])) as Record<Domein, string>,
    weekoverleg: {
      dag: getalOf(ov.dag, S.weekoverleg.dag, 1, 5),
      van: uurOf(ov.van, S.weekoverleg.van),
      duur_min: getalOf(ov.duur_min, S.weekoverleg.duur_min, 15, 180),
      reeks_id: typeof ov.reeks_id === 'string' && UUID.test(ov.reeks_id) ? ov.reeks_id : null,
    },
    planning: Object.fromEntries(WERK_SOORTEN.map((s) => [s.key, naamOf(pl[s.key], S.planning[s.key])])) as Record<WerkSoort, string>,
    verkoop: {
      audit_basis: getalOf(vk.audit_basis, V.audit_basis, 0, 100_000),
      audit_per_proces: getalOf(vk.audit_per_proces, V.audit_per_proces, 0, 100_000),
      max_processen: Math.round(getalOf(vk.max_processen, V.max_processen, 1, 20)),
      opvolg_dagen: Math.round(getalOf(vk.opvolg_dagen, V.opvolg_dagen, 1, 60)),
      presentatie_max_dagen: Math.round(getalOf(vk.presentatie_max_dagen, V.presentatie_max_dagen, 1, 60)),
      presentatie_min_per_proces: Math.round(getalOf(vk.presentatie_min_per_proces, V.presentatie_min_per_proces, 1, 120)),
      auditdag_door: naamOf(vk.auditdag_door, V.auditdag_door),
      rapport_door: naamOf(vk.rapport_door, V.rapport_door),
    },
  }
}

/** Auditprijs bij Solutions: basis + prijs per proces (instellingen, nooit vast in de code). */
export function auditPrijs(processen: number, v: Pick<WerkingInstellingen['verkoop'], 'audit_basis' | 'audit_per_proces'>): number {
  return Math.round((v.audit_basis + v.audit_per_proces * processen) * 100) / 100
}

/** Wie is eigenaar van dit domein? Leeg of "meerdere" = niemand (stemming). */
export function eigenaarVanDomein(w: Pick<WerkingInstellingen, 'domeinen'>, domein: string | null | undefined): string | null {
  return isDomein(domein) ? w.domeinen[domein] : null
}

/** Is deze persoon (voornaam of volledige naam) de eigenaar? Hoofdletters en achternaam tellen niet. */
export function isEigenaar(eigenaar: string | null, naam: string | null | undefined): boolean {
  if (!eigenaar || !naam) return false
  const v = (s: string) => s.trim().split(/\s+/)[0].toLowerCase()
  return v(eigenaar) === v(naam)
}

/** Einde van het weekoverleg ("16:00" + 30 = "16:30"). */
export function eindUur(van: string, duur: number): string {
  const [u, m] = van.split(':').map(Number)
  const t = Math.min(23 * 60 + 59, u * 60 + m + duur)
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/** Loopt het weekoverleg nu? `dag` 1–7 (maandag = 1), `uur` "HH:MM", beide in Brussel. */
export function overlegLoopt(w: Pick<WerkingInstellingen, 'weekoverleg'>, dag: number, uur: string): boolean {
  if (!w.weekoverleg.reeks_id || dag !== w.weekoverleg.dag) return false
  return uur >= w.weekoverleg.van && uur < eindUur(w.weekoverleg.van, w.weekoverleg.duur_min)
}
