import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { getOrCreateSalesOrg } from '@/lib/sales/service'
import { cancelReminderManually, rescheduleReminder } from '@/lib/sales/reminders'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Handmatig ingrijpen op een herinneringsmail: tegenhouden, op een ander moment
 * zetten, of meteen versturen.
 *
 * "Meteen versturen" is hetzelfde als verzetten naar nu — één weg door de code,
 * zodat er geen tweede variant kan ontstaan die zich net anders gedraagt.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()

    const action = String(b.action ?? '')
    // Eén afspraak of een selectie; opschonen en tegenhouden werken op beide.
    const raw: string[] = Array.isArray(b.appointmentIds)
      ? b.appointmentIds.map((v: unknown) => String(v))
      : [String(b.appointmentId ?? '')]
    const wanted = raw.filter(Boolean)
    if (wanted.length === 0) return NextResponse.json({ error: 'Afspraak ontbreekt' }, { status: 400 })

    // Enkel afspraken van ons; ids van buiten vallen er hier uit.
    const admin = createAdminSupabaseClient()
    const org = await getOrCreateSalesOrg()
    const { data: ownRows } = await admin.from('sales_appointments')
      .select('id').in('id', wanted).eq('sales_client_id', org.id)
    const ids = ((ownRows ?? []) as { id: string }[]).map((r) => r.id)
    if (ids.length === 0) return NextResponse.json({ error: 'Afspraak niet gevonden' }, { status: 404 })
    const appointmentId = ids[0]

    const meta = requestMeta(req)
    const log = (summary: string) => logAudit({
      action: `sales.reminder.${action}`, entityType: 'sales_appointment', entityId: appointmentId,
      summary, actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })

    if (action === 'cancel') {
      // Bij een selectie gaat elke mail apart; wat niet lukt, melden we los.
      const problems: string[] = []
      let done = 0
      for (const id of ids) {
        const res = await cancelReminderManually(id, actor.id)
        if (res.ok) done++
        else problems.push(res.error)
      }
      await log(`Verkoop: ${done} herinneringsmail(s) tegengehouden`)
      if (done === 0) return NextResponse.json({ error: problems[0] ?? 'Tegenhouden mislukt' }, { status: 400 })
      return NextResponse.json({
        ok: true,
        message: problems.length
          ? `${done} tegengehouden, ${problems.length} niet: ${problems[0]}`
          : `${done} mail(s) gaan niet uit.`,
      })
    }

    /**
     * Opschonen: de regel uit de lijst halen. De afspraak blijft staan.
     *
     * Een mail die nog moet vertrekken kan NIET opgeschoond worden. Anders
     * verdwijnt hij uit beeld terwijl hij gewoon nog uitgaat, en dat is precies
     * het soort verrassing dat dit scherm hoort te voorkomen. Houd hem eerst
     * tegen; dan mag hij weg.
     */
    if (action === 'hide' || action === 'unhide') {
      const hide = action === 'hide'
      let blocked = 0
      let target = ids

      if (hide) {
        const { data: pending } = await admin.from('sales_appointment_reminders')
          .select('appointment_id, cancelled_at, scheduled_for')
          .in('appointment_id', ids)
        const stillGoing = new Set(
          ((pending ?? []) as { appointment_id: string; cancelled_at: string | null; scheduled_for: string | null }[])
            .filter((r) => !r.cancelled_at && r.scheduled_for && new Date(r.scheduled_for).getTime() > Date.now())
            .map((r) => r.appointment_id),
        )
        target = ids.filter((id) => !stillGoing.has(id))
        blocked = ids.length - target.length
      }

      if (target.length > 0) {
        const { error } = await admin.from('sales_appointments')
          .update({ mail_hidden_at: hide ? new Date().toISOString() : null }).in('id', target)
        if (error) {
          if (/mail_hidden_at|PGRST204|schema cache/i.test(error.message)) {
            return NextResponse.json({
              error: 'Opschonen kan pas na de migratie (kolom mail_hidden_at ontbreekt nog).',
            }, { status: 503 })
          }
          throw new Error(error.message)
        }
      }

      await log(`Verkoop: ${target.length} regel(s) ${hide ? 'opgeschoond' : 'teruggehaald'}`)
      return NextResponse.json({
        ok: true,
        message: blocked > 0
          ? `${target.length} opgeschoond. ${blocked} niet: die mail staat nog klaar — houd hem eerst tegen.`
          : hide ? `${target.length} regel(s) opgeschoond.` : `${target.length} regel(s) teruggehaald.`,
      })
    }

    if (action === 'send_now') {
      const res = await rescheduleReminder(appointmentId, Date.now(), actor.id)
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
      await log('Verkoop: herinneringsmail meteen verstuurd')
      return NextResponse.json({ ok: true, message: res.message })
    }

    if (action === 'reschedule') {
      const at = new Date(String(b.at ?? '')).getTime()
      if (!Number.isFinite(at)) return NextResponse.json({ error: 'Kies een geldig tijdstip' }, { status: 400 })
      const res = await rescheduleReminder(appointmentId, at, actor.id)
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
      await log('Verkoop: verzendmoment van een herinneringsmail gewijzigd')
      return NextResponse.json({ ok: true, message: res.message })
    }

    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
