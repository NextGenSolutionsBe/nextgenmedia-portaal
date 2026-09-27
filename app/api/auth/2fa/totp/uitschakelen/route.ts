import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { schakelUit } from '@/lib/twofa/kern'
import { trekAndereSessiesIn, wachtwoordKlopt } from '@/lib/twofa/server'
import { eigenAccount, logSecurity } from '@/lib/twofa/route'

export const dynamic = 'force-dynamic'

/**
 * POST { wachtwoord, code | herstelcode } — de eigen app loskoppelen (nieuwe
 * telefoon). Vereist het huidige wachtwoord ÉN een geldige app-code of
 * herstelcode. Daarna zijn het geheim en alle herstelcodes weg en worden andere
 * sessies ingetrokken; bij de volgende login koppelt het account een nieuwe app.
 */
export async function POST(req: NextRequest) {
  try {
    const g = await eigenAccount({ kernNodig: true })
    if (!g.ok) return g.res
    const b = (await req.json().catch(() => ({}))) as { wachtwoord?: unknown; code?: unknown; herstelcode?: unknown }
    const wachtwoordOk = await wachtwoordKlopt(g.sessie.user.email, b.wachtwoord)
    const r = await schakelUit(g.kern!, g.sessie.user.id, {
      wachtwoordOk,
      code: typeof b.code === 'string' ? b.code : null,
      herstelcode: typeof b.herstelcode === 'string' ? b.herstelcode : null,
    })
    if (!r.ok) {
      logSecurity(req, g.sessie, g.rol, 'auth.2fa.uitschakelen_mislukt', 'Poging om de app-2FA uit te schakelen mislukt')
      return NextResponse.json({ error: r.fout }, { status: r.status })
    }
    await trekAndereSessiesIn(g.sessie)
    logSecurity(req, g.sessie, g.rol, 'auth.2fa.totp_uitgeschakeld', 'Tweestapsverificatie met een authenticator-app losgekoppeld (koppelt bij de volgende login een nieuwe app)')
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
