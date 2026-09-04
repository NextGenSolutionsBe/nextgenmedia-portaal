import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { sendEmail, getAdminEmails, baseUrl } from '@/lib/email'

// Directe, event-gedreven INTERNE adminmails (nooit naar klanten):
//  • onderhoudsaanvraag → meteen
//  • scriptfeedback/goedkeuring → meteen, maar max 1 mail per klant per uur
// Alles best-effort: faalt nooit door naar de aanroepende portal-route.

const esc = (s: string) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtDT = (iso: string) => new Date(iso).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('nl-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })

const KIND_LABEL: Record<string, string> = {
  text: 'Tekstaanpassing', tekst: 'Tekstaanpassing',
  color: 'Kleurwijziging', kleur: 'Kleurwijziging',
  image: 'Afbeelding vervangen', afbeelding: 'Afbeelding vervangen',
  other: 'Andere kleine wijziging', andere: 'Andere kleine wijziging',
}
const typeLabel = (raw: string | null | undefined) => {
  if (!raw) return 'Onderhoudsaanvraag'
  return KIND_LABEL[raw.toLowerCase()] ?? raw
}

function alertHtml(opts: {
  heading: string
  intro: string
  rows: { label: string; value: string }[]
  description?: string | null
  links?: { label: string; href: string }[]
  ctaText: string
  ctaHref: string
}): string {
  const rowsHtml = opts.rows.map((r) => `
    <tr>
      <td style="padding:4px 12px 4px 0;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top">${esc(r.label)}</td>
      <td style="padding:4px 0;font-size:14px;color:#111827">${esc(r.value)}</td>
    </tr>`).join('')
  const descHtml = opts.description
    ? `<div style="margin-top:14px"><div style="font-size:13px;color:#6b7280;margin-bottom:4px">Omschrijving</div>
         <div style="font-size:14px;color:#111827;line-height:1.6;white-space:pre-wrap;background:#f9fafb;border:1px solid #f0f0f0;border-radius:10px;padding:12px">${esc(opts.description)}</div></div>`
    : ''
  const linksHtml = (opts.links && opts.links.length)
    ? `<div style="margin-top:14px"><div style="font-size:13px;color:#6b7280;margin-bottom:4px">Bijlagen</div>${opts.links.map((l, i) => `<a href="${esc(l.href)}" style="font-size:13px;color:#2563eb;text-decoration:none">${esc(l.label || `Bijlage ${i + 1}`)}</a>`).join('<br>')}</div>`
    : ''
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
      <tr><td style="background:#ffffff;padding:22px 28px 18px;border-bottom:3px solid #fff848">
        <span style="font-size:19px;font-weight:800;color:#111827;letter-spacing:-0.02em">NextGenMedia</span>
        <div style="font-size:12px;color:#9ca3af;margin-top:2px">Interne melding voor admins</div>
      </td></tr>
      <tr><td style="padding:24px 28px">
        <h2 style="margin:0 0 6px;font-size:17px;color:#111827">${esc(opts.heading)}</h2>
        <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6">${esc(opts.intro)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0">${rowsHtml}</table>
        ${descHtml}
        ${linksHtml}
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px"><tr><td style="border-radius:10px;background:#111827">
          <a href="${esc(opts.ctaHref)}" target="_blank" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;border-radius:10px;border-bottom:3px solid #fff848">${esc(opts.ctaText)}</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f0f0f0">
        <p style="margin:0;font-size:12px;color:#9ca3af">Interne melding · uitsluitend voor admins van NextGenMedia.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

async function logAlert(o: { kind: string; clientId: string | null; recipients: string[]; subject: string; text: string; itemCount: number; relatedId: string | null; ok: boolean; error?: string; providerId?: string }) {
  try {
    const admin = createAdminSupabaseClient()
    await admin.from('email_messages').insert({
      to_email: o.recipients.join(', '), to_client_id: o.clientId, subject: o.subject, body: o.text,
      kind: o.kind, audience: 'admin', trigger_type: 'event', item_count: o.itemCount, related_id: o.relatedId,
      status: o.ok ? 'sent' : 'error', error: o.ok ? null : (o.error ?? null), provider_id: o.providerId ?? null,
    })
  } catch { /* log faalt stil */ }
}

/** Directe adminmail bij een nieuwe website-/onderhoudsaanvraag. */
export async function notifyMaintenanceRequest(requestId: string): Promise<void> {
  try {
    const admin = createAdminSupabaseClient()
    const { data: r } = await admin.from('webdesign_change_requests').select('*').eq('id', requestId).maybeSingle()
    if (!r) return
    const { data: client } = await admin.from('clients').select('company_name, contact_name').eq('id', r.client_id).maybeSingle()
    const bedrijf = client?.company_name ?? 'Klant'
    const klant = client?.contact_name || bedrijf

    const rawKind = Array.isArray(r.categories) && r.categories[0] ? r.categories[0] : (String(r.description ?? '').match(/^\[([^\]]+)\]/)?.[1] ?? null)
    const type = typeLabel(rawKind)
    const omschrijving = String(r.description ?? '').replace(/^\[[^\]]+\]\s*/, '').trim()
    const uploads: string[] = Array.isArray(r.image_urls) ? r.image_urls : []
    const adminLink = `${baseUrl()}/admin/services/website`

    const subject = `Nieuwe onderhoudsaanvraag — ${bedrijf}`
    const text = `${bedrijf} heeft een nieuwe onderhoudsaanvraag ingediend.\n\nKlant: ${klant}\nType: ${type}\nDatum: ${fmtDT(r.created_at)}\n\nOmschrijving:\n${omschrijving || '—'}\n\nOpen aanvraag: ${adminLink}`
    const html = alertHtml({
      heading: 'Nieuwe onderhoudsaanvraag',
      intro: `${bedrijf} heeft een nieuwe onderhoudsaanvraag ingediend.`,
      rows: [
        { label: 'Klant', value: klant },
        { label: 'Bedrijf', value: bedrijf },
        { label: 'Type', value: type },
        { label: 'Datum/tijd', value: fmtDT(r.created_at) },
      ],
      description: omschrijving || null,
      links: uploads.map((u, i) => ({ label: `Bijlage ${i + 1}`, href: u })),
      ctaText: 'Open aanvraag', ctaHref: adminLink,
    })

    const recipients = await getAdminEmails()
    const res = await sendEmail({ to: recipients, subject, text, html })
    await logAlert({ kind: 'maintenance_alert', clientId: r.client_id, recipients, subject, text, itemCount: 1, relatedId: requestId, ok: res.ok, error: res.error, providerId: res.id })
  } catch { /* nooit de portal-flow breken */ }
}

