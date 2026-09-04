import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email'
import { buildEmailHtml, buildEmailText } from '@/lib/email-html'
import { logContractEvent } from '@/lib/contract-audit'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// POST — admin verstuurt bewust de contractmail (nooit automatisch).
// Werkt voor gekoppelde én losse contracten. Zet status op 'sent' (verzonden),
// logt audit-event 'sent' en bewaart de mail in het E-mail Center.
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

    const htmlOpts = { bodyText: body, ctaText, ctaLink }
    const html = buildEmailHtml(htmlOpts)
    const text = buildEmailText(htmlOpts)
    const result = await sendEmail({ to: toEmail, subject, text, html })

    // Loggen in E-mail Center (best effort).
    try {
      await admin.from('email_messages').insert({
        to_email: toEmail,
        to_client_id: contract.client_id || null,
        subject,
        body,
        template_id: b.template_id || null,
        template_name: b.template_name || null,
        kind: 'contract',
        audience: 'client',
        status: result.ok ? 'sent' : 'error',
        error: result.ok ? null : result.error,
        provider_id: result.id || null,
        sent_by: user.id,
        sent_by_email: user.email ?? null,
      })
    } catch { }

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

    // Status → verzonden (sent) + audit, tenzij al getekend/geannuleerd.
    if (!['signed', 'getekend', 'cancelled', 'geannuleerd'].includes(String(contract.status))) {
      try {
        await admin.from('contracts').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', id)
      } catch { }
    }
    await logContractEvent(admin, id, 'sent', {
      actor: user.email ?? user.id, meta: { to: toEmail, template: b.template_name || null },
    })

    try {
      revalidatePath('/admin/contracts')
      revalidatePath(`/admin/contracts/${id}`)
      if (contract.client_id) revalidatePath(`/admin/clients/${contract.client_id}`)
    } catch { }

    return NextResponse.json({ ok: true, id: result.id, to: toEmail })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
