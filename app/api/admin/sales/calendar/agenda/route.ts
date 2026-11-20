import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { getOrCreateSalesOrg } from '@/lib/sales/service'
import { SIGNATURES } from '@/lib/sales/signatures'
import { listPipelines } from '@/lib/sales/pipelines'

export const dynamic = 'force-dynamic'

/**
 * Naam en e-mailhandtekening van een gekoppelde agenda aanpassen.
 * Bij het koppelen worden die al gevraagd; dit is om ze nadien te wijzigen.
 */
export async function PATCH(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    const id = String(b.id ?? '')
    if (!id) return NextResponse.json({ error: 'Agenda ontbreekt' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const org = await getOrCreateSalesOrg()

    // Enkel een agenda van onszelf; een id van buiten mag hier niets uithalen.
    const { data: own } = await admin.from('sales_calendar_connections')
      .select('id').eq('id', id).eq('sales_client_id', org.id).maybeSingle()
    if (!own) return NextResponse.json({ error: 'Agenda niet gevonden' }, { status: 404 })

    const name = String(b.name ?? '').trim().slice(0, 60)
    if (!name) return NextResponse.json({ error: 'Vul een naam in' }, { status: 400 })

    // Handtekening: ofwel een sleutel uit onze eigen lijst, ofwel niets. Een
    // vrije URL laten we bewust niet toe — die zou zomaar in klantmails komen.
    const sig = SIGNATURES.find((s) => s.key === String(b.signature ?? ''))
    const payload: Record<string, unknown> = {
      name,
      signature_image_url: sig?.url ?? null,
      signature_phone: String(b.phone ?? '').trim() || sig?.phone || null,
      signature_email: String(b.email ?? '').trim() || sig?.email || null,
    }

    // Merk van deze agenda: enkel een pipeline van onszelf, of leeg (= beide).
    if ('pipelineId' in b) {
      const pipelines = await listPipelines()
      payload.pipeline_id = pipelines.find((p) => p.id === String(b.pipelineId ?? ''))?.id ?? null
    }
    // Wie in ClickUp toegewezen wordt op afspraaktaken van deze agenda.
    if ('clickupAssigneeId' in b) {
      const n = Number(b.clickupAssigneeId)
      payload.clickup_assignee_id = Number.isFinite(n) && n > 0 ? Math.round(n) : null
    }

    let { error } = await admin.from('sales_calendar_connections').update(payload).eq('id', id)
    // Zelfde Google-agenda + zelfde merk bestaat al als aparte koppeling.
    if (error && /duplicate|unique|23505/i.test(error.message)) {
      return NextResponse.json({
        error: 'Er bestaat al een koppeling van deze Google-agenda voor dat merk. Pas die aan, of kies hier een ander merk.',
      }, { status: 409 })
    }
    if (error && /signature_|pipeline_id|clickup_|PGRST204|schema cache/i.test(error.message)) {
      // Kolommen bestaan nog niet → op zijn minst de naam bewaren.
      ;({ error } = await admin.from('sales_calendar_connections').update({ name }).eq('id', id))
      if (!error) {
        return NextResponse.json({
          ok: true,
          warning: 'De naam is opgeslagen, maar de handtekening niet: draai eerst de migratie.',
        })
      }
    }
    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * DELETE ?id= — een agenda loskoppelen.
 *
 * ZACHT: de koppeling wordt inactief (active = false) en verdwijnt uit elke
 * agendakiezer. Bewust geen harde delete — dat zou via ON DELETE CASCADE de
 * werkuren van die agenda wissen en calendar_id van oude afspraken leegmaken.
 * De (versleutelde) Google-tokens blijven staan: een afgesplitste zuster-
 * agenda en de ClickUp→Google-sync gebruiken vaak dezelfde tokens, en
 * intrekken bij Google zou die stilletjes breken. Opnieuw koppelen (Google of
 * "agenda uit een gekoppeld account") activeert dezelfde rij weer.
 *
 * Enkel een admin, en enkel zonder toekomstige afspraken: die zouden anders
 * aan een agenda hangen die niemand nog ziet.
 */
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Enkel een beheerder kan een agenda loskoppelen.' }, { status: 403 })
    const id = String(req.nextUrl.searchParams.get('id') ?? '')
    if (!id) return NextResponse.json({ error: 'Agenda ontbreekt' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const org = await getOrCreateSalesOrg()
    const { data: own } = await admin.from('sales_calendar_connections')
      .select('id, name').eq('id', id).eq('sales_client_id', org.id).maybeSingle()
    if (!own) return NextResponse.json({ error: 'Agenda niet gevonden' }, { status: 404 })
    const naam = (own as { name: string | null }).name ?? 'deze agenda'

    const { count, error: telFout } = await admin.from('sales_appointments')
      .select('id', { count: 'exact', head: true })
      .eq('calendar_id', id).neq('status', 'cancelled').gt('ends_at', new Date().toISOString())
    if (telFout) throw new Error(telFout.message)
    if ((count ?? 0) > 0) {
      return NextResponse.json({
        error: `In de agenda van ${naam} staan nog ${count} toekomstige afspraak${count === 1 ? '' : 'en'}. Zet ze eerst in een andere agenda (afspraak bewerken → Agenda) of annuleer ze; daarna kan je loskoppelen.`,
      }, { status: 409 })
    }

    const { error } = await admin.from('sales_calendar_connections').update({ active: false }).eq('id', id)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'sales.calendar.disconnect', entityType: 'sales_calendar_connection', entityId: id,
      summary: `Verkoop: agenda “${naam}” losgekoppeld`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
