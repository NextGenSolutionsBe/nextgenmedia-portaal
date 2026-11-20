import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { leesAdminIdentiteit } from '@/lib/admin-identiteit'
import { LeadTaakFout } from '@/lib/sales/lead-taken-server'
import { mailTakenLijst, planMailTaak, zetMailTaak } from '@/lib/mail-opvolging/taken-server'
import { controleerMailTaken } from '@/lib/mail-opvolging/sync-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const UUID = /^[0-9a-f-]{36}$/i

/**
 * Taken uit de mail (Command Center, blok Taken).
 *  GET  → alle voorstellen en wat ermee gebeurde (te beslissen, nog te doen, gedaan, verwijderd).
 *  POST { actie: 'zet', id, omschrijving, deadline, assignee_id, merk } → ClickUp-taak (zelfde flow als Taken toewijzen).
 *  POST { actie: 'verwijder' | 'terug', id }
 *  POST { actie: 'clickup' } → nu nakijken wat al in ClickUp staat of gedaan is.
 * Elke interne gebruiker (admin of actief teamlid), zoals Taken.
 */
export async function GET() {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    return NextResponse.json({ taken: await mailTakenLijst(createAdminSupabaseClient()) })
  } catch (e) { return NextResponse.json({ error: safeMessage(e) }, { status: 400 }) }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const admin = createAdminSupabaseClient()
    const ident = await leesAdminIdentiteit().catch(() => null)
    const naam = ident?.naam ?? user.email ?? null
    if (b.actie === 'clickup') return NextResponse.json({ ok: true, ...(await controleerMailTaken(admin)) })
    const id = typeof b.id === 'string' && UUID.test(b.id) ? b.id : null
    if (!id) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })
    if (b.actie === 'zet') {
      await planMailTaak(admin, id, b, { userId: user.id, email: user.email ?? null, naam })
      await logAudit({ action: 'mailtaak.ingepland', entityType: 'mail_taak', entityId: id, summary: `Taak uit de mail ingepland: ${String(b.omschrijving ?? '').slice(0, 120)}`, actorUserId: user.id, actorEmail: user.email ?? null, ...requestMeta(req) })
      return NextResponse.json({ ok: true })
    }
    if (b.actie === 'verwijder' || b.actie === 'terug') {
      await zetMailTaak(admin, id, b.actie === 'verwijder' ? 'verwijderd' : 'voorstel', naam)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Onbekende actie.' }, { status: 400 })
  } catch (e) {
    if (e instanceof LeadTaakFout) return NextResponse.json({ error: e.publiek }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e) }, { status: 400 })
  }
}
