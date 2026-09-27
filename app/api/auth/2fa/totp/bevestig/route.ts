import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { bevestigSetup } from '@/lib/twofa/kern'
import { markeerSessie, trekAndereSessiesIn } from '@/lib/twofa/server'
import { eigenAccount, logSecurity } from '@/lib/twofa/route'

export const dynamic = 'force-dynamic'

/**
 * POST { code } — de instelling bevestigen. PAS HIER wordt de app-2FA actief,
 * en enkel met een geldige code uit de app. Geeft de herstelcodes één keer
 * terug (in de databank staan enkel hun hashes). Andere sessies van dit account
 * worden ingetrokken: die zijn met een zwakkere factor aangemeld.
 */
export async function POST(req: NextRequest) {
  try {
    const g = await eigenAccount({ kernNodig: true })
    if (!g.ok) return g.res
    const { code } = (await req.json().catch(() => ({}))) as { code?: unknown }
    const r = await bevestigSetup(g.kern!, g.sessie.user.id, typeof code === 'string' ? code : '')
    if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
    // Deze sessie heeft net een geldige app-code getoond; een eventuele
    // "stel eerst een app in"-verplichting vervalt.
    if (g.sessie.sessionId) await markeerSessie(g.sessie.user.id, g.sessie.sessionId, 'totp', false)
    await trekAndereSessiesIn(g.sessie)
    logSecurity(req, g.sessie, g.rol, 'auth.2fa.totp_geactiveerd', 'Tweestapsverificatie met een authenticator-app ingeschakeld')
    return NextResponse.json({ ok: true, herstelcodes: r.herstelcodes }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
