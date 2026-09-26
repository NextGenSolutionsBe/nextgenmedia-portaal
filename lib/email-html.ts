// Bouwt een nette, responsive HTML-mail met NextGenMedia-branding.
// Puur (geen imports) zodat het overal bruikbaar is.

function escapeHtml(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Tekst → HTML-alinea's: lege regel = nieuwe alinea, enkele newline = <br>. */
function paragraphs(text: string): string {
  return (text ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f2937">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

export type EmailHtmlOpts = {
  bodyText: string
  ctaText?: string | null
  ctaLink?: string | null
}

const ACCENT = '#fff848'

/** Branded HTML-mail. Tabellen + inline styles voor maximale mailclient-support. */
export function buildEmailHtml(opts: EmailHtmlOpts): string {
  const hasCta = !!(opts.ctaText && opts.ctaLink)
  const cta = hasCta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px">
         <tr><td style="border-radius:10px;background:#111827">
           <a href="${escapeHtml(opts.ctaLink!)}" target="_blank"
              style="display:inline-block;padding:13px 30px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;border-bottom:3px solid #fff848">
             ${escapeHtml(opts.ctaText!)}
           </a>
         </td></tr>
       </table>`
    : ''

  return `<!DOCTYPE html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"></head>
<body style="margin:0;padding:0;background:#f3f4f6">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
        <!-- Header -->
        <tr><td style="background:#ffffff;padding:22px 28px 18px;border-bottom:3px solid ${ACCENT}">
          <span style="font-size:19px;font-weight:800;color:#111827;letter-spacing:-0.02em">NextGen<span style="color:#111827;border-bottom:3px solid ${ACCENT};padding-bottom:1px">Media</span></span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px 32px 28px">
          ${paragraphs(opts.bodyText)}
          ${cta}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:18px 28px;background:#f9fafb;border-top:1px solid #f0f0f0">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#9ca3af">
            NextGenMedia · info@nextgenmedia.be<br>
            Deze e-mail werd verstuurd vanuit je NextGenMedia-portaal.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

/** Platte-tekstversie (fallback voor mailclients zonder HTML). */
export function buildEmailText(opts: EmailHtmlOpts): string {
  let t = opts.bodyText ?? ''
  if (opts.ctaText && opts.ctaLink) t += `\n\n${opts.ctaText}: ${opts.ctaLink}`
  t += `\n\n— NextGenMedia · info@nextgenmedia.be`
  return t
}
