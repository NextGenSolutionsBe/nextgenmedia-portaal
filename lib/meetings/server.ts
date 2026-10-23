import 'server-only'
import { randomUUID } from 'crypto'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { sendEmail, baseUrl, EMAIL_FROM } from '@/lib/email'
import { buildEmailHtml } from '@/lib/email-html'
import {
  maakMeetingEvent, haalMeetingEvent, werkMeetingEventBij, annuleerMeetingEvent, type MeetingEvent,
} from '@/lib/sales/google-calendar'
import {
  clickupConfigured, maakAfspraakTaak, werkAfspraakTaakBij, annuleerAfspraakTaak, isTaskGone, zoekTaakMetMarker,
} from '@/lib/clickup'
import {
  googleEventId, googleOmschrijving, genodigden, clickupMarker, clickupTaakNaam, clickupOmschrijving,
  kiesHerinnering, magNogVersturen, herinneringsMail, MEETING_TIJDZONE, type Persoon,
} from '@/lib/meetings/model'

/**
 * Klantmeetings — de stappen naast de databank.
 *
 *  1. Google Calendar: afspraak met Meet-link, vaste event-id (geen dubbels).
 *  2. ClickUp: taak in de lijst van het merk, toegewezen aan de eigenaar van de
 *     agenda — dezelfde werkwijze als de verkoopafspraken (lib/sales/afspraak-sync).
 *  3. Herinnering: één geplande mail per meeting; de scheduler (pg_cron →
 *     /api/cron/klantmeetings) verstuurt hem op het juiste moment.
 *
 * Elke stap heeft een eigen status op de meeting. Een fout in één stap laat de
 * andere ongemoeid en kan los opnieuw geprobeerd worden.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

export type MeetingRij = {
  id: string; aanvraag_sleutel: string | null; client_id: string | null; klant_naam: string; titel: string; beschrijving: string | null
  starts_at: string; ends_at: string; tijdzone: string; status: 'ingepland' | 'geannuleerd'
  agenda_id: string | null; organisator_naam: string | null; organisator_email: string | null
  klant_ontvangers: Persoon[]; deelnemers: Persoon[]; herinnering_aan: boolean
  google_event_id: string | null; google_calendar_id: string | null; meet_url: string | null; google_status: string; google_fout: string | null
  clickup_task_id: string | null; clickup_list_id: string | null; clickup_status: string; clickup_fout: string | null; clickup_gestart_op: string | null
  created_by: string | null; created_by_email: string | null; created_at: string; updated_at: string
  geannuleerd_op: string | null; geannuleerd_door: string | null
}

export type HerinneringRij = {
  id: string; meeting_id: string; moment: string; gepland_voor: string; ontvangers: Persoon[]; status: string
  verzend_sleutel: string; provider_id: string | null; email_message_id: string | null; fout: string | null; pogingen: number
  bezig_sinds: string | null; verzonden_op: string | null; geannuleerd_op: string | null; created_at: string; updated_at: string
}

/** Foutmelding om te bewaren en te tonen: kort, en zonder iets dat op een sleutel lijkt. */
export function veiligeFout(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? 'Onbekende fout')
  return raw
    .replace(/Bearer\s+[\w.\-~+/=]+/gi, 'Bearer ***')
    .replace(/\b(pk|sk|re)_[\w-]{8,}/g, '***')
    .replace(/([?&](key|token|access_token|secret)=)[^&\s]+/gi, '$1***')
    .slice(0, 300)
}

const nu = () => new Date().toISOString()

async function bewaar(admin: Admin, id: string, velden: Partial<MeetingRij>): Promise<MeetingRij> {
  const { data, error } = await admin.from('klant_meetings').update({ ...velden, updated_at: nu() }).eq('id', id).select('*').single()
  if (error) throw new Error(error.message)
  return data as MeetingRij
}

export async function leesMeeting(admin: Admin, id: string): Promise<MeetingRij | null> {
  const { data } = await admin.from('klant_meetings').select('*').eq('id', id).maybeSingle()
  return (data as MeetingRij | null) ?? null
}

