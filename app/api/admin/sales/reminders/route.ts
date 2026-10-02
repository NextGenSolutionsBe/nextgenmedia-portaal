import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { getEmailStatus, RESTRICTED_KEY_HINT, resendKeyFor } from '@/lib/email'
import { listPipelines } from '@/lib/sales/pipelines'
import { getOrCreateSalesOrg } from '@/lib/sales/service'
import { dueAt } from '@/lib/sales/reminders'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Overzicht van de herinneringsmails: wat staat er klaar, wanneer precies gaat
 * het uit, en is het aangekomen?
 *
 * De status komt bij Resend vandaan, niet uit onze eigen tabel. Die weet enkel
 * dát we een mail hebben aangeboden — niet of hij ook bezorgd is. Precies dat
 * verschil wil je hier kunnen zien.
 */

type Item = {
  appointmentId: string
  company: string | null
  contact: string | null
  email: string | null
  pipeline: string | null
  owner: string | null
  startsAt: string
  /** Wanneer de mail vertrekt (of vertrokken is). */
  dueAt: string
  state: 'sent' | 'scheduled' | 'pending' | 'blocked' | 'cancelled'
  /** Alleen bij 'blocked': waarom er niets uitgaat. */
  reason: string | null
  /** Echte status bij Resend, indien bekend. */
  resendEvent: string | null
}

// Hoeveel statussen we bij Resend opvragen. Eén verzoek per mail; ruim genoeg
// voor een normale week, en het scherm blijft snel.
const MAX_STATUS_LOOKUPS = 60

