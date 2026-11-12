// Founders of Flanders — Instagram-video's in de eigen speler (server).
//
// Instagram's eigen ingesloten speler geeft in de app vaak een foutmelding
// ("Er is een fout opgetreden … Afspeel-ID"). Daarom halen we bij het bewaren
// de miniatuur en de video één keer op uit de openbare embedpagina en zetten
// we ze in de publieke bucket founders-media. De klant kijkt dan met een
// gewone videospeler, met de miniatuur van Instagram als voorbeeldbeeld.

import { embedPaginaUrl, leesEmbedPagina } from '@/lib/instagram-media'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any; storage: { from: (b: string) => any } }

export const FOUNDERS_MEDIA_BUCKET = 'founders-media'
const MAX_VIDEO = 50 * 1024 * 1024
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

async function haal(url: string, ms: number): Promise<Response> {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms)
  try { return await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'nl-BE,nl;q=0.9,en;q=0.8' }, signal: c.signal, cache: 'no-store' }) } finally { clearTimeout(t) }
}

async function bewaar(admin: Admin, pad: string, data: ArrayBuffer, type: string) {
  const { error } = await admin.storage.from(FOUNDERS_MEDIA_BUCKET).upload(pad, new Uint8Array(data), { contentType: type, upsert: false })
  if (error) throw new Error(error.message)
}

type Rij = { id: string; embed: { provider?: string; url?: string } | null; media_poster_pad: string | null; media_video_pad: string | null }

/**
 * Miniatuur en video van één Founders-video ophalen en bewaren. `forceer`:
 * ook als het al eens lukte of net mislukte (knop "Opnieuw ophalen", of een
 * nieuwe link). Twee keer tegelijk kan niet: wie de claim niet krijgt, stopt.
 */
export async function kopieerInstagramMedia(admin: Admin, id: string, o: { forceer?: boolean } = {}): Promise<{ ok: boolean; video: boolean; fout?: string }> {
  const nu = new Date()
  const vijfMin = new Date(nu.getTime() - 5 * 60_000).toISOString()
  const halfUur = new Date(nu.getTime() - 30 * 60_000).toISOString()
  let q = admin.from('founders_videos').update({ media_status: 'bezig', media_bezig_sinds: nu.toISOString() }).eq('id', id)
  q = o.forceer
    ? q.or(`media_status.is.null,media_status.neq.bezig,media_bezig_sinds.lt."${vijfMin}"`)
    : q.or(`media_status.is.null,and(media_status.eq.mislukt,media_opgehaald_op.lt."${halfUur}"),and(media_status.eq.bezig,media_bezig_sinds.lt."${vijfMin}")`)
  const { data: claim } = await q.select('id, embed, media_poster_pad, media_video_pad')
  const rij = ((claim ?? []) as Rij[])[0]
  if (!rij) return { ok: false, video: false, fout: 'Wordt al opgehaald.' }

  const mislukt = async (fout: string) => {
    await admin.from('founders_videos').update({ media_status: 'mislukt', media_fout: fout.slice(0, 300), media_opgehaald_op: new Date().toISOString(), media_bezig_sinds: null }).eq('id', id)
    return { ok: false, video: false, fout }
  }
  try {
    const pagina = rij.embed?.provider === 'instagram' && rij.embed.url ? embedPaginaUrl(rij.embed.url) : null
    if (!pagina) return await mislukt('Geen Instagram-link.')
    const r = await haal(pagina, 15_000)
    if (!r.ok) return await mislukt(`Instagram antwoordde met ${r.status}.`)
    const { poster, video } = leesEmbedPagina(await r.text())
    if (!poster && !video) return await mislukt('Instagram gaf geen beeld terug. Staat de post openbaar?')

    const map = `founders/${id}`
    let posterPad: string | null = null
    if (poster) {
      const p = await haal(poster, 15_000)
      if (p.ok) {
        const type = (p.headers.get('content-type') ?? 'image/jpeg').split(';')[0]
        const ext = type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg'
        posterPad = `${map}/${crypto.randomUUID()}.${ext}`
        await bewaar(admin, posterPad, await p.arrayBuffer(), ext === 'jpg' ? 'image/jpeg' : type)
      }
    }
    let videoPad: string | null = null
    if (video) {
      const v = await haal(video, 45_000)
      if (v.ok) {
        const lengte = Number(v.headers.get('content-length') ?? 0)
        if (lengte > MAX_VIDEO) throw new Error('De video is groter dan 50 MB.')
        const data = await v.arrayBuffer()
        if (data.byteLength > MAX_VIDEO) throw new Error('De video is groter dan 50 MB.')
        videoPad = `${map}/${crypto.randomUUID()}.mp4`
        await bewaar(admin, videoPad, data, 'video/mp4')
      }
    }
    if (!posterPad && !videoPad) return await mislukt('Het beeld van Instagram kon niet opgehaald worden.')

    await admin.from('founders_videos').update({
      media_poster_pad: posterPad ?? rij.media_poster_pad, media_video_pad: videoPad ?? rij.media_video_pad,
      media_status: 'ok', media_fout: videoPad ? null : 'Enkel de miniatuur: dit lijkt geen video.', media_opgehaald_op: new Date().toISOString(), media_bezig_sinds: null,
    }).eq('id', id)
    // Oude bestanden opruimen (enkel als er een nieuwe in de plaats kwam).
    const weg = [posterPad && rij.media_poster_pad, videoPad && rij.media_video_pad].filter((x): x is string => typeof x === 'string' && x.length > 0)
    if (weg.length) await admin.storage.from(FOUNDERS_MEDIA_BUCKET).remove(weg)
    return { ok: true, video: !!videoPad }
  } catch (e) {
    return await mislukt(e instanceof Error ? e.message : 'Ophalen mislukt.')
  }
}

/** Bestanden van een video weghalen (bij verwijderen of een andere link). */
export async function wisInstagramMedia(admin: Admin, rij: { media_poster_pad?: string | null; media_video_pad?: string | null }) {
  const weg = [rij.media_poster_pad, rij.media_video_pad].filter((x): x is string => !!x)
  if (weg.length) await admin.storage.from(FOUNDERS_MEDIA_BUCKET).remove(weg).catch(() => null)
}

/** Instagram-video's waarvan de video nog niet (of al een tijd niet) in de eigen opslag staat. */
export function ontbrekendeMedia(rijen: Record<string, unknown>[], nu: Date = new Date()): string[] {
  return rijen.filter((r) => {
    const e = r.embed as { provider?: string } | null
    if (e?.provider !== 'instagram' || r.media_video_pad || r.media_status === 'ok') return false
    if (r.media_status === 'bezig') return !r.media_bezig_sinds || nu.getTime() - new Date(String(r.media_bezig_sinds)).getTime() > 5 * 60_000
    if (r.media_status === 'mislukt') return !r.media_opgehaald_op || nu.getTime() - new Date(String(r.media_opgehaald_op)).getTime() > 30 * 60_000
    return true
  }).map((r) => String(r.id)).slice(0, 6)
}
