import { NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { eigenAccount } from '@/lib/twofa/route'

export const dynamic = 'force-dynamic'

/**
 * GET — de 2FA-status van het EIGEN account. Geeft nooit het geheim, de
 * herstelcodes of hun hashes terug: enkel of het actief is en hoeveel codes er
 * nog over zijn.
 */
export async function GET() {
  try {
    const g = await eigenAccount()
    if (!g.ok) return g.res
    const db = createAdminSupabaseClient()
    const [{ data: totp }, { count }] = await Promise.all([
      db.from('user_totp').select('actief, geactiveerd_op').eq('user_id', g.sessie.user.id).maybeSingle(),
      db.from('user_herstelcodes').select('id', { count: 'exact', head: true }).eq('user_id', g.sessie.user.id).is('gebruikt_op', null),
    ])
    const t = totp as { actief?: boolean; geactiveerd_op?: string | null } | null
    return NextResponse.json({
      actief: !!t?.actief,
      geactiveerdOp: t?.actief ? t.geactiveerd_op ?? null : null,
      herstelcodesOver: t?.actief ? count ?? 0 : 0,
      beschikbaar: !!g.kern,
      verplicht: true,
      email: g.sessie.user.email ?? null,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
