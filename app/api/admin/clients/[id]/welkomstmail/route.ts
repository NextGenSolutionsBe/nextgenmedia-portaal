import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { sendEmailMetAfzenderTerugval, EMAIL_FROM, resendKeyFor, baseUrl } from '@/lib/email'
import { buildEmailHtml, buildEmailText } from '@/lib/email-html'
import { mailMerkVan, MERK_STIJL } from '@/lib/merk-mail'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { AccountFout, klantAccount, maakActivatie } from '@/lib/klant-account-server'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f-]{36}$/i

/**
 * POST — de welkomstmail met de login, vanuit de MailComposer (voorbeeld en
 * knop Versturen; nooit automatisch). De knop opent een persoonlijke link
 * (7 dagen) waar de klant zelf zijn wachtwoord kiest en meteen
 * tweestapsverificatie kan aanzetten. Enkel naar het e-mailadres van het
 * account. In het E-mail Center staat de mail zonder de link (geen tokens in logs).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const acc = await klantAccount(admin, id)
    if (!acc.userId || !acc.email) return NextResponse.json({ error: 'Maak eerst het klantaccount aan.' }, { status: 409 })

    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const aan = String(b.to_email ?? '').trim()
    const onderwerp = String(b.subject ?? '').trim().slice(0, 200)
    const tekst = String(b.body ?? '')
    if (aan.toLowerCase() !== acc.email.toLowerCase()) return NextResponse.json({ error: `De welkomstmail gaat enkel naar het e-mailadres van het account: ${acc.email}.` }, { status: 400 })
    if (!onderwerp) return NextResponse.json({ error: 'Het onderwerp is verplicht.' }, { status: 400 })
    const sleutel = typeof b.verzend_sleutel === 'string' && /^[0-9a-zA-Z-]{8,64}$/.test(b.verzend_sleutel) ? b.verzend_sleutel : null
    if (sleutel) {
      const { data: al } = await admin.from('email_messages').select('id, status, created_at').eq('verzend_sleutel', sleutel).maybeSingle()
      if (al && (al as { status: string }).status === 'sent') return NextResponse.json({ ok: true, id: (al as { id: string }).id, al_verstuurd: true, verstuurd_op: (al as { created_at: string }).created_at })
    }

    const merk = mailMerkVan(b.merk)
    const van = merk === 'nextgenmedia' ? EMAIL_FROM : MERK_STIJL[merk].van
    const knop = String(b.cta_text ?? '').trim() || 'Wachtwoord kiezen'
    const { url } = await maakActivatie(admin, { clientId: id, userId: acc.userId, email: acc.email, door: user.email ?? null })
    const html = buildEmailHtml({ bodyText: tekst, ctaText: knop, ctaLink: url, merk })
    const text = buildEmailText({ bodyText: tekst, ctaText: knop, ctaLink: url, merk })
    // Voor het logboek: dezelfde mail, maar zonder de persoonlijke link.
    const verborgen = `${baseUrl().replace(/\/$/, '')}/welkom/(persoonlijke link)`
    const htmlLog = buildEmailHtml({ bodyText: tekst, ctaText: knop, ctaLink: verborgen, merk })
    const t = () => new Date().toISOString()

    let logId: string | null = null
    try {
      const { data: rij } = await admin.from('email_messages').insert({
        to_email: aan, to_client_id: id, subject: onderwerp, body: tekst, html: htmlLog, from_email: van, kind: 'klantaccount', audience: 'client',
        verzend_sleutel: sleutel, status: 'bezig', sent_by: user.id, sent_by_email: user.email ?? null, updated_at: t(),
      }).select('id').single()
      logId = (rij as { id: string } | null)?.id ?? null
    } catch { /* logboek mag het versturen niet tegenhouden */ }

    const res = await sendEmailMetAfzenderTerugval({ to: aan, subject: onderwerp, text, html, from: merk === 'nextgenmedia' ? null : van, apiKey: resendKeyFor(merk), idempotencyKey: sleutel ? `klantaccount-${id}-${sleutel}` : null })
    if (logId) await admin.from('email_messages').update({ status: res.ok ? 'sent' : 'error', error: res.ok ? null : res.error ?? 'Onbekende fout', provider_id: res.id ?? null, updated_at: t() }).eq('id', logId)
    if (!res.ok) return NextResponse.json({ error: res.error || 'Verzenden mislukt' }, { status: 400 })
    const m = requestMeta(req)
    await logAudit({ action: 'client.welkomstmail', entityType: 'client', entityId: id, summary: `Welkomstmail met activatielink verstuurd naar ${aan}`, actorUserId: user.id, actorEmail: user.email ?? null, actorRole: 'admin', ip: m.ip, userAgent: m.userAgent })
    return NextResponse.json({ ok: true, id: logId, verstuurd_op: t() })
  } catch (e) {
    if (e instanceof AccountFout) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e) }, { status: 400 })
  }
}
