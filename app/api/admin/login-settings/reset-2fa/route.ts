import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { requireAdmin } from '@/lib/supabase/server'
import { resetVoorAnder } from '@/lib/twofa/kern'
import { wachtwoordKlopt, wisAlleSessies } from '@/lib/twofa/server'
import { eigenAccount, logSecurity } from '@/lib/twofa/route'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST { authUserId, wachtwoord, code } — herstelpad als iemand zijn telefoon
 * ÉN zijn herstelcodes kwijt is. Enkel een admin, en enkel met het EIGEN
 * wachtwoord én de EIGEN app-code (de admin moet zelf app-2FA hebben). Nooit
 * voor het eigen account. Gevolg: de app-2FA van die persoon is weg, zijn
 * sessies moeten opnieuw door de tweede stap (mailcode), en daarna stelt hij
 * een nieuwe app in. Komt in het logboek.
 */
export async function POST(req: NextRequest) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const g = await eigenAccount({ kernNodig: true })
    if (!g.ok) return g.res
    const b = (await req.json().catch(() => ({}))) as { authUserId?: unknown; wachtwoord?: unknown; code?: unknown }
    const doel = String(b.authUserId ?? '')
    if (!UUID.test(doel)) return NextResponse.json({ error: 'Ongeldig account' }, { status: 400 })
    const wachtwoordOk = await wachtwoordKlopt(g.sessie.user.email, b.wachtwoord)
    const r = await resetVoorAnder(g.kern!, g.sessie.user.id, doel, { wachtwoordOk, code: typeof b.code === 'string' ? b.code : null })
    if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
    await wisAlleSessies(doel)
    logSecurity(req, g.sessie, g.rol, 'auth.2fa.reset_door_admin', 'App-2FA van een ander account gereset (telefoon en herstelcodes kwijt)', { entityId: doel })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
