import { leesGetal } from '../getal'
// Personeel — invoer uit verzoeken netjes maken. Puur.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)
export const uuidOf = (v: unknown): string | null => (isUuid(v) ? v : null)
export const tekst = (v: unknown, max = 500): string | null => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null }
export const getal = (v: unknown): number | null => leesGetal(v)
export const dagOf = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
export const uurOf = (v: unknown): string | null => { const t = String(v ?? '').slice(0, 5); return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null }
export const isoOf = (v: unknown): string | null => { if (typeof v !== 'string' || !v) return null; const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toISOString() : null }

export type Link = { naam: string; url?: string | null; pad?: string | null }
/** Links en bestanden bij een verslag of briefing: enkel http(s)-links of eigen opslagpaden. */
export function linksOf(v: unknown, eigenPrefix?: string): Link[] {
  if (!Array.isArray(v)) return []
  const uit: Link[] = []
  for (const r of v.slice(0, 30)) {
    const o = (r ?? {}) as Record<string, unknown>
    const url = typeof o.url === 'string' && /^https?:\/\//i.test(o.url.trim()) ? o.url.trim().slice(0, 1000) : null
    const pad = typeof o.pad === 'string' && eigenPrefix && o.pad.startsWith(eigenPrefix) && !o.pad.includes('..') ? o.pad.slice(0, 500) : null
    if (!url && !pad) continue
    uit.push({ naam: tekst(o.naam, 200) ?? (url ?? pad ?? 'Link'), url, pad })
  }
  return uit
}

/** Het werkverslag bij het uitklokken. */
export type Verslag = { project?: string | null; taak?: string | null; content?: string | null; goed?: string | null; mis?: string | null; todo?: string | null; blokkades?: string | null }
export function verslagOf(v: unknown): Verslag {
  const o = (v ?? {}) as Record<string, unknown>
  return {
    project: tekst(o.project, 200), taak: tekst(o.taak, 500), content: tekst(o.content, 2000),
    goed: tekst(o.goed, 2000), mis: tekst(o.mis, 2000), todo: tekst(o.todo, 2000), blokkades: tekst(o.blokkades, 2000),
  }
}

/** Welke velden zijn veranderd (voor de auditlog). */
export function verschillen(oud: Record<string, unknown>, nieuw: Record<string, unknown>): { oud: Record<string, unknown>; nieuw: Record<string, unknown> } | null {
  const o: Record<string, unknown> = {}, n: Record<string, unknown> = {}
  for (const k of Object.keys(nieuw)) {
    if (JSON.stringify(oud[k] ?? null) !== JSON.stringify(nieuw[k] ?? null)) { o[k] = oud[k] ?? null; n[k] = nieuw[k] ?? null }
  }
  return Object.keys(n).length ? { oud: o, nieuw: n } : null
}

/** Veilige bestandsnaam voor de opslag. */
export const veiligeBestandsnaam = (naam: string) => (naam.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').slice(-120) || 'bestand')

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
export const MAX_FOTO_BYTES = 5 * 1024 * 1024
