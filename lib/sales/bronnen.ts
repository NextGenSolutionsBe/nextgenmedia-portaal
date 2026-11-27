/**
 * Eén bronnenlijst voor de hele app (verbeterplan fase 6, punt 76): Projecten,
 * NextGenSolutions en de verkoopcijfers. Oude waarden (inbound, doorverwijzing,
 * andere) blijven geldig en leesbaar; er wordt niets omgezet in de databank.
 * Getest in tests/sales-fase6.test.ts.
 */
export const BRONNEN_LIJST = [
  { key: 'outbound', label: 'Outbound', uitleg: 'Wij gingen er zelf op af.' },
  { key: 'inbound_website', label: 'Inbound website', uitleg: 'Via de website, een formulier of een mail.' },
  { key: 'doorverwezen', label: 'Doorverwezen', uitleg: 'Iemand stuurde de klant naar ons.' },
  { key: 'netwerk', label: 'Netwerk', uitleg: 'Uit ons eigen netwerk.' },
  { key: 'lezing', label: 'Lezing', uitleg: 'Na een lezing of workshop van ons.' },
  { key: 'event', label: 'Event', uitleg: 'Op een beurs of event.' },
  { key: 'bestaande_klant', label: 'Bestaande klant', uitleg: 'Een klant die er al was, vraagt iets nieuws.' },
] as const

export type BronKey = (typeof BRONNEN_LIJST)[number]['key']

/** Waarden van vroeger: blijven geldig, worden niet omgezet. */
const OUDE_BRONNEN: Record<string, string> = { inbound: 'Inbound', doorverwijzing: 'Doorverwezen', andere: 'Andere' }

export const isBronKey = (v: unknown): v is string => typeof v === 'string' && (BRONNEN_LIJST.some((b) => b.key === v) || v in OUDE_BRONNEN)
export const bronNaam = (v: string | null | undefined): string => (v ? BRONNEN_LIJST.find((b) => b.key === v)?.label ?? OUDE_BRONNEN[v] ?? v : 'Onbekend')
export const isOudeBron = (v: string | null | undefined) => !!v && v in OUDE_BRONNEN

/** Kwam de klant zelf (inbound) of gingen wij erop af (outbound)? Onzeker = null (nooit gokken). */
export function bronRichting(v: string | null | undefined): 'inbound' | 'outbound' | null {
  if (v === 'outbound') return 'outbound'
  if (v === 'inbound' || v === 'inbound_website') return 'inbound'
  return null
}

// ── Redenen van verlies (punt 77), zelfde lijst voor Media en Solutions ─────

export const VERLIES_REDENEN = ['Te duur', 'Geen budget of timing', 'Koos een andere partij', 'Geen reactie meer', 'Niet de juiste fit']

/** De reden netjes groeperen: een vaste reden als ze erin voorkomt, anders "Andere". */
export function verliesGroep(reden: string | null | undefined): string {
  const r = String(reden ?? '').trim().toLowerCase()
  if (!r) return 'Geen reden'
  return VERLIES_REDENEN.find((v) => r.startsWith(v.toLowerCase())) ?? 'Andere'
}
