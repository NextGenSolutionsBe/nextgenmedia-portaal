import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { UitgaveFout, leesOpgeladenBon } from '@/lib/vennoot-uitgaven-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** POST { pad } — een net opgeladen bonnetje laten lezen (wat, datum, bedrag). Enkel een voorstel; er wordt niets bewaard. Enkel admins. */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as { pad?: unknown }
    return NextResponse.json(await leesOpgeladenBon(createAdminSupabaseClient(), b.pad))
  } catch (e) {
    if (e instanceof UitgaveFout) return NextResponse.json({ error: e.message }, { status: e.status })
    safeMessage(e, 'vennoten.bon.lezen') // volledig in de serverlog
    return NextResponse.json({ error: 'Het bonnetje lezen lukte niet. Vul de gegevens zelf in.' }, { status: 502 })
  }
}
