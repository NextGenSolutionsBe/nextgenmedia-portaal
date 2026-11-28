import 'server-only'

/**
 * Adressen opzoeken en de afstand over de weg berekenen, voor de
 * kilometervergoeding op een factuur. Gratis open diensten zonder sleutel:
 * Photon (OpenStreetMap) voor adressen, OSRM (OpenStreetMap) voor de route.
 * Enkel het adres en de coördinaten gaan naar buiten; niets wordt bewaard
 * behalve in het geheugen van deze functie (een paar uur, om niet steeds
 * opnieuw te vragen). Lukt het niet, dan zeggen we dat en vul je de km zelf in.
 */

export type AdresVoorstel = { adres: string; kort: string; lat: number; lon: number }

const UA = 'NextGenMedia-portaal/1.0 (facturatie, kilometervergoeding)'
const LANDEN = new Set(['BE', 'NL', 'LU', 'FR', 'DE'])
const LAND_NAAM: Record<string, string> = { NL: 'Nederland', LU: 'Luxemburg', FR: 'Frankrijk', DE: 'Duitsland' }
const UUR = 3_600_000
const cache = new Map<string, { tot: number; waarde: unknown }>()

function uitCache<T>(sleutel: string): T | undefined {
  const c = cache.get(sleutel)
  if (!c) return undefined
  if (c.tot < Date.now()) { cache.delete(sleutel); return undefined }
  return c.waarde as T
}
function inCache(sleutel: string, waarde: unknown, ms = 6 * UUR) {
  if (cache.size > 2000) cache.clear()
  cache.set(sleutel, { tot: Date.now() + ms, waarde })
}

async function haal(url: string, ms = 8000): Promise<unknown> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal, cache: 'no-store' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally { clearTimeout(t) }
}

type PhotonFeature = { geometry?: { coordinates?: [number, number] }; properties?: Record<string, string | undefined> }

function naarVoorstel(f: PhotonFeature): AdresVoorstel | null {
  const p = f.properties ?? {}
  const c = f.geometry?.coordinates
  if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null
  const land = (p.countrycode ?? '').toUpperCase()
  if (land && !LANDEN.has(land)) return null
  const straat = [p.street, p.housenumber].filter(Boolean).join(' ')
  const plaats = p.city ?? p.town ?? p.village ?? p.locality ?? p.district ?? p.county ?? ''
  const naam = p.name && p.name !== straat && p.name !== plaats ? p.name : ''
  const gemeente = [p.postcode, plaats].filter(Boolean).join(' ')
  const delen = [naam, straat, gemeente, land && land !== 'BE' ? LAND_NAAM[land] ?? land : ''].filter(Boolean)
  if (!delen.length) return null
  return { adres: delen.join(', '), kort: plaats || naam || straat, lat: c[1], lon: c[0] }
}

/** Voorstellen terwijl je typt (minstens 3 tekens), dicht bij Hasselt eerst. */
export async function zoekAdressen(q: string): Promise<AdresVoorstel[]> {
  const vraag = q.trim().replace(/\s+/g, ' ').slice(0, 200)
  if (vraag.length < 3) return []
  const sleutel = `z:${vraag.toLowerCase()}`
  const al = uitCache<AdresVoorstel[]>(sleutel)
  if (al) return al
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(vraag)}&limit=8&lat=50.93&lon=5.34`
  const j = await haal(url) as { features?: PhotonFeature[] }
  const gezien = new Set<string>()
  const uit = (j.features ?? []).map(naarVoorstel).filter((x): x is AdresVoorstel => !!x).filter((x) => (gezien.has(x.adres) ? false : (gezien.add(x.adres), true))).slice(0, 6)
  inCache(sleutel, uit)
  return uit
}

/** Eén adres naar een punt op de kaart (het eerste voorstel). */
export async function plaatsVan(adres: string): Promise<AdresVoorstel | null> {
  const l = await zoekAdressen(adres)
  return l[0] ?? null
}

/** Afstand over de weg in km (één richting), afgerond op hele km. */
export async function routeKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): Promise<number> {
  const punten = `${a.lon.toFixed(6)},${a.lat.toFixed(6)};${b.lon.toFixed(6)},${b.lat.toFixed(6)}`
  const sleutel = `r:${punten}`
  const al = uitCache<number>(sleutel)
  if (al !== undefined) return al
  let laatste: unknown = null
  for (const basis of ['https://routing.openstreetmap.de/routed-car/route/v1/driving', 'https://router.project-osrm.org/route/v1/driving']) {
    try {
      const j = await haal(`${basis}/${punten}?overview=false`) as { code?: string; routes?: { distance?: number }[] }
      const m = j.code === 'Ok' ? j.routes?.[0]?.distance : undefined
      if (typeof m === 'number' && m >= 0) {
        const km = Math.round(m / 1000)
        inCache(sleutel, km, 24 * UUR)
        return km
      }
      laatste = new Error(j.code ?? 'geen route')
    } catch (e) { laatste = e }
  }
  throw laatste instanceof Error ? laatste : new Error('Geen route gevonden')
}

export class AfstandFout extends Error {}

/** Van en naar (adres, eventueel met coördinaten) → km over de weg en de gevonden adressen. */
export async function afstandTussen(
  van: { adres: string; lat?: number | null; lon?: number | null },
  naar: { adres: string; lat?: number | null; lon?: number | null },
): Promise<{ km: number; van: AdresVoorstel; naar: AdresVoorstel }> {
  const vind = async (p: { adres: string; lat?: number | null; lon?: number | null }, wie: string): Promise<AdresVoorstel> => {
    if (typeof p.lat === 'number' && typeof p.lon === 'number') return { adres: p.adres, kort: '', lat: p.lat, lon: p.lon }
    const v = await plaatsVan(p.adres).catch(() => null)
    if (!v) throw new AfstandFout(`Het adres "${p.adres.slice(0, 80)}" (${wie}) vond ik niet. Typ het wat vollediger of kies een voorstel.`)
    return v
  }
  const [a, b] = await Promise.all([vind(van, 'van'), vind(naar, 'naar')])
  try {
    return { km: await routeKm(a, b), van: a, naar: b }
  } catch {
    throw new AfstandFout('De routeplanner antwoordt nu niet. Vul de afstand zelf in, of probeer zo opnieuw.')
  }
}
