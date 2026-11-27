import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission, logPortalAction } from '@/lib/portal-auth'
import { rateLimit } from '@/lib/rate-limit'
import { klantKeurtStoryGoed, LeveringFout } from '@/lib/ngs/levering-server'

/**
 * Klantapp — Software en automatisatie (verbeterplan K88): een user story goedkeuren.
 * Recht `solutions`/`goedkeuren`, altijd op de geresolveerde klant (enkel stories van
 * eigen, lopende projecten). Twee keer goedkeuren = één akkoord. Er vertrekt geen mail.
 */
export async function POST(req: NextRequest) {
  const g = await requirePortalPermission('solutions', 'goedkeuren')
  if (!g.ok) return g.response
  const rl = await rateLimit(`solutions:goedkeuren:${g.session.userId}`, { limit: 60, windowSec: 3600 })
  if (!rl.allowed) return NextResponse.json({ error: 'Even te veel tegelijk. Probeer het zo meteen opnieuw.' }, { status: 429 })
  try {
    const b = (await req.json().catch(() => null)) as { actie?: unknown; story_id?: unknown } | null
    if (b?.actie !== 'goedkeuren') return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
    const door = g.session.name || g.session.email || 'Klant'
    const r = await klantKeurtStoryGoed(createAdminSupabaseClient(), g.session.clientId, b.story_id, door)
    await logPortalAction(g.session, 'solutions.story_goedgekeurd', { type: 'ngs_user_story', id: String(b.story_id) }, { req, meta: { nummer: r.nummer, project_id: r.projectId } }).catch(() => null)
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof LeveringFout) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: 'Goedkeuren mislukt. Probeer het opnieuw.' }, { status: 500 })
  }
}
