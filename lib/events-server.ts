import 'server-only'
import { sendEmail, baseUrl, EMAIL_FROM } from '@/lib/email'
import { buildEmailHtml } from '@/lib/email-html'
import { controleerAfzender } from '@/lib/meetings/afzender'
import { veiligeFout } from '@/lib/meetings/server'
import {
  maakEventAgenda, werkEventAgendaBij, zetEventGasten, annuleerMeetingEvent, haalMeetingEvent, AgendaNietGekoppeld,
} from '@/lib/sales/google-calendar'
import {
  googleEventIdVoor, googleOmschrijving, heeftMeet, bouwIcs, bevestigingsMail, herinneringsMail, herinneringNodig,
  belangrijkeWijziging, LAATSTE_HERINNERING_MS, HERINNERING_VOORAF_MS,
  type KlantEvent, type Inschrijving, type GeldigEvent,
} from '@/lib/events'

/**
 * Workshops & events op de server: publiceren (Google-event, online met Meet),
 * bijwerken, annuleren, de gastenlijst in Google gelijk houden met de
 * inschrijvingen, en de twee mails die de app zelf verstuurt.
 *
 * Mails: de bevestiging meteen na het inschrijven (met agendabestand) en één
 * herinnering vanaf 24 uur vooraf, via de scheduler van de Meeting Inplanner
 * (pg_cron → /api/cron/klantmeetings). Altijd vanuit info@nextgenmedia.be via
 * Resend, elke mail in het E-mail Center. Wijzigt het team de tijd of plaats,
 * of annuleert het een event, dan verwittigt Google de gasten zelf.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }

const nu = () => new Date().toISOString()
export const EVENT_KOLOMMEN = '*'
export const appLinkVoor = (eventId: string) => `${baseUrl()}/portal/events/${eventId}`

export async function leesEvent(admin: Admin, id: string): Promise<KlantEvent | null> {
  const { data } = await admin.from('klant_events').select('*').eq('id', id).maybeSingle()
  return (data as KlantEvent | null) ?? null
}

async function bewaarEvent(admin: Admin, id: string, velden: Record<string, unknown>): Promise<KlantEvent> {
  const { data, error } = await admin.from('klant_events').update({ ...velden, updated_at: nu() }).eq('id', id).select('*').single()
  if (error) throw new Error(error.message)
  return data as KlantEvent
}

/** Aantal actieve inschrijvingen per event. */
export async function bezetting(admin: Admin, eventIds: string[]): Promise<Map<string, number>> {
  const telling = new Map<string, number>()
  if (!eventIds.length) return telling
  const { data } = await admin.from('klant_event_inschrijvingen').select('event_id').in('event_id', eventIds).eq('status', 'ingeschreven').limit(20000)
  for (const r of (data ?? []) as { event_id: string }[]) telling.set(r.event_id, (telling.get(r.event_id) ?? 0) + 1)
  return telling
}

/** De standaardagenda van NextGenMedia (dezelfde als in de Meeting Inplanner). */
export async function standaardAgenda(admin: Admin): Promise<string | null> {
  const { data } = await admin.from('sales_pipelines').select('default_calendar_id').eq('key', 'nextgenmedia').maybeSingle()
  return (data as { default_calendar_id?: string | null } | null)?.default_calendar_id ?? null
}

export async function agendaOpties(admin: Admin): Promise<{ id: string; naam: string; gekoppeld: boolean }[]> {
  const { data } = await admin.from('sales_calendar_connections').select('id, name, status, active, provider').eq('active', true).order('name')
  return ((data ?? []) as { id: string; name: string; status: string; provider: string }[])
    .filter((a) => a.provider === 'google').map((a) => ({ id: a.id, naam: a.name, gekoppeld: a.status === 'connected' }))
}

const wacht = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── Google: event aanmaken, bijwerken, annuleren ─────────────────────────────

type AgendaUitkomst = { ok: true; event: KlantEvent } | { ok: false; fout: string; event: KlantEvent }

