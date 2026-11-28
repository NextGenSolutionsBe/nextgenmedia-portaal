import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, createAdminSupabaseClient } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { onboardingVan, zetStap } from '@/lib/team/rollen-server'

export const dynamic = 'force-dynamic'

/** Mijn onboarding: enkel de eigen checklist (werknemers). Een hoofdbeheerder heeft er geen. */
async function eigenStaffId(userId: string): Promise<string | null> {
  const { data } = await createAdminSupabaseClient().from('staff_members').select('id').eq('auth_user_id', userId).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

export async function GET() {
  const user = await requireStaff()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const id = await eigenStaffId(user.id)
  return NextResponse.json({ stappen: id ? await onboardingVan(createAdminSupabaseClient(), id) : [] })
}

export async function POST(req: NextRequest) {
  const user = await requireStaff()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const id = await eigenStaffId(user.id)
    if (!id) return NextResponse.json({ error: 'Je hebt geen onboarding.' }, { status: 400 })
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (typeof b?.stap !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.stap)) return NextResponse.json({ error: 'Onbekende stap.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const naam = String(user.user_metadata?.full_name ?? user.email ?? 'Medewerker')
    await zetStap(admin, id, b.stap, b.gedaan === true, naam)
    return NextResponse.json({ ok: true, stappen: await onboardingVan(admin, id) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
