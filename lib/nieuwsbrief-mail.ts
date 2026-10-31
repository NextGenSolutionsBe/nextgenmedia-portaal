import { publiekeUrl } from '@/lib/marketing-media'
import { youtubeKijkUrl, youtubeThumb } from '@/lib/youtube'
import { categorieLabel, leesTekst, type Blok, type Inline, type Nieuwsbrief } from '@/lib/nieuwsbrieven'

/**
 * De nieuwsbrief als mail: dezelfde blokken, in mailveilige HTML (tabellen en
 * inline stijlen) plus een tekstversie. Een video wordt een miniatuur met een
 * afspeelknop die naar YouTube linkt. Onderaan: lezen in de klantapp en
 * afmelden. Pure module.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const inlineHtml = (d: Inline[]) => d.map((x) => x.t === 'vet' ? `<strong>${esc(x.s)}</strong>` : x.t === 'cursief' ? `<em>${esc(x.s)}</em>`
  : x.t === 'link' ? `<a href="${esc(x.url)}" style="color:#111;text-decoration:underline">${esc(x.s)}</a>` : esc(x.s).replace(/\n/g, '<br>')).join('')
const inlineTekst = (d: Inline[]) => d.map((x) => (x.t === 'link' ? `${x.s} (${x.url})` : x.s)).join('')

const P = 'margin:0 0 16px;font-size:16px;line-height:1.65;color:#27272a'
const KNOP = 'display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px'

function blokHtml(b: Blok): string {
  switch (b.type) {
    case 'tekst': return leesTekst(b.tekst).map((a) => a.soort === 'lijst'
      ? `<ul style="margin:0 0 16px;padding-left:22px;font-size:16px;line-height:1.65;color:#27272a">${a.items.map((it) => `<li style="margin:0 0 6px">${inlineHtml(it)}</li>`).join('')}</ul>`
      : `<p style="${P}">${inlineHtml(a.delen)}</p>`).join('')
    case 'kop': return `<h2 style="margin:28px 0 12px;font-size:22px;line-height:1.3;color:#111">${esc(b.tekst)}</h2>`
    case 'afbeelding': {
      const url = publiekeUrl(b.pad)
      return url ? `<p style="margin:0 0 16px"><img src="${esc(url)}" alt="${esc(b.onderschrift)}" width="536" style="width:100%;max-width:536px;height:auto;border-radius:12px;display:block"></p>${b.onderschrift ? `<p style="margin:-8px 0 16px;font-size:13px;color:#71717a">${esc(b.onderschrift)}</p>` : ''}` : ''
    }
    case 'galerij': {
      const cellen = b.paden.map((p) => `<td width="50%" style="padding:4px"><img src="${esc(publiekeUrl(p) ?? '')}" alt="" width="260" style="width:100%;height:auto;border-radius:10px;display:block"></td>`)
      const rijen: string[] = []
      for (let i = 0; i < cellen.length; i += 2) rijen.push(`<tr>${cellen[i]}${cellen[i + 1] ?? '<td width="50%"></td>'}</tr>`)
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px">${rijen.join('')}</table>`
    }
    case 'video': return `<p style="margin:0 0 16px"><a href="${esc(youtubeKijkUrl(b.youtube_id))}" style="display:block;position:relative;text-decoration:none"><img src="${esc(youtubeThumb(b.youtube_id))}" alt="Video bekijken" width="536" style="width:100%;max-width:536px;height:auto;border-radius:12px;display:block"></a></p><p style="margin:-6px 0 16px;font-size:14px"><a href="${esc(youtubeKijkUrl(b.youtube_id))}" style="color:#111;font-weight:600">▶ Bekijk de video${b.onderschrift ? `: ${esc(b.onderschrift)}` : ''}</a></p>`
    case 'citaat': return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="border-left:4px solid #111;padding:4px 0 4px 16px"><p style="margin:0;font-size:19px;line-height:1.45;color:#111;font-weight:600">${esc(b.tekst)}</p>${b.wie ? `<p style="margin:8px 0 0;font-size:14px;color:#71717a">— ${esc(b.wie)}</p>` : ''}</td></tr></table>`
    case 'knop': return `<p style="margin:8px 0 20px"><a href="${esc(b.url)}" style="${KNOP}">${esc(b.tekst)}</a></p>`
  }
}

function blokTekst(b: Blok): string {
  switch (b.type) {
    case 'tekst': return leesTekst(b.tekst).map((a) => a.soort === 'lijst' ? a.items.map((it) => `- ${inlineTekst(it)}`).join('\n') : inlineTekst(a.delen)).join('\n\n')
    case 'kop': return b.tekst.toUpperCase()
    case 'afbeelding': return b.onderschrift ? `[Foto: ${b.onderschrift}]` : ''
    case 'galerij': return ''
    case 'video': return `Video: ${youtubeKijkUrl(b.youtube_id)}`
    case 'citaat': return `“${b.tekst}”${b.wie ? ` — ${b.wie}` : ''}`
    case 'knop': return `${b.tekst}: ${b.url}`
  }
}

export function bouwNieuwsbriefMail(n: Pick<Nieuwsbrief, 'titel' | 'categorie' | 'samenvatting' | 'cover_pad' | 'cover_youtube_id' | 'blokken'>, o: { appLink: string; afmeldLink: string }): { onderwerp: string; html: string; tekst: string } {
  const cover = publiekeUrl(n.cover_pad) ?? (n.cover_youtube_id ? youtubeThumb(n.cover_youtube_id) : null)
  const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(n.titel)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="padding:20px 32px;border-bottom:1px solid #f4f4f5"><span style="font-size:15px;font-weight:700;color:#111">NextGenMedia</span><span style="float:right;font-size:12px;color:#71717a;padding-top:2px">${esc(categorieLabel(n.categorie))}</span></td></tr>
${cover ? `<tr><td><a href="${esc(o.appLink)}"><img src="${esc(cover)}" alt="" width="600" style="width:100%;height:auto;display:block"></a></td></tr>` : ''}
<tr><td style="padding:28px 32px 8px">
<h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;color:#111">${esc(n.titel)}</h1>
${n.samenvatting ? `<p style="margin:0 0 20px;font-size:18px;line-height:1.5;color:#52525b">${esc(n.samenvatting)}</p>` : ''}
${n.blokken.map(blokHtml).join('\n')}
<p style="margin:24px 0 8px"><a href="${esc(o.appLink)}" style="${KNOP}">Lees verder in je klantapp</a></p>
</td></tr>
<tr><td style="padding:20px 32px 28px;border-top:1px solid #f4f4f5;font-size:12px;line-height:1.6;color:#a1a1aa">Je krijgt deze nieuwsbrief omdat je klant bent bij NextGenMedia. Liever geen nieuwsbrief meer? <a href="${esc(o.afmeldLink)}" style="color:#71717a">Afmelden</a>.</td></tr>
</table></td></tr></table></body></html>`
  const tekst = [n.titel, n.samenvatting ?? '', ...n.blokken.map(blokTekst).filter(Boolean), `Lees verder in je klantapp: ${o.appLink}`, `Afmelden: ${o.afmeldLink}`].filter(Boolean).join('\n\n')
  return { onderwerp: n.titel, html, tekst }
}
