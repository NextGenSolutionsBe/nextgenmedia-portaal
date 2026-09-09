// Gedeelde rendermaten zodat de drag&drop-editor en de uiteindelijke pdf-lib
// stamping EXACT dezelfde positionering gebruiken (geen benaderingen meer).
//
// Coördinaatconventie (ongewijzigd t.o.v. bestaande data):
//   x, y = percentage van de paginabreedte/-hoogte vanaf LINKSBOVEN (0-100)
//   width, height = punten (PDF points)
// y markeert de BOVENKANT van de tekst. De editor toont de tekst met haar top op
// y%; de stamping zet de baseline op (top - ascent) zodat beide overeenkomen.

export const FIELD_FONT_PT = 11
// Helvetica cap/ascent ≈ 0.72-0.8 van de fontgrootte; 0.8 geeft de beste match
// tussen de in de browser gerenderde teksttop en de pdf-lib baseline.
export const FIELD_ASCENT_RATIO = 0.8

/** PDF-baseline (vanaf onderkant) voor tekst waarvan de top op yPct moet staan. */
export function baselineFromTopPct(yPct: number, pageHeightPt: number, fontPt = FIELD_FONT_PT): number {
  const topPt = pageHeightPt - (yPct / 100) * pageHeightPt
  return topPt - fontPt * FIELD_ASCENT_RATIO
}
