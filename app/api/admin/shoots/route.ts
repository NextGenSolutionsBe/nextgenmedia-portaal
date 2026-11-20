import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { isDatum } from '@/lib/shoots/model'
import { bewaarShoot, laadShoots, ShootFout, teamLijst } from '@/lib/shoots/server'

export const dynamic = 'force-dynamic'

const fout = (e: unknown) => e instanceof ShootFout ? NextResponse.json({ error: e.message }, { status: e.status }) : NextResponse.json({ error: safeMessage(e, 'shoots') }, { status: 500 })

/** GET ?van=&tot= — shoots voor de kalender (+ het team voor "Wie is erbij" met ?team=1). */
export async function GET(req: NextRequest) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const sp = req.nextUrl.searchParams
  const van = sp.get('van'), tot = sp.get('tot')
  try {
    const admin = createAdminSupabaseClient()
    if (sp.get('team') === '1') return NextResponse.json({ team: await teamLijst(admin) })
    if (!isDatum(van) || (tot && !isDatum(tot))) return NextResponse.json({ error: 'Kies een periode.' }, { status: 400 })
    return NextResponse.json({ shoots: await laadShoots(admin, { van, tot }) })
  } catch (e) { return fout(e) }
}

/** POST { client_id, plan, briefing_pad? } — nieuwe shoot. */
export async function POST(req: NextRequest) {
  const user = await requireStaff()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const r = await bewaarShoot(createAdminSupabaseClient(), null, (await req.json().catch(() => ({}))) as Record<string, unknown>, { userId: user.id, email: user.email ?? null })
    try { revalidatePath('/portal/social-media') } catch { /* geen cache */ }
    return NextResponse.json({ ok: true, ...r })
  } catch (e) { return fout(e) }
}
