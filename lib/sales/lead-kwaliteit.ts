// Kwaliteit van outbound leads — pure module (geen server-imports), zodat
// hetzelfde in de opschoning, de import, de verificatieknop en de tests draait.
//
// Uitgangspunt: NOOIT data verzinnen. We normaliseren wat er staat, keuren af
// wat onmogelijk is, en "verifiëren" een lead enkel met bewijs: het
// telefoonnummer staat op de eigen website van het bedrijf. Dan horen
// bedrijfsnaam, nummer en website aantoonbaar bij elkaar.

// ── Telefoon (België eerst) ──────────────────────────────────────────────────

export type Telefoon =
  | { geldig: true; land: 'BE' | 'buitenland'; nsn: string; e164: string; weergave: string }
  | { geldig: false; reden: string }

/**
 * Een telefoonnummer normaliseren naar één notatie: "+32 11 26 96 00",
 * "+32 470 12 34 56", "+32 2 123 45 67". Belgische regels:
 *  · vast: 8 cijfers na de 0 (zonenummer 2, 3, 4 of 9 = 1 cijfer, anders 2)
 *  · mobiel: 9 cijfers, beginnend met 45–49
 * Placeholders (00000000, 12345678, reeksen van hetzelfde cijfer) en
 * betaalnummers (0900/0905…) worden afgekeurd.
 */
export function telefoonBE(v: string | null | undefined): Telefoon {
  const ruw = String(v ?? '').trim()
  if (!ruw) return { geldig: false, reden: 'geen telefoonnummer' }
  // Een cel met twee nummers ("011 22 33 44 / 0470 …"): het eerste bruikbare telt.
  const delen = ruw.split(/\s*(?:[;|,]|\s\/\s|\sof\s|\sen\s)\s*/i).filter(Boolean)
  if (delen.length > 1) {
    for (const d of delen) { const t = telefoonBE(d); if (t.geldig) return t }
  }
  let c = ruw.replace(/\(0\)/g, '').replace(/\D/g, '')
  if (!c) return { geldig: false, reden: 'geen cijfers in het telefoonnummer' }
  if (/^(\d)\1{5,}$/.test(c) || /^(\d)\1+$/.test(c.replace(/^0+/, '')) || /^0*(12345678|123456789|87654321)$/.test(c)) return { geldig: false, reden: 'placeholdernummer' }

  let nsn: string | null = null
  if (c.startsWith('0032')) nsn = c.slice(4)
  else if (c.startsWith('32') && (c.length === 10 || c.length === 11 || ruw.startsWith('+'))) nsn = c.slice(2)
  else if (c.startsWith('31') && c.length === 11) return { geldig: true, land: 'buitenland', nsn: c, e164: `+${c}`, weergave: `+31 ${c.slice(2)}` } // Nederlands, landcode zonder +
  else if (c.startsWith('00')) {
    // Buitenlands nummer met 00-prefix
    const intl = c.slice(2)
    if (intl.length < 9 || intl.length > 14) return { geldig: false, reden: 'onmogelijke lengte voor een buitenlands nummer' }
    return { geldig: true, land: 'buitenland', nsn: intl, e164: `+${intl}`, weergave: `+${intl}` }
  } else if (ruw.trim().startsWith('+')) {
    if (c.length < 9 || c.length > 14) return { geldig: false, reden: 'onmogelijke lengte voor een buitenlands nummer' }
    return { geldig: true, land: 'buitenland', nsn: c, e164: `+${c}`, weergave: `+${c}` }
  } else if (c.startsWith('0')) nsn = c.slice(1)
  else if (c.length === 8 || c.length === 9) nsn = c // Excel at de voorloopnul op
  if (nsn === null) return { geldig: false, reden: 'onherkenbaar telefoonnummer' }
  nsn = nsn.replace(/^0/, '')

  if (/^90\d/.test(nsn)) return { geldig: false, reden: 'betaalnummer (090x)' }
  if (/^(\d)\1+$/.test(nsn)) return { geldig: false, reden: 'placeholdernummer' }
  const mobiel = /^4[5-9]\d{7}$/.test(nsn)
  const vast = /^[1-9]\d{7}$/.test(nsn) && !/^4[5-9]/.test(nsn)
  if (!mobiel && !vast) return { geldig: false, reden: nsn.length < 8 ? 'telefoonnummer te kort' : nsn.length > 9 ? 'telefoonnummer te lang' : 'geen geldig Belgisch nummer' }

  let weergave: string
  if (mobiel) weergave = `+32 ${nsn.slice(0, 3)} ${nsn.slice(3, 5)} ${nsn.slice(5, 7)} ${nsn.slice(7)}`
  else if (/^[2349]/.test(nsn)) weergave = `+32 ${nsn[0]} ${nsn.slice(1, 4)} ${nsn.slice(4, 6)} ${nsn.slice(6)}`
  else weergave = `+32 ${nsn.slice(0, 2)} ${nsn.slice(2, 4)} ${nsn.slice(4, 6)} ${nsn.slice(6)}`
  return { geldig: true, land: 'BE', nsn, e164: `+32${nsn}`, weergave }
}