// ── 1. Google Calendar + Meet ────────────────────────────────────────────────

const eventVelden = (m: MeetingRij) => ({
  summary: m.titel,
  description: googleOmschrijving(m),
  startsAt: new Date(m.starts_at).toISOString(),
  endsAt: new Date(m.ends_at).toISOString(),
  timezone: m.tijdzone || MEETING_TIJDZONE,
  attendees: genodigden(m),
})

/**
 * Ontbreekt de Meet-link nog, dan eerst even wachten. Een net aangemaakte
 * aanvraag die nog loopt laten we lopen; bij een herhaling (de afspraak
 * bestond al) of een mislukte aanvraag vragen we een nieuwe link aan.
 */
async function zorgVoorMeet(agendaId: string, ev: MeetingEvent, meetingId: string, herhaling: boolean): Promise<MeetingEvent> {
  if (ev.meetUrl) return ev
  if (ev.meetStatus === 'bezig') {
    await new Promise((r) => setTimeout(r, 1500))
    const opnieuw = await haalMeetingEvent(agendaId, ev.calendarId, ev.eventId)
    if (opnieuw?.meetUrl) return opnieuw
    if (opnieuw?.meetStatus === 'bezig' && !herhaling) return opnieuw
  }
  return werkMeetingEventBij(agendaId, ev.calendarId, ev.eventId, { nieuweMeetRequestId: `${meetingId}-${Date.now()}` })
}

/**
 * Afspraak aanmaken of bijwerken in Google. Werpt nooit: de uitkomst staat op
 * de meeting. Bijwerken (met een agenda-update naar de genodigden) enkel na
 * een wijziging, of als de vorige poging daartoe mislukte.
 */
export async function stapGoogle(admin: Admin, m: MeetingRij, opts: { bijwerken?: boolean } = {}): Promise<MeetingRij> {
  if (m.status === 'geannuleerd') return m
  if (!m.agenda_id) return bewaar(admin, m.id, { google_status: 'fout', google_fout: 'Er is geen agenda gekozen voor deze meeting.' })
  const bijwerken = opts.bijwerken ?? m.google_status === 'fout'
  try {
    let ev: MeetingEvent | null = null
    let herhaling = false
    if (m.google_event_id && m.google_calendar_id) {
      herhaling = true
      ev = bijwerken
        ? await werkMeetingEventBij(m.agenda_id, m.google_calendar_id, m.google_event_id, eventVelden(m))
        : await haalMeetingEvent(m.agenda_id, m.google_calendar_id, m.google_event_id)
      if (ev?.geannuleerd) ev = null
    }
    if (!ev) {
      ev = await maakMeetingEvent(m.agenda_id, {
        ...eventVelden(m), eventId: googleEventId(m.id), meetRequestId: m.id, calendarId: m.google_calendar_id,
      })
    }
    ev = await zorgVoorMeet(m.agenda_id, ev, m.id, herhaling)
    return bewaar(admin, m.id, {
      google_event_id: ev.eventId, google_calendar_id: ev.calendarId, meet_url: ev.meetUrl ?? m.meet_url,
      google_status: 'ok', google_fout: null,
    })
  } catch (e) {
    return bewaar(admin, m.id, { google_status: 'fout', google_fout: veiligeFout(e) })
  }
}

// ── 2. ClickUp ───────────────────────────────────────────────────────────────

/** Zelfde lijst en eigenaar als de verkoopafspraken: het merk van de agenda, anders NextGenMedia. */
async function clickupDoel(admin: Admin, agendaId: string | null): Promise<{ listId: string | null; assigneeId: number | null }> {
  let pipelineId: string | null = null
  let assigneeId: number | null = null
  if (agendaId) {
    const { data } = await admin.from('sales_calendar_connections').select('pipeline_id, clickup_assignee_id').eq('id', agendaId).maybeSingle()
    pipelineId = (data?.pipeline_id as string | null) ?? null
    assigneeId = data?.clickup_assignee_id ? Number(data.clickup_assignee_id) : null
  }
  const { data: pipes } = await admin.from('sales_pipelines').select('id, key, clickup_list_id')
  const lijst = (pipes ?? []) as { id: string; key: string; clickup_list_id: string | null }[]
  const pipe = lijst.find((p) => p.id === pipelineId) ?? lijst.find((p) => p.key === 'nextgenmedia')
  return { listId: pipe?.clickup_list_id ?? null, assigneeId }
}

