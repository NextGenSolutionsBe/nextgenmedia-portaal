import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { sendEmail, getAdminEmails, baseUrl } from '@/lib/email'

// Dagelijkse admin-samenvatting: detail van GISTEREN + tellingen over 7 dagen.
// Bron voor zowel de cron (auto) als de manuele knop (E-mailcenter → Meldingen).
// Uitsluitend naar admins — nooit naar klanten.

type DetailItem = { who: string; what: string; when: string; href: string }

async function safeList<T>(p: PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  try { const { data } = await p; return data ?? [] } catch { return [] }
}
async function safeCount(p: PromiseLike<{ count: number | null }>): Promise<number> {
  try { const { count } = await p; return count ?? 0 } catch { return 0 }
}

const fmtDT = (iso: string) =>
  new Date(iso).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export type AdminReport = { itemCount: number; subject: string; text: string; html: string }

export async function buildAdminReport(now = new Date()): Promise<AdminReport> {
  const admin = createAdminSupabaseClient()
  const base = baseUrl()

  const startToday = new Date(now); startToday.setUTCHours(0, 0, 0, 0)
  const yStartISO = new Date(startToday.getTime() - 24 * 3600e3).toISOString()
  const yEndISO = startToday.toISOString()
  const weekStartISO = new Date(startToday.getTime() - 7 * 24 * 3600e3).toISOString()

  // ── Detail van gisteren ──────────────────────────────────────────────────
  const [approvals, feedback, webReqs, shootFb, partnerPays, partnerAssigns] = await Promise.all([
    safeList(admin.from('social_content_items').select('client_id, title, updated_at').eq('status', 'approved').gte('updated_at', yStartISO).lt('updated_at', yEndISO)),
    safeList(admin.from('social_content_items').select('client_id, title, updated_at').eq('status', 'changes_requested').gte('updated_at', yStartISO).lt('updated_at', yEndISO)),
    safeList(admin.from('webdesign_change_requests').select('client_id, title, kind, created_at').gte('created_at', yStartISO).lt('created_at', yEndISO)),
    safeList(admin.from('shoot_briefing_feedback').select('client_id, message, created_at').eq('author_role', 'client').gte('created_at', yStartISO).lt('created_at', yEndISO)),
    safeList(admin.from('partner_payments').select('freelancer_id, amount, created_at').eq('status', 'pending').gte('created_at', yStartISO).lt('created_at', yEndISO)),
    safeList(admin.from('freelancer_assignments').select('freelancer_id, title, created_at').eq('origin', 'partner').eq('status', 'open').gte('created_at', yStartISO).lt('created_at', yEndISO)),
  ])

  // Namen ophalen
  const clientIds = new Set<string>()
  const partnerIds = new Set<string>()
  for (const r of [...approvals, ...feedback, ...webReqs, ...shootFb] as { client_id: string | null }[]) if (r.client_id) clientIds.add(r.client_id)
  for (const r of [...partnerPays, ...partnerAssigns] as { freelancer_id: string | null }[]) if (r.freelancer_id) partnerIds.add(r.freelancer_id)
  const [clients, partners] = await Promise.all([
    clientIds.size ? safeList(admin.from('clients').select('id, company_name').in('id', [...clientIds])) : Promise.resolve([]),
    partnerIds.size ? safeList(admin.from('freelancers').select('id, name').in('id', [...partnerIds])) : Promise.resolve([]),
  ])
  const cName = new Map((clients as { id: string; company_name: string }[]).map((c) => [c.id, c.company_name]))
  const pName = new Map((partners as { id: string; name: string }[]).map((p) => [p.id, p.name]))
  const cn = (id: string | null) => (id ? cName.get(id) ?? 'Klant' : 'Klant')
  const pn = (id: string | null) => (id ? pName.get(id) ?? 'Partner' : 'Partner')

  const items: DetailItem[] = []
  for (const a of approvals as { client_id: string | null; title: string | null; updated_at: string }[])
    items.push({ who: cn(a.client_id), what: `keurde script "${a.title ?? 'item'}" goed`, when: fmtDT(a.updated_at), href: `${base}/admin/services/social-media?client=${a.client_id ?? ''}` })
  for (const f of feedback as { client_id: string | null; title: string | null; updated_at: string }[])
    items.push({ who: cn(f.client_id), what: `gaf feedback op "${f.title ?? 'item'}"`, when: fmtDT(f.updated_at), href: `${base}/admin/services/social-media?client=${f.client_id ?? ''}` })
  for (const w of webReqs as { client_id: string | null; title: string | null; kind: string | null; created_at: string }[])
    items.push({ who: cn(w.client_id), what: w.kind === 'maintenance' ? `diende een onderhoudsaanvraag in${w.title ? ` (${w.title})` : ''}` : `diende een websiteaanpassing in${w.title ? ` (${w.title})` : ''}`, when: fmtDT(w.created_at), href: `${base}/admin/services/website` })
  for (const s of shootFb as { client_id: string | null; created_at: string }[])
    items.push({ who: cn(s.client_id), what: 'reageerde op een shoot briefing', when: fmtDT(s.created_at), href: `${base}/admin/services/social-media?client=${s.client_id ?? ''}` })
  for (const p of partnerPays as { freelancer_id: string | null; amount: number; created_at: string }[])
    items.push({ who: pn(p.freelancer_id), what: `registreerde een betaling van €${Number(p.amount).toFixed(2)} (in afwachting)`, when: fmtDT(p.created_at), href: `${base}/admin/partners/${p.freelancer_id ?? ''}` })
  for (const a of partnerAssigns as { freelancer_id: string | null; title: string | null; created_at: string }[])
    items.push({ who: pn(a.freelancer_id), what: `diende een opdracht in: "${a.title ?? 'opdracht'}" (in afwachting)`, when: fmtDT(a.created_at), href: `${base}/admin/assignments` })

  // ── Weekoverzicht (laatste 7 dagen) ──────────────────────────────────────
  const sci = () => admin.from('social_content_items').select('id', { count: 'exact', head: true })
  const wcr = () => admin.from('webdesign_change_requests').select('id', { count: 'exact', head: true })
  const [wApprovals, wFeedback, wWeb, wMaint, wShoot, wPay, wAssign] = await Promise.all([
    safeCount(sci().eq('status', 'approved').gte('updated_at', weekStartISO)),
    safeCount(sci().eq('status', 'changes_requested').gte('updated_at', weekStartISO)),
    safeCount(wcr().neq('kind', 'maintenance').gte('created_at', weekStartISO)),
    safeCount(wcr().eq('kind', 'maintenance').gte('created_at', weekStartISO)),
    safeCount(admin.from('shoot_briefing_feedback').select('id', { count: 'exact', head: true }).eq('author_role', 'client').gte('created_at', weekStartISO)),
    safeCount(admin.from('partner_payments').select('id', { count: 'exact', head: true }).gte('created_at', weekStartISO)),
    safeCount(admin.from('freelancer_assignments').select('id', { count: 'exact', head: true }).eq('origin', 'partner').gte('created_at', weekStartISO)),
  ])
  const week = [
    { label: 'Goedgekeurde scripts', n: wApprovals },
    { label: 'Scripts met feedback', n: wFeedback },
    { label: 'Websiteaanvragen', n: wWeb },
    { label: 'Onderhoudsaanvragen', n: wMaint },
    { label: 'Shoot briefing reacties', n: wShoot },
    { label: 'Partnerbetalingen', n: wPay },
    { label: 'Partneropdrachten', n: wAssign },
  ]

  const subject = 'NextGenMedia — dagelijkse samenvatting'
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Platte tekst
  const textLines: string[] = ['Wijzigingen gisteren:', '']
  if (items.length === 0) textLines.push('Geen nieuwe wijzigingen gevonden.')
  else for (const it of items) textLines.push(`• ${it.who} ${it.what} — ${it.when}\n  ${it.href}`)
  textLines.push('', 'Laatste 7 dagen:')
  for (const w of week) textLines.push(`• ${w.label}: ${w.n}`)
  textLines.push('', `Dashboard: ${base}/admin`)
  const text = textLines.join('\n')

  // HTML
  const detailHtml = items.length === 0
    ? `<p style="margin:0 0 8px;font-size:14px;color:#6b7280">Geen nieuwe wijzigingen gevonden.</p>`
    : items.map((it) => `
        <tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f0">
          <div style="font-size:14px;color:#111827"><b>${esc(it.who)}</b> ${esc(it.what)}</div>
          <div style="font-size:12px;color:#9ca3af;margin-top:2px">${esc(it.when)} · <a href="${esc(it.href)}" style="color:#2563eb;text-decoration:none">openen in dashboard →</a></div>
        </td></tr>`).join('')

  const weekHtml = week.map((w) => `
    <tr>
      <td style="padding:6px 0;font-size:14px;color:#374151">${esc(w.label)}</td>
      <td style="padding:6px 0;font-size:14px;font-weight:700;color:#111827;text-align:right">${w.n}</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
      <tr><td style="background:#ffffff;padding:22px 28px 18px;border-bottom:3px solid #fff848">
        <span style="font-size:19px;font-weight:800;color:#111827;letter-spacing:-0.02em">NextGenMedia</span>
        <div style="font-size:12px;color:#9ca3af;margin-top:2px">Dagelijkse samenvatting voor admins</div>
      </td></tr>
      <tr><td style="padding:24px 28px">
        <h2 style="margin:0 0 12px;font-size:16px;color:#111827">Wijzigingen gisteren</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${detailHtml}</table>
        <h2 style="margin:24px 0 8px;font-size:16px;color:#111827">Weekoverzicht (laatste 7 dagen)</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${weekHtml}</table>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px"><tr><td style="border-radius:10px;background:#111827">
          <a href="${esc(base)}/admin" target="_blank" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;border-radius:10px;border-bottom:3px solid #fff848">Open dashboard</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f0f0f0">
        <p style="margin:0;font-size:12px;color:#9ca3af">Interne melding · uitsluitend voor admins van NextGenMedia.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`

  return { itemCount: items.length, subject, text, html }
}

/** Bouwt + verstuurt het rapport. auto: enkel bij wijzigingen. manual: altijd. */
export async function runAndSendAdminReport(trigger: 'auto' | 'manual', now = new Date()): Promise<{ sent: boolean; itemCount: number; error?: string }> {
  const report = await buildAdminReport(now)

  if (trigger === 'auto' && report.itemCount === 0) {
    return { sent: false, itemCount: 0 }
  }

  const recipients = await getAdminEmails()
  const result = await sendEmail({ to: recipients, subject: report.subject, text: report.text, html: report.html })

  const admin = createAdminSupabaseClient()
  try {
    await admin.from('email_messages').insert({
      to_email: recipients.join(', '), subject: report.subject, body: report.text,
      kind: 'admin_notify', audience: 'admin', trigger_type: trigger, item_count: report.itemCount,
      status: result.ok ? 'sent' : 'error', error: result.ok ? null : result.error, provider_id: result.id || null,
    })
  } catch { /* log faalt stil */ }

  if (result.ok) {
    try { await admin.from('admin_notify_state').upsert({ id: 'singleton', last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() }) } catch { }
  }

  return { sent: result.ok, itemCount: report.itemCount, error: result.ok ? undefined : result.error }
}