// ── Website ──────────────────────────────────────────────────────────────────

/** Geen officiële website: sociale media, gidsen, zoekmachines, bouwplatformen. */
const GEEN_EIGEN_SITE = [
  'facebook.com', 'fb.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com', 'pinterest.',
  'google.', 'goo.gl', 'g.page', 'maps.app', 'bing.com', 'yelp.', 'tripadvisor.', 'goudengids.be', 'pagesdor.be', 'goldenpages.be',
  'openingsuren.', 'companyweb.be', 'trends.knack.be', 'bizzy.', 'infobel.', 'cylex.', 'hotfrog.', 'kompass.', 'europages.', 'kbopub.',
  'linktr.ee', 'wixsite.com/', 'business.site', 'site123.me', 'jouwweb.', 'weebly.com', 'monsite.', 'blogspot.',
]

export type Website = { geldig: true; url: string; domein: string } | { geldig: false; reden: string }

/** "www.bedrijf.be/contact" → { url: "https://www.bedrijf.be", domein: "bedrijf.be" }. */
export function websiteNorm(v: string | null | undefined): Website {
  const s = String(v ?? '').trim()
  if (!s) return { geldig: false, reden: 'geen website' }
  if (s.includes('@') && !/^https?:\/\//i.test(s)) return { geldig: false, reden: 'e-mailadres in het websiteveld' }
  let u: URL
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`) } catch { return { geldig: false, reden: 'ongeldige website' } }
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return { geldig: false, reden: 'ongeldige website' }
  const volledig = `${host}${u.pathname}`
  if (GEEN_EIGEN_SITE.some((d) => volledig.includes(d))) return { geldig: false, reden: 'geen eigen website (sociale media of gids)' }
  return { geldig: true, url: `https://${host}`, domein: host.replace(/^www\./, '') }
}

// ── Website-inhoud ───────────────────────────────────────────────────────────

/** Alle telefoonnummers die in een HTML-pagina staan, als nationaal nummer (zonder 0/+32). */
export function telefoonsInHtml(html: string): Set<string> {
  const uit = new Set<string>()
  const voeg = (s: string) => { const t = telefoonBE(s); if (t.geldig) uit.add(t.nsn) }
  for (const m of html.matchAll(/tel:([+\d\s().\-/%20]{8,30})/gi)) { let s = m[1]; try { s = decodeURIComponent(s) } catch { s = s.replace(/%20/g, ' ') } voeg(s) }
  // Tekst: HTML-tags weg, entiteiten voor spaties normaliseren
  const tekst = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ')
  for (const m of tekst.matchAll(/(?:\+|00)?\d[\d\s.\-/()]{7,20}\d/g)) voeg(m[0])
  // Ook JSON-LD en data-attributen (vaak "telephone":"+32…")
  for (const m of html.matchAll(/"telephone"\s*:\s*"([^"]{8,30})"/gi)) voeg(m[1])
  return uit
}

const RECHTSVORM = new Set(['bv', 'bvba', 'nv', 'vzw', 'cv', 'cvba', 'comm', 'commv', 'vof', 'sa', 'sprl', 'srl', 'gcv', 'ltd', 'gmbh', 'bvi'])
const ALGEMEEN = new Set(['bouw', 'bouwbedrijf', 'groep', 'group', 'transport', 'techniek', 'technieken', 'technics', 'services', 'service', 'solutions', 'de', 'het', 'en', 'van', 'der', 'den', 'the', 'and', 'belgium', 'belgie', 'limburg', 'hvac', 'klima', 'invest', 'company'])

/** Onderscheidende woorden uit een bedrijfsnaam (voor de controle op de website). */
export function naamTokens(naam: string): string[] {
  return naam.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !RECHTSVORM.has(t) && !ALGEMEEN.has(t))
}

