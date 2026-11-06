import { timingSafeEqual } from 'node:crypto'

/**
 * Toegangscontrole voor de MCP-route over HTTP.
 *
 * De sleutel zit in het pad (`/api/mcp/<sleutel>`), want een connector heeft
 * geen ingelogde gebruiker. Dat is een gedeeld geheim, geen volwaardige
 * authenticatie: wie het adres heeft, heeft toegang. Vandaar de eisen hieronder.
 *
 * Apart bestand zodat dit te testen is. Een routebestand in Next mag enkel
 * handlers exporteren, dus daar kan het niet staan.
 */

/** Minimumlengte. Korter is geen geheim maar een uitnodiging om te raden; dan
 *  weigeren we liever alles dan schijnveiligheid te bieden. */
export const MIN_LENGTE = 32

export function sleutelKlopt(gegeven: unknown, echt: unknown): boolean {
  const a = typeof gegeven === 'string' ? gegeven : ''
  const b = typeof echt === 'string' ? echt : ''

  // Geen sleutel ingesteld, of een te korte: alles dicht.
  if (b.length < MIN_LENGTE) return false

  // LET OP: vergelijk BYTE-lengte, niet string-lengte. "é" is één teken maar
  // twee bytes, dus twee even lange strings kunnen verschillend lange buffers
  // geven — en dan gooit timingSafeEqual een fout. Dat leverde een 500 op waar
  // een 404 hoort, en die 500 verraadt dat de lengte klopte.
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false

  // Tijdconstant vergelijken: anders kan je uit de antwoordtijd afleiden hoeveel
  // tekens er klopten en de sleutel stap voor stap raden.
  return timingSafeEqual(ba, bb)
}
