import 'server-only'
import { GSM_MELDING_MIN } from '@/lib/meetings/kalender'
import { randomUUID } from 'crypto'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { sendEmail, baseUrl, EMAIL_FROM, resendKeyFor } from '@/lib/email'
import { defaultFromFor } from '@/lib/sales/pipelines'
import { buildEmailHtml } from '@/lib/email-html'
import {
  maakMeetingEvent, haalMeetingEvent, werkMeetingEventBij, annuleerMeetingEvent, controleerAgenda, AgendaNietGekoppeld, type MeetingEvent,
} from '@/lib/sales/google-calendar'
import {
  clickupConfigured, maakAfspraakTaak, werkAfspraakTaakBij, annuleerAfspraakTaak, isTaskGone, zoekTaakMetMarker, lijstToegang,
} from '@/lib/clickup'
import {
  googleEventId, googleOmschrijving, genodigden, clickupMarker, clickupTaakNaam, clickupOmschrijving,
  kiesHerinnering, magNogVersturen, herinneringsMail, STANDAARD_TIJDZONE, type Persoon, type Koppelingen,
} from '@/lib/meetings/model'

/**
 * Meetingplanner — de stappen naast de databank. Hergebruikt de Google-koppeling
 * (sales_calendar_connections) en de ClickUp-werkwijze van de afsprakentool.
 *
 *  1. Google Calendar: afspraak met Meet-link, vaste event-id (geen dubbels).
 *     Google verstuurt zelf de uitnodiging naar de genodigden.
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
  bron?: 'intern' | 'klantboeking'; lead_id?: string | null; boeker_bedrijf?: string | null; boeker_reden?: string | null
  beheer_token_hash?: string | null; bevestiging_status?: string | null; bevestiging_op?: string | null; bevestiging_fout?: string | null
  project_id?: string | null; clickup_item_id?: string | null
  uitnodiging_status?: string | null; uitnodiging_op?: string | null; uitnodiging_naar?: string[] | null
  gsm_melding_status?: string | null; gsm_melding_fout?: string | null
  vorm?: 'online' | 'locatie' | null; locatie?: string | null; met_meet?: boolean | null
}

export type HerinneringRij = {
  id: string; meeting_id: string | null; afspraak_id?: string | null; voor_start?: string | null; moment: string; gepland_voor: string; ontvangers: Persoon[]; status: string
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

/** Veerkrachtig: een kolom die (nog) niet gemigreerd is, valt weg en we proberen opnieuw. */
async function bewaar(admin: Admin, id: string, velden: Partial<MeetingRij>): Promise<MeetingRij> {
  const rij: Record<string, unknown> = { ...velden, updated_at: nu() }
  for (let i = 0; i < 6; i++) {
    const { data, error } = await admin.from('klant_meetings').update(rij).eq('id', id).select('*').single()
    if (!error) return data as MeetingRij
    const kol = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
    if (kol && kol in rij) { delete rij[kol]; continue }
    throw new Error(error.message)
  }
  throw new Error('Meeting niet bewaard')
}

export async function leesMeeting(admin: Admin, id: string): Promise<MeetingRij | null> {
  const { data } = await admin.from('klant_meetings').select('*').eq('id', id).maybeSingle()
  return (data as MeetingRij | null) ?? null
}

// ── 1. Google Calendar + Meet ────────────────────────────────────────────────

/** Meeting op locatie: adres in het locatieveld van Google. Leeg wist een vroeger adres. */
const locatieVan = (m: MeetingRij): string => (m.vorm === 'locatie' ? m.locatie ?? '' : '')
/** Online altijd met Meet; op locatie enkel als die er bewust bij gevraagd is. */
export const wilMeet = (m: Pick<MeetingRij, 'vorm' | 'met_meet'>): boolean => m.vorm !== 'locatie' || m.met_meet === true

