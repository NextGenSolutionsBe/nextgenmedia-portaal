import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { canTransition, transitionError, APPOINTMENT_STAGE } from '@/lib/sales/stages'
import { logLeadEvent, moveLeadToPipeline } from '@/lib/sales/service'
import { listPipelines } from '@/lib/sales/pipelines'
import { normalizePhone } from '@/lib/sales/dedupe'

export const dynamic = 'force-dynamic'

// GET — één lead met historiek (voor het detailpaneel).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const [{ data: lead }, { data: events }] = await Promise.all([
      admin.from('sales_leads')
        .select(`*, sales_companies ( * ), sales_contacts ( * )`)
        .eq('id', id).maybeSingle(),
      admin.from('sales_lead_events').select('*').eq('lead_id', id).order('created_at', { ascending: false }).limit(100),
    ])
    if (!lead) return NextResponse.json({ error: 'Lead niet gevonden' }, { status: 404 })
    return NextResponse.json({ lead, events: events ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH — fase, labels, terugbellen, niet-bellen, briefing, contactgegevens.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const b = await req.json()
    const admin = createAdminSupabaseClient()

    const { data: current } = await admin.from('sales_leads')
      .select('id, stage_key, contact_id, pipeline_id, company_id, sales_client_id')
      .eq('id', id).maybeSingle()
    if (!current) return NextResponse.json({ error: 'Lead niet gevonden' }, { status: 404 })

    // Merk wisselen: de lead verhuist naar de andere pipeline. Dat kan botsen
    // met de regel "één actieve lead per bedrijf per pipeline", dus we melden
    // dat netjes in plaats van een databasefout te tonen.
    if (b.pipelineId) {
      const pipelines = await listPipelines()
      const target = pipelines.find((p) => p.id === String(b.pipelineId))
      if (!target) return NextResponse.json({ error: 'Onbekende pipeline' }, { status: 400 })
      const cur = current as { pipeline_id: string | null; company_id: string; sales_client_id: string }
      if (cur.pipeline_id !== target.id) {
        const moved = await moveLeadToPipeline(id, target.id)
        if (!moved.ok) return NextResponse.json({ error: moved.error }, { status: 409 })
        await logLeadEvent(id, {
          kind: 'system', body: `Verhuisd naar ${target.name}`,
          actorId: actor.id, actorEmail: actor.email ?? null,
        })
      }
    }

    const patch: Record<string, unknown> = {}

    // Fasewissel — "Afspraak ingepland" kan hier NOOIT gezet worden (§3): die
    // ontstaat uitsluitend via een geslaagde boeking in Appointment setting.
    if (typeof b.stage === 'string' && b.stage !== current.stage_key) {
      if (b.stage === APPOINTMENT_STAGE || !canTransition(current.stage_key, b.stage)) {
        return NextResponse.json({ error: transitionError(current.stage_key, b.stage) ?? 'Niet toegestaan' }, { status: 400 })
      }
      patch.stage_key = b.stage
    }

    if (Array.isArray(b.labels)) patch.labels = b.labels.map(String)
    if (b.callback_at !== undefined) {
      patch.callback_at = b.callback_at ? new Date(b.callback_at).toISOString() : null
      // Zonder terugbelmoment heeft de notitie erbij geen betekenis meer.
      if (!b.callback_at) patch.callback_note = null
    }
    if (b.callback_note !== undefined) {
      patch.callback_note = String(b.callback_note ?? '').trim().slice(0, 300) || null
    }
    if (b.lost_reason !== undefined) patch.lost_reason = String(b.lost_reason ?? '') || null
    if (b.email_brief !== undefined) patch.email_brief = String(b.email_brief ?? '') || null
    if (typeof b.do_not_call === 'boolean') {
      patch.do_not_call = b.do_not_call
      patch.do_not_call_reason = b.do_not_call ? (String(b.do_not_call_reason ?? '') || null) : null
    }
    if (b.archived === true) patch.archived_at = new Date().toISOString()
    if (b.archived === false) patch.archived_at = null
    if (b.assigned_to !== undefined) patch.assigned_to = b.assigned_to || null

    if (Object.keys(patch).length > 0) {
      let { error } = await admin.from('sales_leads').update(patch).eq('id', id)
      // callback_note bestaat pas na de migratie; zonder die kolom moet de
      // rest van de wijziging gewoon doorgaan.
      if (error && /callback_note/i.test(error.message)) {
        delete patch.callback_note
        if (Object.keys(patch).length > 0) {
          ;({ error } = await admin.from('sales_leads').update(patch).eq('id', id))
        } else {
          error = null
        }
      }
      if (error) throw new Error(error.message)
    }

    // Contactgegevens bijwerken (o.a. e-mail overschrijven vanuit de boeking).
    if (b.contact && current.contact_id) {
      const c: Record<string, unknown> = {}
      for (const k of ['name', 'role', 'email', 'phone', 'mobile', 'linkedin'] as const) {
        if (b.contact[k] !== undefined) c[k] = String(b.contact[k] ?? '') || null
      }
      if (b.contact.phone !== undefined || b.contact.mobile !== undefined) {
        c.phone_digits = normalizePhone(String(b.contact.phone ?? b.contact.mobile ?? ''))
      }
      if (Object.keys(c).length) await admin.from('sales_contacts').update(c).eq('id', current.contact_id)
    }

    if (patch.stage_key) {
      await logLeadEvent(id, {
        kind: 'stage', fromStage: current.stage_key, toStage: String(patch.stage_key),
        actorId: actor.id, actorEmail: actor.email ?? null,
      })
    }
    if (typeof b.note === 'string' && b.note.trim()) {
      await logLeadEvent(id, { kind: b.noteKind === 'call' ? 'call' : 'note', body: b.note.trim(), actorId: actor.id, actorEmail: actor.email ?? null })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — archiveren (zacht verwijderen; nooit hard, §4).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('sales_leads').update({ archived_at: new Date().toISOString() }).eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
