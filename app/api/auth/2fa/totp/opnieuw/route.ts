import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { safeMessage } from '@/lib/api-error'
import { startHerSetup } from '@/lib/twofa/kern'
import { wachtwoordMetLimiet } from '@/lib/twofa/server'
import { csrfFout, eigenAccount, logSecurity } from '@/lib/twofa/route'

export const dynamic = 'force-dynamic'

/**
 * POST { wachtwoord, code | herstelcode } — de app opnieuw instellen (nieuwe
 * telefoon) zonder de bescherming tussendoor te verliezen. Geeft een NIEUWE
 * QR-code; de oude app blijft werken tot /api/auth/2fa/totp/bevestig een code
 * uit de nieuwe app krijgt (≤ 15 min). Een gebruikte herstelcode is verbruikt.
 */
export async function POST(req: NextRequest) {
  try {
    const csrf = csrfFout(req); if (csrf) return csrf
    const g = await eigenAccount({ kernNodig: true })
    if (!g.ok) return g.res
    const b = (await req.json().catch(() => ({}))) as { wachtwoord?: unknown; code?: unknown; herstelcode?: unknown }
    const ww = await wachtwoordMetLimiet(g.sessie.user.id, g.sessie.user.email, b.wachtwoord)
    if (ww === 'te_veel') return NextResponse.json({ error: 'Te veel pogingen. Probeer het later opnieuw.' }, { status: 429 })
    const r = await startHerSetup(g.kern!, g.sessie.user.id, g.sessie.user.email ?? g.sessie.user.id, {
      wachtwoordOk: ww === 'ok',
      code: typeof b.code === 'string' ? b.code : null,
      herstelcode: typeof b.herstelcode === 'string' ? b.herstelcode : null,
    })
    if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
    logSecurity(req, g.sessie, g.rol, 'auth.2fa.opnieuw_gestart', 'Opnieuw instellen van de authenticator-app gestart')
    const qrSvg = await QRCode.toString(r.uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
    return NextResponse.json({ qrSvg, geheim: r.geheimLeesbaar }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