/** Google-event (online: met Meet) aanmaken of herstellen. Bewaart de uitkomst op het event. */
export async function zorgVoorGoogle(admin: Admin, e: KlantEvent): Promise<AgendaUitkomst> {
  const agendaId = e.agenda_id ?? await standaardAgenda(admin)
  if (!agendaId) {
    const ev = await bewaarEvent(admin, e.id, { google_status: 'fout', google_fout: 'Kies de Google-agenda waarin het event komt.' })
    return { ok: false, fout: ev.google_fout!, event: ev }
  }
  const { data: k } = await admin.from('sales_calendar_connections').select('id, name, status, active, calendar_id').eq('id', agendaId).maybeSingle()
  const koppeling = k as { id: string; name: string; status: string; active: boolean | null; calendar_id: string | null } | null
  if (!koppeling || koppeling.active === false) {
    const ev = await bewaarEvent(admin, e.id, { google_status: 'fout', google_fout: 'Deze Google-agenda bestaat niet (meer). Kies een andere.' })
    return { ok: false, fout: ev.google_fout!, event: ev }
  }
  if (koppeling.status !== 'connected') {
    const ev = await bewaarEvent(admin, e.id, { google_status: 'fout', google_fout: `De Google-koppeling van "${koppeling.name}" is verlopen. Koppel ze opnieuw via Verkoop → Agenda.` })
    return { ok: false, fout: ev.google_fout!, event: ev }
  }
  const metMeet = heeftMeet(e)
  try {
    let g = await maakEventAgenda(agendaId, {
      eventId: e.google_event_id ?? googleEventIdVoor(e.id), meetRequestId: `ngmev-${e.id}`, calendarId: e.google_calendar_id || koppeling.calendar_id,
      summary: e.titel, description: googleOmschrijving(e, appLinkVoor(e.id)), startsAt: e.start_op, endsAt: e.einde_op, timezone: e.tijdzone,
      location: e.vorm === 'locatie' ? e.locatie : null, metMeet,
    })
    // Google maakt de Meet-link soms enkele seconden later aan.
    for (let i = 0; metMeet && g.meetStatus === 'bezig' && i < 4; i++) {
      await wacht(1500)
      const opnieuw = await haalMeetingEvent(agendaId, g.calendarId, g.eventId)
      if (opnieuw) g = { ...opnieuw, icalUid: g.icalUid }
    }
    if (metMeet && !g.meetUrl) {
      g = await werkEventAgendaBij(agendaId, g.calendarId, g.eventId, { nieuweMeetRequestId: `ngmev-${e.id}-${Date.now()}` }, false)
    }
    if (metMeet && !g.meetUrl) {
      const ev = await bewaarEvent(admin, e.id, {
        agenda_id: agendaId, google_calendar_id: g.calendarId, google_event_id: g.eventId, google_ical_uid: g.icalUid,
        google_status: 'fout', google_fout: 'Google maakte nog geen Meet-link aan. Probeer het zo opnieuw.',
      })
      return { ok: false, fout: ev.google_fout!, event: ev }
    }
    const ev = await bewaarEvent(admin, e.id, {
      agenda_id: agendaId, google_calendar_id: g.calendarId, google_event_id: g.eventId, google_ical_uid: g.icalUid,
      meet_url: metMeet ? g.meetUrl : null, google_status: 'ok', google_fout: null,
      // De gastenlijst van een (her)aangemaakt event is leeg: opnieuw vullen.
      google_sync_versie: 0,
    })
    return { ok: true, event: ev }
  } catch (err) {
    const fout = err instanceof AgendaNietGekoppeld ? err.message : veiligeFout(err)
    const ev = await bewaarEvent(admin, e.id, { agenda_id: agendaId, google_status: 'fout', google_fout: fout })
    return { ok: false, fout, event: ev }
  }
}

/**
 * Publiceren: eerst het Google-event. Een online event zonder Meet-link gaat
 * niet live (de deelnemers hebben die link nodig); op locatie mag het wel, met
 * de fout zichtbaar zodat het team opnieuw kan proberen.
 */
