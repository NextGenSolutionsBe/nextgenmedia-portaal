import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { maakToken } from '@/lib/harrie/auth'
import { listPipelines } from '@/lib/sales/pipelines'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Beheer van de Harrie-koppeling. ADMIN-ONLY: wie hier een token aanmaakt,
 * geeft toegang tot de volledige pipeline — namen, nummers, e-mailadressen.
 */

export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()

    const [{ data: tokens }, { data: instellingen }, { data: events }, pipelines] = await Promise.all([
      admin.from('harrie_tokens')
        .select('id, naam, prefix, created_at, laatst_gebruikt, aantal_verzoeken, ingetrokken_op')
        .order('created_at', { ascending: false }),
      admin.from('harrie_instellingen').select('pipeline_id').eq('id', true).maybeSingle(),
      admin.from('harrie_events')
        .select('id, type, gebeurd_op, detail, resultaat, created_at, lead_id, prospect')
        .order('created_at', { ascending: false }).limit(30),
      listPipelines(),
    ])

    const [{ count: leads }, { count: klanten }, { count: bedrijven }] = await Promise.all([
      admin.from('sales_leads').select('id', { count: 'exact', head: true }).is('archived_at', null),
      admin.from('clients').select('id', { count: 'exact', head: true }),
      admin.from('kantoor_bedrijven').select('id', { count: 'exact', head: true }),
    ])

    return NextResponse.json({
      tokens: tokens ?? [],
      instellingen: instellingen ?? { pipeline_id: null },
      events: events ?? [],
      pipelines,
      // Wat er via de koppeling te zien is. Bewust met `count: 'exact'` geteld
      // en niet door rijen op te halen: PostgREST kapt elke query af op 1000,
      // dus tellen in code gaf hier een verkeerd (te laag) beeld.
      omvang: { leads: leads ?? 0, klanten: klanten ?? 0, kantoorbedrijven: bedrijven ?? 0 },
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    const admin = createAdminSupabaseClient()

    // ── Nieuw token ──────────────────────────────────────────────────────────
    if (b.actie === 'token') {
      const naam = String(b.naam ?? '').trim().slice(0, 120) || 'Harrie'
      const { token, hash, prefix } = maakToken()
      const { error } = await admin.from('harrie_tokens').insert({
        naam, token_hash: hash, prefix, aangemaakt_door: actor.id,
      })
      if (error) throw new Error(error.message)

      const meta = requestMeta(req)
      await logAudit({
        // Het token zelf komt hier NOOIT in — enkel dát er één gemaakt is.
        action: 'harrie.token.create', entityType: 'harrie_token', entityId: prefix,
        summary: `Harrie-koppeling: token "${naam}" aangemaakt`,
        actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
        ip: meta.ip, userAgent: meta.userAgent,
      })
      // Eén keer in leesbare vorm. Daarna staat enkel de hash in de databank.
      return NextResponse.json({ ok: true, token })
    }

    // ── Instellingen ─────────────────────────────────────────────────────────
    if (b.actie === 'instellingen') {
      const pipelineId = b.pipeline_id ? String(b.pipeline_id) : null
      const { error } = await admin.from('harrie_instellingen').update({
        pipeline_id: pipelineId,
        updated_at: new Date().toISOString(),
      }).eq('id', true)
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Onbekende actie.' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** DELETE ?token=<id> — token intrekken. Onmiddellijk: de volgende vraag van
 *  Harrie krijgt 401. We verwijderen de rij niet, zodat het logboek blijft
 *  kloppen en je achteraf kunt zien wanneer welk token gebruikt is. */
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('token') ?? ''
    if (!id) return NextResponse.json({ error: 'token ontbreekt' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: rij } = await admin.from('harrie_tokens').select('naam').eq('id', id).maybeSingle()
    const { error } = await admin.from('harrie_tokens')
      .update({ ingetrokken_op: new Date().toISOString() }).eq('id', id)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'harrie.token.revoke', entityType: 'harrie_token', entityId: id,
      summary: `Harrie-koppeling: token "${(rij as { naam?: string } | null)?.naam ?? id}" ingetrokken`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
