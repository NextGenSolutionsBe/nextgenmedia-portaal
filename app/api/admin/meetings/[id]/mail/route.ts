import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { plannerRechten, magMeeting } from '@/lib/meetings/rechten'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { leesMeeting } from '@/lib/meetings/server'
import { meetingMailVoorstel } from '@/lib/meetings/meeting-mail'
import { controleerAfzender } from '@/lib/meetings/afzender'
import { verstuurMeetingMail, type MeetingMailInvoer } from '@/lib/meetings/meeting-mail-server'

export const dynamic = 'force-dynamic'

/**
 * Mail aan de deelnemers van een meeting, vanuit info@nextgenmedia.be.
 *  GET  → voorstel (ontvangers, onderwerp, tekst met datum, tijdzone, Meet-link
 *         of adres, organisator en briefing), de afzender en eerdere mails
 *  PATCH → versturen, enkel na een klik op Versturen in de MailComposer. Klopt
 *          de afzender niet, dan vertrekt er niets (geen ander account). PATCH en
 *          niet POST: mailen over een bestaande meeting valt onder 'aanpassen'.
 * Elke poging staat in het E-mail Center (kind 'meeting_mail').
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Admin = ReturnType<typeof createAdminSupabaseClient>

async function eerdere(admin: Admin, id: string) {
  const { data } = await admin.from('email_messages').select('id, created_at, to_email, subject, status, error, sent_by_email')
    .eq('related_id', id).eq('kind', 'meeting_mail').order('created_at', { ascending: false }).limit(20)
  return data ?? []
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const r = await plannerRechten()
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'Meeting niet gevonden' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    const m = await leesMeeting(admin, params.id)
    if (!m || !magMeeting(r, m, 'bekijken')) return NextResponse.json({ error: 'Meeting niet gevonden' }, { status: 404 })
    const [afzender, verstuurd] = await Promise.all([controleerAfzender(), eerdere(admin, m.id)])
    return NextResponse.json({ voorstel: meetingMailVoorstel(m), afzender, verstuurd })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'meetings.mail.GET') }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const r = await plannerRechten()
    if (!UUID.test(params.id) || !r.persoon) return NextResponse.json({ error: 'Meeting niet gevonden' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    const m = await leesMeeting(admin, params.id)
    if (!m || !magMeeting(r, m, 'bekijken')) return NextResponse.json({ error: 'Meeting niet gevonden' }, { status: 404 })
    if (!magMeeting(r, m, 'aanpassen')) return NextResponse.json({ error: 'Je mag voor deze meeting geen mail versturen.' }, { status: 403 })

    const b = await req.json().catch(() => ({})) as MeetingMailInvoer
    const u = await verstuurMeetingMail(admin, m, b, { userId: user.id, email: r.persoon.email })
    if (u.ok && !u.al_verstuurd) {
      const { ip, userAgent } = requestMeta(req)
      await logAudit({
        action: 'meeting.mail_verstuurd', entityType: 'klant_meeting', entityId: m.id, actorUserId: user.id, actorEmail: r.persoon.email,
        summary: `${m.klant_naam}: ${String(b.onderwerp ?? '')}`, ip, userAgent, metadata: { aan: u.aan, van: u.van, kopie_info: u.kopie },
      })
    }
    if (!u.ok) return NextResponse.json({ error: u.fout, log_id: u.log_id ?? null }, { status: u.status })
    return NextResponse.json({ ok: true, id: u.id, verstuurd_op: u.verstuurd_op, van: u.van, provider_id: u.provider_id, al_verstuurd: u.al_verstuurd === true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'meetings.mail.PATCH') }, { status: 500 })
  }
}
