import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { schakelUit } from '@/lib/twofa/kern'
import { trekAndereSessiesIn, wachtwoordMetLimiet } from '@/lib/twofa/server'
import { csrfFout, eigenAccount, logSecurity } from '@/lib/twofa/route'
import { stuurBeveiligingsmelding } from '@/lib/twofa/meldingen'

export const dynamic = 'force-dynamic'

/**
 * POST { wachtwoord, code | herstelcode } — de eigen app loskoppelen. Vereist
 * het huidige wachtwoord ÉN een geldige app-code of herstelcode. Daarna zijn
 * het geheim en alle herstelcodes weg en worden andere sessies ingetrokken.
 * Intern koppelt het account bij de volgende login een nieuwe app; een klant
 * logt daarna weer in met enkel e-mail + wachtwoord (en krijgt een melding).
 */
export async function POST(req: NextRequest) {
  try {
    const csrf = csrfFout(req); if (csrf) return csrf
    const g = await eigenAccount({ kernNodig: true })
    if (!g.ok) return g.res
    const b = (await req.json().catch(() => ({}))) as { wachtwoord?: unknown; code?: unknown; herstelcode?: unknown }
    const ww = await wachtwoordMetLimiet(g.sessie.user.id, g.sessie.user.email, b.wachtwoord)
    if (ww === 'te_veel') return NextResponse.json({ error: 'Te veel pogingen. Probeer het later opnieuw.' }, { status: 429 })
    const r = await schakelUit(g.kern!, g.sessie.user.id, {
      wachtwoordOk: ww === 'ok',
      code: typeof b.code === 'string' ? b.code : null,
      herstelcode: typeof b.herstelcode === 'string' ? b.herstelcode : null,
    })
    if (!r.ok) {
      logSecurity(req, g.sessie, g.rol, 'auth.2fa.uitschakelen_mislukt', 'Poging om de app-2FA uit te schakelen mislukt')
      return NextResponse.json({ error: r.fout }, { status: r.status })
    }
    await trekAndereSessiesIn(g.sessie)
    if (g.rol === 'klant') {
      logSecurity(req, g.sessie, g.rol, 'auth.2fa.totp_uitgeschakeld', 'Tweestapsverificatie uitgeschakeld door de klant zelf')
      void stuurBeveiligingsmelding(g.sessie.user.email, 'uitgezet')
    } else {
      logSecurity(req, g.sessie, g.rol, 'auth.2fa.totp_uitgeschakeld', 'Tweestapsverificatie met een authenticator-app losgekoppeld (koppelt bij de volgende login een nieuwe app)')
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
