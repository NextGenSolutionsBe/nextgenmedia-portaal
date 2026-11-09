import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { TegentekenFout, tegenteken } from '@/lib/contracten/tegenhandtekening-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST { handtekening (PNG data-URL), zone { page, x, y, w, h }, naam }
 * Een zaakvoerder (admin) tekent het contract namens NextGenMedia, na de klant.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ik = await requireAdmin()
  if (!ik) return NextResponse.json({ error: 'Enkel een zaakvoerder kan namens NextGenMedia tekenen.' }, { status: 403 })
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Ongeldig contract.' }, { status: 400 })
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const meta = requestMeta(req)
    const admin = createAdminSupabaseClient()
    const uit = await tegenteken(admin, params.id, {
      handtekening: b.handtekening, zone: b.zone, naam: b.naam,
      door: { userId: ik.id, email: ik.email ?? null }, ip: meta.ip, ua: meta.userAgent,
    })
    await logAudit({
      action: 'contract.tegengetekend', entityType: 'contract', entityId: params.id,
      summary: `Contract ondertekend namens NextGenMedia door ${String(b.naam ?? '')}`,
      actorUserId: ik.id, actorEmail: ik.email ?? null, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent,
      metadata: { archief_versie: uit.archiefVersie, certificaat_nr: uit.certificaatNr },
    })
    try {
      revalidatePath('/admin/contracts'); revalidatePath(`/admin/contracts/${params.id}`)
      revalidatePath('/portal/contracts'); revalidatePath('/portal'); revalidatePath('/admin')
    } catch { }
    return NextResponse.json({ ok: true, ...uit })
  } catch (e) {
    if (e instanceof TegentekenFout) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e, 'Tekenen mislukt') }, { status: 500 })
  }
}