/** Staat de bedrijfsnaam (een onderscheidend deel ervan) op de site of in het domein? */
export function naamOpSite(naam: string, html: string, domein: string): boolean {
  const tokens = naamTokens(naam)
  if (!tokens.length) return false
  const plat = html.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const dom = domein.toLowerCase().replace(/[^a-z0-9]/g, '')
  return tokens.some((t) => plat.includes(t) || dom.includes(t))
}

/** Een link naar de contactpagina op dezelfde site. */
export function contactLink(html: string, basis: string): string | null {
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    const href = m[1]
    if (!/contact|over-ons|about|impressum|kontakt/i.test(href)) continue
    try {
      const u = new URL(href, basis)
      const b = new URL(basis)
      if (u.hostname.replace(/^www\./, '') !== b.hostname.replace(/^www\./, '')) continue
      return u.toString()
    } catch { /* volgende */ }
  }
  return null
}

// ── Oordeel ──────────────────────────────────────────────────────────────────

export type Controle = {
  telefoon: Telefoon
  website: Website
  /** Resultaat van het ophalen van de site (null = niet geprobeerd). */
  site: null | { bereikbaar: boolean; telefoonOpSite: boolean; naamOpSite: boolean; fout?: string | null }
  dubbelVan?: string | null
  /** Handmatig goedgekeurde lijst (bv. een lijst die de gebruiker zelf aanleverde). */
  vertrouwd?: boolean
}

export type Oordeel = { behouden: boolean; status: 'geverifieerd' | 'vertrouwd' | 'geen_telefoon' | 'ongeldig_telefoon' | 'dubbel' | 'geen_website' | 'website_ongeldig' | 'website_onbereikbaar' | 'niet_verifieerbaar'; reden: string }

export const STATUS_LABEL: Record<Oordeel['status'], string> = {
  geverifieerd: 'Geverifieerd — nummer staat op de eigen website',
  vertrouwd: 'Aangeleverd en goedgekeurd',
  geen_telefoon: 'Geen telefoonnummer',
  ongeldig_telefoon: 'Ongeldig telefoonnummer',
  dubbel: 'Dubbele lead',
  geen_website: 'Geen eigen website — niet verifieerbaar',
  website_ongeldig: 'Geen geldige eigen website',
  website_onbereikbaar: 'Website onbereikbaar',
  niet_verifieerbaar: 'Telefoonnummer niet terug te vinden op de eigen website',
}

/**
 * Het oordeel over één lead, in volgorde van ernst:
 *  1. telefoon ontbreekt of is onmogelijk → weg
 *  2. dubbel → weg (de beste versie blijft)
 *  3. vertrouwde lijst → blijft (met genormaliseerd nummer)
 *  4. geen/ongeldige/onbereikbare website → niet verifieerbaar → weg
 *  5. nummer staat op de eigen site → geverifieerd → blijft
 *  6. anders → niet verifieerbaar → weg
 * "Weg" betekent uitsluiten (archiveren met reden), nooit iets verzinnen.
 */