/** Directe adminmail bij scriptfeedback/goedkeuring — max 1 per klant per uur. */
export async function notifyClientScriptActivity(clientId: string): Promise<void> {
  try {
    const admin = createAdminSupabaseClient()
    const key = `scripts:${clientId}`

    // Throttle: max één mail per klant per uur.
    const { data: t } = await admin.from('admin_notify_throttle').select('last_sent_at').eq('key', key).maybeSingle()
    if (t?.last_sent_at && Date.now() - new Date(t.last_sent_at).getTime() < 3600e3) return
    await admin.from('admin_notify_throttle').upsert({ key, last_sent_at: new Date().toISOString() })

    const sinceISO = new Date(Date.now() - 3600e3).toISOString()
    const { data: items } = await admin.from('social_content_items')
      .select('status, reviewed_at, updated_at, title')
      .eq('client_id', clientId)
      .in('status', ['approved', 'changes_requested'])
      .gte('reviewed_at', sinceISO)
    const rows = (items ?? []) as { status: string; reviewed_at: string | null; updated_at: string | null; title: string | null }[]
    const approved = rows.filter((r) => r.status === 'approved').length
    const feedback = rows.filter((r) => r.status === 'changes_requested').length
    const total = approved + feedback || 1
    const times = rows.map((r) => r.reviewed_at || r.updated_at).filter(Boolean) as string[]
    const last = times.sort().slice(-1)[0] ?? new Date().toISOString()

    const { data: client } = await admin.from('clients').select('company_name').eq('id', clientId).maybeSingle()
    const bedrijf = client?.company_name ?? 'Klant'
    const adminLink = `${baseUrl()}/admin/services/social-media?client=${clientId}`

    const summary: string[] = []
    if (approved) summary.push(`${approved} script${approved === 1 ? '' : 's'} goedgekeurd`)
    if (feedback) summary.push(`${feedback} script${feedback === 1 ? '' : 's'} met feedback`)
    if (summary.length === 0) summary.push('scriptactiviteit')

    const subject = `Nieuwe feedback van ${bedrijf}`
    const text = `${bedrijf} heeft feedback of goedkeuringen toegevoegd aan scripts.\n\nSamenvatting:\n${summary.map((s) => `• ${s}`).join('\n')}\n• laatste wijziging: ${fmtTime(last)}\n\nOpen dashboard: ${adminLink}`
    const html = alertHtml({
      heading: 'Nieuwe scriptactiviteit',
      intro: `${bedrijf} heeft feedback of goedkeuringen toegevoegd aan scripts.`,
      rows: [
        { label: 'Klant', value: bedrijf },
        { label: 'Samenvatting', value: summary.join(' · ') },
        { label: 'Laatste wijziging', value: fmtTime(last) },
      ],
      ctaText: 'Open dashboard', ctaHref: adminLink,
    })

    const recipients = await getAdminEmails()
    const res = await sendEmail({ to: recipients, subject, text, html })
    await logAlert({ kind: 'script_alert', clientId, recipients, subject, text, itemCount: total, relatedId: clientId, ok: res.ok, error: res.error, providerId: res.id })
  } catch { /* nooit de portal-flow breken */ }
}
