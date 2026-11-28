// Dienstencategorieën voor de omzetrapportage — één bron, gebaseerd op de
// bestaande diensten van de app (SERVICE_LABELS). Geen dubbele lijst: enkel
// twee technische categorieën erbij.

export const DIENST_LABELS: Record<string, string> = {
  'social-media': 'Social Media',
  'webdesign': 'Website',
  'marketing-consultancy': 'Marketing Consultancy',
  'grafisch-ontwerp': 'Grafisch Ontwerp',
  'ads': 'Google Advertising',
  'foto-video': 'Foto & Videografie',
}
/** Kilometers en andere doorgerekende kosten: apart, nooit bij een kerndienst. */
export const DOORGEREKEND = 'doorgerekend'
export const NIET_GECATEGORISEERD = 'niet_gecategoriseerd'
export const isDienst = (v: unknown): v is string => typeof v === 'string' && v in DIENST_LABELS
export function dienstLabel(slug: string): string {
  if (slug === DOORGEREKEND) return 'Doorgerekende kosten (km, …)'
  if (slug === NIET_GECATEGORISEERD) return 'Niet gecategoriseerd'
  return DIENST_LABELS[slug] ?? slug
}