export async function publiceer(admin: Admin, e: KlantEvent): Promise<{ ok: true; event: KlantEvent; waarschuwing?: string } | { ok: false; fout: string }> {
  if (e.status === 'geannuleerd') return { ok: false, fout: 'Een geannuleerd event kan je niet meer publiceren. Dupliceer het.' }
  if (Date.parse(e.start_op) <= Date.now()) return { ok: false, fout: 'Dit event ligt in het verleden.' }
  const g = await zorgVoorGoogle(admin, e)
  if (!g.ok && heeftMeet(e)) return { ok: false, fout: `Niet gepubliceerd: ${g.fout}` }
  const { data, error } = await admin.from('klant_events')
    .update({ status: 'gepubliceerd', gepubliceerd_op: e.gepubliceerd_op ?? nu(), updated_at: nu() })
    .eq('id', e.id).neq('status', 'geannuleerd').select('*').maybeSingle()
  if (error) return { ok: false, fout: error.message }
  if (!data) return { ok: false, fout: 'Dit event werd intussen geannuleerd.' }
  return { ok: true, event: data as KlantEvent, ...(g.ok ? {} : { waarschuwing: `Gepubliceerd, maar de Google-agenda lukte niet: ${g.fout}` }) }
}

/** Velden bewaren; bij een gepubliceerd event ook Google bijwerken. */
export async function werkEventBij(admin: Admin, e: KlantEvent, w: GeldigEvent): Promise<{ event: KlantEvent; waarschuwing?: string; verwittigd: boolean }> {
  const agendaVast = e.status !== 'concept' && e.google_event_id
  const velden: Record<string, unknown> = { ...w }
  if (agendaVast) delete velden.agenda_id // na publiceren blijft het event in dezelfde agenda
  const meetWas = heeftMeet(e)
  let ev = await bewaarEvent(admin, e.id, velden)
  if (ev.status !== 'gepubliceerd' || !ev.google_event_id || !ev.agenda_id || !ev.google_calendar_id) {
    if (ev.status === 'gepubliceerd' && ev.google_status !== 'ok') {
      const g = await zorgVoorGoogle(admin, ev)
      return { event: g.event, verwittigd: false, ...(g.ok ? {} : { waarschuwing: g.fout }) }
    }
    return { event: ev, verwittigd: false }
  }
  const verwittigen = belangrijkeWijziging(e, w)
  const meetNu = heeftMeet(ev)
  try {
    const g = await werkEventAgendaBij(ev.agenda_id, ev.google_calendar_id, ev.google_event_id, {
      summary: ev.titel, description: googleOmschrijving(ev, appLinkVoor(ev.id)), startsAt: ev.start_op, endsAt: ev.einde_op, timezone: ev.tijdzone,
      location: ev.vorm === 'locatie' ? ev.locatie : '',
      ...(meetNu && !ev.meet_url ? { nieuweMeetRequestId: `ngmev-${ev.id}-${Date.now()}` } : {}),
      ...(!meetNu && meetWas ? { geenMeet: true } : {}),
    }, verwittigen)
    ev = await bewaarEvent(admin, ev.id, { meet_url: meetNu ? (g.meetUrl ?? ev.meet_url) : null, google_status: 'ok', google_fout: null })
    return { event: ev, verwittigd: verwittigen }
  } catch (err) {
    ev = await bewaarEvent(admin, ev.id, { google_status: 'fout', google_fout: veiligeFout(err) })
    return { event: ev, verwittigd: false, waarschuwing: `Bewaard, maar Google werd niet bijgewerkt: ${ev.google_fout}` }
  }
}

/** Annuleren: Google verwittigt de gasten; herinneringen vervallen. */
export async function annuleerEvent(admin: Admin, e: KlantEvent): Promise<{ event: KlantEvent; waarschuwing?: string }> {
  let ev = await bewaarEvent(admin, e.id, { status: 'geannuleerd', geannuleerd_op: nu() })
  await admin.from('klant_event_inschrijvingen').update({ herinnering_status: 'overgeslagen', updated_at: nu() })
    .eq('event_id', e.id).in('herinnering_status', ['gepland', 'bezig'])
  if (!ev.google_event_id || !ev.agenda_id || !ev.google_calendar_id || ev.google_status === 'geannuleerd') return { event: ev }
  try {
    await annuleerMeetingEvent(ev.agenda_id, ev.google_calendar_id, ev.google_event_id, true)
    ev = await bewaarEvent(admin, ev.id, { google_status: 'geannuleerd', google_fout: null })
    return { event: ev }
  } catch (err) {
    ev = await bewaarEvent(admin, ev.id, { google_status: 'fout', google_fout: veiligeFout(err) })
    return { event: ev, waarschuwing: `Geannuleerd in de app, maar Google lukte niet: ${ev.google_fout}` }
  }
}

