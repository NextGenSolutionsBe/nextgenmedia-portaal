// Vaste redenen waarom een prospect afhaakt. Pure module.
//
// VASTE KEUZES, geen vrij veld als standaard. De hele reden dat we dit
// vastleggen is om er later op te kunnen tellen ("hoeveel procent van de
// bouwbedrijven haakt af op prijs?") — en op vrije tekst valt niet te tellen:
// "te duur", "geen budget" en "budget zit er niet in" zijn dan drie redenen.
// Bij "Anders" mag een toelichting, maar de teller blijft op "Anders" staan.

export const GEEN_INTERESSE_REDENEN = [
  'Heeft al een partner',
  'Doet marketing intern',
  'Geen budget',
  'Geen behoefte',
  'Slechte ervaring met bureaus',
  // Bewust ZONDER de belofte "later opnieuw proberen": deze fase is een
  // eindpunt. Wil de prospect echt later gebeld worden, dan is dat geen
  // afwijzing maar een terugbelafspraak — daar is de terugbelknop voor.
  'Niet nu — geen tijd',
  'Anders',
] as const

export type GeenInteresseReden = (typeof GEEN_INTERESSE_REDENEN)[number]

export const isGeenInteresseReden = (v: unknown): v is GeenInteresseReden =>
  typeof v === 'string' && (GEEN_INTERESSE_REDENEN as readonly string[]).includes(v)

/**
 * De reden zoals hij wordt opgeslagen in lost_reason: de vaste reden, bij
 * "Anders" met de toelichting erachter zodat er niets verloren gaat, maar
 * altijd met de vaste reden vooraan zodat tellen blijft werken.
 */
export function bouwReden(reden: string, toelichting?: string): string | null {
  if (!isGeenInteresseReden(reden)) return null
  const extra = (toelichting ?? '').trim()
  return reden === 'Anders' && extra ? `Anders — ${extra.slice(0, 300)}` : reden
}

/** De vaste reden uit een opgeslagen lost_reason halen (voor de tellingen). */
export function redenGroep(lostReason: string | null | undefined): string | null {
  const s = (lostReason ?? '').trim()
  if (!s) return null
  for (const r of GEEN_INTERESSE_REDENEN) {
    if (s === r || s.startsWith(`${r} —`)) return r
  }
  // Oude, vrije waarden groeperen we onder hun eigen tekst; die verdwijnen
  // vanzelf naarmate de vaste keuzes gebruikt worden.
  return s.slice(0, 60)
}
