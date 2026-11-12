import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, getSessionUser } from '@/lib/supabase/server'
import { resolvePortalSession, logPortalAction } from '@/lib/portal-auth'
import { controleerWachtwoord } from '@/lib/account-server'
import { controleerNieuwWachtwoord } from '@/lib/klant-account'

export const dynamic = 'force-dynamic'

/**
 * POST { huidig, nieuw } — de ingelogde klant wijzigt zijn eigen wachtwoord.
 * Enkel met het huidige wachtwoord; geldt altijd en enkel voor het eigen account.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await resolvePortalSession()
    if (!session || !session.active) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const user = await getSessionUser()
    if (!user?.email || user.id !== session.userId) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as { huidig?: unknown; nieuw?: unknown }
    const huidig = String(b.huidig ?? ''), nieuw = String(b.nieuw ?? '')
    const f = controleerNieuwWachtwoord(nieuw, user.email)
    if (f) return NextResponse.json({ error: f }, { status: 400 })
    if (nieuw === huidig) return NextResponse.json({ error: 'Kies een ander wachtwoord dan je huidige.' }, { status: 400 })
    if (!(await controleerWachtwoord(user.email, huidig))) return NextResponse.json({ error: 'Je huidige wachtwoord klopt niet.' }, { status: 400 })
    const { error } = await createAdminSupabaseClient().auth.admin.updateUserById(user.id, { password: nieuw })
    if (error) return NextResponse.json({ error: 'Bewaren mislukt. Probeer het zo opnieuw.' }, { status: 400 })
    await logPortalAction(session, 'portal.wachtwoord_gewijzigd', { type: 'auth_user', id: user.id }, { req })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Er ging iets mis. Probeer het zo opnieuw.' }, { status: 500 })
  }
}
