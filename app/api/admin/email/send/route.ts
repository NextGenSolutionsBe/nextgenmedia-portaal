import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email'
import { buildEmailHtml, buildEmailText } from '@/lib/email-html'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

async function requireAdminUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' || (await isActiveStaff(user.id)) ? user : null
}

// POST — admin verstuurt bewust een mail naar een klant (nooit automatisch).
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdminUser()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const b = await req.json()
    const toEmail = (b.to_email as string)?.trim()
    const subject = (b.subject as string)?.trim()
    const body = (b.body as string) ?? ''
    const ctaText = (b.cta_text as string)?.trim() || null
    const ctaLink = (b.cta_link as string)?.trim() || null
    if (!toEmail) return NextResponse.json({ error: 'Geen e-mailadres voor deze klant' }, { status: 400 })
    if (!subject) return NextResponse.json({ error: 'Onderwerp is verplicht' }, { status: 400 })

    const admin = createAdminSupabaseClient()

    const htmlOpts = { bodyText: body, ctaText, ctaLink }
    const html = buildEmailHtml(htmlOpts)
    const text = buildEmailText(htmlOpts)

    const result = await sendEmail({ to: toEmail, subject, text, html })

    await admin.from('email_messages').insert({
      to_email: toEmail,
      to_client_id: b.to_client_id || null,
      subject,
      body,
      template_id: b.template_id || null,
      template_name: b.template_name || null,
      kind: b.kind || 'generic',
      audience: 'client',
      status: result.ok ? 'sent' : 'error',
      error: result.ok ? null : result.error,
      provider_id: result.id || null,
      sent_by: user.id,
      sent_by_email: user.email ?? null,
    })

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true, id: result.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
