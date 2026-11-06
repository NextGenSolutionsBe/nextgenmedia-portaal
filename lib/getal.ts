// Getallen uit invoer lezen zoals een Belgische gebruiker ze typt. Pure module
// (client én server). Eén plek, zodat "12,50", "12.50", "1.250,50" en
// "€ 1 250,50" overal hetzelfde betekenen.

/**
 * "12,5" → 12.5 · "12.5" → 12.5 · "1.250,50" → 1250.5 · "1,250.50" → 1250.5 ·
 * "1.250" → 1250 (punt + precies drie cijfers = duizendtal, zoals in België) ·
 * "€ 99" → 99 · "" / onzin → null.
 */
export function leesGetal(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v).trim().replace(/[\s €]/g, '').replace(/^\+/, '')
  if (!s || s === '-') return null
  const komma = s.lastIndexOf(','), punt = s.lastIndexOf('.')
  if (komma >= 0 && punt >= 0) {
    // Beide aanwezig: het laatste teken is het decimaalteken, het andere scheidt duizendtallen.
    s = komma > punt ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (komma >= 0) {
    s = (s.match(/,/g) ?? []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.')
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '')
  }
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Getal terug naar invoertekst in Belgische notatie: 12.5 → "12,5", 1250 → "1250". */
export function getalAlsInvoer(n: number | null | undefined, maxDecimalen = 4): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return ''
  return String(Number(n.toFixed(maxDecimalen))).replace('.', ',')
}

