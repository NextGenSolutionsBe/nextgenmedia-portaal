import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { herbevestigAdmin } from '@/lib/twofa/kern'
import { wachtwoordKlopt, wisAlleSessies } from '@/lib/twofa/server'
import { eigenAccount, logSecurity } from '@/lib/twofa/route'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST { authUserId, wachtwoord, code? } — een admin zet de tweestaps-
 * verificatie van een WERKNEMER volledig uit: een eventuele authenticator-app
 * en herstelcodes worden verwijderd en de code bij het inloggen vervalt.
 *
 *  · enkel admins, enkel voor werknemers (niet voor admins, niet voor jezelf)
 *  · de admin bevestigt met het eigen wachtwoord, plus de eigen app-code als
 *    die admin zelf een authenticator-app heeft
 *  · komt in het logboek; weer aanzetten kan met één klik ("Met code")
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const g = await eigenAccount({ kernNodig: true })
    if (!g.ok) return g.res
    const b = (await req.json().catch(() => ({}))) as { authUserId?: unknown; wachtwoord?: unknown; code?: unknown }
    const doel = String(b.authUserId ?? '')
    if (!UUID.test(doel)) return NextResponse.json({ error: 'Ongeldig account' }, { status: 400 })
    if (doel === actor.id) return NextResponse.json({ error: 'Je kunt je eigen 2FA hier niet uitzetten. Gebruik Mijn account.' }, { status: 400 })

    const db = createAdminSupabaseClient()
    const [{ data: rol }, { data: staff }] = await Promise.all([
      db.from('user_roles').select('role').eq('user_id', doel).maybeSingle(),
      db.from('staff_members').select('id, name, email').eq('auth_user_id', doel).maybeSingle(),
    ])
    if ((rol as { role?: string } | null)?.role === 'admin') return NextResponse.json({ error: 'Dit kan enkel voor werknemers, niet voor een admin.' }, { status: 400 })
    if (!staff) return NextResponse.json({ error: 'Dit is geen werknemersaccount.' }, { status: 400 })

    const wachtwoordOk = await wachtwoordKlopt(g.sessie.user.email, b.wachtwoord)
    const r = await herbevestigAdmin(g.kern!, actor.id, { wachtwoordOk, code: typeof b.code === 'string' ? b.code : null })
    if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })

    const { data: app } = await db.from('user_totp').select('actief').eq('user_id', doel).maybeSingle()
    const hadApp = !!(app as { actief?: boolean } | null)?.actief
    await g.kern!.opslag.verwijder(doel)
    await g.kern!.opslag.vervangHerstelcodes(doel, [])
    const { error } = await db.from('login_settings').upsert({
      auth_user_id: doel, two_factor_required: false,
      note: '2FA uitgezet door een admin', updated_by: actor.id, updated_at: new Date().toISOString(),
    }, { onConflict: 'auth_user_id' })
    if (error) throw new Error(error.message)
    // Oude 2FA-markeringen hebben geen betekenis meer; opruimen.
    await wisAlleSessies(doel)

    const s = staff as { name?: string | null; email?: string | null }
    logSecurity(req, g.sessie, g.rol, 'auth.2fa.uitgezet_door_admin',
      `2FA uitgezet voor werknemer ${s.name || s.email || doel}${hadApp ? ' (authenticator-app verwijderd)' : ''}`,
      { entityId: doel, metadata: { hadApp } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
