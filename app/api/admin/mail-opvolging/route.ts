import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { laadOpvolgingen, syncStand } from '@/lib/mail-opvolging/server'
import { leesMailEnAgenda } from '@/lib/mail-opvolging/sync-server'
import { moetOpvolgen } from '@/lib/mail-opvolging/regels'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
const UUID = /^[0-9a-f-]{36}$/i

/**
 * Mail-opvolging op Projecten.
 *  GET ?opdracht=<id> → de opvolging van dat project, de tijdlijn (mails, meetings, offerte, contract) en de leesstand.
 *  GET ?lijst=1       → per project wat er opgevolgd moet worden (voor de kaartjes op het bord).
 *  POST { actie: 'opgevolgd', opdracht_id, sleutel, reden? } → weg tot er iets nieuws gebeurt.
 *  POST { actie: 'lezen' } → de mailboxen en agenda's nu lezen.
 * Rechten: module opdrachten (bekijken / aanpassen).
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await magIk('opdrachten', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const id = req.nextUrl.searchParams.get('opdracht')
    if (id) {
      if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
      const [lijst, stand] = await Promise.all([laadOpvolgingen(admin, { opdrachtId: id }), syncStand(admin)])
      const p = lijst[0] ?? null
      return NextResponse.json({ opvolging: p?.opvolging ?? null, gebeurtenissen: (p?.gebeurtenissen ?? []).slice(-25).reverse(), actief: !!p, stand })
    }
    const lijst = await laadOpvolgingen(admin)
    return NextResponse.json({
      items: lijst.filter((x) => x.opvolging && x.opvolging.status !== 'wacht_op_klant').map((x) => ({ opdracht_id: x.project.id, status: x.opvolging!.status, dringend: x.opvolging!.dringend, tekst: x.opvolging!.tekst, telt: moetOpvolgen(x.opvolging) })),
    })
  } catch (e) { return NextResponse.json({ error: safeMessage(e) }, { status: 400 }) }
}

export async function POST(req: NextRequest) {
  try {
    const p = await magIk('opdrachten', 'aanpassen')
    if (!p) return NextResponse.json({ error: 'Je mag dit niet aanpassen.' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as { actie?: unknown; opdracht_id?: unknown; sleutel?: unknown; reden?: unknown }
    const admin = createAdminSupabaseClient()
    if (b.actie === 'opgevolgd') {
      const id = typeof b.opdracht_id === 'string' && UUID.test(b.opdracht_id) ? b.opdracht_id : null
      const sleutel = typeof b.sleutel === 'string' && /^[a-z]+:[\w:.@-]{1,600}$/i.test(b.sleutel) ? b.sleutel : null
      if (!id || !sleutel) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })
      const reden = typeof b.reden === 'string' && b.reden.trim() ? b.reden.trim().slice(0, 300) : null
      const { error } = await admin.from('mail_opvolging_afgehandeld').upsert({ opdracht_id: id, sleutel, reden, door: p.naam ?? p.email ?? null }, { onConflict: 'opdracht_id,sleutel' })
      if (error) throw new Error(error.message)
      await logAudit({ action: 'opdracht.opgevolgd', entityType: 'opdracht', entityId: id, summary: `Opvolging afgehandeld${reden ? `: ${reden}` : ''}`, actorUserId: p.userId, actorEmail: p.email, ...requestMeta(req) })
      try { revalidatePath('/admin') } catch { }
      return NextResponse.json({ ok: true })
    }
    if (b.actie === 'lezen') {
      const r = await leesMailEnAgenda(admin)
      try { revalidatePath('/admin') } catch { }
      return NextResponse.json({ ok: true, gekoppeld: r.gekoppeld, bewaard: r.mappen.reduce((s, m) => s + m.bewaard, 0), fouten: r.mappen.filter((m) => m.fout).map((m) => `${m.mailbox} (${m.map}): ${m.fout}`), meetings: r.meetings, agendaFout: r.agendaFout })
    }
    return NextResponse.json({ error: 'Onbekende actie.' }, { status: 400 })
  } catch (e) { return NextResponse.json({ error: safeMessage(e) }, { status: 400 }) }
}