// ── Gastenlijst in Google ────────────────────────────────────────────────────

/**
 * De gastenlijst van het Google-event gelijkzetten met de actieve inschrijvingen.
 * Wie tijdens het bijwerken inschrijft, verhoogt de versie: dan meteen nog eens.
 * Wat hier niet lukt, pakt de scheduler op (versie in Google < versie in de app).
 */
export async function syncGasten(admin: Admin, eventId: string): Promise<{ ok: boolean; aantal?: number; fout?: string }> {
  for (let poging = 0; poging < 3; poging++) {
    const e = await leesEvent(admin, eventId)
    if (!e || e.status !== 'gepubliceerd' || e.google_status !== 'ok' || !e.google_event_id || !e.agenda_id || !e.google_calendar_id) return { ok: false, fout: 'Geen actief Google-event.' }
    const versie = e.inschrijving_versie
    if (e.google_sync_versie >= versie && poging > 0) return { ok: true }
    const { data } = await admin.from('klant_event_inschrijvingen').select('naam, email').eq('event_id', eventId).eq('status', 'ingeschreven').order('created_at').limit(5000)
    const gasten = ((data ?? []) as { naam: string; email: string }[]).map((r) => ({ email: r.email, displayName: r.naam }))
    try {
      const r = await zetEventGasten(e.agenda_id, e.google_calendar_id, e.google_event_id, gasten)
      await admin.from('klant_events').update({ google_sync_versie: versie }).eq('id', eventId).lt('google_sync_versie', versie)
      const na = await leesEvent(admin, eventId)
      if (!na || na.inschrijving_versie === versie) return { ok: true, aantal: r.aantal }
    } catch (err) {
      return { ok: false, fout: veiligeFout(err) }
    }
  }
  return { ok: true }
}

// ── Mails ────────────────────────────────────────────────────────────────────

const base64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

async function logMail(admin: Admin, o: { aan: string; clientId: string; onderwerp: string; tekst: string; html: string; soort: string; providerId: string | null; eventId: string; sleutel: string }) {
  try {
    await admin.from('email_messages').insert({
      to_email: o.aan, to_client_id: o.clientId, subject: o.onderwerp, body: o.tekst, html: o.html,
      from_email: EMAIL_FROM, kind: o.soort, audience: 'client', trigger_type: 'auto', status: 'sent',
      provider_id: o.providerId, related_id: o.eventId, verzend_sleutel: o.sleutel,
    })
  } catch { /* logboek is een extra; de mail zelf is vertrokken */ }
}

