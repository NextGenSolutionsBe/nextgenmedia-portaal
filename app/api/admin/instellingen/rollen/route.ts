import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { eisBeheer, eisHoofdbeheerder } from '@/lib/instellingen/api'
import { controleerSjabloon } from '@/lib/team/rollen'
import { laadSjablonen, bewaarSjabloon } from '@/lib/team/rollen-server'

export const dynamic = 'force-dynamic'

// GET — de rolsjablonen (ook de uitgezette, om ze terug aan te zetten).
export async function GET() {
  try {
    const g = await eisBeheer(); if (!g.ok) return g.response
    return NextResponse.json({ sjablonen: await laadSjablonen(createAdminSupabaseClient(), true) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — een sjabloon bewaren (nieuw of aangepast). Verwijderen bestaat niet: uitzetten kan.
export async function POST(req: NextRequest) {
  try {
    const g = await eisHoofdbeheerder(); if (!g.ok) return g.response
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!b) return NextResponse.json({ error: 'Ongeldige gegevens.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const alle = await laadSjablonen(admin, true)
    const bestaand = typeof b.key === 'string' ? alle.find((s) => s.key === b.key) ?? null : null
    if (b.nieuw === true && bestaand) return NextResponse.json({ error: 'Er bestaat al een sjabloon met die sleutel.' }, { status: 409 })
    const c = controleerSjabloon(b, b.nieuw === true ? null : bestaand)
    if (!c.ok) return NextResponse.json({ error: c.fout }, { status: 400 })
    await bewaarSjabloon(admin, c.sjabloon, g.persoon.email)
    const meta = requestMeta(req)
    await logAudit({
      action: bestaand ? 'rol_sjabloon.gewijzigd' : 'rol_sjabloon.nieuw', entityType: 'rol_sjabloon', entityId: c.sjabloon.key,
      summary: `Rolsjabloon ${bestaand ? 'aangepast' : 'toegevoegd'}: ${c.sjabloon.naam}`,
      actorUserId: g.persoon.userId, actorEmail: g.persoon.email, actorRole: 'admin',
      metadata: { rol: c.sjabloon.rol, modules: c.sjabloon.modules, bedrijven: c.sjabloon.bedrijven, actief: c.sjabloon.actief }, ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true, sjabloon: c.sjabloon })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
