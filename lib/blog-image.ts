import 'server-only'

// Gratis stockfoto's via Pexels (primair) met Unsplash als fallback. Commercieel
// vrij te gebruiken. Best-effort: zonder API-keys of bij een fout geeft dit null
// terug — de bloggeneratie loopt altijd door (afbeelding blijft dan leeg).
//
// Env: PEXELS_API_KEY (Authorization header) en/of UNSPLASH_ACCESS_KEY (Client-ID).

async function fromPexels(q: string, opts?: { random?: boolean }): Promise<string | null> {
  const key = process.env.PEXELS_API_KEY
  if (!key) return null
  try {
    const perPage = opts?.random ? 15 : 1
    const page = opts?.random ? 1 + Math.floor(Math.random() * 3) : 1
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${perPage}&page=${page}&orientation=landscape`
    const res = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const json = await res.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const photos = (json?.photos ?? []) as any[]
    if (photos.length === 0) return null
    const photo = opts?.random ? photos[Math.floor(Math.random() * photos.length)] : photos[0]
    const src = photo?.src
    return src?.landscape || src?.large || src?.original || null
  } catch { return null }
}

async function fromUnsplash(q: string, opts?: { random?: boolean }): Promise<string | null> {
  const key = process.env.UNSPLASH_ACCESS_KEY
  if (!key) return null
  try {
    const perPage = opts?.random ? 15 : 1
    const page = opts?.random ? 1 + Math.floor(Math.random() * 3) : 1
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=${perPage}&page=${page}&orientation=landscape`
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}` }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const json = await res.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = (json?.results ?? []) as any[]
    if (results.length === 0) return null
    const photo = opts?.random ? results[Math.floor(Math.random() * results.length)] : results[0]
    const urls = photo?.urls
    return urls?.regular || urls?.full || urls?.raw || null
  } catch { return null }
}

/** True als minstens één stockfoto-provider geconfigureerd is. */
export function stockImageConfigured(): boolean {
  return !!(process.env.PEXELS_API_KEY || process.env.UNSPLASH_ACCESS_KEY)
}

/**
 * Zoekt één passende landschapsfoto: Pexels eerst, dan Unsplash als fallback.
 * Retourneert een hotlinkbare CDN-URL of null. `{ random: true }` → telkens een andere.
 */
export async function findStockImage(query: string | null | undefined, opts?: { random?: boolean }): Promise<string | null> {
  const q = (query ?? '').trim()
  if (!q) return null
  return (await fromPexels(q, opts)) || (await fromUnsplash(q, opts)) || null
}
