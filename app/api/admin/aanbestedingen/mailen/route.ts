import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, requireAdmin } from '@/lib/supabase/server'
import { workspaceVoor } from '@/lib/aanbestedingen/workspaces'
import { mailKandidaten, mailWorkspace } from '@/lib/aanbestedingen/mail'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * De signaalmail met de hand versturen, en vooraf kunnen zien wat erin komt.
 *
 * GET geeft de kandidaten zonder iets te versturen; POST verstuurt. Zo kan je
 * eerst kijken of de drempel goed staat voordat er post vertrekt.
 */

async function scope(req: NextRequest, filterId?: string) {
  const actor = await requireStaff()
  if (!actor) return null
  const isAdmin = !!(await requireAdmin())
  const id = filterId ?? String(req.nextUrl.searchParams.get('filterId') ?? '').trim()
  if (!id) return { actor, isAdmin, ws: null }
  return { actor, isAdmin, ws: await workspaceVoor(id, actor.id, isAdmin) }
}

export async function GET(req: NextRequest) {
  try {
    const s = await scope(req)
    if (!s) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!s.ws) return NextResponse.json({ error: 'Workspace niet gevonden' }, { status: 404 })
    return NextResponse.json({ kandidaten: await mailKandidaten(s.ws) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}))
    const s = await scope(req, String(b.filterId ?? '').trim() || undefined)
    if (!s) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!s.ws) return NextResponse.json({ error: 'Workspace niet gevonden' }, { status: 404 })

    const res = await mailWorkspace(s.ws)

    if (res.fout && !res.verstuurd) {
      return NextResponse.json({ error: res.fout }, { status: 502 })
    }

    const resultaat = res.kandidaten === 0
      // Nul is een normale uitkomst; zeg waarom, anders lijkt het kapot.
      ? `Niets te melden: geen nieuwe opdracht met score ${s.ws.mail_drempel} of hoger.`
      : `Gemaild over ${res.kandidaten} opdracht(en) naar ${res.ontvangers.join(', ')}`

    if (res.verstuurd) {
      const meta = requestMeta(req)
      await logAudit({
        action: 'aanbestedingen.mailen', entityType: 'aanbestedingen_filter', entityId: s.ws.id,
        summary: `Aanbestedingen ${s.ws.naam}: ${resultaat}`,
        actorUserId: s.actor.id, actorEmail: s.actor.email ?? null,
        actorRole: s.isAdmin ? 'admin' : 'employee',
        ip: meta.ip, userAgent: meta.userAgent,
      })
    }

    return NextResponse.json({ ok: true, ...res, resultaat, waarschuwing: res.fout })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
