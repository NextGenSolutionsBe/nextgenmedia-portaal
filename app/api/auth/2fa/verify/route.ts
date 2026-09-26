import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient, isActiveStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import {
  hashCode, safeEqual, createToken, TWO_FA_COOKIE, SESSION_TTL_MS, MAX_ATTEMPTS,
} from '@/lib/two-factor'

export const dynamic = 'force-dynamic'

async function internalRole(userId: string): Promise<'admin' | 'employee' | null> {
  const admin = createAdminSupabaseClient()
  const { data } = await admin.from('user_roles').select('role').eq('user_id', userId).maybeSingle()
  if (data?.role === 'admin') return 'admin'
  return (await isActiveStaff(userId)) ? 'employee' : null
}

// POST — code controleren. Bij succes wordt een ondertekend, httpOnly cookie
// gezet dat bewijst dat DEZE gebruiker de code heeft ingevoerd.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

    const role = await internalRole(user.id)
    if (!role) return NextResponse.json({ error: 'Niet van toepassing' }, { status: 403 })

    // Rem per IP bovenop de 5 pogingen per code: zonder deze rem zou iemand
    // steeds een nieuwe code kunnen aanvragen en telkens 5 keer mogen raden.
    const ip = clientIp(req)
    const rl = await rateLimit(`2fa-verify:${ip}`, { limit: 20, windowSec: 15 * 60 })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Te veel pogingen. Probeer het over een kwartier opnieuw.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      )
    }

    const { code } = await req.json()
    const entered = String(code ?? '').trim()
    if (!/^\d{6}$/.test(entered)) return NextResponse.json({ error: 'Voer de 6-cijferige code in.' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: row } = await admin
      .from('login_codes')
      .select('id, code_hash, expires_at, consumed_at, attempts')
      .eq('user_id', user.id).is('consumed_at', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()

    if (!row) return NextResponse.json({ error: 'Geen geldige code. Vraag een nieuwe aan.' }, { status: 400 })
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'Deze code is verlopen. Vraag een nieuwe aan.' }, { status: 400 })
    }
    if ((row.attempts ?? 0) >= MAX_ATTEMPTS) {
      // Te vaak mis → code verbranden, zodat brute-force geen tweede kans krijgt.
      await admin.from('login_codes').update({ consumed_at: new Date().toISOString() }).eq('id', row.id)
      return NextResponse.json({ error: 'Te veel pogingen. Vraag een nieuwe code aan.' }, { status: 429 })
    }

    if (!safeEqual(await hashCode(entered), row.code_hash)) {
      await admin.from('login_codes').update({ attempts: (row.attempts ?? 0) + 1 }).eq('id', row.id)
      const left = MAX_ATTEMPTS - (row.attempts ?? 0) - 1
      return NextResponse.json(
        { error: left > 0 ? `Onjuiste code. Nog ${left} poging(en).` : 'Onjuiste code. Vraag een nieuwe aan.' },
        { status: 400 },
      )
    }

    // Correct → code eenmalig verbruiken en de sessie markeren als geverifieerd.
    await admin.from('login_codes').update({ consumed_at: new Date().toISOString() }).eq('id', row.id)

    // Loggen mag het inloggen NOOIT ophouden: niet awaiten en fouten slikken.
    const meta = requestMeta(req)
    void logAudit({
      action: 'auth.2fa.verified', entityType: 'user', entityId: user.id,
      summary: `Tweestapsverificatie geslaagd (${role})`,
      actorUserId: user.id, actorEmail: user.email ?? null, actorRole: role,
      ip: meta.ip, userAgent: meta.userAgent,
    }).catch(() => { /* audit is bijzaak */ })

    const res = NextResponse.json({ ok: true })
    res.cookies.set(TWO_FA_COOKIE, await createToken(user.id), {
      httpOnly: true,                                   // niet leesbaar voor scripts
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    })
    return res
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