const eventVelden = (m: MeetingRij) => ({
  summary: m.titel,
  description: googleOmschrijving(m),
  startsAt: new Date(m.starts_at).toISOString(),
  endsAt: new Date(m.ends_at).toISOString(),
  timezone: m.tijdzone || STANDAARD_TIJDZONE,
  attendees: genodigden(m),
  location: locatieVan(m),
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
        ...eventVelden(m), eventId: googleEventId(m.id), meetRequestId: m.id, calendarId: m.google_calendar_id, metMeet: wilMeet(m),
      })
    }
    if (wilMeet(m)) ev = await zorgVoorMeet(m.agenda_id, ev, m.id, herhaling)
    // Werd een online meeting een meeting op locatie zonder link: de Meet-link eraf.
    else if (ev.meetUrl) ev = await werkMeetingEventBij(m.agenda_id, ev.calendarId, ev.eventId, { geenMeet: true })
    // Google stuurde de uitnodiging bij het aanmaken; na een wijziging een update.
    const nieuweUitnodiging = m.uitnodiging_status !== 'verzonden' || !!opts.bijwerken
    return bewaar(admin, m.id, {
      google_event_id: ev.eventId, google_calendar_id: ev.calendarId, meet_url: wilMeet(m) ? ev.meetUrl ?? m.meet_url : null,
      google_status: 'ok', google_fout: null,
      uitnodiging_status: 'verzonden',
      // Gsm-melding: wat Google echt bewaart. Ontbreekt ze (ouder event), dan zet de scheduler ze.
      gsm_melding_status: ev.gsmMelding === GSM_MELDING_MIN ? 'ingesteld' : null,
      ...(nieuweUitnodiging ? { uitnodiging_op: nu(), uitnodiging_naar: genodigden(m).map((g) => g.email) } : {}),
    })
  } catch (e) {
    return bewaar(admin, m.id, {
      google_status: 'fout', google_fout: veiligeFout(e),
      ...(m.uitnodiging_status === 'verzonden' ? {} : { uitnodiging_status: 'mislukt' }),
    })
  }
}

/**
 * Na een mislukte eerste poging: staat de afspraak er toch (onduidelijke
 * afloop)? 'ja' = alsnog gelukt, 'nee' = zeker niet aangemaakt, 'onbekend' =
 * Google niet te bereiken. Zelfde vaste event-id, dus nooit een tweede afspraak.
 */
