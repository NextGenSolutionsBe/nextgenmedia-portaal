/**
 * YouTube-video's: video's laden we nooit zelf op (te zwaar), we embedden ze.
 * Herkent een gewone link, een korte link, Shorts, een embedlink, de
 * embedcode (<iframe …>) of een kale video-id. Pure module.
 */

const ID = /^[A-Za-z0-9_-]{11}$/

export function youtubeId(invoer: string | null | undefined): string | null {
  const s = String(invoer ?? '').trim()
  if (!s) return null
  if (ID.test(s)) return s
  // Embedcode: haal de src uit de iframe.
  const src = s.match(/src=["']([^"']+)["']/i)?.[1]
  const tekst = src ?? s
  let u: URL
  try { u = new URL(tekst.startsWith('http') ? tekst : `https://${tekst}`) } catch { return null }
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, '').toLowerCase()
  let id: string | null = null
  if (host === 'youtu.be') id = u.pathname.split('/')[1] ?? null
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v')
    else {
      const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/)
      id = m?.[2] ?? null
    }
  }
  return id && ID.test(id) ? id : null
}

/** Privacyvriendelijke embed (geen tracking tot de bezoeker afspeelt). */
export const youtubeEmbedUrl = (id: string, autoplay = false): string =>
  `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1${autoplay ? '&autoplay=1' : ''}`
export const youtubeThumb = (id: string): string => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
export const youtubeKijkUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`