/** Bevestiging na het inschrijven, met agendabestand. Eén keer per inschrijving. */
export async function stuurBevestiging(admin: Admin, inschrijvingId: string): Promise<'verzonden' | 'overgeslagen' | 'mislukt'> {
  // Claimen: twee gelijktijdige pogingen sturen nooit twee mails. Een afgebroken
  // poging ('bezig' langer dan 10 minuten) mag opnieuw, met dezelfde Resend-sleutel.
  const grens = new Date(Date.now() - 10 * 60_000).toISOString()
  const { data: claim } = await admin.from('klant_event_inschrijvingen')
    .update({ bevestiging_status: 'bezig', bevestiging_bezig_sinds: nu(), updated_at: nu() })
    .eq('id', inschrijvingId).eq('status', 'ingeschreven')
    .or(`bevestiging_status.eq.nog_niet,and(bevestiging_status.eq.bezig,bevestiging_bezig_sinds.lt."${grens}")`)
    .select('*').maybeSingle()
  if (!claim) return 'overgeslagen'
  const i = claim as Inschrijving
  const zet = (velden: Record<string, unknown>) => admin.from('klant_event_inschrijvingen').update({ ...velden, bevestiging_bezig_sinds: null, updated_at: nu() }).eq('id', i.id)
  const e = await leesEvent(admin, i.event_id)
  if (!e || e.status !== 'gepubliceerd' || Date.parse(e.einde_op) < Date.now()) {
    await zet({ bevestiging_status: 'overgeslagen', bevestiging_fout: 'Event niet meer actief.' })
    return 'overgeslagen'
  }
  const afzender = await controleerAfzender()
  if (!afzender.ok) { await zet({ bevestiging_status: 'mislukt', bevestiging_fout: afzender.fout }); return 'mislukt' }
  const app = appLinkVoor(e.id)
  const doorAnder = i.ingeschreven_door_naam && i.ingeschreven_door_naam.trim().toLowerCase() !== i.naam.trim().toLowerCase() ? i.ingeschreven_door_naam : null
  const mail = bevestigingsMail(e, { naam: i.naam, email: i.email }, { appLink: app, doorAnder })
  const html = buildEmailHtml({ bodyText: mail.tekst, ctaText: mail.ctaTekst, ctaLink: mail.ctaLink })
  const sleutel = `event-bevestiging-${i.id}`
  const res = await sendEmail({
    to: i.email, subject: mail.onderwerp, text: `${mail.tekst}\n\n${mail.ctaTekst}: ${mail.ctaLink}`, html, idempotencyKey: sleutel,
    attachments: [{ filename: 'event.ics', content: base64(bouwIcs(e, { appLink: app })), contentType: 'text/calendar; charset=utf-8' }],
  })
  if (!res.ok) {
    // Onzeker (netwerk): opnieuw 'nog_niet', de scheduler probeert met dezelfde sleutel (Resend stuurt dan geen tweede).
    await zet(res.onzeker ? { bevestiging_status: 'nog_niet', bevestiging_fout: veiligeFout(res.error) } : { bevestiging_status: 'mislukt', bevestiging_fout: veiligeFout(res.error) })
    return 'mislukt'
  }
  await zet({ bevestiging_status: 'verzonden', bevestiging_op: nu(), bevestiging_fout: null })
  await logMail(admin, { aan: i.email, clientId: i.client_id, onderwerp: mail.onderwerp, tekst: mail.tekst, html, soort: 'event_bevestiging', providerId: res.id ?? null, eventId: e.id, sleutel })
  return 'verzonden'
}

/** Na een inschrijving (op de achtergrond): eerst op de gastenlijst, dan de bevestiging. */
export async function naInschrijving(admin: Admin, eventId: string, ids: string[]): Promise<void> {
  await syncGasten(admin, eventId).catch(() => null)
  for (const id of ids) await stuurBevestiging(admin, id).catch(() => null)
}

async function stuurHerinnering(admin: Admin, i: Inschrijving, e: KlantEvent): Promise<'verzonden' | 'overgeslagen' | 'mislukt'> {
  const grens = new Date(Date.now() - 10 * 60_000).toISOString()
  const { data: claim } = await admin.from('klant_event_inschrijvingen')
    .update({ herinnering_status: 'bezig', herinnering_bezig_sinds: nu(), updated_at: nu() })
    .eq('id', i.id).eq('status', 'ingeschreven')
    .or(`herinnering_status.eq.gepland,and(herinnering_status.eq.bezig,herinnering_bezig_sinds.lt."${grens}")`)
    .select('id').maybeSingle()
  if (!claim) return 'overgeslagen'
  const zet = (velden: Record<string, unknown>) => admin.from('klant_event_inschrijvingen').update({ ...velden, herinnering_bezig_sinds: null, updated_at: nu() }).eq('id', i.id)
  const afzender = await controleerAfzender()
  if (!afzender.ok) { await zet({ herinnering_status: 'mislukt', herinnering_fout: afzender.fout }); return 'mislukt' }
  const app = appLinkVoor(e.id)
  const mail = herinneringsMail(e, { naam: i.naam, email: i.email }, { appLink: app })
  const html = buildEmailHtml({ bodyText: mail.tekst, ctaText: mail.ctaTekst, ctaLink: mail.ctaLink })
  const sleutel = `event-herinnering-${i.id}`
  const res = await sendEmail({ to: i.email, subject: mail.onderwerp, text: `${mail.tekst}\n\n${mail.ctaTekst}: ${mail.ctaLink}`, html, idempotencyKey: sleutel })
  if (!res.ok) {
    if (res.onzeker) { await admin.from('klant_event_inschrijvingen').update({ herinnering_fout: veiligeFout(res.error), updated_at: nu() }).eq('id', i.id); return 'mislukt' }
    await zet({ herinnering_status: 'mislukt', herinnering_fout: veiligeFout(res.error) })
    return 'mislukt'
  }
  await zet({ herinnering_status: 'verzonden', herinnering_op: nu(), herinnering_fout: null })
  await logMail(admin, { aan: i.email, clientId: i.client_id, onderwerp: mail.onderwerp, tekst: mail.tekst, html, soort: 'event_herinnering', providerId: res.id ?? null, eventId: e.id, sleutel })
  return 'verzonden'
}

