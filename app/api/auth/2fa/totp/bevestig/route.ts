import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { bevestigHerSetup, bevestigSetup } from '@/lib/twofa/kern'
import { markeerSessie, trekAndereSessiesIn } from '@/lib/twofa/server'
import { csrfFout, eigenAccount, logSecurity } from '@/lib/twofa/route'
import { stuurBeveiligingsmelding } from '@/lib/twofa/meldingen'

export const dynamic = 'force-dynamic'

/**
 * POST { code } — de instelling bevestigen. PAS HIER wordt de app-2FA actief,
 * en enkel met een geldige code uit de app. Geeft de herstelcodes één keer
 * terug (in de databank staan enkel hun hashes). Andere sessies van dit account
 * worden ingetrokken: die zijn met een zwakkere factor aangemeld.
 * Loopt er een "opnieuw instellen" (app al actief + nieuwe setup), dan vervangt
 * een code uit de NIEUWE app het oude geheim.
 */
export async function POST(req: NextRequest) {
  try {
    const csrf = csrfFout(req); if (csrf) return csrf
    const g = await eigenAccount({ kernNodig: true, koppelenBijInloggen: true })
    if (!g.ok) return g.res
    const { code } = (await req.json().catch(() => ({}))) as { code?: unknown }
    const invoer = typeof code === 'string' ? code : ''
    const opnieuw = !!(await g.kern!.opslag.lees(g.sessie.user.id))?.actief
    const r = opnieuw
      ? await bevestigHerSetup(g.kern!, g.sessie.user.id, invoer)
      : await bevestigSetup(g.kern!, g.sessie.user.id, invoer)
    if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
    // Deze sessie heeft net een geldige app-code getoond: de tweede stap is voltooid
    // (ook als dit het koppelen tijdens het inloggen was).
    if (g.sessie.sessionId) await markeerSessie(g.sessie.user.id, g.sessie.sessionId, 'totp')
    await trekAndereSessiesIn(g.sessie)
    if (opnieuw) logSecurity(req, g.sessie, g.rol, 'auth.2fa.totp_opnieuw', 'Authenticator-app opnieuw ingesteld (vorige app en herstelcodes ongeldig)')
    else logSecurity(req, g.sessie, g.rol, 'auth.2fa.totp_geactiveerd', 'Tweestapsverificatie met een authenticator-app ingeschakeld')
    if (g.rol === 'klant') void stuurBeveiligingsmelding(g.sessie.user.email, opnieuw ? 'opnieuw' : 'aangezet')
    return NextResponse.json({ ok: true, herstelcodes: r.herstelcodes }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
