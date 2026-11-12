import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, getSessionUser } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { tokenVorm } from '@/lib/klant-account'
import { AccountFout, rondActivatieAf, wisselActivatie } from '@/lib/klant-account-server'

export const dynamic = 'force-dynamic'

/**
 * Publiek, token-gated: de activatielink uit de welkomstmail.
 *  POST { token }              → eenmalige token om het wachtwoord te zetten (enkel klantaccounts).
 *  POST { token, klaar: true } → na het kiezen van het wachtwoord (ingelogd als die klant): de link werkt niet meer.
 */
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({})) as { token?: unknown; klaar?: unknown }
    const token = tokenVorm(b.token)
    if (!token) return NextResponse.json({ error: 'Deze link klopt niet.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    if (b.klaar === true) {
      const user = await getSessionUser()
      if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 })
      await rondActivatieAf(admin, token, user.id)
      const m = requestMeta(req)
      await logAudit({ action: 'client.account_geactiveerd', entityType: 'auth_user', entityId: user.id, summary: 'Klant koos een wachtwoord via de activatielink', actorUserId: user.id, actorEmail: user.email ?? null, actorRole: 'client', ip: m.ip, userAgent: m.userAgent })
      return NextResponse.json({ ok: true })
    }
    const r = await wisselActivatie(admin, token)
    return NextResponse.json({ token_hash: r.tokenHash, email: r.email })
  } catch (e) {
    if (e instanceof AccountFout) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: 'Er ging iets mis. Probeer het zo opnieuw.' }, { status: 500 })
  }
}
