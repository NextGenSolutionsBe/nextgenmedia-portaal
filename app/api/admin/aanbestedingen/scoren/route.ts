import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, requireAdmin } from '@/lib/supabase/server'
import { workspaceVoor, workspacesVoor, type Workspace } from '@/lib/aanbestedingen/workspaces'
import { scoreWorkspace } from '@/lib/aanbestedingen/score'
import { startRun, updateRun, isGeannuleerd, rondAf } from '@/lib/aanbestedingen/runs'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Voorselectie: alle nieuwe opdrachten van een workspace een score geven.
 *
 * Dit is de goedkope stap — een licht model dat enkel titel, omschrijving en
 * CPV-code ziet. De volledige analyse met bestekken komt daarna, en enkel voor
 * de top van deze lijst.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const isAdmin = !!(await requireAdmin())

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({
        error: 'ANTHROPIC_API_KEY ontbreekt in de omgeving. Zonder die sleutel kunnen we niet scoren.',
      }, { status: 503 })
    }

    const b = await req.json().catch(() => ({}))

    let ws: Workspace | null = null
    try {
      ws = b.filterId
        ? await workspaceVoor(String(b.filterId), actor.id, isAdmin)
        : (await workspacesVoor(actor.id, isAdmin))[0] ?? null
    } catch (e) {
      if (/does not exist|schema cache/i.test(e instanceof Error ? e.message : '')) {
        return NextResponse.json({
          error: 'De tabellen voor Aanbestedingen bestaan nog niet. Draai eerst de migratie.',
        }, { status: 503 })
      }
      throw e
    }
    if (!ws) return NextResponse.json({ error: 'Geen workspace gevonden.' }, { status: 404 })

    const runId = await startRun(ws.id, 'scoren', 'Opdrachten beoordelen…', actor.email ?? '')
    const bijwerken = (velden: Record<string, unknown>) => updateRun(runId, velden)

    try {
      const res = await scoreWorkspace(ws.id, {
        onVoortgang: async (nu, totaal) => {
          await bijwerken({
            stap_nu: nu, stap_totaal: totaal,
            omschrijving: `${nu} van ${totaal} beoordeeld…`,
          })
        },
        stoppen: () => isGeannuleerd(runId),
      })

      const resultaat = [
        res.gestopt ? 'Geannuleerd' : null,
        `${res.bekeken} opdracht(en) bekeken`,
        `${res.gescoord} beoordeeld`,
        res.overgeslagen > 0 ? `${res.overgeslagen} ongewijzigd of niet meer relevant` : null,
        res.zonder_antwoord > 0 ? `LET OP: ${res.zonder_antwoord} zonder antwoord` : null,
        `$${res.kost_usd.toFixed(3)}`,
      ].filter(Boolean).join(' · ')

      await rondAf(runId, res.gestopt ? 'geannuleerd' : 'klaar', resultaat)

      const meta = requestMeta(req)
      await logAudit({
        action: 'aanbestedingen.scoren', entityType: 'aanbestedingen_filter', entityId: ws.id,
        summary: `Aanbestedingen ${ws.naam}: ${resultaat}`,
        actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: isAdmin ? 'admin' : 'employee',
        ip: meta.ip, userAgent: meta.userAgent,
      })

      return NextResponse.json({ ok: true, runId, ...res, resultaat })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Beoordelen mislukt'
      await rondAf(runId, 'mislukt', msg)
      return NextResponse.json({ error: msg }, { status: 502 })
    }
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
