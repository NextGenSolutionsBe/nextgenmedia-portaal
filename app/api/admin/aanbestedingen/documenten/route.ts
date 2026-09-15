import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff, requireAdmin } from '@/lib/supabase/server'
import { bdaConfigured } from '@/lib/aanbestedingen/bda'
import { workspaceIdUit } from '@/lib/aanbestedingen/normalize'
import { haalDocumentenOp } from '@/lib/aanbestedingen/documents'
import { workspaceVoor } from '@/lib/aanbestedingen/workspaces'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * De bestekdocumenten van één opdracht ophalen en uitlezen.
 *
 * Losstaand van het analyseren: dit kost geen AI-tokens, enkel tijd. Zo kun je
 * eerst zien wat er in een dossier zit voordat je er geld aan uitgeeft.
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
    const referentienummer = String(b.referentienummer ?? '').trim()
    if (!referentienummer) {
      return NextResponse.json({ error: 'Geef een referentienummer mee.' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()
    const { data: rij, error } = await admin
      .from('aanbestedingen')
      .select('filter_id, referentienummer, titel, link')
      .eq('referentienummer', referentienummer)
      .limit(1)
      .maybeSingle()

    if (error && /does not exist|schema cache/i.test(error.message)) {
      return NextResponse.json({
        error: 'De tabellen voor Aanbestedingen bestaan nog niet. Draai eerst de migratie.',
      }, { status: 503 })
    }
    if (!rij) return NextResponse.json({ error: 'Opdracht niet gevonden.' }, { status: 404 })

    const opdracht = rij as { filter_id: string; referentienummer: string; titel: string | null; link: string | null }

    // Toegang loopt via de gedeelde laag, niet via een eigen check hier.
    const ws = await workspaceVoor(opdracht.filter_id, actor.id, isAdmin)
    if (!ws) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const workspaceId = workspaceIdUit(opdracht.link ?? '')
    if (!workspaceId) {
      return NextResponse.json({
        error: 'Deze opdracht heeft geen bruikbare link naar publicprocurement.be, dus we weten niet welke documenten erbij horen.',
      }, { status: 422 })
    }

    const res = await haalDocumentenOp(opdracht.filter_id, opdracht.referentienummer, workspaceId)

    // De hele keten benoemen, niet enkel een getal.
    const resultaat = [
      `${res.gevonden} document(en)`,
      res.nieuw > 0 ? `${res.nieuw} ingelezen` : null,
      res.uit_cache > 0 ? `${res.uit_cache} uit cache` : null,
      res.overgeslagen > 0 ? `${res.overgeslagen} al bekend` : null,
      res.onleesbaar > 0 ? `${res.onleesbaar} onleesbaar` : null,
      res.niet_opgehaald > 0 ? `${res.niet_opgehaald} niet op te halen` : null,
      res.tekens > 0 ? `${res.tekens.toLocaleString('nl-BE')} tekens` : null,
    ].filter(Boolean).join(' · ')

    const meta = requestMeta(req)
    await logAudit({
      action: 'aanbestedingen.documenten', entityType: 'aanbesteding', entityId: opdracht.referentienummer,
      summary: `Documenten ${opdracht.referentienummer}: ${resultaat}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: isAdmin ? 'admin' : 'employee',
      ip: meta.ip, userAgent: meta.userAgent,
    })

    return NextResponse.json({ ok: true, ...res, resultaat })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
