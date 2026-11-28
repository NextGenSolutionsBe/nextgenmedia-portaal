import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { leesAdminIdentiteit } from '@/lib/admin-identiteit'
import { doorgeven, DoorgevenFout } from '@/lib/sales/doorgeven-server'

export const dynamic = 'force-dynamic'

/** Doorgeven aan het andere bedrijf (fase 6, punt 75). Module Projecten (middleware). */
export async function POST(req: NextRequest) {
  const user = await requireStaff()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const ident = await leesAdminIdentiteit().catch(() => null)
    const r = await doorgeven(createAdminSupabaseClient(), b, { naam: ident?.naam ?? null, email: user.email ?? null })
    const meta = requestMeta(req)
    await logAudit({ action: 'sales.doorgeven', entityType: r.naar === 'nextgensolutions' ? 'ngs_deal' : 'opdracht', entityId: r.id, summary: `Doorgegeven aan ${r.naar === 'nextgensolutions' ? 'NextGenSolutions' : 'NextGenMedia'}`, actorUserId: user.id, actorEmail: user.email ?? null, ip: meta.ip, userAgent: meta.userAgent })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    if (e instanceof DoorgevenFout) return NextResponse.json({ error: e.message }, { status: 400 })
    return NextResponse.json({ error: safeMessage(e) }, { status: 500 })
  }
}
