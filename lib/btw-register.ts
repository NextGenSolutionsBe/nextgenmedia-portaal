import { validateBtw } from '@/lib/btw'

/**
 * Bedrijfsgegevens opzoeken op btw-nummer via VIES, het officiële btw-register
 * van de Europese Commissie (gratis, geen sleutel). Geeft de geregistreerde naam
 * en het adres terug. Companyweb of de KBO geven meer, maar vragen een betaald
 * abonnement of hebben geen open API.
 */

export type BtwGegevens = { btw: string; geldig: boolean; naam: string | null; straat: string | null; postcode: string | null; gemeente: string | null; land: string | null }

const LAND: Record<string, string> = { BE: 'België', NL: 'Nederland', FR: 'Frankrijk', DE: 'Duitsland', LU: 'Luxemburg' }
// Rechtsvormen die VIES vooraan zet ("BV NEXTGENMEDIA"); wij zetten ze achteraan.
const VORMEN = new Set(['BV', 'NV', 'VZW', 'VOF', 'COMMV', 'CV', 'CVBA', 'BVBA', 'SA', 'SRL', 'SPRL', 'ASBL', 'SC', 'SCRL', 'SCS', 'SNC', 'DPU', 'EV', 'IVZW', 'ESV', 'GCV', 'LV'])

/** "SA DPU PROXIMUS" → "Proximus SA DPU"; "BV NEXT GEN MEDIA" → "Next Gen Media BV". */
export function netteNaam(ruw: string | null | undefined): string | null {
  const s = String(ruw ?? '').replace(/\s+/g, ' ').trim()
  if (!s || s === '---') return null
  const woorden = s.split(' ')
  const vorm: string[] = []
  while (woorden.length > 1 && VORMEN.has(woorden[0].toUpperCase().replace(/\./g, ''))) vorm.push(woorden.shift()!.toUpperCase().replace(/\./g, ''))
  // Enkel volledig in hoofdletters omzetten; een naam met eigen hoofdletters laten we staan.
  const kern = woorden.join(' ')
  const net = kern === kern.toUpperCase()
    ? kern.toLowerCase().replace(/(^|[\s\-'&(/])(\p{L})/gu, (_m, voor: string, l: string) => voor + l.toUpperCase())
    : kern
  return [net, ...vorm].join(' ')
}

/** VIES-antwoord → gegevens. Adres: "Straat 27\n1030 Schaerbeek". */
export function leesVies(btw: string, j: Record<string, unknown>): BtwGegevens {
  const geldig = j.isValid === true || j.valid === true
  const adres = String(j.address ?? '').split('\n').map((x) => x.trim()).filter((x) => x && x !== '---')
  let straat: string | null = adres[0] ?? null, postcode: string | null = null, gemeente: string | null = null
  const laatste = adres.length > 1 ? adres[adres.length - 1] : ''
  const m = laatste.match(/^(\d{4,5})\s+(.+)$/)
  if (m) { postcode = m[1]; gemeente = m[2] } else if (laatste) gemeente = laatste
  if (adres.length > 2) straat = adres.slice(0, -1).join(', ')
  return { btw, geldig, naam: geldig ? netteNaam(String(j.name ?? '')) : null, straat: geldig ? straat : null, postcode: geldig ? postcode : null, gemeente: geldig ? gemeente : null, land: geldig ? LAND[btw.slice(0, 2)] ?? btw.slice(0, 2) : null }
}

/** Opzoeken bij VIES. Werpt bij een ongeldig nummer of als VIES niet antwoordt. */
export async function zoekInBtwRegister(invoer: string, f: typeof fetch = fetch): Promise<BtwGegevens> {
  const v = validateBtw(invoer)
  if (!v.ok || !v.value) throw new Error(v.error ?? 'Vul een btw-nummer in.')
  const btw = v.value
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 8000)
  try {
    const r = await f(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${btw.slice(0, 2)}/vat/${encodeURIComponent(btw.slice(2))}`, { headers: { Accept: 'application/json' }, signal: ctrl.signal, cache: 'no-store' })
    if (!r.ok) throw new Error('Het Europese btw-register antwoordt niet. Probeer het zo meteen opnieuw.')
    const j = await r.json() as Record<string, unknown>
    // VIES meldt drukte of onderhoud van een land als userError (bv. MS_UNAVAILABLE).
    if (typeof j.userError === 'string' && !['VALID', 'INVALID'].includes(j.userError)) throw new Error('Het btw-register van dit land is even niet bereikbaar. Probeer het zo meteen opnieuw.')
    return leesVies(btw, j)
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Het Europese btw-register antwoordt te traag. Probeer het zo meteen opnieuw.')
    throw e
  } finally { clearTimeout(t) }
}
