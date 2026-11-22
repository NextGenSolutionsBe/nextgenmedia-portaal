import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { leesAdminIdentiteit } from '@/lib/admin-identiteit'
import { NgsFout, laadNgs, maakDeal, notities, verplaatsDeal, verwijderDeal, voegNotitieToe, wijzigDeal } from '@/lib/ngs/server'

export const dynamic = 'force-dynamic'

/**
 * NextGenSolutions-pipeline. Toegang: module nextgensolutions (middleware per methode) en actief teamlid.
 *  GET            → alle deals en de opvolgtaken (laatst gekend)
 *  GET ?deal=<id> → de notities van één deal
 *  POST { actie: 'nieuw' | 'wijzig' | 'verplaats' | 'verwijder' | 'notitie', … }
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function wie(user: { email?: string | null }) {
  const ident = await leesAdminIdentiteit().catch(() => null)
  return ident?.naam || user.email || null
}

export async function GET(req: NextRequest) {
  const user = await requireStaff()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const admin = createAdminSupabaseClient()
    const deal = req.nextUrl.searchParams.get('deal')
    if (deal) return NextResponse.json({ notities: await notities(admin, deal) })
    return NextResponse.json(await laadNgs(admin, await wie(user)), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'ngs.GET') }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const user = await requireStaff()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const admin = createAdminSupabaseClient()
    const door = await wie(user)
    const id = typeof b.id === 'string' && UUID.test(b.id) ? b.id : null
    const moetId = () => { if (!id) throw new NgsFout('Deal niet gevonden.', 404); return id }
    let antwoord: Record<string, unknown> = { ok: true }
    let samenvatting = ''
    switch (b.actie) {
      case 'nieuw': { const nieuw = await maakDeal(admin, b, door); antwoord = { ok: true, id: nieuw }; samenvatting = `Deal ${String(b.bedrijf ?? '')}`; b.id = nieuw; break }
      case 'wijzig': await wijzigDeal(admin, moetId(), b, door); samenvatting = 'Deal aangepast'; break
      case 'verplaats': { const d = await verplaatsDeal(admin, moetId(), b, door); antwoord = { ok: true, deal: d }; samenvatting = `Naar ${d.fase}`; break }
      case 'verwijder': await verwijderDeal(admin, moetId(), door); samenvatting = 'Deal verwijderd'; break
      case 'notitie': await voegNotitieToe(admin, moetId(), b.tekst, door); samenvatting = 'Notitie'; break
      default: throw new NgsFout('Onbekende actie.')
    }
    const meta = requestMeta(req)
    await logAudit({ action: `ngs.${String(b.actie)}`, entityType: 'ngs_deal', entityId: typeof b.id === 'string' ? b.id : null, summary: samenvatting.slice(0, 300), actorUserId: user.id, actorEmail: user.email ?? null, ip: meta.ip, userAgent: meta.userAgent })
    try { revalidatePath('/admin/nextgensolutions') } catch { }
    return NextResponse.json(antwoord)
  } catch (e) {
    if (e instanceof NgsFout) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e, 'ngs.POST') }, { status: 500 })
  }
}
