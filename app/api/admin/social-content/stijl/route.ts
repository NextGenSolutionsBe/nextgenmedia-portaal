import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { StijlFout, leesKalenderStijl, stijlActie } from '@/lib/content/kalender-stijl-server'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Het team: labels en fasekleuren van een klantkalender (dezelfde die de klant ziet). */
export async function GET(req: NextRequest) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const clientId = req.nextUrl.searchParams.get('client_id') ?? ''
    if (!UUID.test(clientId)) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })
    return NextResponse.json({ stijl: await leesKalenderStijl(createAdminSupabaseClient(), clientId) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  const ik = await requireStaff()
  if (!ik) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const clientId = typeof b.client_id === 'string' && UUID.test(b.client_id) ? b.client_id : null
    if (!clientId) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: klant } = await admin.from('clients').select('id').eq('id', clientId).maybeSingle()
    if (!klant) return NextResponse.json({ error: 'Klant niet gevonden.' }, { status: 404 })
    const uit = await stijlActie(admin, clientId, b, ik.email ?? null)
    if (b.actie !== 'item_labels') {
      const meta = requestMeta(req)
      await logAudit({ action: `content.kalender.${String(b.actie)}`, entityType: 'client', entityId: clientId, summary: `Contentkalender: ${String(b.actie)}${b.naam ? ` "${String(b.naam)}"` : ''}`, actorUserId: ik.id, actorEmail: ik.email ?? null, actorRole: 'staff', ip: meta.ip, userAgent: meta.userAgent })
    }
    try { revalidatePath('/portal/social-media') } catch { }
    return NextResponse.json({ ok: true, ...uit })
  } catch (err) {
    if (err instanceof StijlFout) return NextResponse.json({ error: err.message }, { status: err.status })
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
