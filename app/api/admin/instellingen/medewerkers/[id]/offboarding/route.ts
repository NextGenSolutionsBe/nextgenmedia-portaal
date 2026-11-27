import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { eisHoofdbeheerder } from '@/lib/instellingen/api'
import { isAdminId } from '@/lib/instellingen/medewerkers'
import { offboardingVan, offboarden } from '@/lib/team/rollen-server'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f-]{36}$/i

// GET — wat er bij het vertrek nog openstaat (enkel lezen).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await eisHoofdbeheerder(); if (!g.ok) return g.response
    const { id } = await params
    if (isAdminId(id) || !UUID.test(id)) return NextResponse.json({ error: 'Offboarding is er enkel voor werknemers.' }, { status: 400 })
    return NextResponse.json(await offboardingVan(createAdminSupabaseClient(), id))
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — vertrek vastleggen: einddatum, login blokkeren, agenda-abonnementen intrekken. Niets wordt verwijderd.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await eisHoofdbeheerder(); if (!g.ok) return g.response
    const { id } = await params
    if (isAdminId(id) || !UUID.test(id)) return NextResponse.json({ error: 'Offboarding is er enkel voor werknemers.' }, { status: 400 })
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const eind = typeof b?.eind_datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.eind_datum) ? b.eind_datum : null
    const notitie = typeof b?.notitie === 'string' ? b.notitie.trim().slice(0, 1000) || null : null
    const admin = createAdminSupabaseClient()
    const gedaan = await offboarden(admin, id, { eind_datum: eind, notitie, blokkeren: b?.blokkeren === true, icalIntrekken: b?.ical_intrekken === true }, g.persoon.naam ?? g.persoon.email, g.persoon.userId)
    const meta = requestMeta(req)
    await logAudit({
      action: 'staff.offboarding', entityType: 'staff_member', entityId: id, summary: `Vertrek vastgelegd (${gedaan.join(', ') || 'enkel een notitie'})`,
      actorUserId: g.persoon.userId, actorEmail: g.persoon.email, actorRole: 'admin', metadata: { gedaan }, ip: meta.ip, userAgent: meta.userAgent,
    })
    try { revalidatePath('/admin/instellingen') } catch { /* */ }
    return NextResponse.json({ ok: true, gedaan, ...(await offboardingVan(admin, id)) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
