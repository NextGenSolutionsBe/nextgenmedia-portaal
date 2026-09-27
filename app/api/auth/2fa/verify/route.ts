import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import { TWO_FA_COOKIE } from '@/lib/two-factor'
import { controleerFactor } from '@/lib/twofa/kern'
import { huidigeSessie, interneRol, maakKern, markeerSessie } from '@/lib/twofa/server'

export const dynamic = 'force-dynamic'

/**
 * POST { code } of { herstelcode } — de tweede stap van het inloggen: een code
 * uit de authenticator-app of een herstelcode. (Een mailcode bestaat niet meer;
 * wie nog geen app heeft, koppelt er eerst een via /api/auth/2fa/totp/*.)
 *
 * Bij succes wordt DEZE Supabase-sessie (session_id uit de JWT) gemarkeerd in
 * twofa_sessies. De middleware, de route-guards en de RLS lezen die rij; niets
 * in de browser (cookie, state, parameter) kan dat nabootsen.
 */
export async function POST(req: NextRequest) {
  try {
    const sessie = await huidigeSessie()
    if (!sessie) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    if (!sessie.sessionId) return NextResponse.json({ error: 'Je sessie is ongeldig. Log opnieuw in.' }, { status: 401 })
    const user = sessie.user

    const role = await interneRol(user.id)
    if (!role) return NextResponse.json({ error: 'Niet van toepassing' }, { status: 403 })

    // Rem per IP bovenop de rem per account: zonder deze rem zou iemand steeds
    // eindeloos codes kunnen raden vanaf verschillende accounts.
    const ip = clientIp(req)
    const rl = await rateLimit(`2fa-verify:${ip}`, { limit: 20, windowSec: 15 * 60, failClosed: true })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Te veel pogingen. Probeer het over een kwartier opnieuw.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      )
    }

    const body = (await req.json().catch(() => ({}))) as { code?: unknown; herstelcode?: unknown }
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const herstelcode = typeof body.herstelcode === 'string' ? body.herstelcode.trim() : ''
    const admin = createAdminSupabaseClient()
    const meta = requestMeta(req)

    const { data: totp } = await admin.from('user_totp').select('actief').eq('user_id', user.id).maybeSingle()
    if (!(totp as { actief?: boolean } | null)?.actief) {
      // Nog geen app: die wordt op het verificatiescherm eerst gekoppeld
      // (setup + bevestigen). Een mailcode bestaat niet meer.
      return NextResponse.json({ error: 'Koppel eerst een authenticator-app.', code: 'koppelen' }, { status: 409 })
    }
    const kern = maakKern()
    if (!kern) return NextResponse.json({ error: 'Tweestapsverificatie is tijdelijk niet beschikbaar. Neem contact op met een beheerder.' }, { status: 503 })
    const r = await controleerFactor(kern, user.id, { code, herstelcode })
    if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
    const methode = r.methode
    const herstelcodesOver = r.herstelcodesOver
    await markeerSessie(user.id, sessie.sessionId, methode)

    // Loggen mag het inloggen NOOIT ophouden: niet awaiten en fouten slikken.
    void logAudit({
      action: methode === 'herstelcode' ? 'auth.2fa.herstelcode_gebruikt' : 'auth.2fa.verified',
      entityType: 'user', entityId: user.id,
      summary: methode === 'herstelcode'
        ? `Ingelogd met een herstelcode (${herstelcodesOver ?? 0} over)`
        : `Tweestapsverificatie geslaagd via de authenticator-app (${role})`,
      actorUserId: user.id, actorEmail: user.email ?? null, actorRole: role,
      metadata: { methode }, ip: meta.ip, userAgent: meta.userAgent,
    }).catch(() => { /* audit is bijzaak */ })

    const res = NextResponse.json({ ok: true, methode, herstelcodesOver })
    // Het oude verificatiecookie heeft geen betekenis meer; opruimen.
    res.cookies.set(TWO_FA_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
    return res
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
