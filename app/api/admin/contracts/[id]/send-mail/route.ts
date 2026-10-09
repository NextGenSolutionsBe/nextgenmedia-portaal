import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { sendEmail, EMAIL_FROM } from '@/lib/email'
import { buildEmailHtml, buildEmailText } from '@/lib/email-html'
import { logContractEvent } from '@/lib/contract-audit'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const adressen = (v: unknown): string[] => String(v ?? '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }
/** Insert/update die ontbrekende kolommen laat vallen (werkt ook vóór de migratie). */
async function veerkrachtig(admin: Admin, op: 'insert' | 'update', rij: Record<string, unknown>, id?: string): Promise<string | null> {
  const p = { ...rij }
  for (let i = 0; i < 10; i++) {
    const q = op === 'insert' ? admin.from('email_messages').insert(p).select('id').single() : admin.from('email_messages').update(p).eq('id', id)
    const { data, error } = await q
    if (!error) return op === 'insert' ? String(data.id) : id ?? null
    const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
    if (col && col in p) { delete p[col]; continue }
    return null
  }
  return null
}

// POST — admin verstuurt bewust de contractmail (nooit automatisch).
// Werkt voor gekoppelde én losse contracten. Elke verzendpoging wordt EERST
// gelogd (status 'bezig', met de volledige mail), daarna verstuurd en bijgewerkt
// naar 'sent' of 'error' met de berichtreferentie van de mailprovider.
// Zet de contractstatus op 'sent' (verzonden); dat is NIET 'getekend'.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (roleData?.role !== 'admin' && !(await isActiveStaff(user.id))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const admin = createAdminSupabaseClient()
    const { data: contract } = await admin.from('contracts').select('*').eq('id', id).maybeSingle()
    if (!contract) return NextResponse.json({ error: 'Contract niet gevonden' }, { status: 404 })

    const b = await req.json()
    const subject = (b.subject as string)?.trim()
    const body = (b.body as string) ?? ''
    const ctaText = (b.cta_text as string)?.trim() || null
    const ctaLink = (b.cta_link as string)?.trim() || null
    if (!subject) return NextResponse.json({ error: 'Onderwerp is verplicht' }, { status: 400 })

    // Ontvanger: expliciete override → ondertekenaar → klant-e-mail.
    let toEmail = (b.to_email as string)?.trim() || contract.signer_email || ''
    if (!toEmail && contract.client_id) {
      const { data: client } = await admin.from('clients').select('email').eq('id', contract.client_id).maybeSingle()
      toEmail = client?.email || ''
    }
    if (!toEmail) return NextResponse.json({ error: 'Geen e-mailadres voor deze ontvanger' }, { status: 400 })
    if (!EMAIL.test(toEmail)) return NextResponse.json({ error: `“${toEmail}” is geen geldig e-mailadres.` }, { status: 400 })
    const cc = adressen(b.cc)
    const fout = cc.find((x) => !EMAIL.test(x))
    if (fout) return NextResponse.json({ error: `“${fout}” (cc) is geen geldig e-mailadres.` }, { status: 400 })
    // Optioneel: een verborgen kopie naar het eigen adres (aanvulling op het logboek, geen vervanging).
    const bcc = b.kopie_naar_mij === true && user.email && EMAIL.test(user.email) ? [user.email] : []

    const htmlOpts = { bodyText: body, ctaText, ctaLink }
    const html = buildEmailHtml(htmlOpts)
    const text = buildEmailText(htmlOpts)
    const nu = () => new Date().toISOString()
    const bijlage = ctaLink ? `Ondertekenlink: ${ctaLink}${contract.signed_pdf_path ? ' · getekende versie beschikbaar' : contract.pdf_path ? ` · contractversie: ${String(contract.pdf_path).split('/').pop()}` : ''}` : contract.pdf_path ? `Contractversie: ${String(contract.pdf_path).split('/').pop()}` : null

    // 1. Eerst loggen: zo is elke verzendpoging terug te vinden, ook als er onderweg iets misgaat.
    const logId = await veerkrachtig(admin, 'insert', {
      to_email: toEmail, to_client_id: contract.client_id || null, contract_id: id, related_id: id,
      subject, body, html, cc: cc.join(', ') || null, bcc: bcc.join(', ') || null, from_email: EMAIL_FROM, bijlage,
      template_id: b.template_id || null, template_name: b.template_name || null, kind: 'contract', audience: 'client',
      status: 'bezig', sent_by: user.id, sent_by_email: user.email ?? null, updated_at: nu(),
    })

    // 2. Versturen.
    const result = await sendEmail({ to: toEmail, subject, text, html, cc, bcc })

    // 3. Resultaat vastleggen (status + berichtreferentie of foutmelding).
    if (logId) await veerkrachtig(admin, 'update', { status: result.ok ? 'sent' : 'error', error: result.ok ? null : result.error ?? 'Onbekende fout', provider_id: result.id || null, updated_at: nu() }, logId)

    if (!result.ok) return NextResponse.json({ error: result.error, log_id: logId }, { status: 400 })

    // Status → verzonden (sent) + audit, tenzij al getekend/geannuleerd.
    if (!['signed', 'getekend', 'cancelled', 'geannuleerd'].includes(String(contract.status))) {
      try {
        await admin.from('contracts').update({ status: 'sent', sent_at: nu() }).eq('id', id)
      } catch { }
    }
    await logContractEvent(admin, id, 'sent', {
      actor: user.email ?? user.id, meta: { to: toEmail, cc: cc.length ? cc : null, template: b.template_name || null, email_message_id: logId, provider_id: result.id ?? null },
    })

    try {
      revalidatePath('/admin/contracts')
      revalidatePath(`/admin/contracts/${id}`)
      if (contract.client_id) revalidatePath(`/admin/clients/${contract.client_id}`)
    } catch { }

    return NextResponse.json({ ok: true, id: result.id, to: toEmail, log_id: logId })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
