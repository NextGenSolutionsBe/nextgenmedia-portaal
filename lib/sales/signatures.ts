/**
 * E-mailhandtekeningen van het team. Pure module — ook bruikbaar in de UI.
 *
 * De bestanden staan in /public/handtekeningen. Wie een agenda koppelt onder
 * zijn voornaam krijgt automatisch de juiste handtekening; expliciet instellen
 * kan ook en gaat altijd voor.
 */

export type Signature = { key: string; label: string; url: string; email: string; phone: string }

export const SIGNATURES: Signature[] = [
  { key: 'bram',   label: 'Bram Reinquin',   url: '/handtekeningen/bram.png',   email: 'bram@nextgenmedia.be',   phone: '+32 493 47 42 63' },
  { key: 'marco',  label: 'Marco Castermans', url: '/handtekeningen/marco.png', email: 'marco@nextgenmedia.be',  phone: '+32 468 49 33 76' },
  { key: 'chiara', label: 'Chiara Walmagh',  url: '/handtekeningen/chiara.png', email: 'chiara@nextgenmedia.be', phone: '+32 493 47 42 63' },
]

/**
 * Handtekening zoeken bij de naam van een agenda ("Bram", "agenda Marco", ...).
 * Bewust op voornaam: zo hoeft niemand de naam exact te typen.
 */
export function matchSignature(name: string | null | undefined): Signature | null {
  const n = (name ?? '').toLowerCase()
  if (!n.trim()) return null
  return SIGNATURES.find((s) => n.includes(s.key)) ?? null
}
