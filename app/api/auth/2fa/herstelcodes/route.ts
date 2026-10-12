import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { nieuweHerstelcodes } from '@/lib/twofa/kern'
import { trekAndereSessiesIn, wachtwoordMetLimiet } from '@/lib/twofa/server'
import { csrfFout, eigenAccount, logSecurity } from '@/lib/twofa/route'
import { stuurBeveiligingsmelding } from '@/lib/twofa/meldingen'

export const dynamic = 'force-dynamic'

/**
 * POST { wachtwoord, code } — nieuwe herstelcodes. Vereist het wachtwoord én
 * een code uit de app (klanten: of een herstelcode, die dan verbruikt is).
 * Alle vorige codes vervallen meteen; de nieuwe worden één keer getoond en
 * enkel gehasht bewaard.
 */
export async function POST(req: NextRequest) {
  try {
    const csrf = csrfFout(req); if (csrf) return csrf
    const g = await eigenAccount({ kernNodig: true })
    if (!g.ok) return g.res
    const b = (await req.json().catch(() => ({}))) as { wachtwoord?: unknown; code?: unknown; herstelcode?: unknown }
    const ww = await wachtwoordMetLimiet(g.sessie.user.id, g.sessie.user.email, b.wachtwoord)
    if (ww === 'te_veel') return NextResponse.json({ error: 'Te veel pogingen. Probeer het later opnieuw.' }, { status: 429 })
    const r = await nieuweHerstelcodes(g.kern!, g.sessie.user.id, {
      wachtwoordOk: ww === 'ok',
      code: typeof b.code === 'string' ? b.code : null,
      herstelcode: g.rol === 'klant' && typeof b.herstelcode === 'string' ? b.herstelcode : null,
    })
    if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
    await trekAndereSessiesIn(g.sessie)
    logSecurity(req, g.sessie, g.rol, 'auth.2fa.herstelcodes_vernieuwd', 'Nieuwe herstelcodes aangemaakt (vorige ongeldig)')
    if (g.rol === 'klant') void stuurBeveiligingsmelding(g.sessie.user.email, 'herstelcodes')
    return NextResponse.json({ ok: true, herstelcodes: r.herstelcodes }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
