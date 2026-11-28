/**
 * Aankopen: een optionele link naar de bestelpagina (bv. de landingspagina
 * waar je het bestelt). Enkel http(s); zonder schema zetten we er https:// voor.
 * Pure module, getest in tests/aankoop-link.test.ts.
 */
export function leesBestelLink(v: unknown): { ok: true; link: string | null } | { ok: false; fout: string } {
  const s = String(v ?? '').trim()
  if (!s) return { ok: true, link: null }
  if (s.length > 500) return { ok: false, fout: 'De link is te lang.' }
  const metSchema = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s.replace(/^\/+/, '')}`
  let u: URL
  try { u = new URL(metSchema) } catch { return { ok: false, fout: 'Dat is geen geldige link.' } }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, fout: 'Enkel een link die met https:// begint.' }
  if (!u.hostname.includes('.') || /\s/.test(s)) return { ok: false, fout: 'Dat is geen geldige link.' }
  return { ok: true, link: u.toString() }
}

/** Korte weergave: het domein zonder www. */
export const linkDomein = (link: string): string => {
  try { return new URL(link).hostname.replace(/^www\./, '') } catch { return link }
}
