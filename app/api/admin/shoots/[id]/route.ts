import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { bewaarShoot, laadShoot, ShootFout, verwijderShoot, verzondenAan } from '@/lib/shoots/server'

export const dynamic = 'force-dynamic'

const fout = (e: unknown) => e instanceof ShootFout ? NextResponse.json({ error: e.message }, { status: e.status }) : NextResponse.json({ error: safeMessage(e, 'shoots') }, { status: 500 })
const ververs = () => { try { revalidatePath('/portal/social-media') } catch { /* geen cache */ } }

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const { id } = await params
  try {
    const admin = createAdminSupabaseClient()
    const shoot = await laadShoot(admin, id)
    return NextResponse.json({ shoot, verzonden: await verzondenAan(admin, id).catch(() => []) })
  } catch (e) { return fout(e) }
}

/** PATCH { client_id, plan, versie, briefing_pad? } — bewaren (enkel als niemand anders intussen bewaarde). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const { id } = await params
  try {
    const r = await bewaarShoot(createAdminSupabaseClient(), id, (await req.json().catch(() => ({}))) as Record<string, unknown>, { userId: user.id, email: user.email ?? null })
    ververs()
    return NextResponse.json({ ok: true, ...r })
  } catch (e) { return fout(e) }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const { id } = await params
  try {
    await verwijderShoot(createAdminSupabaseClient(), id)
    ververs()
    return NextResponse.json({ ok: true })
  } catch (e) { return fout(e) }
}
