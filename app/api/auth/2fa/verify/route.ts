import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import { hashCode, safeEqual, MAX_ATTEMPTS, TWO_FA_COOKIE } from '@/lib/two-factor'
import { controleerFactor, FOUT_CODE } from '@/lib/twofa/kern'
import { appVerplichtVoor } from '@/lib/twofa/sessie'
import { huidigeSessie, interneRol, leesBeleid, maakKern, markeerSessie } from '@/lib/twofa/server'

export const dynamic = 'force-dynamic'

/**
 * POST { code } of { herstelcode } — de tweede stap van het inloggen.
 *
 *  · Staat een authenticator-app aan: enkel een app-code of een herstelcode.
 *    De mailcode telt dan NIET (anders zou een gestolen wachtwoord + mailbox volstaan).
 *  · Anders: de toegestuurde mailcode (zoals voorheen).
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
    // een nieuwe mailcode kunnen aanvragen en telkens opnieuw mogen raden.
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
    const appActief = !!(totp as { actief?: boolean } | null)?.actief
    let methode: 'mail' | 'totp' | 'herstelcode'
    let herstelcodesOver: number | undefined

    if (appActief) {
      const kern = maakKern()
      // Zonder sleutel kan de app-code niet gecontroleerd worden. NIET terugvallen
      // op de mailcode: dat zou de app-2FA stil verzwakken.
      if (!kern) return NextResponse.json({ error: 'Tweestapsverificatie is tijdelijk niet beschikbaar. Neem contact op met een beheerder.' }, { status: 503 })
      const r = await controleerFactor(kern, user.id, { code, herstelcode })
      if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
      methode = r.methode
      herstelcodesOver = r.herstelcodesOver
    } else {
      if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: 'Voer de 6-cijferige code in.' }, { status: 400 })
      const { data: row } = await admin
        .from('login_codes')
        .select('id, code_hash, expires_at, consumed_at, attempts')
        .eq('user_id', user.id).is('consumed_at', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (!row || new Date(row.expires_at).getTime() < Date.now()) {
        return NextResponse.json({ error: `${FOUT_CODE} Vraag een nieuwe code aan.` }, { status: 400 })
      }
      if ((row.attempts ?? 0) >= MAX_ATTEMPTS) {
        // Te vaak mis → code verbranden, zodat brute-force geen tweede kans krijgt.
        await admin.from('login_codes').update({ consumed_at: new Date().toISOString() }).eq('id', row.id)
        return NextResponse.json({ error: 'Te veel pogingen. Vraag een nieuwe code aan.' }, { status: 429 })
      }
      if (!safeEqual(await hashCode(code), row.code_hash)) {
        await admin.from('login_codes').update({ attempts: (row.attempts ?? 0) + 1 }).eq('id', row.id)
        return NextResponse.json({ error: FOUT_CODE }, { status: 400 })
      }
      // Correct → code eenmalig verbruiken (voorwaardelijk: twee gelijktijdige
      // pogingen met dezelfde code kunnen niet allebei slagen).
      const { data: verbruikt } = await admin.from('login_codes')
        .update({ consumed_at: new Date().toISOString() }).eq('id', row.id).is('consumed_at', null).select('id')
      if (!verbruikt?.length) return NextResponse.json({ error: FOUT_CODE }, { status: 400 })
      methode = 'mail'
    }

    // Vereist de rol een authenticator-app die nog niet ingesteld is? Dan mag de
    // sessie verder, maar enkel naar het instelscherm (middleware).
    const instellen = !appActief && appVerplichtVoor(role, await leesBeleid())
    await markeerSessie(user.id, sessie.sessionId, methode, instellen)

    // Loggen mag het inloggen NOOIT ophouden: niet awaiten en fouten slikken.
    void logAudit({
      action: methode === 'herstelcode' ? 'auth.2fa.herstelcode_gebruikt' : 'auth.2fa.verified',
      entityType: 'user', entityId: user.id,
      summary: methode === 'herstelcode'
        ? `Ingelogd met een herstelcode (${herstelcodesOver ?? 0} over)`
        : `Tweestapsverificatie geslaagd via ${methode === 'totp' ? 'authenticator-app' : 'mailcode'} (${role})`,
      actorUserId: user.id, actorEmail: user.email ?? null, actorRole: role,
      metadata: { methode }, ip: meta.ip, userAgent: meta.userAgent,
    }).catch(() => { /* audit is bijzaak */ })

    const res = NextResponse.json({ ok: true, methode, herstelcodesOver, instellen })
    // Het oude verificatiecookie heeft geen betekenis meer; opruimen.
    res.cookies.set(TWO_FA_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
    return res
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
