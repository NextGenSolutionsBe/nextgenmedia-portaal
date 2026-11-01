/**
 * Miniatuur en video van een openbare Instagram-post of -reel uit de
 * embedpagina (instagram.com/<p|reel>/<code>/embed/captioned/). Pure module:
 * enkel tekst lezen, niets ophalen.
 *
 * De links die Instagram geeft zijn ondertekend en vervallen na een tijd;
 * daarom kopieert de server ze meteen naar de eigen opslag (zie
 * lib/founders-media-server.ts).
 */

const CDN = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i

/** Enkel https-links op het CDN van Instagram/Meta. */
export function isInstagramCdn(url: string | null | undefined): boolean {
  if (!url) return false
  try { const u = new URL(url); return u.protocol === 'https:' && CDN.test(u.hostname) } catch { return false }
}

/** De embedpagina van een post of reel; null als het geen Instagram-link is. */
export function embedPaginaUrl(link: string): string | null {
  let u: URL
  try { u = new URL(link) } catch { return null }
  if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return null
  const m = u.pathname.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})/)
  if (!m) return null
  const soort = m[1] === 'reels' ? 'reel' : m[1]
  return `https://www.instagram.com/${soort}/${m[2]}/embed/captioned/`
}

const html = (s: string) => s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/')

/** Een JSON-tekst die (soms dubbel) ge-escaped in een script staat, terug leesbaar maken. */
function ontsnap(s: string): string {
  return s
    .replace(/\\+\//g, '/')
    .replace(/\\+u0025/gi, '%')
    .replace(/\\+u0026/gi, '&')
    .replace(/\\+u003d/gi, '=')
    .replace(/\\+u002f/gi, '/')
    .replace(/\\/g, '')
}

export function leesEmbedPagina(pagina: string): { poster: string | null; video: string | null } {
  // Miniatuur: <img class="EmbeddedMediaImage" … src="…"> (volgorde van de attributen wisselt).
  const img = pagina.match(/<img[^>]*class="[^"]*EmbeddedMediaImage[^"]*"[^>]*\ssrc="([^"]+)"/i)?.[1]
    ?? pagina.match(/<img[^>]*\ssrc="([^"]+)"[^>]*class="[^"]*EmbeddedMediaImage[^"]*"/i)?.[1]
    ?? pagina.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1]
    ?? null
  const poster = img ? html(img) : null

  // Video: "video_url":"https:\/\/…mp4?…" in de ingesloten gegevens.
  let video: string | null = null
  const i = pagina.indexOf('video_url')
  if (i >= 0) {
    const stuk = pagina.slice(i, i + 4000)
    const m = stuk.match(/^video_url\\*"\s*:\s*\\*"(https?:.*?)\\*"/)
    if (m) video = html(ontsnap(m[1]))
  }
  return { poster: isInstagramCdn(poster) ? poster : null, video: isInstagramCdn(video) ? video : null }
}
