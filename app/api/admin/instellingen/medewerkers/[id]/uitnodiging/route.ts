import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { sendEmail, baseUrl } from '@/lib/email'
import { eisHoofdbeheerder } from '@/lib/instellingen/api'
import { isAdminId } from '@/lib/instellingen/medewerkers'

export const dynamic = 'force-dynamic'

/**
 * POST — uitnodigingsmail versturen. Dit gebeurt NOOIT automatisch: enkel via
 * de aparte knop, na een uitdrukkelijke bevestiging in het scherm.
 *
 * De mail bevat een eenmalige link naar /login/wachtwoord; daar kiest de
 * medewerker zelf een wachtwoord. De link zelf komt niet in het logboek.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await eisHoofdbeheerder(); if (!g.ok) return g.response
    const { id } = await params
    if (isAdminId(id)) return NextResponse.json({ error: 'Een hoofdbeheerder nodig je niet uit; die heeft al een eigen account.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: staff } = await admin.from('staff_members').select('id, auth_user_id, email, name, voornaam, active, verwijderd_at').eq('id', id).maybeSingle()
    if (!staff) return NextResponse.json({ error: 'Medewerker niet gevonden.' }, { status: 404 })
    if (!staff.email) return NextResponse.json({ error: 'Deze medewerker heeft geen e-mailadres.' }, { status: 400 })
    if (staff.active === false || staff.verwijderd_at) return NextResponse.json({ error: 'Activeer of herstel de medewerker eerst; een inactief account kan niet inloggen.' }, { status: 400 })

    const { data: link, error } = await admin.auth.admin.generateLink({ type: 'recovery', email: staff.email })
    const tokenHash = link?.properties?.hashed_token
    if (error || !tokenHash) return NextResponse.json({ error: `Uitnodigingslink aanmaken mislukt: ${error?.message ?? 'onbekend'}` }, { status: 400 })

    const url = `${baseUrl()}/login/wachtwoord?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`
    const voornaam = staff.voornaam || (staff.name ?? '').split(' ')[0] || ''
    const aanhef = voornaam ? `Dag ${voornaam},` : 'Dag,'
    const tekst = [
      aanhef, '',
      'Je hebt toegang gekregen tot het NextGenMedia-portaal. Kies via onderstaande link een wachtwoord; daarna kun je inloggen met dit e-mailadres.', '',
      url, '',
      'De link is ongeveer een uur geldig en werkt één keer. Verwachtte je deze mail niet? Dan mag je ze negeren.', '',
      'Groeten', 'NextGenMedia',
    ].join('\n')
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#111">
      <p>${aanhef}</p>
      <p>Je hebt toegang gekregen tot het NextGenMedia-portaal. Kies via onderstaande knop een wachtwoord; daarna kun je inloggen met dit e-mailadres.</p>
      <p style="margin:24px 0"><a href="${url}" style="background:#fff848;color:#111;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;display:inline-block">Wachtwoord kiezen</a></p>
      <p style="font-size:13px;color:#555">Werkt de knop niet? Kopieer deze link in je browser:<br><span style="word-break:break-all">${url}</span></p>
      <p style="font-size:13px;color:#555">De link is ongeveer een uur geldig en werkt één keer. Verwachtte je deze mail niet? Dan mag je ze negeren.</p>
      <p>Groeten<br>NextGenMedia</p></div>`
    const r = await sendEmail({ to: staff.email, subject: 'Je toegang tot het NextGenMedia-portaal', text: tekst, html })
    if (!r.ok) return NextResponse.json({ error: `Mail versturen mislukt: ${r.error ?? 'onbekend'}` }, { status: 502 })

    await admin.from('staff_members').update({ uitnodiging_verzonden_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id)
    const meta = requestMeta(req)
    await logAudit({
      action: 'staff.invited', entityType: 'staff_member', entityId: id, summary: `Uitnodiging verstuurd naar ${staff.email}`,
      actorUserId: g.persoon.userId, actorEmail: g.persoon.email, actorRole: 'admin', metadata: { mailId: r.id ?? null }, ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
