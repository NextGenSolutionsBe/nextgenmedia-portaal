import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { leesPersoon } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { SolutionsKaartFout, solutionsKaarten, verhuisKaart, laatKaartStaan } from '@/lib/sales/solutions-kaarten-server'

export const dynamic = 'force-dynamic'

/**
 * Nieuwe werking (28 nov 2026): de Solutions-kaarten op Projecten. Enkel de
 * zaakvoerders beslissen per kaart: verhuizen naar de Pipeline of laten staan.
 *  GET                         → de kaarten (ook de al verhuisde)
 *  POST { actie: 'verhuis' | 'laten' | 'terug', id }
 */
export async function GET() {
  const p = await leesPersoon()
  if (!p?.isAdmin) return NextResponse.json({ error: 'Enkel voor de zaakvoerders' }, { status: 403 })
  try { return NextResponse.json({ kaarten: await solutionsKaarten(createAdminSupabaseClient()) }) }
  catch (e) { return NextResponse.json({ error: safeMessage(e, 'solutions-kaarten.GET') }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const p = await leesPersoon()
  if (!p?.isAdmin) return NextResponse.json({ error: 'Enkel voor de zaakvoerders' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as { actie?: string; id?: string }
    const admin = createAdminSupabaseClient()
    const id = String(b.id ?? '')
    let dealId: string | null = null
    if (b.actie === 'verhuis') dealId = await verhuisKaart(admin, id, p.naam ?? p.email)
    else if (b.actie === 'laten' || b.actie === 'terug') await laatKaartStaan(admin, id, b.actie === 'laten')
    else return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
    await logAudit({ action: `opdracht.solutions_${b.actie}`, entityType: 'opdracht', entityId: id, summary: b.actie === 'verhuis' ? 'Solutions-kaart verhuisd naar de Pipeline' : b.actie === 'laten' ? 'Solutions-kaart blijft op Projecten' : 'Keuze teruggezet', actorUserId: p.userId, actorEmail: p.email, metadata: { deal: dealId }, ...requestMeta(req) })
    try { revalidatePath('/admin/opdrachten'); revalidatePath('/admin/nextgensolutions') } catch { }
    return NextResponse.json({ ok: true, dealId })
  } catch (e) {
    if (e instanceof SolutionsKaartFout) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e, 'solutions-kaarten.POST') }, { status: 500 })
  }
}
