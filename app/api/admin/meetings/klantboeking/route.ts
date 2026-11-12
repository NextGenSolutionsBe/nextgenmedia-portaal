import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { baseUrl } from '@/lib/email'
import { plannerRechten } from '@/lib/meetings/rechten'
import { datumLang, uur } from '@/lib/meetings/model'
import { leesKbInstellingen, bewaarKbInstellingen, berekenVrijeSlots, BoekingFout } from '@/lib/meetings/klantboeking-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Instellingen van de klantboeking (Meeting Inplanner → Klantboekingen).
 *  GET              → instellingen, publieke link, agenda's
 *  GET ?controle=1  → rekent de vrije momenten echt uit (zelfde code als de publieke pagina)
 *  POST             → { actief, agenda_id }
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const r = await plannerRechten()
    if (!r.persoon || !(r.meetings.bekijken || r.verkoop.bekijken)) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const instellingen = await leesKbInstellingen(admin)
    const { data: agendas } = await admin.from('sales_calendar_connections').select('id, name, status, active, provider, clickup_assignee_id').eq('active', true).order('name')
    let controle: { ok: boolean; aantal?: number; eerste?: string[]; fout?: string; detail?: string } | null = null
    if (req.nextUrl.searchParams.get('controle')) {
      try {
        const b = await berekenVrijeSlots(admin, { vers: true })
        controle = { ok: true, aantal: b.slots.length, eerste: b.slots.slice(0, 6).map((s) => `${datumLang(s)} om ${uur(s)}`) }
      } catch (e) {
        controle = e instanceof BoekingFout ? { ok: false, fout: e.publiek, detail: e.intern } : { ok: false, fout: safeMessage(e, 'klantboeking.controle') }
      }
    }
    return NextResponse.json({
      instellingen, link: `${baseUrl()}/boeken`, controle,
      agendas: ((agendas ?? []) as { id: string; name: string; status: string; provider: string; clickup_assignee_id: number | null }[])
        .filter((a) => a.provider === 'google').map((a) => ({ id: a.id, naam: a.name, gekoppeld: a.status === 'connected', clickup: !!a.clickup_assignee_id })),
      magAanpassen: r.meetings.aanpassen || r.verkoop.aanpassen,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'klantboeking.GET') }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const r = await plannerRechten()
    if (!r.persoon || !(r.meetings.aanpassen || r.verkoop.aanpassen)) return NextResponse.json({ error: 'Je mag de klantboeking niet instellen' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as { actief?: unknown; agenda_id?: unknown }
    const agenda = b.agenda_id ? String(b.agenda_id) : null
    if (agenda && !UUID.test(agenda)) return NextResponse.json({ error: 'Ongeldige agenda' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    await bewaarKbInstellingen(admin, { actief: b.actief !== false, agenda_id: agenda }, r.persoon.email)
    const { ip, userAgent } = requestMeta(req)
    await logAudit({ action: 'klantboeking.instellingen', entityType: 'app_settings', entityId: 'klantboeking', actorUserId: user.id, actorEmail: r.persoon.email, ip, userAgent, metadata: { actief: b.actief !== false, agenda_id: agenda } })
    return NextResponse.json({ ok: true, instellingen: await leesKbInstellingen(admin) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'klantboeking.POST') }, { status: 500 })
  }
}
