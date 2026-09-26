import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin, requireStaff } from '@/lib/supabase/server'
import { getOrCreateSetter } from '@/lib/sales/setters'
import { loadCalendar, logLeadEvent, getOrCreateSalesOrg, moveLeadToPipeline, listOwners, type CalendarOwner } from '@/lib/sales/service'
import { isBookable } from '@/lib/sales/availability'
import { APPOINTMENT_STAGE, normaliseerStage } from '@/lib/sales/stages'
import { registreerActiviteit } from '@/lib/sales/activiteiten'
import { createEvent, moveEvent, deleteEvent, werkEventBij } from '@/lib/sales/google-calendar'
import { normalizePhone } from '@/lib/sales/dedupe'
import { bouwAgendaOmschrijving, bouwAgendaTitel, bouwKlantOmschrijving, afspraakMoment, afspraakNotitie } from '@/lib/sales/briefing'
import { listPipelines, defaultPipelineId } from '@/lib/sales/pipelines'
import { googleKleurId } from '@/lib/sales/merk'
import {
  maakClickupTaak, werkClickupTaakBij, sluitClickupTaak, stuurInterneMelding,
  type AfspraakGegevens,
} from '@/lib/sales/afspraak-sync'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Hervalidatie: valt dit tijdvak écht binnen een boekbaar (wit) segment? */
async function assertBookable(
  salesClientId: string, start: number, end: number, ownerId: string | null, ignoreApptId?: string,
): Promise<void> {
  const pad = 86400000
  const data = await loadCalendar(salesClientId, start - pad, end + pad, ownerId)
  if (!data) throw new Error('Pipeline niet gevonden')

  // Bij verplaatsen telt de afspraak zelf niet als blokkade: die gaat immers weg
  // van zijn oude plek. We voegen zijn eigen tijd daarom terug toe aan het wit.
  let segments = data.segments
  if (ignoreApptId) {
    const self = data.appointments.find((a) => a.id === ignoreApptId)
    if (self) {
      const s = new Date(self.starts_at).getTime(), e = new Date(self.ends_at).getTime()
      segments = [...segments, { start: s, end: e }]
        .sort((a, b) => a.start - b.start)
        .reduce<{ start: number; end: number }[]>((acc, cur) => {
          const last = acc[acc.length - 1]
          if (last && cur.start <= last.end) last.end = Math.max(last.end, cur.end)
          else acc.push({ ...cur })
          return acc
        }, [])
    }
  }

  if (!isBookable(segments, start, end)) {
    throw new Error('Dit moment is niet (meer) vrij. Ververs de agenda en kies een wit vak.')
  }

  // Max. aantal afspraken per dag (§8).
  const client = data.client
  if (client.max_per_day > 0) {
    const dayStart = new Date(start); dayStart.setUTCHours(0, 0, 0, 0)
    const sameDay = data.appointments.filter((a) => {
      if (a.id === ignoreApptId) return false
      const t = new Date(a.starts_at).getTime()
      return t >= dayStart.getTime() && t < dayStart.getTime() + 86400000
    })
    if (sameDay.length >= client.max_per_day) {
      throw new Error(`Er staan maximaal ${client.max_per_day} afspraken per dag ingesteld.`)
    }
  }
}

/**
 * Het setterprofiel van wie boekt, of null.
 *
 * Bestaat er al een profiel, dan gebruiken we dat. Bestaat het niet, dan maken
 * we er enkel één aan voor een niet-admin — zie de toelichting bij de aanroep.
 * Faalt dit om welke reden ook, dan geven we null terug: een boeking mag hier
 * nooit op stuklopen, en setter_id blijft altijd als terugval staan.
 */
async function bepaalSetterProfiel(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  actor: { id: string; email?: string | null },
): Promise<string | null> {
  try {
    const { data } = await admin.from('sales_setters')
      .select('id').eq('auth_user_id', actor.id).maybeSingle()
    const bestaand = (data as { id: string } | null)?.id
    if (bestaand) return bestaand

    if (await requireAdmin()) return null

    const naam = actor.email?.split('@')[0] ?? 'Appointment setter'
    const nieuw = await getOrCreateSetter(actor.id, naam, actor.email ?? null)
    return nieuw?.id ?? null
  } catch {
    return null
  }
}

