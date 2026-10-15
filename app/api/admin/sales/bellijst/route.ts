import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { requireStaff } from '@/lib/supabase/server'
import { belLijst, markeerGebeld, maakOngedaan, DAGEN_VOORAF } from '@/lib/sales/bellijst'
import { listPipelines } from '@/lib/sales/pipelines'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * De bellijst: wie moeten we bellen om een afspraak te bevestigen?
 *
 * Vervangt de herinneringsmail. Er gaat niets meer automatisch naar een
 * prospect; wij bellen zelf twee dagen vooraf.
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const dagen = Math.min(14, Math.max(0, Number(req.nextUrl.searchParams.get('dagen')) || DAGEN_VOORAF))
    const [lijst, pipelines] = await Promise.all([belLijst(dagen), listPipelines()])
    const naam = new Map(pipelines.map((p) => [p.id, p.name]))
    const metMerk = (i: { pipeline: string | null }) => ({ ...i, pipeline: i.pipeline ? naam.get(i.pipeline) ?? null : null })

    return NextResponse.json({
      dagenVooraf: dagen,
      tebellen: lijst.tebellen.map(metMerk),
      later: lijst.later.map(metMerk),
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** Gebeld (of toch niet). */
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const b = await req.json().catch(() => ({}))
    const id = String(b.appointmentId ?? '').trim()
    if (!id) return NextResponse.json({ error: 'Geen afspraak opgegeven' }, { status: 400 })

    if (b.gebeld === false) {
      await maakOngedaan(id)
    } else {
      await markeerGebeld(id, actor.id, typeof b.notitie === 'string' ? b.notitie : null)
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'sales.appointment.bevestigd', entityType: 'sales_appointment', entityId: id,
      summary: b.gebeld === false ? 'Verkoop: bevestiging teruggedraaid' : 'Verkoop: afspraak telefonisch bevestigd',
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
