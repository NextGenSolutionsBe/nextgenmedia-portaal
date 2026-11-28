/**
 * Huisstijl NextGenMedia (brandbook v2.0, november 2026). Enkel voor wat in naam
 * van NextGenMedia vertrekt: mails, shootplan en shootdocument, offertes van
 * NextGenMedia, certificaten bij NextGenMedia-contracten en de publieke pagina's
 * daarvan. De app zelf blijft in de huisstijl van NextGen Agency.
 *
 * Kleuren: woud draagt (50%), zonnegeel licht op (30%), kalk geeft rust (20%).
 * Zonnegeel nooit als tekst op kalk of wit (te weinig contrast); wel op woud.
 * Letters: Bricolage Grotesque (titels ExtraBold, tussentitels Bold), DM Sans
 * (tekst Regular, nadruk SemiBold), DM Mono (labels, data, in kapitalen).
 * Logo's: public/merk/ngm/ (uit het brandbook gehaald, nooit zelf nagetekend).
 * Pure module: bruikbaar op de server en in de browser.
 */
export const NGM = {
  woud: '#0C2B1E',
  zonnegeel: '#FDDB57',
  kalk: '#FAF7EE',
  /** Secundaire tekst op woud. */
  mos: '#A9BFA9',
  /** Secundaire tekst op kalk of wit. */
  varen: '#4F6B5A',
  /** Fijne lijnen en randen op kalk of wit. */
  lijn: '#E6E0D0',
  baseline: 'From concept to impact.',
  website: 'nextgenmedia.be',
  naam: 'NextGenMedia',
} as const

const BASIS = 'https://app.nextgenmedia.be'

/** Logo's (transparant). Woud = op kalk of wit, zonnegeel of kalk = op woud. */
export const NGM_LOGO = {
  woud: '/merk/ngm/logo-woud.png',
  zonnegeel: '/merk/ngm/logo-zonnegeel.png',
  kalk: '/merk/ngm/logo-kalk.png',
  beeldmerkWoud: '/merk/ngm/beeldmerk-woud.png',
  beeldmerkZonnegeel: '/merk/ngm/beeldmerk-zonnegeel.png',
  /** Voor mails: absolute link (440 px breed, getoond op 200 px). Zonnegeel op de woudkleurige kop. */
  mail: `${BASIS}/merk/ngm/logo-mail.png`,
  /** Hoogte/breedte van het logo. */
  verhouding: 340 / 2441,
} as const
