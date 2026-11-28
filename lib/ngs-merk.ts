/**
 * Huisstijl NextGenSolutions (brandkit 2026, brandbook v1.0). Enkel voor wat in naam
 * van NextGenSolutions vertrekt: mails, offertes en contracten van NextGenSolutions
 * en de publieke pagina's daarvan. De app zelf blijft in de huisstijl van NextGen Agency.
 *
 * Kleuren: kalk en wit (60%), inkt (25%), blauw enkel waar je iets kunt doen (10%):
 * knoppen, links en de verbinding in het logo. Signaalblauw enkel op inkt of nacht.
 * Groen enkel voor "klopt", "goedgekeurd", "actief"; rood en oranje zitten niet in het merk.
 * Letters: Montserrat (koppen: SemiBold 600 grote titels, Bold 700 tussentitels), Inter
 * (tekst, Medium/SemiBold voor knoppen), Jersey 15 (labels: kapitalen, +8%, één regel).
 * Logo's: public/merk/ngs/ (uit de brandkit, nooit zelf natekenen of natypen).
 * Pure module: bruikbaar op de server en in de browser.
 */
export const NGS = {
  kalk: '#F4F3EF',
  inkt: '#0B0B0C',
  blauw: '#1E40AF',
  blauwHover: '#172F86',
  nacht: '#18181A',
  signaal: '#7B97F7',
  ijs: '#E8EDFB',
  tekst: '#5E5E5E',
  tekstSterk: '#3A3A3A',
  steen: '#6F6E6A',
  grijsLicht: '#A3A3A3',
  lijn: '#DEDDD8',
  akkoord: '#1E7341',
  baseline: 'Geef je bedrijf een oneerlijk voordeel.',
  tagline: 'AI-automatisatie en software op maat',
  website: 'nextgensolutions.be',
  naam: 'NextGenSolutions',
} as const

const BASIS = 'https://app.nextgenmedia.be'

/** Logo's (transparant). Kleur = op kalk of wit, wit = op inkt. */
export const NGS_LOGO = {
  kleur: '/merk/ngs/logo-kleur.png',
  wit: '/merk/ngs/logo-wit.png',
  beeldmerk: '/merk/ngs/beeldmerk-kleur.png',
  beeldmerkWit: '/merk/ngs/beeldmerk-wit.png',
  /** Voor mails: absolute link (440 px breed, getoond op 180 px), op wit. */
  mail: `${BASIS}/merk/ngs/logo-mail.png`,
  /** Hoogte/breedte van het horizontale logo. */
  verhouding: 268 / 1200,
} as const