const taakVelden = (m: MeetingRij) => ({
  naam: clickupTaakNaam(m),
  omschrijving: clickupOmschrijving(m, baseUrl()),
  startMs: new Date(m.starts_at).getTime(),
  eindMs: new Date(m.ends_at).getTime(),
})

const CLICKUP_CLAIM_MS = 2 * 60_000

/**
 * Taak aanmaken of bijwerken. Nooit twee taken: een poging wordt eerst
 * geclaimd, en na een onduidelijke fout zoeken we de taak terug aan de
 * referentie in de omschrijving voor we een nieuwe maken.
 */
export async function stapClickup(admin: Admin, m: MeetingRij): Promise<MeetingRij> {
  if (m.status === 'geannuleerd') return m
  if (!clickupConfigured()) return bewaar(admin, m.id, { clickup_status: 'fout', clickup_fout: 'ClickUp is niet ingesteld (CLICKUP_API_KEY ontbreekt).' })

  if (m.clickup_task_id) {
    try {
      await werkAfspraakTaakBij(m.clickup_task_id, taakVelden(m))
      return bewaar(admin, m.id, { clickup_status: 'ok', clickup_fout: null })
    } catch (e) {
      if (!isTaskGone(e)) return bewaar(admin, m.id, { clickup_status: 'fout', clickup_fout: veiligeFout(e) })
      // Handmatig verwijderd in ClickUp: opnieuw aanmaken, zoals een nieuwe meeting.
      m = await bewaar(admin, m.id, { clickup_task_id: null })
    }
  }

  const doel = await clickupDoel(admin, m.agenda_id)
  if (!doel.listId) return bewaar(admin, m.id, { clickup_status: 'overgeslagen', clickup_fout: 'Geen ClickUp-lijst ingesteld voor dit merk.' })

  // Claim: wie de stap al bezig heeft (minder dan 2 minuten), laten we doen.
  const vorigeStart = m.clickup_gestart_op
  const grens = new Date(Date.now() - CLICKUP_CLAIM_MS).toISOString()
  const { data: claim } = await admin.from('klant_meetings')
    .update({ clickup_status: 'bezig', clickup_gestart_op: nu(), clickup_list_id: doel.listId, updated_at: nu() })
    .eq('id', m.id).is('clickup_task_id', null)
    .or(`clickup_status.neq.bezig,clickup_gestart_op.lt."${grens}"`)
    .select('*').maybeSingle()
  if (!claim) return (await leesMeeting(admin, m.id)) ?? m
  m = claim as MeetingRij

  try {
    let taskId: string | null = null
    if (vorigeStart) taskId = await zoekTaakMetMarker(doel.listId, clickupMarker(m.id), new Date(vorigeStart).getTime())
    if (taskId) await werkAfspraakTaakBij(taskId, taakVelden(m))
    else taskId = await maakAfspraakTaak(doel.listId, { ...taakVelden(m), assigneeId: doel.assigneeId })
    return bewaar(admin, m.id, { clickup_task_id: taskId, clickup_status: 'ok', clickup_fout: null })
  } catch (e) {
    return bewaar(admin, m.id, { clickup_status: 'fout', clickup_fout: veiligeFout(e) })
  }
}

// ── 3. Herinnering ───────────────────────────────────────────────────────────

/** Lopende herinnering(en) intrekken: gepland of mislukt. Een verzending die net bezig is, laten we afwerken. */
export async function trekHerinneringIn(admin: Admin, meetingId: string): Promise<void> {
  await admin.from('klant_meeting_herinneringen')
    .update({ status: 'geannuleerd', geannuleerd_op: nu(), updated_at: nu() })
    .eq('meeting_id', meetingId).in('status', ['gepland', 'mislukt'])
}

