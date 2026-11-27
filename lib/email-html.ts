// Bouwt een nette, responsive HTML-mail in de huisstijl van het merk
// (NextGenMedia = eigen huisstijl: woud, zonnegeel en kalk met het logo;
// NextGenSolutions blauw). Puur, zodat het overal bruikbaar is.
import { merkStijl, mailMerkVan, type MailMerk } from './merk-mail'
import { NGM } from './ngm-merk'
import { NGS } from './ngs-merk'

function escapeHtml(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Tekst → HTML-alinea's: lege regel = nieuwe alinea, enkele newline = <br>. */
function paragraphs(text: string, kleur = '#272727'): string {
  return (text ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${kleur}">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** NextGenMedia: kop in woud met het logo in zonnegeel, tekst in woud op wit, knop in zonnegeel, voet in woud met de baseline. */
function ngmHtml(opts: EmailHtmlOpts): string {
  const m = merkStijl('nextgenmedia')
  const hasCta = !!(opts.ctaText && opts.ctaLink)
  const cta = hasCta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px">
         <tr><td style="border-radius:999px;background:${NGM.zonnegeel}">
           <a href="${escapeHtml(opts.ctaLink!)}" target="_blank"
              style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:700;color:${NGM.woud};text-decoration:none;border-radius:999px">
             ${escapeHtml(opts.ctaText!)}
           </a>
         </td></tr>
       </table>`
    : ''
  return `<!DOCTYPE html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:${NGM.kalk}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NGM.kalk};padding:24px 12px;font-family:'DM Sans','Helvetica Neue',Arial,sans-serif">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${NGM.lijn}">
        <!-- Kop -->
        <tr><td style="background:${NGM.woud};padding:26px 32px 24px">
          <img src="${m.logo}" alt="${m.naam}" width="190" height="27" style="display:block;width:190px;height:auto;border:0">
        </td></tr>
        <!-- Tekst -->
        <tr><td style="padding:34px 32px 26px">
          ${paragraphs(opts.bodyText, NGM.woud)}
          ${cta}
        </td></tr>
        <!-- Voet -->
        <tr><td style="padding:18px 32px 20px;background:${NGM.woud}">
          <p style="margin:0;font-size:12px;line-height:1.6;color:${NGM.mos}">
            ${m.naam} · <a href="mailto:${m.adres}" style="color:${NGM.mos};text-decoration:none">${m.adres}</a> · <a href="https://${m.website}" style="color:${NGM.mos};text-decoration:none">${m.website}</a><br>
            <span style="font-family:'DM Mono','Courier New',monospace;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${NGM.zonnegeel}">${NGM.baseline}</span>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

/**
 * NextGenSolutions (brandkit 2026): kalk als achtergrond, een witte kaart met een fijne rand, het logo
 * in kleur bovenaan, tekst in inkt en tekstgrijs, één blauwe knop met een pijl, voet met het label in kapitalen.
 */
function ngsHtml(opts: EmailHtmlOpts): string {
  const m = merkStijl('nextgensolutions')
  const hasCta = !!(opts.ctaText && opts.ctaLink)
  const cta = hasCta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px">
         <tr><td style="border-radius:999px;background:${NGS.blauw}">
           <a href="${escapeHtml(opts.ctaLink!)}" target="_blank"
              style="display:inline-block;padding:14px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;font-family:Inter,Arial,Helvetica,sans-serif">
             ${escapeHtml(opts.ctaText!)} &rarr;
           </a>
         </td></tr>
       </table>`
    : ''
  return `<!DOCTYPE html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:${NGS.kalk}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NGS.kalk};padding:24px 12px;font-family:Inter,Arial,Helvetica,sans-serif">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${NGS.lijn}">
        <!-- Kop -->
        <tr><td style="padding:26px 32px 18px;border-bottom:1px solid ${NGS.lijn}">
          <img src="${m.logo}" alt="${m.naam}" width="180" style="display:block;width:180px;height:auto;border:0">
        </td></tr>
        <!-- Tekst -->
        <tr><td style="padding:30px 32px 24px">
          ${paragraphs(opts.bodyText, NGS.inkt)}
          ${cta}
        </td></tr>
        <!-- Voet -->
        <tr><td style="padding:18px 32px 20px;background:${NGS.kalk};border-top:1px solid ${NGS.lijn}">
          <p style="margin:0;font-size:12px;line-height:1.6;color:${NGS.tekst}">
            ${m.naam} · ${m.adres} · <a href="https://${m.website}" style="color:${NGS.blauw};text-decoration:none">${m.website}</a><br>
            <span style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${NGS.tekstSterk}">${NGS.tagline}</span>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

export type EmailHtmlOpts = {
  bodyText: string
  ctaText?: string | null
  ctaLink?: string | null
  /** Huisstijl; zonder = NextGenMedia. */
  merk?: MailMerk | null
}

/** Branded HTML-mail. Tabellen + inline styles voor maximale mailclient-support. */
export function buildEmailHtml(opts: EmailHtmlOpts): string {
  if (mailMerkVan(opts.merk) === 'nextgenmedia') return ngmHtml(opts)
  if (mailMerkVan(opts.merk) === 'nextgensolutions') return ngsHtml(opts)
  const m = merkStijl(opts.merk)
  const ACCENT = m.accent
  const hasCta = !!(opts.ctaText && opts.ctaLink)
  const cta = hasCta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px">
         <tr><td style="border-radius:8px;background:#0f0f0f">
           <a href="${escapeHtml(opts.ctaLink!)}" target="_blank"
              style="display:inline-block;padding:13px 30px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;border-bottom:3px solid ${ACCENT}">
             ${escapeHtml(opts.ctaText!)}
           </a>
         </td></tr>
       </table>`
    : ''

  return `<!DOCTYPE html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"></head>
<body style="margin:0;padding:0;background:#f0f0f0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0;padding:24px 12px;font-family:Archivo,'Helvetica Neue',Arial,sans-serif">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0">
        <!-- Header -->
        ${m.logo
          ? `<tr><td style="background:#ffffff;padding:24px 28px 20px;border-bottom:1px solid #e0e0e0">
          <img src="${m.logo}" alt="${m.naam}" width="132" height="40" style="display:block;width:132px;height:auto;border:0">
        </td></tr>`
          : `<tr><td style="background:#ffffff;padding:22px 28px 18px;border-bottom:3px solid ${ACCENT}">
          <span style="font-size:19px;font-weight:800;color:#111827;letter-spacing:-0.02em">${m.deel1}<span style="color:#111827;border-bottom:3px solid ${ACCENT};padding-bottom:1px">${m.deel2}</span></span>
        </td></tr>`}
        <!-- Body -->
        <tr><td style="padding:32px 32px 28px">
          ${paragraphs(opts.bodyText)}
          ${cta}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:18px 28px;background:#f7f7f7;border-top:1px solid #f0f0f0">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#999999">
            ${m.naam} · ${m.adres}<br>
            Deze e-mail werd verstuurd vanuit je ${m.naam}-portaal.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

/**
 * De link van de knop nog eens los in de tekst (een template met {{contract_link}} op een
 * eigen regel) ziet er rommelig uit: die lange link met codes laten we weg, de knop blijft.
 * "via onderstaande link" wordt dan "via onderstaande knop". Andere links blijven staan.
 */
export function zonderLosseLink(tekst: string, link: string | null | undefined): string {
  const l = (link ?? '').trim()
  if (!l || l.length < 12 || !(tekst ?? '').includes(l)) return tekst ?? ''
  const esc = l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let t = tekst
    .split('\n').filter((r) => r.trim().replace(/^[<(\[]|[>)\]]$/g, '') !== l).join('\n')
    .replace(new RegExp(`[ \\t]*[:\\-–]?[ \\t]*[<(\\[]?${esc}[>)\\]]?`, 'g'), '')
  t = t.replace(/\b(onderstaande|volgende) link\b/gi, (_m, w: string) => `${w} knop`)
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Platte-tekstversie (fallback voor mailclients zonder HTML). */
export function buildEmailText(opts: EmailHtmlOpts): string {
  let t = opts.bodyText ?? ''
  if (opts.ctaText && opts.ctaLink) t += `\n\n${opts.ctaText}: ${opts.ctaLink}`
  const m = merkStijl(opts.merk)
  t += `\n\n— ${m.naam} · ${m.adres}`
  return t
}
