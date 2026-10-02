import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { nieuweHerstelcodes } from '@/lib/twofa/kern'
import { trekAndereSessiesIn, wachtwoordKlopt } from '@/lib/twofa/server'
import { eigenAccount, logSecurity } from '@/lib/twofa/route'

export const dynamic = 'force-dynamic'

/**
 * POST { wachtwoord, code } — nieuwe herstelcodes. Vereist het wachtwoord én
 * een code uit de app. Alle vorige codes vervallen meteen; de nieuwe worden
 * één keer getoond en enkel gehasht bewaard.
 */
export async function POST(req: NextRequest) {
  try {
    const g = await eigenAccount({ kernNodig: true })
    if (!g.ok) return g.res
    const b = (await req.json().catch(() => ({}))) as { wachtwoord?: unknown; code?: unknown }
    const wachtwoordOk = await wachtwoordKlopt(g.sessie.user.email, b.wachtwoord)
    const r = await nieuweHerstelcodes(g.kern!, g.sessie.user.id, { wachtwoordOk, code: typeof b.code === 'string' ? b.code : null })
    if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
    await trekAndereSessiesIn(g.sessie)
    logSecurity(req, g.sessie, g.rol, 'auth.2fa.herstelcodes_vernieuwd', 'Nieuwe herstelcodes aangemaakt (vorige ongeldig)')
    return NextResponse.json({ ok: true, herstelcodes: r.herstelcodes }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
