// Dagelijkse INTERNE Metricool-samenvatting (nooit naar klanten). "Welke klanten
// krijgen vandaag een post → herplaats op de stories." Verzonden via de bestaande
// mail-opzet (Resend) naar de admins. Read-only afgeleid uit de Metricool API.

import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { metricoolConfigured, listScheduledPosts, type MetricoolPost } from '@/lib/metricool'
import { sendEmail, getAdminEmails, baseUrl } from '@/lib/email'

/** Huidige datum (YYYY-MM-DD) + uur in Europe/Brussels — DST-correct. */
export function brusselsDateHour(): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const hourRaw = get('hour')
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(hourRaw === '24' ? '0' : hourRaw) }
}

// datetime is een naïeve Brusselse wall-clock string ("YYYY-MM-DDTHH:mm:ss") —
// tijd zuiver uit de componenten halen, geen tijdzone-conversie.
function fmtTime(dt: string | null): string {
  if (!dt) return '—'
  const m = dt.match(/T(\d{2}):(\d{2})/)
  return m ? `${m[1]}:${m[2]}` : '—'
}

export type DigestResult = { ok: boolean; sent: boolean; clients: number; posts: number; date: string; reason?: string; error?: string }

/** Bouwt en verstuurt de dagsamenvatting voor vandaag (Belgische tijd). */
export async function sendMetricoolDailyDigest(): Promise<DigestResult> {
  const { date } = brusselsDateHour()
  if (!metricoolConfigured()) return { ok: true, sent: false, clients: 0, posts: 0, date, reason: 'not_configured' }

  const admin = createAdminSupabaseClient()
  const linkedRes = await admin
    .from('clients')
    .select('id, company_name, metricool_blog_id')
    .not('metricool_blog_id', 'is', null)
  if (linkedRes.error) return { ok: true, sent: false, clients: 0, posts: 0, date, reason: 'not_migrated' }
  const linked = (linkedRes.data ?? []).filter((c) => c.metricool_blog_id)

  const rows: Array<{ name: string; posts: MetricoolPost[] }> = []
  let total = 0
  for (const c of linked) {
    try {
      const posts = await listScheduledPosts(c.metricool_blog_id as string, date, date)
      if (posts.length > 0) { rows.push({ name: c.company_name, posts }); total += posts.length }
    } catch { /* per klant veilig falen */ }
  }

  if (total === 0) return { ok: true, sent: false, clients: 0, posts: 0, date, reason: 'no_posts' }

  rows.sort((a, b) => a.name.localeCompare(b.name))
  const url = `${baseUrl()}/admin/metricool`
  const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })

  // Platte tekst
  const textLines = [`Vandaag (${dateLabel}) posten deze klanten — herplaats op de stories:`, '']
  for (const r of rows) {
    textLines.push(`• ${r.name}`)
    for (const p of r.posts) {
      const net = p.networks.length ? ` [${p.networks.join(', ')}]` : ''
      textLines.push(`    – ${fmtTime(p.datetime)}${net}`)
    }
  }
  textLines.push('', `Overzicht: ${url}`)
  const text = textLines.join('\n')

  // HTML
  const rowsHtml = rows.map((r) => {
    const items = r.posts.map((p) => {
      const net = p.networks.length ? ` <span style="color:#6b7280">· ${p.networks.join(', ')}</span>` : ''
      return `<div style="font-size:13px;color:#374151;margin:2px 0">${fmtTime(p.datetime)}${net}</div>`
    }).join('')
    return `<tr><td style="padding:10px 12px;border-top:1px solid #eee;font-weight:600;color:#111;vertical-align:top">${escapeHtml(r.name)}</td><td style="padding:10px 12px;border-top:1px solid #eee">${items}</td></tr>`
  }).join('')
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
    <h2 style="font-size:16px;margin:0 0 4px">📣 Vandaag posten ${rows.length} klant(en)</h2>
    <p style="font-size:13px;color:#6b7280;margin:0 0 12px">${escapeHtml(dateLabel)} — vergeet niet te <b>herplaatsen op de stories</b>.</p>
    <table style="border-collapse:collapse;width:100%;max-width:560px;border:1px solid #eee;border-radius:8px;overflow:hidden">
      <thead><tr style="background:#fafafa"><th align="left" style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">Klant</th><th align="left" style="padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">Posts vandaag</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <p style="font-size:12px;margin-top:14px"><a href="${url}" style="color:#111">Open het Metricool-overzicht →</a></p>
  </div>`

  const to = await getAdminEmails()
  const r = await sendEmail({ to, subject: `📣 Metricool vandaag: ${rows.length} klant(en) posten`, text, html })
  return { ok: r.ok, sent: r.ok, clients: rows.length, posts: total, date, error: r.ok ? undefined : r.error }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
