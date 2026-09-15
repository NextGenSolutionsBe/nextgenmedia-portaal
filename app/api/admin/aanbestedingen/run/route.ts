import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, requireAdmin } from '@/lib/supabase/server'
import { workspaceVoor } from '@/lib/aanbestedingen/workspaces'
import { actieveRun, laatsteRun, updateRun } from '@/lib/aanbestedingen/runs'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * De lopende taak van een workspace: voortgang opvragen (GET) en annuleren
 * (POST).
 *
 * Het scherm polst hier zolang er iets bezig is. Dat is ook nodig omdat de
 * taak zelf als één lange aanvraag draait: wie het venster sluit en terugkomt,
 * ziet hier dat er nog iets loopt.
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

    try {
      const [bezig, laatste] = await Promise.all([actieveRun(s.ws.id), laatsteRun(s.ws.id)])
      return NextResponse.json({ bezig, laatste })
    } catch (e) {
      // Vóór de migratie bestaat annuleren_gevraagd nog niet. Dan gewoon niets
      // tonen in plaats van het scherm laten struikelen.
      if (/annuleren_gevraagd|does not exist|schema cache/i.test(e instanceof Error ? e.message : '')) {
        return NextResponse.json({ bezig: null, laatste: null })
      }
      throw e
    }
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * POST — het annuleren aanvragen.
 *
 * Dit stopt niets onmiddellijk: het zet een vlag die de lopende taak tussen
 * twee stappen leest. Wat al bezig is wordt afgemaakt. Dat staat ook zo in het
 * antwoord, zodat het scherm geen belofte doet die het niet waarmaakt.
 */
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}))
    const s = await scope(req, String(b.filterId ?? '').trim() || undefined)
    if (!s) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!s.ws) return NextResponse.json({ error: 'Workspace niet gevonden' }, { status: 404 })

    const run = await actieveRun(s.ws.id)
    if (!run) return NextResponse.json({ ok: true, bericht: 'Er liep niets meer.' })

    await updateRun(run.id, { annuleren_gevraagd: true, omschrijving: 'Annuleren gevraagd — de huidige stap wordt nog afgemaakt…' })

    const meta = requestMeta(req)
    await logAudit({
      action: 'aanbestedingen.run.annuleren', entityType: 'aanbestedingen_filter', entityId: s.ws.id,
      summary: `Aanbestedingen ${s.ws.naam}: ${run.fase} annuleren gevraagd`,
      actorUserId: s.actor.id, actorEmail: s.actor.email ?? null,
      actorRole: s.isAdmin ? 'admin' : 'employee',
      ip: meta.ip, userAgent: meta.userAgent,
    })

    return NextResponse.json({
      ok: true,
      bericht: 'Annuleren gevraagd. De stap die nu bezig is wordt nog afgemaakt; daarna stopt hij. Wat al klaar is blijft bewaard.',
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