export async function bestaatGoogleAfspraak(admin: Admin, m: MeetingRij): Promise<'ja' | 'nee' | 'onbekend'> {
  if (!m.agenda_id) return 'nee'
  try {
    const { data } = await admin.from('sales_calendar_connections').select('calendar_id').eq('id', m.agenda_id).maybeSingle()
    const ev = await haalMeetingEvent(m.agenda_id, m.google_calendar_id || (data?.calendar_id as string | null) || 'primary', googleEventId(m.id))
    return ev && !ev.geannuleerd ? 'ja' : 'nee'
  } catch (e) {
    // Zonder geldige koppeling kan er ook niets aangemaakt zijn.
    return e instanceof AgendaNietGekoppeld ? 'nee' : 'onbekend'
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

/** Klant en project bij naam, voor de taakomschrijving. */
async function koppelingenVoor(admin: Admin, m: MeetingRij): Promise<Koppelingen> {
  const [klant, project] = await Promise.all([
    m.client_id ? admin.from('clients').select('company_name, contact_name').eq('id', m.client_id).maybeSingle() : Promise.resolve({ data: null }),
    m.project_id ? admin.from('opdrachten').select('titel').eq('id', m.project_id).maybeSingle() : Promise.resolve({ data: null }),
  ]) as [{ data: { company_name?: string | null; contact_name?: string | null } | null }, { data: { titel?: string | null } | null }]
  return {
    klant: klant.data ? (klant.data.company_name || klant.data.contact_name || null) : null,
    project: project.data?.titel ?? null,
    clickupItemId: m.clickup_item_id ?? null,
  }
}

const taakVelden = (m: MeetingRij, k: Koppelingen) => ({
  naam: clickupTaakNaam(m),
  omschrijving: clickupOmschrijving(m, baseUrl(), k),
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
  const k = await koppelingenVoor(admin, m)

  if (m.clickup_task_id) {
    try {
      await werkAfspraakTaakBij(m.clickup_task_id, taakVelden(m, k))
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
    if (taskId) await werkAfspraakTaakBij(taskId, taakVelden(m, k))
    else taskId = await maakAfspraakTaak(doel.listId, { ...taakVelden(m, k), assigneeId: doel.assigneeId })
    return bewaar(admin, m.id, { clickup_task_id: taskId, clickup_status: 'ok', clickup_fout: null })
  } catch (e) {
    return bewaar(admin, m.id, { clickup_status: 'fout', clickup_fout: veiligeFout(e) })
  }
}

// ── 3. Herinnering ───────────────────────────────────────────────────────────

/** Herinnering invoegen; zonder de kolom voor_start (nog niet gemigreerd) opnieuw zonder. */
async function voegHerinneringToe(admin: Admin, rij: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
  let r = await admin.from('klant_meeting_herinneringen').insert(rij).select('*').single()
  if (r.error && /Could not find the 'voor_start' column/.test(r.error.message)) {
    const { voor_start: _v, ...rest } = rij
    void _v
    r = await admin.from('klant_meeting_herinneringen').insert(rest).select('*').single()
  }
  return r
}

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
  const { data, error } = await voegHerinneringToe(admin, {
    meeting_id: m.id, moment: keuze.moment, gepland_voor: keuze.geplandVoor, voor_start: new Date(m.starts_at).toISOString(),
    ontvangers: m.klant_ontvangers, status: 'gepland', verzend_sleutel: `km-${randomUUID()}`,
  })
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
    klant_naam: m.klant_naam, titel: m.titel, starts_at: m.starts_at, meet_url: wilMeet(m) ? m.meet_url : null,
    beschrijving: m.beschrijving, organisator_naam: m.organisator_naam, ontvangers, tijdzone: m.tijdzone,
    locatie: m.vorm === 'locatie' ? m.locatie ?? null : null,
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

  if (r.afspraak_id) return verstuurAfspraakHerinnering(admin, r, zet)
  const m = r.meeting_id ? await leesMeeting(admin, r.meeting_id) : null
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

// ── Herinnering voor verkoopafspraken (Calendar) ───────────────────────
//
// Afspraken die via Calendar geboekt worden (pipeline, Focusmode) staan
// in sales_appointments. Ze krijgen dezelfde herinnering als elke meeting, via
// dezelfde scheduler en tabel (kolom afspraak_id), met de afzender van het merk.

type AfspraakRij = {
  id: string; starts_at: string; status: string; titel: string | null; attendee_email: string | null; meet_url: string | null
  adres: string | null; pipeline_id: string | null; calendar_id: string | null
  sales_leads?: { sales_companies?: { name?: string } | null; sales_contacts?: { name?: string } | null } | null
}

async function leesAfspraak(admin: Admin, id: string): Promise<AfspraakRij | null> {
  const { data } = await admin.from('sales_appointments')
    .select('id, starts_at, status, titel, attendee_email, meet_url, adres, pipeline_id, calendar_id, sales_leads ( sales_companies ( name ), sales_contacts ( name ) )')
    .eq('id', id).maybeSingle()
  return (data as AfspraakRij | null) ?? null
}

const MOMENT_MIN: Record<string, number> = { '24u': 24 * 60, '2u': 2 * 60 }

/**
 * Herinnering van een verkoopafspraak (opnieuw) plannen na boeken, verplaatsen
 * of annuleren. Best-effort: werpt nooit, zodat een boeking hier nooit op
 * stukloopt. Al verstuurd voor dit startuur → niets opnieuw.
 */
export async function afspraakHerinneringBijwerken(admin: Admin, afspraakId: string): Promise<void> {
  try {
    const a = await leesAfspraak(admin, afspraakId)
    const { data: lijst } = await admin.from('klant_meeting_herinneringen').select('*').eq('afspraak_id', afspraakId).order('created_at', { ascending: true })
    const rijen = (lijst ?? []) as HerinneringRij[]
    const actief = rijen.filter((x) => ['gepland', 'mislukt'].includes(x.status))
    const intrekken = async () => {
      if (!actief.length) return
      await admin.from('klant_meeting_herinneringen').update({ status: 'geannuleerd', geannuleerd_op: nu(), updated_at: nu() })
        .eq('afspraak_id', afspraakId).in('status', ['gepland', 'mislukt'])
    }
    if (!a || a.status === 'cancelled' || !a.attendee_email) { await intrekken(); return }
    const start = new Date(a.starts_at).getTime()
    const voorDitUur = (x: HerinneringRij) => x.voor_start
      ? new Date(x.voor_start).getTime() === start
      : new Date(x.gepland_voor).getTime() + (MOMENT_MIN[x.moment] ?? 0) * 60000 === start
    if (rijen.some((x) => (x.status === 'verzonden' || x.status === 'bezig') && voorDitUur(x))) { await intrekken(); return }
    const ontvanger: Persoon = { naam: a.sales_leads?.sales_contacts?.name ?? null, email: a.attendee_email.toLowerCase() }
    const keuze = kiesHerinnering(a.starts_at)
    // Staat er al precies deze herinnering? Dan laten we ze ongemoeid.
    if (keuze && actief.length === 1 && actief[0].status === 'gepland' && new Date(actief[0].gepland_voor).getTime() === new Date(keuze.geplandVoor).getTime()
      && actief[0].ontvangers?.[0]?.email === ontvanger.email) return
    await intrekken()
    if (!keuze) return
    const { error } = await voegHerinneringToe(admin, {
      afspraak_id: afspraakId, moment: keuze.moment, gepland_voor: keuze.geplandVoor, voor_start: new Date(a.starts_at).toISOString(),
      ontvangers: [ontvanger], status: 'gepland', verzend_sleutel: `ka-${randomUUID()}`,
    })
    if (error && !/duplicate|unique|23505/i.test(error.message)) console.error('[meetings:afspraak-herinnering]', error.message)
  } catch (e) {
    console.error('[meetings:afspraak-herinnering]', e)
  }
}

async function verstuurAfspraakHerinnering(admin: Admin, r: HerinneringRij, zet: (v: Record<string, unknown>) => unknown): Promise<VerzendUitkomst> {
  const a = await leesAfspraak(admin, r.afspraak_id as string)
  if (!a || a.status === 'cancelled') {
    await zet({ status: 'geannuleerd', geannuleerd_op: nu(), bezig_sinds: null })
    return 'overgeslagen'
  }
  if (!magNogVersturen(a.starts_at)) {
    await zet({ status: 'overgeslagen', fout: 'Te kort voor de start van de afspraak; niet meer verstuurd.', bezig_sinds: null })
    return 'overgeslagen'
  }
  if (!a.meet_url && !a.adres) {
    await zet({ status: 'mislukt', fout: 'De afspraak heeft geen Meet-link en geen adres; de herinnering zou nergens naar verwijzen.', bezig_sinds: null })
    return 'mislukt'
  }
  const ontvangers = (Array.isArray(r.ontvangers) && r.ontvangers.length ? r.ontvangers : a.attendee_email ? [{ naam: null, email: a.attendee_email }] : [])
  if (!ontvangers.length) {
    await zet({ status: 'mislukt', fout: 'Geen e-mailadres van de prospect.', bezig_sinds: null })
    return 'mislukt'
  }
  const { data: pipe } = a.pipeline_id
    ? await admin.from('sales_pipelines').select('key, name, reminder_from, reminder_reply_to').eq('id', a.pipeline_id).maybeSingle()
    : { data: null }
  const merk = pipe as { key?: string; name?: string; reminder_from?: string | null; reminder_reply_to?: string | null } | null
  const { data: agenda } = a.calendar_id ? await admin.from('sales_calendar_connections').select('name').eq('id', a.calendar_id).maybeSingle() : { data: null }
  const merkNaam = merk?.name ?? 'NextGenMedia'
  const mail = herinneringsMail({
    klant_naam: a.sales_leads?.sales_contacts?.name || a.sales_leads?.sales_companies?.name || 'klant',
    titel: a.titel || `Afspraak met ${merkNaam}`, starts_at: a.starts_at, meet_url: a.meet_url, beschrijving: null,
    organisator_naam: (agenda as { name?: string } | null)?.name?.split(/\s+[—-]\s+/)[0] ?? null,
    ontvangers, afzender: merkNaam, locatie: a.meet_url ? null : a.adres,
  })
  const html = buildEmailHtml({ bodyText: mail.tekst, ctaText: mail.ctaTekst, ctaLink: mail.ctaLink })
  const from = merk?.reminder_from || defaultFromFor(merk?.key) || EMAIL_FROM
  const res = await sendEmail({
    to: ontvangers.map((p) => p.email), subject: mail.onderwerp, text: mail.tekst, html,
    from, replyTo: merk?.reminder_reply_to || null, apiKey: resendKeyFor(merk?.key), idempotencyKey: r.verzend_sleutel,
  })
  if (res.ok) {
    let logId: string | null = null
    try {
      const { data: log } = await admin.from('email_messages').insert({
        to_email: ontvangers.map((p) => p.email).join(', '), subject: mail.onderwerp, body: mail.tekst, html,
        from_email: from, kind: 'afspraak_herinnering', audience: 'client', trigger_type: 'auto', status: 'sent',
        provider_id: res.id ?? null, related_id: a.id, verzend_sleutel: r.verzend_sleutel,
      }).select('id').single()
      logId = (log as { id: string } | null)?.id ?? null
    } catch { /* logboek is een extra */ }
    await zet({ status: 'verzonden', verzonden_op: nu(), provider_id: res.id ?? null, email_message_id: logId, fout: null, bezig_sinds: null })
    return 'verzonden'
  }
  if (res.onzeker) { await zet({ fout: `Onduidelijke afloop, wordt opnieuw geprobeerd: ${veiligeFout(res.error)}` }); return 'onzeker' }
  await zet({ status: 'mislukt', fout: veiligeFout(res.error), bezig_sinds: null })
  return 'mislukt'
}

/** Mislukte herinnering van een verkoopafspraak opnieuw versturen (nieuwe sleutel: de vorige vertrok zeker niet). */
export async function afspraakHerinneringOpnieuw(admin: Admin, afspraakId: string): Promise<{ ok: boolean; fout?: string; uitkomst?: VerzendUitkomst }> {
  const { data: h } = await admin.from('klant_meeting_herinneringen').select('*').eq('afspraak_id', afspraakId).eq('status', 'mislukt').maybeSingle()
  if (!h) return { ok: false, fout: 'Er is geen mislukte herinnering om opnieuw te versturen.' }
  const a = await leesAfspraak(admin, afspraakId)
  if (!a || !magNogVersturen(a.starts_at)) return { ok: false, fout: 'De afspraak begint te snel; een herinnering heeft geen zin meer.' }
  const { data } = await admin.from('klant_meeting_herinneringen')
    .update({ status: 'gepland', gepland_voor: nu(), verzend_sleutel: `ka-${randomUUID()}`, fout: null, updated_at: nu() })
    .eq('id', (h as HerinneringRij).id).eq('status', 'mislukt').select('*').maybeSingle()
  if (!data) return { ok: false, fout: 'De herinnering werd intussen al aangepast. Ververs het scherm.' }
  const uitkomst = await verstuurHerinnering(admin, data as HerinneringRij)
  return { ok: uitkomst === 'verzonden', uitkomst }
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

// ── Koppelingen controleren (zonder iets te versturen) ───────────────────────

export type KoppelingCheck = { onderdeel: string; ok: boolean; melding: string }

/**
 * Werken de bestaande koppelingen echt? Google: token vernieuwen en de agenda
 * lezen. ClickUp: de lijst van het merk bereiken. Resend: sleutel aanwezig en
 * aanvaard. Er wordt niets aangemaakt of verstuurd, en er komt nooit een
 * sleutel of token in de uitkomst.
 */
export async function controleerKoppelingen(admin: Admin, agendaId: string | null): Promise<KoppelingCheck[]> {
  const uit: KoppelingCheck[] = []
  if (agendaId) {
    const r = await controleerAgenda(agendaId).catch((e) => ({ ok: false as const, fout: veiligeFout(e) }))
    uit.push(r.ok ? { onderdeel: 'Google Agenda', ok: true, melding: `Bereikbaar: ${r.naam}${r.schrijven ? '' : ' (geen schrijfrechten!)'}` } : { onderdeel: 'Google Agenda', ok: false, melding: r.fout })
    if (r.ok && !r.schrijven) uit[uit.length - 1].ok = false
  } else uit.push({ onderdeel: 'Google Agenda', ok: false, melding: 'Geen agenda gekozen.' })

  if (!clickupConfigured()) uit.push({ onderdeel: 'ClickUp', ok: false, melding: 'CLICKUP_API_KEY ontbreekt.' })
  else {
    const doel = await clickupDoel(admin, agendaId)
    if (!doel.listId) uit.push({ onderdeel: 'ClickUp', ok: false, melding: 'Geen ClickUp-lijst ingesteld voor dit merk.' })
    else {
      const t = await lijstToegang(doel.listId)
      uit.push({ onderdeel: 'ClickUp', ok: t === 'ok', melding: t === 'ok' ? `Lijst ${doel.listId} bereikbaar${doel.assigneeId ? ', toewijzing aan de eigenaar van de agenda' : ', zonder toewijzing'}` : t === 'weg' ? `Lijst ${doel.listId} niet (meer) bereikbaar met de sleutel.` : 'ClickUp tijdelijk niet bereikbaar.' })
    }
  }

  const sleutel = process.env.RESEND_API_KEY
  if (!sleutel) uit.push({ onderdeel: 'Herinneringsmail (Resend)', ok: false, melding: 'RESEND_API_KEY ontbreekt.' })
  else {
    try {
      const res = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${sleutel}` } })
      const j = await res.json().catch(() => ({})) as { data?: { name: string; status: string }[]; name?: string; message?: string }
      if (res.ok) {
        const domeinen = (j.data ?? []).map((d) => `${d.name} (${d.status})`).join(', ')
        const geverifieerd = (j.data ?? []).some((d) => d.status === 'verified')
        uit.push({ onderdeel: 'Herinneringsmail (Resend)', ok: geverifieerd, melding: domeinen ? `Domeinen: ${domeinen}` : 'Geen domeinen gevonden.' })
      } else if (res.status === 401 && /restricted/i.test(`${j.name ?? ''} ${j.message ?? ''}`)) {
        uit.push({ onderdeel: 'Herinneringsmail (Resend)', ok: true, melding: 'Sleutel aanvaard (mag enkel versturen; domeinen niet op te vragen).' })
      } else {
        uit.push({ onderdeel: 'Herinneringsmail (Resend)', ok: false, melding: veiligeFout(j.message ?? `Resend antwoordde ${res.status}`) })
      }
    } catch (e) {
      uit.push({ onderdeel: 'Herinneringsmail (Resend)', ok: false, melding: veiligeFout(e) })
    }
  }
  return uit
}

/**
 * Echte schrijftest op de agenda: een afspraak zonder genodigden mét Meet-link
 * aanmaken en meteen stil weer verwijderen. Niemand krijgt een uitnodiging.
 * Enkel voor de beveiligde diagnose (scheduler-geheim).
 */
export async function testAfspraak(agendaId: string): Promise<{ ok: boolean; meet: boolean; melding: string }> {
  const id = `ngmtest${randomUUID().replace(/-/g, '')}`
  const start = new Date(Date.now() + 30 * 86400000)
  try {
    const ev = await maakMeetingEvent(agendaId, {
      eventId: id, meetRequestId: id, summary: 'Test NextGenMedia-app (wordt meteen verwijderd)', description: 'Automatische controle van de koppeling.',
      startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 15 * 60000).toISOString(), timezone: STANDAARD_TIJDZONE, attendees: [],
    })
    let meet = ev
    if (!meet.meetUrl) { await new Promise((r) => setTimeout(r, 2000)); meet = (await haalMeetingEvent(agendaId, ev.calendarId, ev.eventId)) ?? ev }
    await annuleerMeetingEvent(agendaId, ev.calendarId, ev.eventId, false)
    return { ok: true, meet: !!meet.meetUrl && /^https:\/\/meet\.google\.com\//.test(meet.meetUrl), melding: meet.meetUrl ? 'Afspraak met Meet-link aangemaakt en weer verwijderd.' : 'Afspraak aangemaakt en verwijderd, maar Google gaf geen Meet-link.' }
  } catch (e) {
    return { ok: false, meet: false, melding: veiligeFout(e) }
  }
}
