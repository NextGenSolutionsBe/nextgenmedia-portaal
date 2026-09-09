import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, requireAdmin } from '@/lib/supabase/server'
import { workspaceVoor, workspacesVoor, type Workspace } from '@/lib/aanbestedingen/workspaces'
import { analyseerWorkspace } from '@/lib/aanbestedingen/analyse'
import { bdaConfigured } from '@/lib/aanbestedingen/bda'
import { startRun, updateRun, isGeannuleerd, rondAf } from '@/lib/aanbestedingen/runs'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * De top van de voorselectie volledig uitwerken, mét de bestekken.
 *
 * Dit is de dure stap. Wat er doorgaat wordt begrensd door twee instellingen
 * van de workspace: `mail_drempel` (wat is interessant) en `ai_top_x` (hoeveel
 * per run). De kost van de run staat in het resultaat, zodat je ziet wat het
 * gekost heeft en niet pas op de factuur.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const isAdmin = !!(await requireAdmin())

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({
        error: 'ANTHROPIC_API_KEY ontbreekt in de omgeving. Zonder die sleutel kunnen we niet analyseren.',
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

    const runId = await startRun(ws.id, 'analyseren', 'Dossiers uitwerken…', actor.email ?? '')
    const bijwerken = (velden: Record<string, unknown>) => updateRun(runId, velden)

    try {
      const res = await analyseerWorkspace(ws, {
        onVoortgang: async (nu, totaal, wat) => {
          await bijwerken({
            stap_nu: nu, stap_totaal: totaal,
            omschrijving: wat ? `${nu + 1} van ${totaal}: ${wat.slice(0, 120)}` : '',
          })
        },
        stoppen: () => isGeannuleerd(runId),
      })

      const resultaat = res.aangeboden === 0
        // Nul is hier een normale uitkomst, geen storing — maar zeg wél waarom,
        // anders lijkt het alsof er iets stuk is.
        ? `Niets te doen: geen opdracht haalde score ${ws.mail_drempel} of hoger.`
        : [
          res.gestopt ? 'Geannuleerd' : null,
          `${res.aangeboden} in aanmerking`,
          `${res.geanalyseerd} uitgewerkt`,
          res.overgeslagen > 0 ? `${res.overgeslagen} ongewijzigd` : null,
          res.zonder_bestek > 0 ? `${res.zonder_bestek} zonder bestek` : null,
          res.mislukt > 0 ? `LET OP: ${res.mislukt} mislukt` : null,
          `$${res.kost_usd.toFixed(2)}`,
        ].filter(Boolean).join(' · ')

      await rondAf(runId, res.gestopt ? 'geannuleerd' : 'klaar', resultaat)

      const meta = requestMeta(req)
      await logAudit({
        action: 'aanbestedingen.analyseren', entityType: 'aanbestedingen_filter', entityId: ws.id,
        summary: `Aanbestedingen ${ws.naam}: ${resultaat}`,
        actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: isAdmin ? 'admin' : 'employee',
        ip: meta.ip, userAgent: meta.userAgent,
      })

      return NextResponse.json({
        ok: true, runId, ...res, resultaat,
        // Zonder BDA-sleutel lukt het analyseren wel, maar zonder bestekken.
        // Dat is een half dossier, dus dat zeggen we erbij.
        waarschuwing: !bdaConfigured()
          ? 'BDA_AUTH_CLIENT_SECRET ontbreekt: de dossiers zijn gemaakt zonder de bestekdocumenten.'
          : undefined,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Analyseren mislukt'
      await rondAf(runId, 'mislukt', msg)
      return NextResponse.json({ error: msg }, { status: 502 })
    }
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
