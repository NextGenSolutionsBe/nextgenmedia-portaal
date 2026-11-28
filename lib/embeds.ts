import { youtubeId } from '@/lib/youtube'

/**
 * Berichten van sociale media insluiten: Instagram (posts en reels), Facebook
 * (posts, video's, reels), LinkedIn-posts en YouTube (ook Shorts).
 *
 * Je plakt een link of de embedcode die het platform geeft. We halen er enkel
 * de openbare link uit en bouwen zelf de iframe-link op het officiële domein.
 * Ruwe HTML of scripts uit een embedcode komen nooit op de pagina. Pure module.
 */

export type EmbedProvider = 'instagram' | 'facebook' | 'linkedin' | 'youtube'
export type Formaat = 'liggend' | 'staand' | 'vierkant'
export const PROVIDER_LABEL: Record<EmbedProvider, string> = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', youtube: 'YouTube' }
export const FORMAAT_LABEL: Record<Formaat, string> = { liggend: 'Liggend', staand: 'Staand (reel)', vierkant: 'Vierkant' }

/** Wat we bewaren: genoeg om de iframe opnieuw te bouwen, niets om blind te vertrouwen. */
export type EmbedRef = { provider: EmbedProvider; url: string; formaat: Formaat; hoogte?: number | null }

const isFormaat = (v: unknown): v is Formaat => v === 'liggend' || v === 'staand' || v === 'vierkant'

/** De link uit een embedcode halen (iframe src, Instagram-permalink, blockquote-link) of de invoer zelf. */
function linkUit(invoer: string): { link: string; hoogte: number | null } {
  const s = invoer.trim()
  const hoogteRuw = s.match(/\bheight=["']?(\d{2,4})/i)?.[1]
  const hoogte = hoogteRuw ? Math.min(1500, Math.max(200, Number(hoogteRuw))) : null
  const permalink = s.match(/data-instgrm-permalink=["']([^"']+)["']/i)?.[1]
  const src = s.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1]
  const cite = s.match(/<blockquote[^>]+cite=["']([^"']+)["']/i)?.[1]
  const href = s.match(/<a[^>]+href=["'](https?:\/\/[^"']+)["']/i)?.[1]
  const link = (permalink ?? src ?? cite ?? href ?? s).replace(/&amp;/g, '&')
  return { link, hoogte }
}

function alsUrl(s: string): URL | null {
  try { return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`) } catch { return null }
}
const host = (u: URL) => u.hostname.toLowerCase().replace(/^(www\.|m\.|web\.|business\.)/, '')

/**
 * Herkent een link of embedcode. `formaat` kies je zelf in de editor; zonder
 * keuze raden we (reels en Shorts staand, Instagram-posts vierkant, de rest liggend).
 */
export function herkenEmbed(invoer: unknown, formaat?: unknown): { ok: true; embed: EmbedRef } | { ok: false; fout: string } {
  const ruw = String(invoer ?? '').trim()
  if (!ruw) return { ok: false, fout: 'Plak een link of embedcode.' }
  if (ruw.length > 10000) return { ok: false, fout: 'Die embedcode is te lang.' }
  const { link, hoogte } = linkUit(ruw)
  const u = alsUrl(link)
  if (!u) return { ok: false, fout: 'Daar staat geen geldige link in.' }
  const h = host(u)
  const keuze = isFormaat(formaat) ? formaat : null

  // YouTube (ook Shorts en embedcode)
  if (h === 'youtube.com' || h === 'youtu.be' || h === 'youtube-nocookie.com' || h === 'music.youtube.com') {
    const id = youtubeId(link)
    if (!id) return { ok: false, fout: 'Geen geldige YouTube-link.' }
    const short = /\/shorts\//.test(u.pathname)
    return { ok: true, embed: { provider: 'youtube', url: short ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`, formaat: keuze ?? (short ? 'staand' : 'liggend') } }
  }

  // Instagram: /p/<code>, /reel/<code>, /reels/<code>, /tv/<code> (ook /<gebruiker>/p/<code>)
  if (h === 'instagram.com' || h === 'instagr.am') {
    const m = u.pathname.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})/)
    if (!m) return { ok: false, fout: 'Gebruik de link van een Instagram-post of -reel (instagram.com/p/… of /reel/…).' }
    const soort = m[1] === 'p' ? 'p' : m[1] === 'tv' ? 'tv' : 'reel'
    return { ok: true, embed: { provider: 'instagram', url: `https://www.instagram.com/${soort}/${m[2]}/`, formaat: keuze ?? (soort === 'p' ? 'vierkant' : 'staand') } }
  }

  // Facebook: een plugin-link uit de embedcode, of de link van een post, video of reel
  if (h === 'facebook.com' || h === 'fb.watch' || h === 'fb.com') {
    let doel = u
    if (u.pathname.startsWith('/plugins/')) {
      const href = u.searchParams.get('href')
      const d = href ? alsUrl(href) : null
      if (!d || !['facebook.com', 'fb.watch', 'fb.com'].includes(host(d))) return { ok: false, fout: 'Deze Facebook-embedcode verwijst niet naar Facebook.' }
      doel = d
    }
    doel.hash = ''
    const reel = /\/reel\//.test(doel.pathname)
    const video = reel || /\/videos?\//.test(doel.pathname) || /\/watch/.test(doel.pathname) || host(doel) === 'fb.watch'
    return { ok: true, embed: { provider: 'facebook', url: doel.toString(), formaat: keuze ?? (reel ? 'staand' : video ? 'liggend' : 'vierkant'), ...(hoogte ? { hoogte } : {}) } }
  }

  // LinkedIn: embedcode (/embed/feed/update/urn:li:…) of de link van een post (…-activity-<nummer>-…)
  if (h === 'linkedin.com') {
    const urn = u.pathname.match(/urn:li:(share|ugcPost|activity):(\d{10,25})/)?.slice(1)
      ?? (u.pathname.match(/activity[-:](\d{10,25})/) ? ['activity', u.pathname.match(/activity[-:](\d{10,25})/)![1]] : null)
    if (!urn) return { ok: false, fout: 'Gebruik de embedcode van de LinkedIn-post (… → Insluiten) of de link van de post.' }
    return { ok: true, embed: { provider: 'linkedin', url: `https://www.linkedin.com/feed/update/urn:li:${urn[0]}:${urn[1]}/`, formaat: keuze ?? 'vierkant', ...(hoogte ? { hoogte } : {}) } }
  }

  return { ok: false, fout: 'Enkel Instagram, Facebook, LinkedIn of YouTube.' }
}

