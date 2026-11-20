import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { leesProfiel } from '@/lib/account-server'
import { RegelsFout, laadVestingRegels, nieuweVestingRegels, tekenVestingRegels, vestingRegelsGeschiedenis } from '@/lib/vesting-regels-server'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Regels vesting. Enkel admins. GET = geldende versie (?regels=alle = alle versies); POST { actie: 'regels' | 'teken' }. */
export async function GET(req: NextRequest) {
  const ik = await requireAdmin()
  if (!ik) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const admin = createAdminSupabaseClient()
    if (req.nextUrl.searchParams.get('regels') === 'alle') return NextResponse.json({ versies: await vestingRegelsGeschiedenis(admin) })
    return NextResponse.json(await laadVestingRegels(admin, ik.id))
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'vesting.regels.GET') }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const ik = await requireAdmin()
  if (!ik) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const admin = createAdminSupabaseClient()
    const meta = requestMeta(req)
    const profiel = await leesProfiel(ik).catch(() => null)
    const naam = (profiel ? `${profiel.voornaam} ${profiel.achternaam}`.trim() : '') || ik.email || null
    let samenvatting = ''
    if (b.actie === 'regels') {
      const v = await nieuweVestingRegels(admin, b, naam)
      samenvatting = `Regels vesting: versie ${v.versie}`
    } else if (b.actie === 'teken') {
      const id = typeof b.id === 'string' && UUID.test(b.id) ? b.id : null
      if (!id) throw new RegelsFout('Ongeldige vraag.')
      await tekenVestingRegels(admin, id, { userId: ik.id, email: ik.email ?? null, naam, handtekening: b.handtekening, ip: meta.ip, ua: meta.userAgent })
      samenvatting = 'Regels vesting getekend'
    } else throw new RegelsFout('Onbekende actie.')
    await logAudit({ action: `vesting.regels.${String(b.actie)}`, entityType: 'vesting_regels', entityId: null, summary: samenvatting, actorUserId: ik.id, actorEmail: ik.email ?? null, ip: meta.ip, userAgent: meta.userAgent }).catch(() => null)
    revalidatePath('/admin/vesting')
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof RegelsFout) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e, 'vesting.regels.POST') }, { status: 500 })
  }
}