/**
 * Herinnering (opnieuw) plannen voor de huidige tijd en ontvangers. Nooit met
 * terugwerkende kracht: kan het niet meer, dan staat er geen.
 */
export async function planHerinnering(admin: Admin, m: MeetingRij): Promise<HerinneringRij | null> {
  await trekHerinneringIn(admin, m.id)
  if (m.status !== 'ingepland' || !m.herinnering_aan) return null
  const keuze = kiesHerinnering(m.starts_at)
  if (!keuze) return null
  const { data, error } = await admin.from('klant_meeting_herinneringen').insert({
    meeting_id: m.id, moment: keuze.moment, gepland_voor: keuze.geplandVoor,
    ontvangers: m.klant_ontvangers, status: 'gepland', verzend_sleutel: `km-${randomUUID()}`,
  }).select('*').single()
  if (error) {
    // Een gelijktijdige aanvraag plande er al één (unieke index): die geldt.
    if (/duplicate|unique|23505/i.test(error.message)) return laatsteHerinnering(admin, m.id)
    throw new Error(error.message)
  }
  return data as HerinneringRij
}

export async function laatsteHerinnering(admin: Admin, meetingId: string): Promise<HerinneringRij | null> {
  const { data } = await admin.from('klant_meeting_herinneringen').select('*').eq('meeting_id', meetingId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return (data as HerinneringRij | null) ?? null
}

/** Mail opbouwen uit de meeting zoals ze NU is: een gewijzigde titel of agenda gaat mee. */
export function bouwHerinnering(m: MeetingRij, ontvangers: Persoon[]) {
  const mail = herinneringsMail({
    klant_naam: m.klant_naam, titel: m.titel, starts_at: m.starts_at, meet_url: m.meet_url,
    beschrijving: m.beschrijving, organisator_naam: m.organisator_naam, ontvangers,
  })
  return { ...mail, html: buildEmailHtml({ bodyText: mail.tekst, ctaText: mail.ctaTekst, ctaLink: mail.ctaLink }) }
}

/** Een 'bezig' die langer duurt, is een verzending die halverwege stopte. */
const BEZIG_VERLOPEN_MS = 10 * 60_000

export type VerzendUitkomst = 'verzonden' | 'mislukt' | 'overgeslagen' | 'niet_geclaimd' | 'onzeker'

/**
 * Eén herinnering versturen. Eerst atomair claimen (gepland → bezig), zodat
 * twee schedulers of een scheduler en een klik nooit allebei versturen. De
 * verzendsleutel gaat mee als idempotentiesleutel naar Resend: een herhaling
 * na een onduidelijke afloop verstuurt geen tweede mail.
 */
export async function verstuurHerinnering(admin: Admin, h: HerinneringRij): Promise<VerzendUitkomst> {
  const grens = new Date(Date.now() - BEZIG_VERLOPEN_MS).toISOString()
  const { data: claim } = await admin.from('klant_meeting_herinneringen')
    .update({ status: 'bezig', bezig_sinds: nu(), pogingen: (h.pogingen ?? 0) + 1, updated_at: nu() })
    .eq('id', h.id)
    .or(`status.eq.gepland,and(status.eq.bezig,bezig_sinds.lt."${grens}")`)
    .select('*').maybeSingle()
  if (!claim) return 'niet_geclaimd'
  const r = claim as HerinneringRij

  const zet = (velden: Record<string, unknown>) =>
    admin.from('klant_meeting_herinneringen').update({ ...velden, updated_at: nu() }).eq('id', r.id)

  const m = await leesMeeting(admin, r.meeting_id)
  if (!m || m.status !== 'ingepland') {
    await zet({ status: 'geannuleerd', geannuleerd_op: nu(), bezig_sinds: null })
    return 'overgeslagen'
  }
  if (!magNogVersturen(m.starts_at)) {
    await zet({ status: 'overgeslagen', fout: 'Te kort voor de start van de meeting; niet meer verstuurd.', bezig_sinds: null })
    return 'overgeslagen'
  }
  if (!m.meet_url) {
    await zet({ status: 'mislukt', fout: 'Er is nog geen Google Meet-link. Los eerst de agenda-stap op en verstuur dan opnieuw.', bezig_sinds: null })
    return 'mislukt'
  }
  const ontvangers = (Array.isArray(r.ontvangers) && r.ontvangers.length ? r.ontvangers : m.klant_ontvangers).map((p) => p.email)
  if (!ontvangers.length) {
    await zet({ status: 'mislukt', fout: 'Geen klantontvanger met een e-mailadres.', bezig_sinds: null })
    return 'mislukt'
  }

  const mail = bouwHerinnering(m, Array.isArray(r.ontvangers) && r.ontvangers.length ? r.ontvangers : m.klant_ontvangers)
  const res = await sendEmail({
    to: ontvangers, subject: mail.onderwerp, text: mail.tekst, html: mail.html,
    replyTo: m.organisator_email || null, idempotencyKey: r.verzend_sleutel,
  })

  if (res.ok) {
    let logId: string | null = null
    try {
      const { data: log } = await admin.from('email_messages').insert({
        to_email: ontvangers.join(', '), to_client_id: m.client_id, subject: mail.onderwerp, body: mail.tekst, html: mail.html,
        from_email: EMAIL_FROM, kind: 'klantmeeting_herinnering', audience: 'client', trigger_type: 'auto', status: 'sent',
        provider_id: res.id ?? null, related_id: m.id, verzend_sleutel: r.verzend_sleutel, sent_by_email: m.created_by_email,
      }).select('id').single()
      logId = (log as { id: string } | null)?.id ?? null
    } catch { /* logboek E-mailcenter is een extra; de verzending zelf is gelukt */ }
    await zet({ status: 'verzonden', verzonden_op: nu(), provider_id: res.id ?? null, email_message_id: logId, fout: null, bezig_sinds: null })
    return 'verzonden'
  }
  if (res.onzeker) {
    // Misschien toch vertrokken: blijft 'bezig' en wordt na tien minuten met dezelfde sleutel opnieuw geprobeerd.
    await zet({ fout: `Onduidelijke afloop, wordt opnieuw geprobeerd: ${veiligeFout(res.error)}` })
    return 'onzeker'
  }
  await zet({ status: 'mislukt', fout: veiligeFout(res.error), bezig_sinds: null })
  return 'mislukt'
}

/** Handmatig opnieuw: enkel een mislukte herinnering, met een nieuwe sleutel (de vorige vertrok zeker niet). */
export async function herinneringOpnieuw(admin: Admin, m: MeetingRij): Promise<{ ok: boolean; fout?: string; uitkomst?: VerzendUitkomst }> {
  const h = await laatsteHerinnering(admin, m.id)
  if (!h || h.status !== 'mislukt') return { ok: false, fout: 'Er is geen mislukte herinnering om opnieuw te versturen.' }
  if (!magNogVersturen(m.starts_at)) return { ok: false, fout: 'De meeting begint te snel; een herinnering heeft geen zin meer.' }
  const { data } = await admin.from('klant_meeting_herinneringen')
    .update({ status: 'gepland', gepland_voor: nu(), verzend_sleutel: `km-${randomUUID()}`, ontvangers: m.klant_ontvangers, fout: null, updated_at: nu() })
    .eq('id', h.id).eq('status', 'mislukt').select('*').maybeSingle()
  if (!data) return { ok: false, fout: 'De herinnering werd intussen al aangepast. Ververs het scherm.' }
  const uitkomst = await verstuurHerinnering(admin, data as HerinneringRij)
  return { ok: uitkomst === 'verzonden', uitkomst }
}

/** Scheduler: alles wat aan de beurt is (en vastgelopen verzendingen) afwerken. */
export async function verwerkHerinneringen(admin: Admin, limiet = 25): Promise<Record<VerzendUitkomst, number>> {
  const telling: Record<VerzendUitkomst, number> = { verzonden: 0, mislukt: 0, overgeslagen: 0, niet_geclaimd: 0, onzeker: 0 }
  const grens = new Date(Date.now() - BEZIG_VERLOPEN_MS).toISOString()
  const { data, error } = await admin.from('klant_meeting_herinneringen').select('*')
    .or(`and(status.eq.gepland,gepland_voor.lte."${nu()}"),and(status.eq.bezig,bezig_sinds.lt."${grens}")`)
    .order('gepland_voor').limit(limiet)
  if (error) throw new Error(error.message)
  for (const h of (data ?? []) as HerinneringRij[]) telling[await verstuurHerinnering(admin, h)]++
  return telling
}

// ── Annuleren ────────────────────────────────────────────────────────────────

/**
 * Meeting annuleren: herinnering intrekken, Google-afspraak annuleren en de
 * ClickUp-taak sluiten zoals bij de verkoopafspraken ([GEANNULEERD] + dicht).
 * De app stuurt zelf geen annuleringsmail.
 */
export async function annuleer(admin: Admin, m: MeetingRij, door: string, genodigdenVerwittigen: boolean): Promise<MeetingRij> {
  if (m.status !== 'geannuleerd') {
    m = await bewaar(admin, m.id, { status: 'geannuleerd', geannuleerd_op: nu(), geannuleerd_door: door })
  }
  await trekHerinneringIn(admin, m.id)
  m = await annuleerGoogle(admin, m, genodigdenVerwittigen)
  return annuleerClickup(admin, m)
}

export async function annuleerGoogle(admin: Admin, m: MeetingRij, genodigdenVerwittigen: boolean): Promise<MeetingRij> {
  if (m.google_status === 'geannuleerd') return m
  const eventId = m.google_event_id ?? googleEventId(m.id)
  if (!m.agenda_id) return bewaar(admin, m.id, { google_status: m.google_event_id ? 'fout' : 'geannuleerd', google_fout: m.google_event_id ? 'Geen agenda meer gekoppeld om de afspraak te annuleren.' : null })
  try {
    // Ook zonder bewaarde agenda-id proberen: een onduidelijk afgelopen aanmaak kan er toch staan.
    let calendarId = m.google_calendar_id
    if (!calendarId) {
      const { data } = await admin.from('sales_calendar_connections').select('calendar_id').eq('id', m.agenda_id).maybeSingle()
      calendarId = (data?.calendar_id as string | null) || 'primary'
    }
    await annuleerMeetingEvent(m.agenda_id, calendarId, eventId, genodigdenVerwittigen)
    return bewaar(admin, m.id, { google_status: 'geannuleerd', google_fout: null })
  } catch (e) {
    // Nooit een afspraak aangemaakt (geen event-id bewaard): niets om te annuleren.
    if (!m.google_event_id) return bewaar(admin, m.id, { google_status: 'geannuleerd', google_fout: null })
    return bewaar(admin, m.id, { google_status: 'fout', google_fout: veiligeFout(e) })
  }
}

export async function annuleerClickup(admin: Admin, m: MeetingRij): Promise<MeetingRij> {
  if (!clickupConfigured()) return m.clickup_task_id ? bewaar(admin, m.id, { clickup_status: 'fout', clickup_fout: 'ClickUp is niet ingesteld; de taak kon niet gesloten worden.' }) : m
  try {
    let taskId = m.clickup_task_id
    // Een onduidelijk afgelopen aanmaak: eerst kijken of de taak er toch staat.
    if (!taskId && m.clickup_list_id && m.clickup_gestart_op) {
      taskId = await zoekTaakMetMarker(m.clickup_list_id, clickupMarker(m.id), new Date(m.clickup_gestart_op).getTime())
    }
    if (!taskId) return bewaar(admin, m.id, { clickup_status: 'overgeslagen', clickup_fout: null })
    await annuleerAfspraakTaak(taskId)
    return bewaar(admin, m.id, { clickup_task_id: taskId, clickup_status: 'ok', clickup_fout: null })
  } catch (e) {
    if (isTaskGone(e)) return bewaar(admin, m.id, { clickup_status: 'ok', clickup_fout: null })
    return bewaar(admin, m.id, { clickup_status: 'fout', clickup_fout: veiligeFout(e) })
  }
}

export { bewaar as bewaarMeeting }
