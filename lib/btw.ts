// BTW-nummervalidatie (client- én serverveilig, geen imports).
// Belgisch standaardformaat: BE + 10 cijfers, eerste cijfer 0 of 1,
// met mod-97 controlegetal (laatste 2 cijfers = 97 - (eerste 8 mod 97)).

/** Landcodes van het Europese btw-register (VIES). Griekenland = EL, Noord-Ierland = XI. */
const EU = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI'])

/** Woorden die mensen voor het nummer zetten of mee kopiëren ("BTW:", "Ondernemingsnr.", "VAT no"). */
const LABELS = /^(BTWNUMMER|BTWNR|BTWNO|BTW|VATNUMBER|VATNR|VATNO|VATID|VAT|TVA|ONDERNEMINGSNUMMER|ONDERNEMINGSNR|ONDNR|KBONUMMER|KBONR|KBO|USTIDNR|USTID|NUMMER|NUMBER|NR|NO)/

/**
 * Normaliseert naar BE0123456789: hoofdletters, zonder spaties, punten,
 * streepjes of schuine strepen, zonder "BTW"/"VAT"/"Ondernemingsnr." ervoor.
 * Losse cijfers krijgen BE; een oud nummer van 9 cijfers krijgt een 0 vooraan.
 * Een letter O tussen de cijfers van een Belgisch nummer wordt een 0.
 */
export function normalizeBtw(input: string | null | undefined): string {
  if (!input) return ''
  let v = String(input).toUpperCase().replace(/[^0-9A-Z]/g, '')
  for (let i = 0; i < 4; i++) { const k = v.replace(LABELS, ''); if (k === v) break; v = k }
  // BE ergens in een langere kopie ("BTWBE1016637895", "BE1016637895BTW").
  const be = v.match(/BE([0-9O]{9,10})(?![0-9])/)
  if (be) v = 'BE' + be[1]
  if (/^BE[0-9O]{9,10}$/.test(v)) v = 'BE' + v.slice(2).replace(/O/g, '0')
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

/** Kan het Europese btw-register (VIES) dit nummer opzoeken? Enkel EU-landcodes. */
export function inEuRegister(genormaliseerd: string): boolean {
  return EU.has(genormaliseerd.slice(0, 2))
}

/**
 * Is het nummer af (niet meer aan het typen)? Een Belgisch nummer telt pas
 * als er 10 cijfers staan, zodat 9 getypte cijfers niet als oud nummer
 * opgezocht worden terwijl je nog bezig bent.
 */
export function btwIsVolledig(input: string | null | undefined): boolean {
  const v = normalizeBtw(input)
  if (!v) return false
  if (v.startsWith('BE')) {
    const cijfers = String(input).replace(/\D/g, '')
    return cijfers.length >= 10 && isValidBelgianBtw(v)
  }
  return validateBtw(v).ok && inEuRegister(v) && v.length >= 8
}

/**
 * Valideert (enkel streng voor BE-nummers). Lege waarde is toegestaan (optioneel veld).
 * Returnt {ok, value, error}. `value` is genormaliseerd.
 */
export function validateBtw(input: string | null | undefined): { ok: boolean; value: string; error?: string } {
  const v = normalizeBtw(input)
  if (!v) return { ok: true, value: '' }
  if (v.startsWith('BE')) {
    if (isValidBelgianBtw(v)) return { ok: true, value: v }
    const cijfers = v.slice(2).replace(/\D/g, '')
    if (!/^BE\d+$/.test(v) || cijfers.length !== 10) {
      return { ok: false, value: v, error: `Een Belgisch btw-nummer is BE + 10 cijfers (bv. BE0123456789)${/^BE\d+$/.test(v) ? `, hier staan er ${cijfers.length}` : ''}.` }
    }
    if (!/^BE[01]/.test(v)) return { ok: false, value: v, error: 'Een Belgisch btw-nummer begint met BE0 of BE1.' }
    return { ok: false, value: v, error: 'Dit btw-nummer bestaat niet: het controlegetal klopt niet. Kijk de cijfers even na.' }
  }
  // Buitenlandse nummers: licht valideren (landcode + minstens 2 tekens).
  if (/^[A-Z]{2}[0-9A-Z]{2,}$/.test(v)) return { ok: true, value: v }
  return { ok: false, value: v, error: 'Dit lijkt geen btw-nummer. Een Belgisch nummer is BE + 10 cijfers, bv. BE0123456789.' }
}
