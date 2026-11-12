// Vorige/volgende navigatie tussen contracten — PUUR + sessieopslag (client-safe).
// Het overzicht bewaart de volgorde van de zichtbare (gefilterde, gesorteerde)
// contracten in sessionStorage; de detailpagina navigeert daar doorheen.

export const NAVIGATIE_SLEUTEL = 'ngm.contracten.navigatie'
export const CONTEXT_SLEUTEL = 'ngm.contracten.context'
/** Een lijst ouder dan dit geldt niet meer als "het huidige overzicht". */
export const MAX_LEEFTIJD_MS = 6 * 60 * 60 * 1000

export type Navigatie = { ids: string[]; opgeslagenOp: number; omschrijving: string }
export type Context = { query: string; scrollY: number }

export type Buren = { vorige: string | null; volgende: string | null; index: number; totaal: number }

/** Positie van een contract in de lijst en zijn buren; index is 1-gebaseerd, 0 = niet in de lijst. */
export function bepaalBuren(ids: string[], huidig: string): Buren {
  const i = ids.indexOf(huidig)
  if (i < 0) return { vorige: null, volgende: null, index: 0, totaal: ids.length }
  return { vorige: i > 0 ? ids[i - 1] : null, volgende: i < ids.length - 1 ? ids[i + 1] : null, index: i + 1, totaal: ids.length }
}

/** Is dit element een tekstinvoer waar pijltjestoetsen bij het typen horen? */
export function isTekstInvoer(el: { tagName?: string; isContentEditable?: boolean; getAttribute?: (n: string) => string | null } | null | undefined): boolean {
  if (!el) return false
  const tag = (el.tagName ?? '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  const rol = el.getAttribute?.('role') ?? ''
  return rol === 'textbox' || rol === 'combobox' || rol === 'listbox' || rol === 'menu'
}

/** Horizontale veeg: 'links' (→ volgende), 'rechts' (→ vorige) of null. */
export function swipeRichting(dx: number, dy: number, drempel = 70): 'links' | 'rechts' | null {
  if (Math.abs(dx) < drempel) return null
  if (Math.abs(dy) > Math.abs(dx) * 0.6) return null    // te schuin: scrollen, geen veeg
  return dx < 0 ? 'links' : 'rechts'
}

const kanOpslaan = () => typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'

export function bewaarNavigatie(ids: string[], omschrijving: string): void {
  if (!kanOpslaan()) return
  try { sessionStorage.setItem(NAVIGATIE_SLEUTEL, JSON.stringify({ ids, opgeslagenOp: Date.now(), omschrijving } satisfies Navigatie)) } catch { /* privémodus */ }
}

export function leesNavigatie(nu = Date.now()): Navigatie | null {
  if (!kanOpslaan()) return null
  try {
    const ruw = sessionStorage.getItem(NAVIGATIE_SLEUTEL)
    if (!ruw) return null
    const n = JSON.parse(ruw) as Navigatie
    if (!Array.isArray(n.ids) || typeof n.opgeslagenOp !== 'number') return null
    if (nu - n.opgeslagenOp > MAX_LEEFTIJD_MS) return null
    return { ids: n.ids.filter((x): x is string => typeof x === 'string'), opgeslagenOp: n.opgeslagenOp, omschrijving: String(n.omschrijving ?? '') }
  } catch { return null }
}

export function bewaarContext(c: Partial<Context>): void {
  if (!kanOpslaan()) return
  try {
    const huidig = leesContext() ?? { query: '', scrollY: 0 }
    sessionStorage.setItem(CONTEXT_SLEUTEL, JSON.stringify({ ...huidig, ...c }))
  } catch { /* */ }
}

export function leesContext(): Context | null {
  if (!kanOpslaan()) return null
  try {
    const ruw = sessionStorage.getItem(CONTEXT_SLEUTEL)
    if (!ruw) return null
    const c = JSON.parse(ruw) as Partial<Context>
    return { query: typeof c.query === 'string' ? c.query : '', scrollY: typeof c.scrollY === 'number' ? c.scrollY : 0 }
  } catch { return null }
}