export function beoordeel(c: Controle): Oordeel {
  if (!c.telefoon.geldig) {
    const geen = c.telefoon.reden === 'geen telefoonnummer'
    return { behouden: false, status: geen ? 'geen_telefoon' : 'ongeldig_telefoon', reden: c.telefoon.reden }
  }
  if (c.dubbelVan) return { behouden: false, status: 'dubbel', reden: `dubbel van ${c.dubbelVan}` }
  if (c.vertrouwd) return { behouden: true, status: 'vertrouwd', reden: 'aangeleverde lijst' }
  if (!c.website.geldig) return { behouden: false, status: c.website.reden === 'geen website' ? 'geen_website' : 'website_ongeldig', reden: c.website.reden }
  if (!c.site) return { behouden: false, status: 'niet_verifieerbaar', reden: 'website nog niet gecontroleerd' }
  if (!c.site.bereikbaar) return { behouden: false, status: 'website_onbereikbaar', reden: c.site.fout ?? 'website onbereikbaar' }
  if (c.site.telefoonOpSite) return { behouden: true, status: 'geverifieerd', reden: c.site.naamOpSite ? 'nummer en naam staan op de eigen website' : 'nummer staat op de eigen website' }
  return { behouden: false, status: 'niet_verifieerbaar', reden: c.site.naamOpSite ? 'naam wel, nummer niet op de eigen website' : 'nummer en naam niet op de opgegeven website' }
}

/** Beste lead van een groep duplicaten: met historiek > verder in de pijplijn > geverifieerd > meest volledig > oudste. */
export function besteVanGroep<T extends { id: string; stage_key: string; heeftHistoriek: boolean; geverifieerd: boolean; volledigheid: number; created_at: string }>(groep: T[]): T {
  return [...groep].sort((a, b) =>
    Number(b.heeftHistoriek) - Number(a.heeftHistoriek)
    || Number(b.stage_key !== 'outbound') - Number(a.stage_key !== 'outbound')
    || Number(b.geverifieerd) - Number(a.geverifieerd)
    || b.volledigheid - a.volledigheid
    || a.created_at.localeCompare(b.created_at))[0]
}

// ── Poort voor nieuwe outbound leads ─────────────────────────────────────────

export type Poort =
  | { ok: true; telefoon: Extract<Telefoon, { geldig: true }>; bron: 'bedrijf' | 'contact' | 'gsm'; website: string | null; websiteWeg: string | null }
  | { ok: false; reden: string }

/**
 * Keurt een nieuwe outbound lead vóór hij wordt opgeslagen:
 *  · er moet een geldig telefoonnummer zijn (bedrijf, contact of gsm);
 *  · het nummer wordt in één notatie gezet;
 *  · de website wordt een volledige URL, of weggelaten als het geen eigen
 *    site is (sociale media, gids, e-mailadres) — nooit iets bijverzinnen.
 * Verificatie op de website zelf gebeurt apart (die kost netwerktijd).
 */
export function poortNieuweLead(v: { bedrijfTelefoon?: string | null; contactTelefoon?: string | null; contactGsm?: string | null; website?: string | null }): Poort {
  const bronnen: ['bedrijf' | 'contact' | 'gsm', string | null | undefined][] = [['bedrijf', v.bedrijfTelefoon], ['contact', v.contactTelefoon], ['gsm', v.contactGsm]]
  let eersteFout: string | null = null
  for (const [bron, waarde] of bronnen) {
    if (!waarde || !String(waarde).trim()) continue
    const t = telefoonBE(waarde)
    if (t.geldig) {
      const w = websiteNorm(v.website)
      return { ok: true, telefoon: t, bron, website: w.geldig ? w.url : null, websiteWeg: !w.geldig && String(v.website ?? '').trim() ? w.reden : null }
    }
    eersteFout ??= t.reden
  }
  return { ok: false, reden: eersteFout ?? 'geen telefoonnummer' }
}
