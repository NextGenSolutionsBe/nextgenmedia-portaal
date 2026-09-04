import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff, requireAdmin } from '@/lib/supabase/server'
import { workspaceVoor } from '@/lib/aanbestedingen/workspaces'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * De opdrachten van één workspace: de lijst, één dossier, en de knoppen
 * "negeren" en "ingediend".
 *
 * Toegang loopt via workspaceVoor — bestaat de workspace niet, of mag je er
 * niet bij, dan krijg je hetzelfde antwoord. Zo kan je hier niet aftasten welke
 * workspaces er zijn.
 */

type Rij = {
  referentienummer: string
  titel: string | null
  organisatie: string | null
  uiterste_indieningsdatum: string | null
  uiterste_indieningsdatum_raw: string | null
  record_status: string
  ingediend: boolean
  genegeerd: boolean
  link: string | null
}

async function scope(req: NextRequest) {
  const actor = await requireStaff()
  if (!actor) return null
  const isAdmin = !!(await requireAdmin())
  const filterId = String(req.nextUrl.searchParams.get('filterId') ?? '').trim()
  if (!filterId) return { actor, isAdmin, ws: null }
  return { actor, isAdmin, ws: await workspaceVoor(filterId, actor.id, isAdmin) }
}

export async function GET(req: NextRequest) {
  try {
    const s = await scope(req)
    if (!s) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!s.ws) return NextResponse.json({ error: 'Workspace niet gevonden' }, { status: 404 })

    const admin = createAdminSupabaseClient()
    const ref = String(req.nextUrl.searchParams.get('ref') ?? '').trim()

    // ── Eén dossier, volledig ────────────────────────────────────────────────
    if (ref) {
      const [opdracht, analyse, documenten] = await Promise.all([
        admin.from('aanbestedingen').select('*')
          .eq('filter_id', s.ws.id).eq('referentienummer', ref).maybeSingle(),
        admin.from('aanbesteding_analyse').select('*')
          .eq('filter_id', s.ws.id).eq('referentienummer', ref).maybeSingle(),
        admin.from('aanbesteding_documenten')
          .select('filename, doc_type, size_bytes, page_count, char_count, leesbaar, status')
          .eq('filter_id', s.ws.id).eq('referentienummer', ref).order('filename'),
      ])
      if (!opdracht.data) return NextResponse.json({ error: 'Opdracht niet gevonden' }, { status: 404 })

      // Openen telt als gezien; dan verdwijnt de "nieuw"-markering.
      if (analyse.data && !(analyse.data as { gezien_op: string | null }).gezien_op) {
        await admin.from('aanbesteding_analyse')
          .update({ gezien_op: new Date().toISOString() })
          .eq('filter_id', s.ws.id).eq('referentienummer', ref)
      }

      return NextResponse.json({
        opdracht: opdracht.data,
        analyse: analyse.data ?? null,
        documenten: documenten.data ?? [],
      })
    }

    // ── De lijst ─────────────────────────────────────────────────────────────
    const { data: opdrachtRijen, error } = await admin
      .from('aanbestedingen')
      .select('referentienummer, titel, organisatie, uiterste_indieningsdatum, uiterste_indieningsdatum_raw, record_status, ingediend, genegeerd, link')
      .eq('filter_id', s.ws.id)
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) {
        return NextResponse.json({ opdrachten: [], hint: 'Draai eerst de migratie.' })
      }
      throw new Error(error.message)
    }

    const { data: analyseRijen } = await admin
      .from('aanbesteding_analyse')
      .select('referentienummer, score, volledig, kwalificatie_reden, prijs_bedrag, bestek_status, gezien_op')
      .eq('filter_id', s.ws.id)
    const perRef = new Map(
      ((analyseRijen ?? []) as { referentienummer: string }[]).map((a) => [a.referentienummer, a]),
    )

    const opdrachten = ((opdrachtRijen ?? []) as Rij[])
      .map((o) => ({ ...o, ...(perRef.get(o.referentienummer) ?? {}) }))
      // Beste bovenaan; wat nog geen score heeft komt onderaan in plaats van
      // ertussen te verdwijnen.
      .sort((a, b) => {
        const sa = (a as { score?: number }).score, sb = (b as { score?: number }).score
        if (sa == null && sb == null) return (a.titel ?? '').localeCompare(b.titel ?? '')
        if (sa == null) return 1
        if (sb == null) return -1
        return sb - sa
      })

    return NextResponse.json({ workspace: s.ws, opdrachten })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * PATCH — negeren, ingediend markeren, of de checklist afvinken.
 *
 * We verwijderen hier nooit iets. "Genegeerd" en "ingediend" zijn vlaggen; de
 * opdracht blijft staan, ook als hij later uit de zoeklijst van de BDA valt.
 */
export async function PATCH(req: NextRequest) {
  try {
    const s = await scope(req)
    if (!s) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!s.ws) return NextResponse.json({ error: 'Workspace niet gevonden' }, { status: 404 })

    const b = await req.json().catch(() => ({}))
    const ref = String(b.referentienummer ?? '').trim()
    if (!ref) return NextResponse.json({ error: 'Geen opdracht opgegeven' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const velden: Record<string, unknown> = {}
    if (typeof b.genegeerd === 'boolean') velden.genegeerd = b.genegeerd
    if (typeof b.ingediend === 'boolean') {
      velden.ingediend = b.ingediend
      velden.ingediend_at = b.ingediend ? new Date().toISOString() : null
    }

    if (Object.keys(velden).length) {
      const { error } = await admin.from('aanbestedingen')
        .update(velden).eq('filter_id', s.ws.id).eq('referentienummer', ref)
      if (error) throw new Error(error.message)
    }

    // De checklist hoort bij de analyse, niet bij de opdracht.
    if (Array.isArray(b.checklist)) {
      const schoon = (b.checklist as unknown[]).slice(0, 40).map((c) => {
        const o = (c ?? {}) as Record<string, unknown>
        return { wat: String(o.wat ?? '').slice(0, 250), klaar: o.klaar === true }
      }).filter((c) => c.wat)
      const { error } = await admin.from('aanbesteding_analyse')
        .update({ checklist: schoon }).eq('filter_id', s.ws.id).eq('referentienummer', ref)
      if (error) throw new Error(error.message)
    }

    if (Object.keys(velden).length) {
      const meta = requestMeta(req)
      await logAudit({
        action: 'aanbestedingen.opdracht.markeren', entityType: 'aanbesteding', entityId: ref,
        summary: `Aanbesteding ${ref}: ${Object.entries(velden)
          .filter(([k]) => k === 'genegeerd' || k === 'ingediend')
          .map(([k, v]) => `${k}=${v}`).join(', ')}`,
        actorUserId: s.actor.id, actorEmail: s.actor.email ?? null,
        actorRole: s.isAdmin ? 'admin' : 'employee',
        ip: meta.ip, userAgent: meta.userAgent,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