// POST — boeken (§5). Transactioneel van opzet: mislukt Google, dan rollen we
// de afspraak terug zodat er nooit een afspraak zonder agenda-item bestaat.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()

    const start = Number(b.startsAt), end = Number(b.endsAt)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return NextResponse.json({ error: 'Ongeldig tijdvak' }, { status: 400 })
    }

    // Eén pipeline: het id komt van de server, nooit uit het verzoek.
    const client = await getOrCreateSalesOrg()
    const salesClientId = client.id

    // Welke agenda (persoon)? Zonder keuze pakt loadCalendar de eerste.
    const requestedOwner = b.ownerId ? String(b.ownerId) : null
    const cal = await loadCalendar(salesClientId, start - 864e5, end + 864e5, requestedOwner)
    const ownerId = cal?.ownerId ?? null
    if (!ownerId) return NextResponse.json({ error: 'Koppel eerst een agenda (Bram of Marco) via Appointment setting.' }, { status: 400 })

    // 1) Hervalideren tegen dezelfde berekening als de kalender tekent.
    await assertBookable(salesClientId, start, end, ownerId)

    const admin = createAdminSupabaseClient()
    const leadId = b.leadId ? String(b.leadId) : null

    // Aan wie hangt deze afspraak?
    //
    // We zetten het setterprofiel HIER al, niet pas bij het registreren van de
    // afloop. Deed je dat later, dan heeft elke nog openstaande afspraak geen
    // profiel — precies degene die opgevolgd moeten worden vallen dan uit alle
    // cijfers per setter. Dat was de situatie: álle bestaande afspraken hadden
    // wel setter_id en geen setter_profile_id.
    //
    // Een profiel AANMAKEN doen we enkel voor wie geen admin is, net als in
    // /api/admin/sales/stats. Anders krijgt elke admin die eens voor iemand
    // inboekt een setterprofiel met uurtarief en commissie, en duikt hij op in
    // de setterlijsten.
    const setterProfileId = await bepaalSetterProfiel(admin, actor)

    // Contact + e-mail bepalen. Een handmatig ingevuld adres overschrijft het
    // adres van de lead in de CRM (§5).
    let contactId: string | null = null
    let attendee: string | null = String(b.attendeeEmail ?? '').trim() || null
    let leadStage: string | null = null
    // Voor welk merk is deze afspraak? Standaard het merk van de lead, maar de
    // setter mag dat overrulen: aan de telefoon blijkt soms dat een prospect uit
    // de ene pipeline beter bij het andere merk past. De keuze wordt hieronder
    // wel gecontroleerd tegen onze eigen pipelines.
    let pipelineId: string | null = null
    let leadPipelineId: string | null = null
    if (leadId) {
      const { data: lead } = await admin
        .from('sales_leads')
        .select('id, contact_id, stage_key, pipeline_id, sales_contacts ( id, email )')
        .eq('id', leadId).eq('sales_client_id', salesClientId).maybeSingle()
      if (!lead) return NextResponse.json({ error: 'Deze lead staat niet in de pipeline' }, { status: 400 })
      contactId = (lead as { contact_id: string | null }).contact_id
      leadStage = (lead as { stage_key: string }).stage_key
      leadPipelineId = (lead as { pipeline_id: string | null }).pipeline_id
      pipelineId = leadPipelineId
      const leadEmail = (lead as { sales_contacts?: { email?: string | null } | null }).sales_contacts?.email ?? null
      if (!attendee) attendee = leadEmail
      else if (contactId && attendee !== leadEmail) {
        await admin.from('sales_contacts').update({ email: attendee }).eq('id', contactId)
      }
    }

    const pipelines = await listPipelines()
    const chosen = pipelines.find((p) => p.id === String(b.pipelineId ?? ''))?.id
    // Een geldige keuze wint van het merk van de lead; anders de lead, anders
    // de standaard. Een onbekend id wordt genegeerd, niet overgenomen.
    pipelineId = chosen ?? pipelineId ?? await defaultPipelineId()

    // Hoort de gekozen agenda wel bij dit merk? Elke agenda-koppeling kan aan
    // één merk hangen (Marco×NextGenMedia is een andere agenda dan
    // Marco×NextGenSolutions). Een merkloze agenda mag voor beide boeken.
    const agenda = cal?.owners.find((o) => o.id === ownerId) ?? null
    if (agenda?.pipeline_id && agenda.pipeline_id !== pipelineId) {
      const agendaMerk = pipelines.find((p) => p.id === agenda.pipeline_id)?.name ?? 'een ander merk'
      return NextResponse.json({
        error: `De agenda van ${agenda.name ?? 'deze persoon'} hoort bij ${agendaMerk}. Kies de agenda van het juiste merk, of wissel het merk van de afspraak.`,
      }, { status: 400 })
    }

    // 2) Afspraak vastleggen. De exclusion-constraint in de database is de
    //    laatste rem tegen dubbel boeken bij gelijktijdige verzoeken.
    const { data: appt, error: apptErr } = await admin.from('sales_appointments').insert({
      sales_client_id: salesClientId,
      pipeline_id: pipelineId,
      lead_id: leadId,
      contact_id: contactId,
      setter_id: actor.id,
      setter_profile_id: setterProfileId,
      calendar_id: ownerId,
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(end).toISOString(),
      status: 'scheduled',
      notes: String(b.notes ?? '') || null,
      client_note: String(b.clientNote ?? '') || null,
      adres: String(b.adres ?? '').trim() || null,
      attendee_email: attendee,
    }).select('id').single()
    if (apptErr || !appt) {
      const dup = /exclusion|overlap|sales_appt_no_overlap/i.test(apptErr?.message ?? '')
      return NextResponse.json({ error: dup ? 'Er staat al een afspraak op dit moment.' : 'Afspraak opslaan mislukt' }, { status: 409 })
    }

    // 2b) Nacontrole over de ZUSTER-agenda's. De exclusion-constraint werkt per
    //     agenda-koppeling, maar "Marco × NextGenMedia" en "Marco ×
    //     NextGenSolutions" zijn twee koppelingen op hetzelfde Google-account:
    //     boeken twee setters exact tegelijk hetzelfde slot op die twee, dan
    //     ziet de constraint geen botsing en staat Marco twee keer geboekt.
    //     Daarom kijken we ná onze insert nog één keer of er een overlappende
    //     afspraak op een zuster-agenda staat; zo ja, trekken we de onze terug.
    //     (Kruisen twee verzoeken elkaar exact, dan zien beide de ander en
    //     trekken beide terug — een niet-boeking is altijd veiliger dan een
    //     dubbele boeking.)
    const zusterIds = (cal?.owners ?? [])
      .filter((o) => o.id !== ownerId && !!agenda?.account_email && o.account_email === agenda.account_email)
      .map((o) => o.id)
    if (zusterIds.length > 0) {
      const { data: botsing } = await admin.from('sales_appointments')
        .select('id')
        .in('calendar_id', zusterIds)
        .neq('status', 'cancelled')
        .lt('starts_at', new Date(end).toISOString())
        .gt('ends_at', new Date(start).toISOString())
        .limit(1)
      if ((botsing ?? []).length > 0) {
        await admin.from('sales_appointments').delete().eq('id', appt.id)
        return NextResponse.json({
          error: `${agenda?.name ?? 'Deze persoon'} heeft op dit moment al een afspraak in zijn andere agenda.`,
        }, { status: 409 })
      }
    }

    // 3) Google-event aanmaken. Mislukt dit → afspraak terugdraaien.
    let meetUrl: string | null = null
    // Buiten de try: de ClickUp-taak en de interne melding (stap 3b) hebben
    // dezelfde gegevens nodig, en die stappen mogen de afspraak nooit
    // terugrollen — dus die staan bewust ná het try/catch-blok.
    let gegevens: AfspraakGegevens | null = null
    try {
      // Alles wat de closer nodig heeft komt in het agenda-item zelf: hij
      // opent 's ochtends zijn agenda en mag daarvoor de app niet in hoeven.
      const { data: infoRow } = leadId
        ? await admin.from('sales_leads')
          .select('sales_companies ( name ), sales_contacts ( name, phone, mobile, email )')
          .eq('id', leadId).maybeSingle()
        : { data: null }
      const info = infoRow as {
        sales_companies?: { name?: string } | null
        sales_contacts?: { name?: string; phone?: string; mobile?: string; email?: string } | null
      } | null
      const company = info?.sales_companies?.name ?? 'Prospect'
      const c = info?.sales_contacts ?? null
      const merk = pipelines.find((p) => p.id === pipelineId)?.name ?? null

      const briefing = {
        bedrijf: company,
        contact: c?.name ?? null,
        telefoon: c?.mobile || c?.phone || null,
        email: c?.email || attendee || null,
        adres: String(b.adres ?? '').trim() || null,
        merk,
        setter: actor.email ?? null,
        briefing: String(b.notes ?? '').trim() || null,
        klantNotitie: String(b.clientNote ?? '').trim() || null,
      }

      // Titel: wat de setter intikte, anders "Bedrijf — Merk". De prospect
      // ziet deze titel in zijn uitnodiging, dus hij is instelbaar. Het merk
      // hoort er ALTIJD in — beide merken boeken in dezelfde agenda per
      // persoon, dus zonder merk in de titel weet je in Google niet meer
      // voor welk bedrijf de afspraak is.
      const eigenTitel = String(b.titel ?? '').trim().slice(0, 120)
      let titel = eigenTitel || bouwAgendaTitel(briefing)
      if (merk && !titel.toLowerCase().includes(merk.toLowerCase())) {
        titel = `${titel} — ${merk}`
      }

      /**
       * Omschrijving hangt af van wie meekijkt. MET genodigde leest de
       * prospect de tekst mee in zijn uitnodiging → de nette klantversie
       * (adres, merk, afspraken, Meet); de interne briefing gaat dan enkel
       * naar ClickUp en de interne melding. ZONDER genodigde is het event
       * puur intern en blijft de volledige briefing gewoon staan.
       */
      const ev = await createEvent(ownerId, {
        summary: titel,
        description: attendee ? bouwKlantOmschrijving(briefing) : bouwAgendaOmschrijving(briefing),
        location: briefing.adres,
        startsAt: start, endsAt: end, timezone: client.timezone,
        attendeeEmail: attendee, withMeet: b.withMeet !== false,
        // Geel blok = NextGenMedia, blauw blok = NextGenSolutions — dezelfde
        // kleuren als de mappen in ClickUp.
        colorId: googleKleurId(pipelines.find((p) => p.id === pipelineId)?.key),
      })
      meetUrl = ev.meetUrl
      await admin.from('sales_appointments')
        .update({ external_event_id: ev.eventId, meet_url: ev.meetUrl }).eq('id', appt.id)
      // Titel apart en best-effort: de kolom bestaat pas na de migratie, en
      // een boeking mag daar nooit op stuklopen.
      await admin.from('sales_appointments').update({ titel }).eq('id', appt.id)

      gegevens = {
        apptId: appt.id as string,
        startMs: start, endMs: end,
        bedrijf: company,
        contact: briefing.contact,
        telefoon: briefing.telefoon,
        email: briefing.email,
        adres: briefing.adres,
        meetUrl: ev.meetUrl,
        notities: briefing.briefing,
        agendaNaam: agenda?.name ?? null,
        setterEmail: actor.email ?? null,
      }
    } catch (e) {
      await admin.from('sales_appointments').delete().eq('id', appt.id)
      return NextResponse.json({ error: `De afspraak is niet geboekt: ${e instanceof Error ? e.message : 'agenda-fout'}` }, { status: 502 })
    }

    // 3b) ClickUp-taak in de agenda-lijst van het merk + interne melding naar
    //     het merk-adres. Best-effort en parallel: de afspraak staat al vast in
    //     de database én in Google — wat hier misgaat wordt een waarschuwing op
    //     het scherm, nooit een mislukte boeking.
    const waarschuwingen: string[] = []
    if (gegevens) {
      const pipeline = pipelines.find((p) => p.id === pipelineId) ?? null
      const [taakW, mailW] = await Promise.all([
        maakClickupTaak(pipeline, agenda?.clickup_assignee_id ?? null, gegevens),
        stuurInterneMelding(pipeline, gegevens),
      ])
      for (const w of [taakW, mailW]) if (w) waarschuwingen.push(w)
    }

    // 4) DE KOPPELING (§6): een geslaagde boeking — en alleen dat — zet de lead
    //    op "Afspraak ingepland".
    if (leadId) {
      await admin.from('sales_leads').update({ stage_key: APPOINTMENT_STAGE }).eq('id', leadId)
      // Eén activiteit "afspraak gepland" mét afspraak-id (verplaatsen maakt
      // er nooit een tweede), plus de fasewissel als aparte regel.
      await registreerActiviteit(admin, {
        leadId, medewerkerId: actor.id, medewerkerEmail: actor.email ?? null,
        type: 'afspraak_gepland', afspraakId: appt.id as string,
        extra: `${afspraakMoment(start, client.timezone)}${agenda?.name ? ` (agenda ${agenda.name})` : ''}`,
      })
      if (normaliseerStage(leadStage) !== APPOINTMENT_STAGE) {
        await registreerActiviteit(admin, {
          leadId, medewerkerId: actor.id, medewerkerEmail: actor.email ?? null,
          type: 'fase_gewijzigd', vanFase: normaliseerStage(leadStage), naarFase: APPOINTMENT_STAGE,
        })
      }
      // De briefing hoort óók op de tijdlijn van de lead (en dus in "laatste
      // notitie"). Tot nu stond ze enkel op de afspraak en in Google/ClickUp/
      // mail, waardoor de app "niets genoteerd" toonde.
      const notitie = afspraakNotitie({ startMs: start, briefing: String(b.notes ?? ''), klantNotitie: String(b.clientNote ?? ''), timeZone: client.timezone })
      if (notitie) await logLeadEvent(leadId, { kind: 'note', body: notitie, actorId: actor.id, actorEmail: actor.email ?? null })
    }

    // 4b) Boek je een lead voor het ándere merk, dan hoort die lead daar
    //     voortaan ook thuis: blijkt aan de telefoon dat iemand uit de ene
    //     pipeline beter bij het andere past, dan verhuist hij mee.
    if (leadId && pipelineId && leadPipelineId && pipelineId !== leadPipelineId) {
      const moved = await moveLeadToPipeline(leadId, pipelineId)
      if (moved.ok) {
        await logLeadEvent(leadId, {
          kind: 'system', body: 'Verhuisd naar het merk van de geboekte afspraak',
          actorId: actor.id, actorEmail: actor.email ?? null,
        })
      } else {
        waarschuwingen.push(`De afspraak staat geboekt, maar de lead kon niet mee verhuizen: ${moved.error}`)
      }
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'sales.appointment.book', entityType: 'sales_appointment', entityId: appt.id as string,
      summary: `Verkoop: afspraak geboekt voor ${client.name}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })

    return NextResponse.json({
      ok: true, id: appt.id, meetUrl,
      waarschuwing: waarschuwingen.length ? waarschuwingen.join('\n') : null,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH — een afspraak bewerken (§5): tijd, lead, merk, agenda (persoon),
// titel, briefing, klantnotitie, adres, Meet-link en genodigde.
//
// Enkel wat meegestuurd wordt verandert. Het tijdvak wordt enkel opnieuw
// gecontroleerd als het uur of de agenda wijzigt — een typfout in de briefing
// rechtzetten mag niet mislukken omdat de werkuren sindsdien veranderden.
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    const id = String(b.id ?? '')
    const start = Number(b.startsAt), end = Number(b.endsAt)
    if (!id || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return NextResponse.json({ error: 'Ongeldig tijdvak' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()
    // '*': clickup_task_id en titel bestaan pas na de migratie; een vaste
    // kolomlijst zou dan de hele query breken.
    const { data: appt } = await admin.from('sales_appointments')
      .select('*')
      .eq('id', id).maybeSingle() as { data: {
        id: string; sales_client_id: string; external_event_id: string | null
        status: string; calendar_id: string | null; lead_id: string | null
        starts_at: string; ends_at: string; pipeline_id: string | null
        clickup_task_id?: string | null; attendee_email: string | null
        adres: string | null; notes: string | null; meet_url: string | null
        client_note?: string | null; titel?: string | null; setter_id?: string | null
      } | null }
    if (!appt) return NextResponse.json({ error: 'Afspraak niet gevonden' }, { status: 404 })
    if (appt.status === 'cancelled') return NextResponse.json({ error: 'Deze afspraak is geannuleerd' }, { status: 400 })

    const org = await getOrCreateSalesOrg()
    const tijdGewijzigd = start !== new Date(appt.starts_at).getTime() || end !== new Date(appt.ends_at).getTime()

    // ── Agenda (persoon) wisselen ───────────────────────────────────────────
    const owners = await listOwners(appt.sales_client_id)
    let nieuweAgenda: CalendarOwner | null = null
    if (b.ownerId && String(b.ownerId) !== (appt.calendar_id ?? '')) {
      nieuweAgenda = owners.find((o) => o.id === String(b.ownerId)) ?? null
      if (!nieuweAgenda) return NextResponse.json({ error: 'Deze agenda bestaat niet (meer).' }, { status: 400 })
      if (nieuweAgenda.status !== 'connected') {
        return NextResponse.json({ error: `De agenda van ${nieuweAgenda.name} is niet (meer) verbonden met Google. Koppel ze eerst opnieuw.` }, { status: 400 })
      }
    }
    const doelAgendaId = nieuweAgenda?.id ?? appt.calendar_id
    if (tijdGewijzigd || nieuweAgenda) {
      await assertBookable(appt.sales_client_id, start, end, doelAgendaId, id)
    }

    const tekst = (v: unknown, max: number): string | null => String(v ?? '').trim().slice(0, max) || null
    const patch: Record<string, unknown> = {
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(end).toISOString(),
    }
    if (nieuweAgenda) patch.calendar_id = nieuweAgenda.id
    if (b.notes !== undefined) patch.notes = tekst(b.notes, 4000)
    if (b.clientNote !== undefined) patch.client_note = tekst(b.clientNote, 2000)
    if (b.adres !== undefined) patch.adres = tekst(b.adres, 300)
    if (b.meetUrl !== undefined) {
      const url = tekst(b.meetUrl, 500)
      if (url && !/^https?:\/\/\S+$/i.test(url)) {
        return NextResponse.json({ error: 'De online link moet met https:// beginnen.' }, { status: 400 })
      }
      patch.meet_url = url
    }
    const nieuweTitel: string | null | undefined = b.titel !== undefined ? tekst(b.titel, 120) : undefined

    // Merk mag ook bij het bewerken nog wisselen.
    const allPipelines = await listPipelines()
    const wantedPipeline = allPipelines.find((p) => p.id === String(b.pipelineId ?? ''))?.id

    // Lead wisselen mag mee in dezelfde bewerking. De afspraak erft dan ook het
    // merk van die lead — anders zou de verkeerde brochure meegaan.
    if ('leadId' in b) {
      const newLeadId: string | null = b.leadId ? String(b.leadId) : null
      if (newLeadId) {
        const { data: lead } = await admin.from('sales_leads')
          .select('id, contact_id, pipeline_id, sales_contacts ( email )')
          .eq('id', newLeadId).eq('sales_client_id', appt.sales_client_id as string).maybeSingle()
        if (!lead) return NextResponse.json({ error: 'Deze lead staat niet in de pipeline' }, { status: 400 })
        if (newLeadId !== appt.lead_id) {
          patch.lead_id = newLeadId
          patch.contact_id = (lead as { contact_id: string | null }).contact_id
          patch.pipeline_id = (lead as { pipeline_id: string | null }).pipeline_id
          const leadEmail = (lead as { sales_contacts?: { email?: string | null } | null }).sales_contacts?.email ?? null
          if (leadEmail) patch.attendee_email = leadEmail
        }
      } else if (appt.lead_id) {
        patch.lead_id = null
      }
    }
    if (typeof b.attendeeEmail === 'string') {
      const mail = b.attendeeEmail.trim() || null
      if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
        return NextResponse.json({ error: 'Het e-mailadres van de genodigde klopt niet.' }, { status: 400 })
      }
      patch.attendee_email = mail
    }
    // Een uitdrukkelijke merkkeuze wint van wat de lead zegt.
    if (wantedPipeline) patch.pipeline_id = wantedPipeline

    // Zelfde regel als bij het boeken: hoort de agenda bij één merk, dan kan de
    // afspraak niet naar het ándere merk — anders staat een NextGenSolutions-
    // afspraak in de NextGenMedia-agenda.
    const huidigeAgenda = owners.find((o) => o.id === appt.calendar_id) ?? null
    const agendaRij = nieuweAgenda ?? huidigeAgenda
    const doelPipelineId = (patch.pipeline_id as string | null | undefined) ?? appt.pipeline_id
    if (agendaRij?.pipeline_id && doelPipelineId && agendaRij.pipeline_id !== doelPipelineId) {
      const agendaMerk = allPipelines.find((p) => p.id === agendaRij.pipeline_id)?.name ?? 'een ander merk'
      return NextResponse.json({
        error: nieuweAgenda
          ? `De agenda van ${agendaRij.name} hoort bij ${agendaMerk}. Kies een agenda van het juiste merk, of wissel ook het merk.`
          : `De agenda van ${agendaRij.name ?? 'deze persoon'} hoort bij ${agendaMerk}. Kies een agenda van het juiste merk (veld Agenda), of boek de afspraak opnieuw.`,
      }, { status: 400 })
    }

    // Wat verandert er inhoudelijk (voor Google, ClickUp en de tijdlijn)?
    const vorig = appt as unknown as Record<string, unknown>
    const LABELS: Record<string, string> = {
      notes: 'briefing', client_note: 'afspraken met de prospect', adres: 'adres', meet_url: 'online link',
      attendee_email: 'genodigde', lead_id: 'lead', pipeline_id: 'merk',
    }
    const gewijzigd = Object.keys(LABELS).filter((k) => k in patch && (patch[k] ?? null) !== (vorig[k] ?? null))
    const titelGewijzigd = nieuweTitel !== undefined && nieuweTitel !== (appt.titel ?? null)
    const detailsGewijzigd = gewijzigd.length > 0 || titelGewijzigd

    const { error } = await admin.from('sales_appointments').update(patch).eq('id', id)
    if (error) {
      const dup = /exclusion|overlap/i.test(error.message)
      return NextResponse.json({ error: dup ? 'Er staat al een afspraak op dit moment in die agenda.' : 'Opslaan mislukt' }, { status: 409 })
    }

    // Effectieve waarden na deze bewerking.
    const eff = {
      leadId: ('lead_id' in patch ? patch.lead_id : appt.lead_id) as string | null,
      pipelineId: doelPipelineId ?? null,
      notes: ('notes' in patch ? patch.notes : appt.notes) as string | null,
      clientNote: ('client_note' in patch ? patch.client_note : appt.client_note ?? null) as string | null,
      adres: ('adres' in patch ? patch.adres : appt.adres) as string | null,
      meetUrl: ('meet_url' in patch ? patch.meet_url : appt.meet_url) as string | null,
      attendee: ('attendee_email' in patch ? patch.attendee_email : appt.attendee_email) as string | null,
      titel: (nieuweTitel !== undefined ? nieuweTitel : appt.titel ?? null) as string | null,
    }
    const nieuwePipeline = allPipelines.find((p) => p.id === eff.pipelineId) ?? null

    // Lead-, setter- en merkgegevens voor het agenda-item en de ClickUp-taak.
    const { data: infoRow } = eff.leadId
      ? await admin.from('sales_leads')
        .select('sales_companies ( name ), sales_contacts ( name, phone, mobile, email )')
        .eq('id', eff.leadId).maybeSingle()
      : { data: null }
    const info = infoRow as {
      sales_companies?: { name?: string } | null
      sales_contacts?: { name?: string; phone?: string; mobile?: string; email?: string } | null
    } | null
    let setterEmail: string | null = null
    if (appt.setter_id && (detailsGewijzigd || nieuweAgenda)) {
      try {
        const { data: u } = await admin.auth.admin.getUserById(appt.setter_id)
        setterEmail = u?.user?.email ?? null
      } catch { /* enkel voor "Ingeboekt door" */ }
    }
    const bouwEvent = (meetInTekst: string | null) => {
      const briefing = {
        bedrijf: info?.sales_companies?.name ?? 'Prospect',
        contact: info?.sales_contacts?.name ?? null,
        telefoon: info?.sales_contacts?.mobile || info?.sales_contacts?.phone || null,
        email: info?.sales_contacts?.email || eff.attendee || null,
        adres: eff.adres, merk: nieuwePipeline?.name ?? null, setter: setterEmail,
        briefing: eff.notes, klantNotitie: eff.clientNote, meetUrl: meetInTekst,
      }
      let titel = eff.titel || bouwAgendaTitel(briefing)
      if (briefing.merk && !titel.toLowerCase().includes(briefing.merk.toLowerCase())) titel = `${titel} — ${briefing.merk}`
      return {
        summary: titel,
        description: eff.attendee ? bouwKlantOmschrijving(briefing) : bouwAgendaOmschrijving(briefing),
      }
    }

    const waarschuwingen: string[] = []
    if (nieuweAgenda) {
      /**
       * Andere persoon = ander Google-agenda. Eerst het nieuwe event maken; pas
       * als dat lukt het oude weghalen. Mislukt Google, dan zetten we de
       * afspraak in de app terug zoals ze was — nooit een afspraak die in de
       * app bij Marco staat en in Google nog bij Bram.
       */
      const eigenMeet = 'meet_url' in patch && (patch.meet_url ?? null) !== (appt.meet_url ?? null)
      const googleMeet = !!appt.meet_url && /meet\.google\.com/i.test(appt.meet_url) && !eigenMeet
      try {
        const ev = await createEvent(nieuweAgenda.id, {
          ...bouwEvent(googleMeet ? null : eff.meetUrl),
          location: eff.adres, startsAt: start, endsAt: end, timezone: org.timezone,
          attendeeEmail: eff.attendee, withMeet: googleMeet,
          colorId: googleKleurId(nieuwePipeline?.key),
        })
        const bij: Record<string, unknown> = { external_event_id: ev.eventId }
        if (googleMeet && ev.meetUrl) { bij.meet_url = ev.meetUrl; eff.meetUrl = ev.meetUrl }
        await admin.from('sales_appointments').update(bij).eq('id', id)
      } catch (e) {
        const terug: Record<string, unknown> = {}
        for (const k of Object.keys(patch)) terug[k] = vorig[k] ?? null
        await admin.from('sales_appointments').update(terug).eq('id', id)
        return NextResponse.json({
          error: `Niets gewijzigd: de agenda van ${nieuweAgenda.name} gaf een fout (${e instanceof Error ? e.message : 'onbekend'}).`,
        }, { status: 502 })
      }
      if (appt.external_event_id && appt.calendar_id) {
        await deleteEvent(appt.calendar_id, appt.external_event_id)
      }
    } else if (appt.external_event_id && appt.calendar_id) {
      if (tijdGewijzigd) {
        try {
          await moveEvent(appt.calendar_id, appt.external_event_id, start, end, org.timezone)
        } catch (e) {
          return NextResponse.json({ error: `Verplaatst in de app, maar de agenda gaf een fout: ${e instanceof Error ? e.message : 'onbekend'}` }, { status: 502 })
        }
      }
      if (detailsGewijzigd) {
        try {
          await werkEventBij(appt.calendar_id, appt.external_event_id, {
            ...bouwEvent(eff.meetUrl),
            location: eff.adres,
            attendeeEmail: gewijzigd.includes('attendee_email') ? eff.attendee : undefined,
            metGenodigde: !!eff.attendee,
          })
        } catch (e) {
          waarschuwingen.push(`Bijgewerkt in de app, maar het agenda-item niet: ${e instanceof Error ? e.message : 'onbekende fout'}`)
        }
      }
    }

    // Titel apart en best-effort: de kolom bestaat pas na de migratie.
    if (titelGewijzigd) await admin.from('sales_appointments').update({ titel: nieuweTitel }).eq('id', id)

    // Verzet betekent: opnieuw bevestigen. Een afspraak die je vorige week
    // telefonisch bevestigd hebt staat nu op een ander uur (of bij een andere
    // persoon), dus die hoort weer op de bellijst.
    let reminderNote: string | null = null
    if (tijdGewijzigd || nieuweAgenda) {
      const { data: was } = await admin.from('sales_appointments')
        .select('bevestigd_op').eq('id', id).maybeSingle()
      if ((was as { bevestigd_op: string | null } | null)?.bevestigd_op) {
        await admin.from('sales_appointments')
          .update({ bevestigd_op: null, bevestigd_door: null }).eq('id', id)
        reminderNote = 'Deze afspraak was al telefonisch bevestigd. Omdat het uur of de agenda wijzigt staat hij weer op de bellijst.'
      }
    }

    // De ClickUp-taak laten meebewegen. Bij een merk- of agendawissel hoort
    // er een nieuwe taak (andere lijst of andere toegewezene): EERST de nieuwe
    // maken, en pas als dat gelukt is de oude dichtzetten. Andersom zou een
    // ClickUp-storing de taak van een gewoon doorgaande afspraak op
    // [GEANNULEERD] zetten zonder dat er ooit een nieuwe komt.
    if (appt.clickup_task_id && (tijdGewijzigd || detailsGewijzigd || nieuweAgenda)) {
      const gegevens: AfspraakGegevens = {
        apptId: id, startMs: start, endMs: end,
        bedrijf: info?.sales_companies?.name ?? 'Prospect',
        contact: info?.sales_contacts?.name ?? null,
        telefoon: info?.sales_contacts?.mobile || info?.sales_contacts?.phone || null,
        email: eff.attendee,
        adres: eff.adres,
        meetUrl: eff.meetUrl,
        notities: eff.notes,
        agendaNaam: agendaRij?.name ?? null,
        setterEmail: actor.email ?? null,
      }

      const merkGewisseld = !!eff.pipelineId && !!appt.pipeline_id && eff.pipelineId !== appt.pipeline_id
      if (merkGewisseld || nieuweAgenda) {
        if (nieuwePipeline?.clickup_list_id) {
          // maakClickupTaak schrijft bij succes zelf het nieuwe taak-id op de
          // afspraak; daarna mag de oude taak pas dicht.
          const maakW = await maakClickupTaak(nieuwePipeline, agendaRij?.clickup_assignee_id ?? null, gegevens)
          if (maakW) {
            waarschuwingen.push(`${maakW} De oude taak blijft daarom gewoon staan.`)
          } else {
            const sluitW = await sluitClickupTaak(appt.clickup_task_id)
            if (sluitW) waarschuwingen.push(sluitW)
          }
        } else {
          // Geen ClickUp-lijst voor dit merk: de oude taak netjes afsluiten en
          // de koppeling wissen — en dat eerlijk melden.
          const sluitW = await sluitClickupTaak(appt.clickup_task_id)
          await admin.from('sales_appointments').update({ clickup_task_id: null }).eq('id', id)
          waarschuwingen.push(
            sluitW ?? `${nieuwePipeline?.name ?? 'Het merk'} heeft geen ClickUp-lijst ingesteld; de oude ClickUp-taak is afgesloten en er is geen nieuwe aangemaakt.`,
          )
        }
      } else {
        const w = await werkClickupTaakBij(appt.clickup_task_id, nieuwePipeline, gegevens)
        if (w) waarschuwingen.push(w)
      }
    }

    // Op de tijdlijn van de lead: wat er aan de afspraak veranderde.
    if (eff.leadId && (tijdGewijzigd || detailsGewijzigd || nieuweAgenda)) {
      const delen = [
        tijdGewijzigd ? `verzet naar ${afspraakMoment(start, org.timezone)}` : null,
        nieuweAgenda ? `agenda → ${nieuweAgenda.name}` : null,
        titelGewijzigd ? 'titel' : null,
        ...gewijzigd.filter((k) => k !== 'lead_id').map((k) => LABELS[k]),
      ].filter(Boolean)
      if (delen.length) {
        await logLeadEvent(eff.leadId, { kind: 'system', body: `Afspraak aangepast: ${delen.join(', ')}`, actorId: actor.id, actorEmail: actor.email ?? null })
      }
    }

    const meta2 = requestMeta(req)
    await logAudit({
      action: tijdGewijzigd || nieuweAgenda ? 'sales.appointment.move' : 'sales.appointment.edit',
      entityType: 'sales_appointment', entityId: id,
      summary: tijdGewijzigd || nieuweAgenda
        ? `Verkoop: afspraak verzet naar ${new Date(start).toISOString()}${nieuweAgenda ? ` (agenda ${nieuweAgenda.name})` : ''}`
        : `Verkoop: afspraak bewerkt (${[titelGewijzigd ? 'titel' : null, ...gewijzigd.map((k) => LABELS[k])].filter(Boolean).join(', ') || 'geen wijziging'})`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta2.ip, userAgent: meta2.userAgent,
    })

    return NextResponse.json({
      ok: true, reminderNote,
      waarschuwing: waarschuwingen.length ? waarschuwingen.join('\n') : null,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?id= — annuleren. Verwijdert het agenda-item en haalt de afspraak uit
// alle tellingen (§5: geannuleerde afspraken tellen NERGENS mee).
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id') ?? ''
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    // '*': zie PATCH — clickup_task_id kan op een oudere installatie ontbreken.
    const { data: appt } = await admin.from('sales_appointments')
      .select('*').eq('id', id).maybeSingle() as { data: {
        id: string; external_event_id: string | null; calendar_id: string | null
        clickup_task_id?: string | null
      } | null }
    if (!appt) return NextResponse.json({ error: 'Afspraak niet gevonden' }, { status: 404 })

    await admin.from('sales_appointments').update({ status: 'cancelled' }).eq('id', id)
    if (appt.external_event_id) {
      await deleteEvent(appt.calendar_id as string, appt.external_event_id as string)
    }
    // ClickUp-taak dichtzetten met [GEANNULEERD] — best-effort.
    const waarschuwing = await sluitClickupTaak(appt.clickup_task_id ?? null)
    return NextResponse.json({ ok: true, waarschuwing })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
