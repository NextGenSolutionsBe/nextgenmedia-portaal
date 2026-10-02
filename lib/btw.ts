// BTW-nummervalidatie (client- én serverveilig, geen imports).
// Belgisch standaardformaat: BE + 10 cijfers, eerste cijfer 0 of 1,
// met mod-97 controlegetal (laatste 2 cijfers = 97 - (eerste 8 mod 97)).

/** Normaliseert naar BE0123456789 (uppercase, zonder spaties/punten/streepjes). */
export function normalizeBtw(input: string | null | undefined): string {
  if (!input) return ''
  let v = input.toUpperCase().replace(/[^0-9A-Z]/g, '')
  // Los ingegeven cijfers zonder landcode → veronderstel BE.
  if (/^\d{9,10}$/.test(v)) v = 'BE' + v
  // BE + 9 cijfers → voorloopnul toevoegen (oud ondernemingsnummer).
  if (/^BE\d{9}$/.test(v)) v = 'BE0' + v.slice(2)
  return v
}

/** Geldig Belgisch BTW-nummer? (BE + 10 cijfers + mod-97 check) */
export function isValidBelgianBtw(input: string | null | undefined): boolean {
  const v = normalizeBtw(input)
  if (!/^BE[01]\d{9}$/.test(v)) return false
  const digits = v.slice(2) // 10 cijfers
  const base = parseInt(digits.slice(0, 8), 10)
  const check = parseInt(digits.slice(8), 10)
  return check === 97 - (base % 97)
}

/**
 * Valideert (enkel voor BE-nummers). Lege waarde is toegestaan (optioneel veld).
 * Returnt {ok, value, error}. `value` is genormaliseerd.
 */
export function validateBtw(input: string | null | undefined): { ok: boolean; value: string; error?: string } {
  const v = normalizeBtw(input)
  if (!v) return { ok: true, value: '' }
  if (v.startsWith('BE')) {
    return isValidBelgianBtw(v)
      ? { ok: true, value: v }
      : { ok: false, value: v, error: 'Ongeldig Belgisch BTW-nummer (verwacht BE + 10 cijfers, bv. BE0123456789)' }
  }
  // Buitenlandse nummers: licht valideren (landcode + minstens 2 tekens).
  return /^[A-Z]{2}[0-9A-Z]{2,}$/.test(v)
    ? { ok: true, value: v }
    : { ok: false, value: v, error: 'Ongeldig BTW-nummer' }
}
