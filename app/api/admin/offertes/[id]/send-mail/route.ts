import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { sendEmailMetAfzenderTerugval, EMAIL_FROM, resendKeyFor } from '@/lib/email'
import { buildEmailHtml, buildEmailText } from '@/lib/email-html'
import { mailMerkVan, MERK_STIJL } from '@/lib/merk-mail'
import { logAudit, requestMeta } from '@/lib/audit'
import { leesAdminIdentiteit } from '@/lib/admin-identiteit'
import { leesOfferte, markeerVerstuurd, publiekeLink } from '@/lib/offertes-server'
import { fout } from '../../_fout'

export const dynamic = 'force-dynamic'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * POST — de offerte per mail versturen, vanuit de MailComposer (voorbeeld en
 * knop Versturen; nooit automatisch). De knop in de mail opent altijd de
 * publieke offertepagina. Eerst loggen in het E-mail Center, dan versturen,
 * dan de offerte op verstuurd. Zelfde verzend_sleutel = één mail.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const o = await leesOfferte(admin, id)
    if (!o) return NextResponse.json({ error: 'Offerte niet gevonden.' }, { status: 404 })
    if (o.status === 'ingetrokken') return NextResponse.json({ error: 'Deze offerte is ingetrokken.' }, { status: 409 })
    if (o.status === 'geaccepteerd') return NextResponse.json({ error: 'Deze offerte is al geaccepteerd.' }, { status: 409 })

    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const aan = String(b.to_email ?? '').trim()
    const onderwerp = String(b.subject ?? '').trim().slice(0, 200)
    const tekst = String(b.body ?? '')
    if (!EMAIL.test(aan)) return NextResponse.json({ error: 'Vul een geldig e-mailadres in.' }, { status: 400 })
    if (!onderwerp) return NextResponse.json({ error: 'Het onderwerp is verplicht.' }, { status: 400 })
    if (/\{\{\s*[a-z_]+\s*\}\}/i.test(`${onderwerp}\n${tekst}`)) return NextResponse.json({ error: 'De mail bevat nog een niet ingevulde code tussen {{ }}.' }, { status: 400 })
    const sleutel = typeof b.verzend_sleutel === 'string' && /^[0-9a-zA-Z-]{8,64}$/.test(b.verzend_sleutel) ? b.verzend_sleutel : null
    if (sleutel) {
      const { data: al } = await admin.from('email_messages').select('id, status, created_at').eq('verzend_sleutel', sleutel).maybeSingle()
      if (al && (al as { status: string }).status === 'sent') return NextResponse.json({ ok: true, id: (al as { id: string }).id, al_verstuurd: true, verstuurd_op: (al as { created_at: string }).created_at })
    }

    const merk = mailMerkVan(b.merk ?? o.merk)
    const van = merk === 'nextgenmedia' ? EMAIL_FROM : MERK_STIJL[merk].van
    const link = publiekeLink(o)
    const knop = String(b.cta_text ?? '').trim() || 'Offerte bekijken'
    const html = buildEmailHtml({ bodyText: tekst, ctaText: knop, ctaLink: link, merk })
    const text = buildEmailText({ bodyText: tekst, ctaText: knop, ctaLink: link, merk })
    const t = () => new Date().toISOString()

    // 1. Eerst loggen.
    let logId: string | null = null
    try {
      const { data: rij } = await admin.from('email_messages').insert({
        to_email: aan, to_client_id: o.client_id, subject: onderwerp, body: tekst, html, from_email: van, kind: 'offerte', audience: 'client',
        related_id: o.id, verzend_sleutel: sleutel, status: 'bezig', sent_by: user.id, sent_by_email: user.email ?? null, updated_at: t(),
      }).select('id').single()
      logId = (rij as { id: string } | null)?.id ?? null
    } catch { /* logboek mag het versturen niet tegenhouden */ }

    // 2. Versturen.
    const res = await sendEmailMetAfzenderTerugval({ to: aan, subject: onderwerp, text, html, from: merk === 'nextgenmedia' ? null : van, apiKey: resendKeyFor(merk), idempotencyKey: sleutel ? `offerte-${o.id}-${sleutel}` : null })
    if (logId) await admin.from('email_messages').update({ status: res.ok ? 'sent' : 'error', error: res.ok ? null : res.error ?? 'Onbekende fout', provider_id: res.id ?? null, updated_at: t() }).eq('id', logId)
    if (!res.ok) return NextResponse.json({ error: res.error || 'Verzenden mislukt' }, { status: 400 })

    // 3. Offerte op verstuurd (en het project bij).
    const ident = await leesAdminIdentiteit().catch(() => null)
    await markeerVerstuurd(admin, o, { aan, logId, door: { id: user.id, email: user.email ?? null, naam: ident?.naam || null } })
    const meta = requestMeta(req)
    await logAudit({ action: 'offerte.verstuurd', entityType: 'offerte', entityId: o.id, summary: `Offerte "${o.titel}" verstuurd naar ${aan}`, actorUserId: user.id, actorEmail: user.email ?? null, ip: meta.ip, userAgent: meta.userAgent })
    return NextResponse.json({ ok: true, id: logId, verstuurd_op: t() })
  } catch (e) { return fout(e, 'offerte.send-mail') }
}