/**
 * Elke vijf minuten (scheduler van de Meeting Inplanner): herinneringen voor
 * events binnen 24 uur, bevestigingen die bleven hangen, gastenlijsten die
 * nog niet in Google staan, en vervallen herinneringen opruimen.
 */
export async function verwerkEvents(admin: Admin): Promise<Record<string, number>> {
  const t = { herinnering: 0, herinnering_mislukt: 0, bevestiging: 0, gasten: 0, opgeruimd: 0 }
  const nuMs = Date.now()
  // 1. Herinneringen
  const { data: komend } = await admin.from('klant_events').select('*').eq('status', 'gepubliceerd')
    .gt('start_op', new Date(nuMs + LAATSTE_HERINNERING_MS).toISOString()).lte('start_op', new Date(nuMs + HERINNERING_VOORAF_MS).toISOString())
  const events = (komend ?? []) as KlantEvent[]
  if (events.length) {
    const perId = new Map(events.map((e) => [e.id, e]))
    const { data: rijen } = await admin.from('klant_event_inschrijvingen').select('*').in('event_id', [...perId.keys()])
      .eq('status', 'ingeschreven').in('herinnering_status', ['gepland', 'bezig']).limit(200)
    for (const i of (rijen ?? []) as Inschrijving[]) {
      const e = perId.get(i.event_id)!
      const wanneer = herinneringNodig(e, { ...i, herinnering_status: 'gepland' }, nuMs)
      if (wanneer === 'nooit') {
        await admin.from('klant_event_inschrijvingen').update({ herinnering_status: 'overgeslagen', herinnering_fout: 'Kort voor de start ingeschreven: de bevestiging volstaat.', updated_at: nu() }).eq('id', i.id).eq('herinnering_status', 'gepland')
        continue
      }
      if (wanneer !== 'nu') continue
      const r = await stuurHerinnering(admin, i, e).catch(() => 'mislukt' as const)
      if (r === 'verzonden') t.herinnering++
      else if (r === 'mislukt') t.herinnering_mislukt++
    }
  }
  // 2. Bevestigingen die op de achtergrond niet vertrokken (functie gestopt, netwerk).
  const { data: hangend } = await admin.from('klant_event_inschrijvingen').select('id')
    .eq('status', 'ingeschreven').in('bevestiging_status', ['nog_niet', 'bezig']).lt('created_at', new Date(nuMs - 5 * 60_000).toISOString()).limit(20)
  for (const r of (hangend ?? []) as { id: string }[]) if ((await stuurBevestiging(admin, r.id).catch(() => 'mislukt')) === 'verzonden') t.bevestiging++
  // 3. Gastenlijsten bijwerken
  const { data: teSyncen } = await admin.from('klant_events').select('id, inschrijving_versie, google_sync_versie')
    .eq('status', 'gepubliceerd').eq('google_status', 'ok').gt('einde_op', nu()).limit(200)
  for (const e of ((teSyncen ?? []) as { id: string; inschrijving_versie: number; google_sync_versie: number }[]).filter((x) => x.inschrijving_versie > x.google_sync_versie).slice(0, 5)) {
    if ((await syncGasten(admin, e.id)).ok) t.gasten++
  }
  // 4. Afgelopen events: wat nog 'gepland' staat, vertrekt niet meer.
  const { data: voorbij } = await admin.from('klant_events').select('id').lt('start_op', nu()).gt('start_op', new Date(nuMs - 3 * 86_400_000).toISOString())
  const ids = ((voorbij ?? []) as { id: string }[]).map((x) => x.id)
  if (ids.length) {
    const { data: weg } = await admin.from('klant_event_inschrijvingen').update({ herinnering_status: 'overgeslagen', updated_at: nu() })
      .in('event_id', ids).eq('herinnering_status', 'gepland').select('id')
    t.opgeruimd = (weg ?? []).length
  }
  return t
}

