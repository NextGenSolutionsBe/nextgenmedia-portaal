import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff, requireAdmin } from '@/lib/supabase/server'
import { BdaClient, bdaConfigured } from '@/lib/aanbestedingen/bda'
import { bewaarOpdrachten } from '@/lib/aanbestedingen/store'
import { workspaceVoor, workspacesVoor, type Workspace } from '@/lib/aanbestedingen/workspaces'
import { startRun, updateRun, isGeannuleerd, rondAf } from '@/lib/aanbestedingen/runs'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Opdrachten ophalen bij de BDA en wegschrijven.
 *
 * Dit is enkel het OPHALEN — scoren en analyseren volgt in de volgende stap.
 * Ophalen kost niets (geen AI), dus we halen altijd het volledige filter op.
 *
 * Een medewerker mag enkel zijn eigen filter verversen; dat wordt hier
 * gecontroleerd en niet in het scherm.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const isAdmin = !!(await requireAdmin())

    if (!bdaConfigured()) {
      return NextResponse.json({
        error: 'BDA_AUTH_CLIENT_SECRET ontbreekt in de omgeving. Zonder die sleutel kunnen we niets ophalen.',
      }, { status: 503 })
    }

    const b = await req.json().catch(() => ({}))
    const admin = createAdminSupabaseClient()

    // Welke workspace? Toegang loopt via de gedeelde laag; hier staat geen
    // eigen rechtencontrole meer.
    let filter: Workspace | null = null
    try {
      filter = b.filterId
        ? await workspaceVoor(String(b.filterId), actor.id, isAdmin)
        : (await workspacesVoor(actor.id, isAdmin))[0] ?? null
    } catch (e) {
      if (/aanbestedingen_filters|does not exist|schema cache/i.test(e instanceof Error ? e.message : '')) {
        return NextResponse.json({
          error: 'De tabellen voor Aanbestedingen bestaan nog niet. Draai eerst de migratie.',
        }, { status: 503 })
      }
      throw e
    }
    if (!filter) {
      return NextResponse.json({
        error: 'Geen workspace gevonden. Maak er eerst een aan bij Aanbestedingen.',
      }, { status: 404 })
    }

    // Run vastleggen zodat de voortgangsbalk iets heeft om te lezen, en zodat
    // er iets is om het annuleren aan te hangen.
    const runId = await startRun(
      filter.id, 'ophalen', 'Opdrachten ophalen bij publicprocurement.be…', actor.email ?? '',
    )
    const bijwerken = (velden: Record<string, unknown>) => updateRun(runId, velden)

    try {
      const client = new BdaClient()
      const { records, totaal, gestopt } = await client.alleOpdrachten(filter.short_link, {
        includeClosed: filter.include_closed,
        stoppen: () => isGeannuleerd(runId),
        onPage: async (opgehaald, tot) => {
          await bijwerken({
            stap_nu: opgehaald, stap_totaal: tot,
            omschrijving: `${opgehaald} van ${tot} opdrachten opgehaald…`,
          })
        },
      })

      const res = await bewaarOpdrachten(filter.id, records)

      // Vertel de HELE keten, niet enkel een getal. "0 dossiers" zonder uitleg
      // levert alleen maar vragen op.
      const resultaat = [
        gestopt ? 'Geannuleerd' : null,
        `${res.totaal} opdracht(en) in je filter`,
        `${res.nieuw} nieuw`,
        `${res.bijgewerkt} bestaand`,
        res.verdwenen > 0 ? `${res.verdwenen} niet meer gevonden` : null,
        // Bij annuleren is dit geen waarschuwing maar een gevolg; dan
        // hoeven we er niet nog eens "LET OP" bij te zetten.
        !gestopt && records.length < totaal ? `LET OP: ${records.length} van ${totaal} opgehaald` : null,
        gestopt ? `gestopt na ${records.length} van ${totaal}` : null,
      ].filter(Boolean).join(' · ')

      await rondAf(runId, gestopt ? 'geannuleerd' : 'klaar', resultaat)

      const meta = requestMeta(req)
      await logAudit({
        action: 'aanbestedingen.ophalen', entityType: 'aanbestedingen_filter', entityId: filter.id,
        summary: `Aanbestedingen: ${resultaat}`,
        actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: isAdmin ? 'admin' : 'employee',
        ip: meta.ip, userAgent: meta.userAgent,
      })

      return NextResponse.json({ ok: true, runId, gestopt, totalCount: totaal, ...res, resultaat })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ophalen mislukt'
      // Een mislukte run zichtbaar laten falen; stil "niets gevonden" tonen is
      // hoe je maandenlang niet merkt dat er iets stuk is.
      await rondAf(runId, 'mislukt', msg)
      return NextResponse.json({ error: msg }, { status: 502 })
    }
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
