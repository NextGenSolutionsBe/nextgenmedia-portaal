import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { eisBeheer, eisHoofdbeheerder } from '@/lib/instellingen/api'
import { isAdminId } from '@/lib/instellingen/medewerkers'
import { onboardingVan, stappenToevoegen, zetStap, laadSjablonen } from '@/lib/team/rollen-server'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f-]{36}$/i

// GET — de onboarding-checklist van een medewerker.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await eisBeheer(); if (!g.ok) return g.response
    const { id } = await params
    if (isAdminId(id) || !UUID.test(id)) return NextResponse.json({ stappen: [] })
    return NextResponse.json({ stappen: await onboardingVan(createAdminSupabaseClient(), id) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — { actie: 'zet', stap, gedaan } | { actie: 'erbij', titel } | { actie: 'sjabloon', sjabloon }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await eisHoofdbeheerder(); if (!g.ok) return g.response
    const { id } = await params
    if (isAdminId(id) || !UUID.test(id)) return NextResponse.json({ error: 'Onboarding is er enkel voor werknemers.' }, { status: 400 })
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const admin = createAdminSupabaseClient()
    const door = g.persoon.naam ?? g.persoon.email
    if (b?.actie === 'zet' && typeof b.stap === 'string' && UUID.test(b.stap)) {
      await zetStap(admin, id, b.stap, b.gedaan === true, door)
    } else if (b?.actie === 'erbij' && typeof b.titel === 'string' && b.titel.trim()) {
      await stappenToevoegen(admin, id, [b.titel])
    } else if (b?.actie === 'sjabloon' && typeof b.sjabloon === 'string') {
      const s = (await laadSjablonen(admin, true)).find((x) => x.key === b.sjabloon)
      if (!s) return NextResponse.json({ error: 'Onbekend sjabloon.' }, { status: 400 })
      const n = await stappenToevoegen(admin, id, s.onboarding)
      const meta = requestMeta(req)
      await logAudit({ action: 'onboarding.sjabloon', entityType: 'staff_member', entityId: id, summary: `Onboarding uit sjabloon ${s.naam} (${n} stappen erbij)`, actorUserId: g.persoon.userId, actorEmail: g.persoon.email, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent })
    } else return NextResponse.json({ error: 'Onbekende actie.' }, { status: 400 })
    return NextResponse.json({ ok: true, stappen: await onboardingVan(admin, id) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