/** Bewaarde embed opnieuw nakijken (nooit een opgeslagen iframe-link vertrouwen). */
export function valideerEmbed(v: unknown): EmbedRef | null {
  if (!v || typeof v !== 'object') return null
  const r = v as { url?: unknown; formaat?: unknown; hoogte?: unknown }
  const e = herkenEmbed(r.url, r.formaat)
  if (!e.ok) return null
  const hoogte = Number(r.hoogte)
  return Number.isFinite(hoogte) && hoogte >= 200 && hoogte <= 1500 ? { ...e.embed, hoogte: Math.round(hoogte) } : e.embed
}

/** De iframe-link, altijd opgebouwd uit de nagekeken link. YouTube speelt via de eigen lichte speler. */
export function embedSrc(e: EmbedRef): string | null {
  const u = alsUrl(e.url)
  if (!u) return null
  switch (e.provider) {
    case 'instagram': {
      const m = u.pathname.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]{5,40})/)
      return m ? `https://www.instagram.com/${m[1]}/${m[2]}/embed/${m[1] === 'p' ? 'captioned/' : ''}` : null
    }
    case 'facebook': {
      const video = e.formaat !== 'vierkant' || /\/(videos?|reel|watch)\//.test(u.pathname)
      const p = new URLSearchParams({ href: u.toString(), show_text: video ? 'false' : 'true', width: video && e.formaat === 'staand' ? '360' : '500' })
      return `https://www.facebook.com/plugins/${video ? 'video' : 'post'}.php?${p.toString()}`
    }
    case 'linkedin': {
      const m = u.pathname.match(/urn:li:(share|ugcPost|activity):(\d{10,25})/)
      return m ? `https://www.linkedin.com/embed/feed/update/urn:li:${m[1]}:${m[2]}?collapsed=1` : null
    }
    case 'youtube': return null
  }
}

/** Hoogte van het venster bij een gegeven breedte (Instagram en Facebook tonen een kop en voet rond het beeld). */
export function embedVerhouding(e: EmbedRef): { breedteMax: number; hoogte?: number; aspect?: string } {
  if (e.provider === 'youtube') return { breedteMax: e.formaat === 'staand' ? 360 : 960, aspect: e.formaat === 'staand' ? '9 / 16' : '16 / 9' }
  if (e.hoogte) return { breedteMax: 540, hoogte: e.hoogte }
  if (e.provider === 'instagram') return e.formaat === 'staand' ? { breedteMax: 400, aspect: '9 / 19.5' } : { breedteMax: 480, aspect: '4 / 5.9' }
  if (e.provider === 'facebook') return e.formaat === 'staand' ? { breedteMax: 360, aspect: '9 / 16' } : e.formaat === 'liggend' ? { breedteMax: 720, aspect: '16 / 9' } : { breedteMax: 500, hoogte: 640 }
  return { breedteMax: 540, hoogte: 640 }
}