// ── Uitschrijven ─────────────────────────────────────────────────────────────

export async function schrijfUit(admin: Admin, inschrijvingId: string, door: string): Promise<{ ok: true; eventId: string } | { ok: false; fout: string }> {
  const { data, error } = await admin.rpc('klant_event_uitschrijven', { p_inschrijving: inschrijvingId, p_door: door })
  if (error) return { ok: false, fout: error.message }
  const r = data as { ok?: boolean; fout?: string; event_id?: string }
  if (!r?.ok || !r.event_id) return { ok: false, fout: 'Deze inschrijving is niet (meer) actief.' }
  return { ok: true, eventId: r.event_id }
}

// ── Klantapp ─────────────────────────────────────────────────────────────────

export type PortaalInschrijving = { id: string; naam: string; email: string; created_at: string; ingeschreven_door_naam: string | null; prijs_cents: number }
export type PortaalEvent = Pick<KlantEvent,
  'id' | 'titel' | 'soort' | 'status' | 'samenvatting' | 'beschrijving' | 'cover_pad' | 'spreker' | 'start_op' | 'einde_op' | 'tijdzone'
  | 'vorm' | 'locatie' | 'met_meet' | 'capaciteit' | 'prijs_cents' | 'inschrijven_tot'> & {
  /** Enkel voor wie van deze klant ingeschreven is. */
  meet_url: string | null
  bezet: number
  /** Inschrijvingen van deze klant (het hele team), nooit die van andere klanten. */
  mijn: PortaalInschrijving[]
}

/**
 * Events voor de klantapp: gepubliceerd en nog niet lang voorbij. Een
 * geannuleerd event enkel als iemand van deze klant ingeschreven was.
 * Altijd gescoped op de geresolveerde clientId.
 */
export async function portaalEvents(admin: Admin, clientId: string, opts: { id?: string } = {}): Promise<PortaalEvent[]> {
  let q = admin.from('klant_events').select('*').in('status', ['gepubliceerd', 'geannuleerd'])
    .gt('einde_op', new Date(Date.now() - 60 * 86_400_000).toISOString()).order('start_op').limit(200)
  if (opts.id) q = q.eq('id', opts.id)
  const { data } = await q
  const events = (data ?? []) as KlantEvent[]
  if (!events.length) return []
  const ids = events.map((e) => e.id)
  const [bezet, { data: eigen }] = await Promise.all([
    bezetting(admin, ids),
    admin.from('klant_event_inschrijvingen').select('id, event_id, naam, email, created_at, ingeschreven_door_naam, prijs_cents, status')
      .eq('client_id', clientId).in('event_id', ids).order('created_at'),
  ])
  const perEvent = new Map<string, PortaalInschrijving[]>()
  const ooit = new Set<string>()
  for (const r of (eigen ?? []) as (PortaalInschrijving & { event_id: string; status: string })[]) {
    ooit.add(r.event_id)
    if (r.status !== 'ingeschreven') continue
    const l = perEvent.get(r.event_id) ?? []
    l.push({ id: r.id, naam: r.naam, email: r.email, created_at: r.created_at, ingeschreven_door_naam: r.ingeschreven_door_naam, prijs_cents: r.prijs_cents })
    perEvent.set(r.event_id, l)
  }
  return events
    .filter((e) => e.status === 'gepubliceerd' || ooit.has(e.id))
    .map((e) => {
      const mijn = perEvent.get(e.id) ?? []
      return {
        id: e.id, titel: e.titel, soort: e.soort, status: e.status, samenvatting: e.samenvatting, beschrijving: e.beschrijving, cover_pad: e.cover_pad,
        spreker: e.spreker, start_op: e.start_op, einde_op: e.einde_op, tijdzone: e.tijdzone, vorm: e.vorm, locatie: e.locatie, met_meet: e.met_meet,
        capaciteit: e.capaciteit, prijs_cents: e.prijs_cents, inschrijven_tot: e.inschrijven_tot,
        meet_url: mijn.length && e.status === 'gepubliceerd' ? e.meet_url : null,
        bezet: bezet.get(e.id) ?? 0, mijn,
      }
    })
}