export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const org = await getOrCreateSalesOrg()
    const pipelines = await listPipelines()
    const byPipeline = new Map(pipelines.map((p) => [p.id, p]))

    const now = Date.now()
    // Vooruit: alles wat nog moet gebeuren. Terug: een maand geschiedenis, zodat
    // je kunt nakijken wat er de voorbije weken vertrokken is.
    const from = new Date(now - 30 * 86400000).toISOString()

    // Opgeschoonde regels blijven bewaard maar staan standaard niet in beeld.
    const showHidden = req.nextUrl.searchParams.get('hidden') === '1'
    let q = admin
      .from('sales_appointments')
      .select('id, starts_at, created_at, status, attendee_email, pipeline_id, lead_id, calendar_id, mail_hidden_at')
      .eq('sales_client_id', org.id)
      .neq('status', 'cancelled')
      .gte('starts_at', from)
      .order('starts_at', { ascending: true })
      .limit(300)
    q = showHidden ? q.not('mail_hidden_at', 'is', null) : q.is('mail_hidden_at', null)

    let { data: apptRows, error: apptErr } = await q
    // Vóór de migratie bestaat mail_hidden_at nog niet; dan gewoon alles tonen.
    if (apptErr && /mail_hidden_at|PGRST204|schema cache|column/i.test(apptErr.message ?? '')) {
      const fallback = await admin
        .from('sales_appointments')
        .select('id, starts_at, created_at, status, attendee_email, pipeline_id, lead_id, calendar_id')
        .eq('sales_client_id', org.id)
        .neq('status', 'cancelled')
        .gte('starts_at', from)
        .order('starts_at', { ascending: true })
        .limit(300)
      apptRows = (fallback.data ?? []).map((r) => ({ ...r, mail_hidden_at: null }))
    }

    const appts = (apptRows ?? []) as {
      id: string; starts_at: string; created_at: string; status: string
      attendee_email: string | null; pipeline_id: string | null
      lead_id: string | null; calendar_id: string | null
    }[]
    if (appts.length === 0) return NextResponse.json({ items: [] })

    const [{ data: reminderRows, error: remErr }, { data: leadRows }, { data: ownerRows }] = await Promise.all([
      admin.from('sales_appointment_reminders')
        .select('appointment_id, resend_id, scheduled_for, sent_at, cancelled_at')
        .in('appointment_id', appts.map((a) => a.id)),
      admin.from('sales_leads')
        .select('id, sales_companies ( name ), sales_contacts ( name )')
        .in('id', appts.map((a) => a.lead_id).filter(Boolean) as string[]),
      admin.from('sales_calendar_connections').select('id, name'),
    ])

    const reminders = new Map(
      ((reminderRows ?? []) as {
        appointment_id: string; resend_id: string | null
        scheduled_for: string | null; cancelled_at?: string | null
      }[]).map((r) => [r.appointment_id, r]),
    )
    const leadInfo = new Map(
      ((leadRows ?? []) as { id: string; sales_companies?: { name?: string } | null; sales_contacts?: { name?: string } | null }[])
        .map((l) => [l.id, { company: l.sales_companies?.name ?? null, contact: l.sales_contacts?.name ?? null }]),
    )
    const ownerName = new Map(
      ((ownerRows ?? []) as { id: string; name: string | null }[]).map((o) => [o.id, o.name]),
    )

    const items: Item[] = appts.map((a) => {
      const info = a.lead_id ? leadInfo.get(a.lead_id) : undefined
      const pipeline = a.pipeline_id ? byPipeline.get(a.pipeline_id) : undefined
      const startsMs = new Date(a.starts_at).getTime()
      const rem = reminders.get(a.id)
      /**
       * Het moment dat ECHT geldt. Staat er een rij, dan is `scheduled_for`
       * de waarheid — die kan handmatig verzet zijn naar "nu". Alleen zonder
       * rij vallen we terug op de berekende regel.
       */
      const due = rem?.scheduled_for
        ? new Date(rem.scheduled_for).getTime()
        : dueAt(startsMs, new Date(a.created_at).getTime())

      // Dezelfde regels als bij het inplannen — zodat dit scherm niet iets
      // anders beweert dan wat er echt gebeurt.
      let state: Item['state'] = 'pending'
      let reason: string | null = null
      if (rem?.cancelled_at) {
        state = 'cancelled'; reason = 'Handmatig tegengehouden'
      } else if (rem) {
        state = due <= now ? 'sent' : 'scheduled'
      } else if (!a.attendee_email) {
        state = 'blocked'; reason = 'Geen e-mailadres bij deze afspraak'
      } else if (!pipeline) {
        state = 'blocked'; reason = 'Geen merk gekoppeld — we weten niet welke brochure erbij hoort'
      } else if (!pipeline.reminder_enabled) {
        state = 'blocked'; reason = `Herinneringen staan uit voor ${pipeline.name}`
      } else if (due >= startsMs) {
        state = 'blocked'; reason = 'Te kort op voorhand geboekt — de mail zou ná de afspraak vallen'
      } else if (due <= now) {
        state = 'blocked'
        reason = 'Verzendmoment is voorbij zonder dat de mail ingepland raakte'
      }

      return {
        appointmentId: a.id,
        company: info?.company ?? null,
        contact: info?.contact ?? null,
        email: a.attendee_email,
        pipeline: pipeline?.name ?? null,
        owner: a.calendar_id ? ownerName.get(a.calendar_id) ?? null : null,
        startsAt: a.starts_at,
        dueAt: new Date(due).toISOString(),
        state,
        reason,
        resendEvent: null,
      }
    })

    // Echte status ophalen, nieuwste eerst — daar wil je als eerste naar kijken.
    // De sleutel per merk onthouden: een status opvragen moet met dezelfde
    // sleutel als waarmee de mail verstuurd is.
    const keyByPipelineName = new Map(pipelines.map((p) => [p.name, resendKeyFor(p.key)]))
    const withId = items
      .map((it, i) => ({
        it, i,
        id: reminders.get(it.appointmentId)?.resend_id ?? null,
        key: keyByPipelineName.get(it.pipeline ?? '') ?? undefined,
      }))
      .filter((x): x is { it: Item; i: number; id: string; key: string | undefined } => !!x.id)
      .sort((a, b) => new Date(b.it.dueAt).getTime() - new Date(a.it.dueAt).getTime())
      .slice(0, MAX_STATUS_LOOKUPS)

    let restrictedKey = false
    await Promise.all(withId.map(async ({ it, id, key }) => {
      const res = await getEmailStatus(id, key)
      if (!res.ok) {
        if (res.restricted) restrictedKey = true
        return
      }
      // Een handmatig tegengehouden mail blijft tegengehouden, wat Resend ook
      // nog over de oude verzending zegt.
      if (it.state === 'cancelled') return
      const st = res.status
      it.resendEvent = st.lastEvent
      // Resend is hier de baas: zegt die 'canceled', dan gaat er niets uit,
      // wat onze eigen tabel ook denkt.
      if (st.lastEvent === 'canceled') { it.state = 'blocked'; it.reason = 'Bij Resend geannuleerd' }
      else if (st.lastEvent && st.lastEvent !== 'scheduled') it.state = 'sent'
    }))

    // Ontbreken de kolommen uit de laatste migratie, dan lezen we geen enkele
    // herinnering en lijkt alles "nog in te plannen" terwijl er mails vertrekken.
    // Dat moet op het scherm staan, niet stilletjes verkeerd getoond worden.
    const missingCols = !!remErr && /PGRST204|schema cache|does not exist|could not find/i.test(remErr.message ?? '')

    // Wat nog moet gebeuren bovenaan, daarna de geschiedenis omgekeerd.
    const upcoming = items.filter((i) => i.state !== 'sent').sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    // 'cancelled' hoort bij "gaat niet uit", niet bij de geschiedenis.
    const history = items.filter((i) => i.state === 'sent').sort((a, b) => b.dueAt.localeCompare(a.dueAt))

    return NextResponse.json({
      items: [...upcoming, ...history],
      showingHidden: showHidden,
      hint: missingCols
        ? 'De laatste migratie is nog niet gedraaid, dus we kunnen niet zien welke mails al ingepland zijn. Draai supabase/migrations/99999999_SYNC_ALL.sql — tot dan klopt dit overzicht niet.'
        : restrictedKey ? RESTRICTED_KEY_HINT : null,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
