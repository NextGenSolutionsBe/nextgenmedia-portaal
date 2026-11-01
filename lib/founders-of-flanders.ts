import { youtubeId } from '@/lib/youtube'
import { herkenEmbed, valideerEmbed, type EmbedRef } from '@/lib/embeds'

/**
 * Founders of Flanders: voorbeeldvideo's (YouTube of een social post van
 * Instagram, Facebook of LinkedIn) die klanten in hun klantapp
 * zien, met de knop om zelf een founder video aan te vragen. De aanvraag loopt
 * via Aanvragen (soort "founders"). Pure module.
 */

export type FoundersVideo = {
  id: string; titel: string; ondernemer: string | null; bedrijf: string | null; beschrijving: string | null
  /** YouTube-video, of null als het een social post is. */
  youtube_id: string | null
  /** Social post (Instagram, Facebook, LinkedIn); enkel de nagekeken openbare link. */
  embed: EmbedRef | null
  formaat: 'liggend' | 'staand'; volgorde: number; zichtbaar: boolean
}

/** Bewaarde rij → veilig om te tonen: een opgeslagen post wordt opnieuw nagekeken. */
export function naarFoundersVideo(r: Record<string, unknown>): FoundersVideo {
  const embed = r.embed ? valideerEmbed(r.embed) : null
  return { ...(r as unknown as FoundersVideo), youtube_id: typeof r.youtube_id === 'string' && r.youtube_id ? r.youtube_id : null, embed }
}

export function valideerFoundersVideo(b: Record<string, unknown>): { ok: true; waarde: Omit<FoundersVideo, 'id' | 'volgorde'> } | { ok: false; fout: string } {
  const ruw = String(b.youtube ?? b.youtube_id ?? '').trim()
  const keuze = b.formaat === 'staand' || b.formaat === 'liggend' ? b.formaat : undefined
  // Eerst YouTube (ook Shorts en embedcode); anders een social post.
  let youtube_id = youtubeId(ruw)
  let embed: EmbedRef | null = null
  if (!youtube_id) {
    // Het formaat van een post raden we zelf (reel staand, post vierkant); enkel 'staand' kiezen gaat voor.
    const e = herkenEmbed(ruw, keuze === 'staand' ? 'staand' : undefined)
    if (!e.ok) return { ok: false, fout: ruw ? e.fout : 'Plak een YouTube-link of de link (of embedcode) van een Instagram-, Facebook- of LinkedIn-post.' }
    if (e.embed.provider === 'youtube') youtube_id = youtubeId(e.embed.url)
    else embed = e.embed
  }
  const kort = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || null
  const titel = kort(b.titel, 140)
  if (!titel) return { ok: false, fout: 'Geef de video een titel.' }
  return {
    ok: true,
    waarde: {
      titel, ondernemer: kort(b.ondernemer, 120), bedrijf: kort(b.bedrijf, 120), beschrijving: String(b.beschrijving ?? '').trim().slice(0, 800) || null,
      youtube_id: youtube_id ?? null, embed,
      // Een Shorts-link of reel is staand; een post (vierkant) staat in het staande raster; anders wat je koos.
      formaat: embed ? (embed.formaat === 'liggend' ? 'liggend' : 'staand') : b.formaat === 'staand' || /\/shorts\//.test(ruw) ? 'staand' : 'liggend',
      zichtbaar: b.zichtbaar !== false,
    },
  }
}

/** Instelling: de link naar het eigen YouTube-kanaal van Founders of Flanders. */
export const KANAAL_SLEUTEL = 'founders_kanaal'

/** Een YouTube-kanaal of -afspeellijst (youtube.com/@naam, /channel/…, /c/…, /user/…, /playlist?list=…). */
export function valideerKanaal(v: unknown): { ok: true; url: string | null } | { ok: false; fout: string } {
  const s = String(v ?? '').trim()
  if (!s) return { ok: true, url: null }
  let u: URL
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`) } catch { return { ok: false, fout: 'Dat is geen geldige link.' } }
  const host = u.hostname.replace(/^(www\.|m\.)/, '').toLowerCase()
  if (host !== 'youtube.com') return { ok: false, fout: 'Plak de link van het YouTube-kanaal (youtube.com/@…).' }
  const kanaal = /^\/(@[\w.-]{2,}|channel\/UC[\w-]{10,}|c\/[\w.-]+|user\/[\w.-]+)\/?/.test(u.pathname)
  const lijst = u.pathname === '/playlist' && /^[\w-]{10,}$/.test(u.searchParams.get('list') ?? '')
  if (!kanaal && !lijst) return { ok: false, fout: 'Plak de link van het kanaal (youtube.com/@…) of van een afspeellijst.' }
  return { ok: true, url: lijst ? `https://www.youtube.com/playlist?list=${u.searchParams.get('list')}` : `https://www.youtube.com${u.pathname.replace(/\/+$/, '')}` }
}
