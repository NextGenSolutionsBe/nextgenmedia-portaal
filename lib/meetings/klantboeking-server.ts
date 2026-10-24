import 'server-only'
import { randomBytes, createHash } from 'crypto'
import { sendEmail, baseUrl, EMAIL_FROM } from '@/lib/email'
import { buildEmailHtml } from '@/lib/email-html'
import { haalBezetStrikt } from '@/lib/sales/google-calendar'
import { clickupConfigured, haalSyncTaken } from '@/lib/clickup'
import { zelfdePersoon } from '@/lib/meetings/kalender'
import { getOrCreateSalesOrg, loadCalendar } from '@/lib/sales/service'
import {
  kandidaatSlots, vrijeSlots, clickupBezet, valideerBoeking, redenNietBoekbaar, bevestigingsMail, kbTitel,
  KB_DUUR_MIN, type Interval, type BoekingInvoer,
} from '@/lib/meetings/klantboeking'
import {
  stapGoogle, stapClickup, planHerinnering, bestaatGoogleAfspraak, annuleer, bewaarMeeting, leesMeeting, veiligeFout, type MeetingRij,
} from '@/lib/meetings/server'

/**
 * Klantboeking — server. Klanten boeken zelf een gratis meeting via de publieke
 * pagina /boeken. Hergebruikt alles wat er al is: de Google-koppeling en de
 * werkuren van de agenda (Appointment setting), de ClickUp-taken als bezet, en
 * dezelfde meetingstappen (Google + Meet, ClickUp, herinnering) als intern.
 *
 * Bij twijfel boeken we niet: lukt één van de bezet-controles niet, dan krijgt
 * de klant geen tijdstippen te zien in plaats van een gok.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

/** Voor de klant: kort en eerlijk, zonder technische details. */
export class BoekingFout extends Error {
  constructor(public publiek: string, public status = 400, public intern?: string) {
    super(publiek)
    this.name = 'BoekingFout'
  }
}

const NIET_BETROUWBAAR = 'Online boeken is even niet mogelijk: we kunnen de agenda nu niet betrouwbaar controleren. Probeer het later opnieuw of mail ons op info@nextgenmedia.be.'

// ── Instellingen ─────────────────────────────────────────────────────────────

export type KlantboekingInstellingen = { actief: boolean; agenda_id: string | null }

export async function leesKbInstellingen(admin: Admin): Promise<KlantboekingInstellingen> {
  const { data } = await admin.from('app_settings').select('value').eq('key', 'klantboeking').maybeSingle()
  const v = (data?.value ?? {}) as Partial<KlantboekingInstellingen>
  let agenda = typeof v.agenda_id === 'string' ? v.agenda_id : null
  if (!agenda) {
    // Standaard: de vaste agenda van het merk NextGenMedia (zelfde als het boekscherm).
    const { data: p } = await admin.from('sales_pipelines').select('default_calendar_id').eq('key', 'nextgenmedia').maybeSingle()
    agenda = (p?.default_calendar_id as string | null) ?? null
  }
  return { actief: v.actief !== false, agenda_id: agenda }
}

export async function bewaarKbInstellingen(admin: Admin, w: KlantboekingInstellingen, door: string): Promise<void> {
  const { error } = await admin.from('app_settings').upsert({ key: 'klantboeking', value: w, updated_at: new Date().toISOString(), updated_by_email: door }, { onConflict: 'key' })
  if (error) throw new Error(error.message)
}

// ── Vrije momenten ───────────────────────────────────────────────────────────

type Agenda = { id: string; name: string | null; status: string; active: boolean | null; account_email: string | null; clickup_assignee_id: number | null; signature_email?: string | null }

async function boekbareAgenda(admin: Admin): Promise<Agenda> {
  const inst = await leesKbInstellingen(admin)
  if (!inst.actief) throw new BoekingFout('Online boeken staat momenteel uit. Mail ons gerust op info@nextgenmedia.be.', 503)
  if (!inst.agenda_id) throw new BoekingFout(NIET_BETROUWBAAR, 503, 'Geen agenda ingesteld voor klantboekingen')
  const { data } = await admin.from('sales_calendar_connections').select('id, name, status, active, account_email, clickup_assignee_id, signature_email').eq('id', inst.agenda_id).maybeSingle()
  const a = data as Agenda | null
  if (!a || a.active === false || a.status !== 'connected') throw new BoekingFout(NIET_BETROUWBAAR, 503, 'Agenda voor klantboekingen niet (meer) gekoppeld')
  return a
}

/** Agenda's van dezelfde persoon (zelfde account én persoon), zoals in loadCalendar. */
async function zusterIds(admin: Admin, a: Agenda): Promise<string[]> {
  if (!a.account_email) return [a.id]
  const { data } = await admin.from('sales_calendar_connections').select('id, name, account_email, clickup_assignee_id').eq('account_email', a.account_email)
  const ids = ((data ?? []) as { id: string; name: string | null; account_email: string | null; clickup_assignee_id: number | null }[])
    .filter((o) => zelfdePersoon(a, o)).map((x) => x.id)
  return ids.includes(a.id) ? ids : [a.id, ...ids]
}

export type Beschikbaarheid = { agendaId: string; slots: string[] }

const cache = new Map<string, { tot: number; waarde: Beschikbaarheid }>()
const CACHE_MS = 60_000

/**
 * Vrije momenten voor klanten in [van, tot). Alle bronnen moeten lukken:
 * werkuren + verkoopafspraken (loadCalendar), Google vrij/bezet (strikt),
 * ClickUp-taken van de eigenaar en de meetings uit de app.
 */
export async function berekenVrijeSlots(admin: Admin, opts: { nu?: Date; van?: number; tot?: number; vers?: boolean; negeerMeetingId?: string } = {}): Promise<Beschikbaarheid> {
  const nu = opts.nu ?? new Date()
  const agenda = await boekbareAgenda(admin)
  const alle = kandidaatSlots(nu)
  const kandidaten = alle.filter((s) => (opts.van === undefined || new Date(s).getTime() >= opts.van) && (opts.tot === undefined || new Date(s).getTime() < opts.tot))
  if (!kandidaten.length) return { agendaId: agenda.id, slots: [] }
  const sleutel = `${agenda.id}|${kandidaten[0]}|${kandidaten[kandidaten.length - 1]}|${opts.negeerMeetingId ?? ''}`
  const hit = cache.get(sleutel)
  if (!opts.vers && hit && hit.tot > Date.now()) return hit.waarde

  const van = new Date(kandidaten[0]).getTime() - 3600_000
  const tot = new Date(kandidaten[kandidaten.length - 1]).getTime() + KB_DUUR_MIN * 60000 + 3600_000
  if (!clickupConfigured()) throw new BoekingFout(NIET_BETROUWBAAR, 503, 'CLICKUP_API_KEY ontbreekt')
  if (!agenda.clickup_assignee_id) throw new BoekingFout(NIET_BETROUWBAAR, 503, 'Geen ClickUp-gebruiker gekoppeld aan de agenda')

  let werkuren: Interval[]
  let google: Interval[]
  let clickup: Interval[]
  try {
    const org = await getOrCreateSalesOrg()
    const [cal, g, taken] = await Promise.all([
      loadCalendar(org.id, van, tot, agenda.id),
      haalBezetStrikt(agenda.id, van, tot),
      haalSyncTaken([Number(agenda.clickup_assignee_id)], van - 86400_000, tot + 86400_000),
    ])
    if (!cal || cal.ownerId !== agenda.id) throw new Error('Werkuren van de agenda niet gelezen')
    werkuren = cal.segments
    google = g
    clickup = clickupBezet(taken)
  } catch (e) {
    if (e instanceof BoekingFout) throw e
    throw new BoekingFout(NIET_BETROUWBAAR, 503, veiligeFout(e))
  }

  // Meetings uit de app (ook die nog niet in Google staan) op dezelfde persoon.
  const zusters = await zusterIds(admin, agenda)
  const { data: mt, error: mtErr } = await admin.from('klant_meetings').select('id, starts_at, ends_at')
    .in('agenda_id', zusters).eq('status', 'ingepland')
    .lt('starts_at', new Date(tot).toISOString()).gt('ends_at', new Date(van).toISOString())
  if (mtErr) throw new BoekingFout(NIET_BETROUWBAAR, 503, mtErr.message)
  const meetings = ((mt ?? []) as { id: string; starts_at: string; ends_at: string }[])
    .filter((m) => m.id !== opts.negeerMeetingId)
    .map((m) => ({ start: new Date(m.starts_at).getTime(), end: new Date(m.ends_at).getTime() }))
  // Het eigen event van een te verplaatsen meeting telt niet als bezet.
  let eigen: Interval | null = null
  if (opts.negeerMeetingId) {
    const m = await leesMeeting(admin, opts.negeerMeetingId)
    if (m) eigen = { start: new Date(m.starts_at).getTime(), end: new Date(m.ends_at).getTime() }
  }
  const zonderEigen = (l: Interval[]) => (eigen ? l.filter((b) => !(b.start === eigen!.start && b.end === eigen!.end)) : l)

  const slots = vrijeSlots(kandidaten, { werkuren, bezet: [...zonderEigen(google), ...clickup, ...meetings] })
  const waarde = { agendaId: agenda.id, slots }
  cache.set(sleutel, { tot: Date.now() + CACHE_MS, waarde })
  return waarde
}

/** Is precies dit moment nu (vers berekend) nog vrij? */
async function nogVrij(admin: Admin, startsAt: string, negeerMeetingId?: string): Promise<Beschikbaarheid & { vrij: boolean }> {
  const t = new Date(startsAt).getTime()
  const b = await berekenVrijeSlots(admin, { van: t - 60_000, tot: t + 60_000, vers: true, negeerMeetingId })
  return { ...b, vrij: b.slots.includes(new Date(startsAt).toISOString()) }
}

/** Nacontrole na het reserveren: overlapt er intussen iets op dezelfde persoon? */
async function botstNaReservering(admin: Admin, m: MeetingRij, agenda: Agenda): Promise<boolean> {
  const zusters = await zusterIds(admin, agenda)
  const [{ data: mt }, { data: ap }] = await Promise.all([
    admin.from('klant_meetings').select('id').in('agenda_id', zusters).eq('status', 'ingepland').neq('id', m.id)
      .lt('starts_at', m.ends_at).gt('ends_at', m.starts_at).limit(1),
    admin.from('sales_appointments').select('id').in('calendar_id', zusters).neq('status', 'cancelled')
      .lt('starts_at', m.ends_at).gt('ends_at', m.starts_at).limit(1),
  ])
  return ((mt ?? []).length + (ap ?? []).length) > 0
}

// ── Beheerlink ───────────────────────────────────────────────────────────────

export const nieuwBeheerToken = (): string => randomBytes(32).toString('base64url')
export const hashToken = (t: string): string => createHash('sha256').update(t).digest('hex')
export const isTokenVorm = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{40,60}$/.test(t)
export const beheerUrl = (token: string): string => `${baseUrl()}/boeken/beheer#t=${token}`

/** Bevestiging (na boeken, verplaatsen of op vraag van ons) — status op de meeting. */
export async function stuurBevestiging(admin: Admin, m: MeetingRij, token: string, verplaatst = false): Promise<MeetingRij> {
  const ontvanger = m.klant_ontvangers[0]
  if (!ontvanger) return bewaarMeeting(admin, m.id, { bevestiging_status: 'mislukt', bevestiging_fout: 'Geen e-mailadres.' })
  const mail = bevestigingsMail({ naam: ontvanger.naam || m.klant_naam, startsAt: m.starts_at, meetUrl: m.meet_url, beheerUrl: beheerUrl(token), verplaatst })
  const html = buildEmailHtml({ bodyText: mail.tekst, ctaText: mail.ctaTekst, ctaLink: mail.ctaLink })
  const sleutel = `kb-${m.id}-${hashToken(token).slice(0, 12)}-${new Date(m.starts_at).getTime()}`
  const res = await sendEmail({ to: ontvanger.email, subject: mail.onderwerp, text: mail.tekst, html, replyTo: m.organisator_email || null, idempotencyKey: sleutel })
  try {
    await admin.from('email_messages').insert({
      to_email: ontvanger.email, subject: mail.onderwerp, body: mail.tekst.replace(/#t=[A-Za-z0-9_-]+/g, '#t=…'), from_email: EMAIL_FROM,
      kind: 'klantboeking_bevestiging', audience: 'client', trigger_type: 'auto', status: res.ok ? 'sent' : 'error',
      error: res.ok ? null : veiligeFout(res.error), provider_id: res.id ?? null, related_id: m.id,
    })
  } catch { /* logboek is een extra */ }
  return bewaarMeeting(admin, m.id, res.ok
    ? { bevestiging_status: 'verzonden', bevestiging_op: new Date().toISOString(), bevestiging_fout: null }
    : { bevestiging_status: 'mislukt', bevestiging_fout: veiligeFout(res.error) })
}

/** Intern: bevestiging opnieuw sturen. Nieuwe link (we bewaren enkel de hash); de oude werkt dan niet meer. */
export async function bevestigingOpnieuw(admin: Admin, m: MeetingRij): Promise<MeetingRij> {
  const token = nieuwBeheerToken()
  const bij = await bewaarMeeting(admin, m.id, { beheer_token_hash: hashToken(token) })
  return stuurBevestiging(admin, bij, token)
}

// ── Boeken ───────────────────────────────────────────────────────────────────

export type BoekResultaat = {
  id: string; startsAt: string; endsAt: string; meetUrl: string | null; beheerUrl: string | null
  bevestigingVerstuurd: boolean; herhaald?: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Een klant boekt. Volgorde: regels → nog vrij? → reserveren (unieke index)
 * → nacontrole → Google + Meet (anders niet geboekt) → ClickUp → herinnering
 * → bevestiging. Een herhaling met dezelfde aanvraagsleutel boekt niets opnieuw.
 */
export async function boekKlantmeeting(admin: Admin, invoer: BoekingInvoer & { aanvraag_sleutel?: unknown }, nu: Date = new Date()): Promise<BoekResultaat> {
  const sleutel = String(invoer.aanvraag_sleutel ?? '')
  if (!UUID.test(sleutel)) throw new BoekingFout('Ververs de pagina en probeer opnieuw.')
  const { data: al } = await admin.from('klant_meetings').select('*').eq('aanvraag_sleutel', sleutel).maybeSingle()
  if (al) {
    const m = al as MeetingRij
    return { id: m.id, startsAt: m.starts_at, endsAt: m.ends_at, meetUrl: m.meet_url, beheerUrl: null, bevestigingVerstuurd: m.bevestiging_status === 'verzonden', herhaald: true }
  }

  const v = valideerBoeking(invoer, nu)
  if (!v.ok) throw new BoekingFout(v.fout)
  const w = v.waarde

  // Geen spam: hoogstens drie komende boekingen per e-mailadres.
  const { data: eigen } = await admin.from('klant_meetings').select('id, klant_ontvangers').eq('bron', 'klantboeking').eq('status', 'ingepland').gt('starts_at', nu.toISOString())
  const vanDitAdres = ((eigen ?? []) as { klant_ontvangers: { email: string }[] }[]).filter((x) => x.klant_ontvangers?.some((p) => p.email === w.email)).length
  if (vanDitAdres >= 3) throw new BoekingFout('Je hebt al drie meetings gepland. Verplaats of annuleer er eerst één via de link in je bevestigingsmail.', 429)

  const agenda = await boekbareAgenda(admin)
  const vrij = await nogVrij(admin, w.startsAt)
  if (!vrij.vrij) throw new BoekingFout('Dit tijdstip is net niet meer beschikbaar. Kies een ander moment.', 409)

  const token = nieuwBeheerToken()
  const { data: rij, error } = await admin.from('klant_meetings').insert({
    aanvraag_sleutel: sleutel, bron: 'klantboeking', client_id: null, klant_naam: w.bedrijf || w.naam,
    titel: kbTitel(w), beschrijving: w.reden, starts_at: w.startsAt, ends_at: w.endsAt, tijdzone: 'Europe/Brussels',
    agenda_id: agenda.id, organisator_naam: (agenda.name ?? '').split(/\s+[—-]\s+/)[0] || null, organisator_email: agenda.signature_email || null,
    klant_ontvangers: [{ naam: w.naam, email: w.email }], deelnemers: [], herinnering_aan: true,
    boeker_bedrijf: w.bedrijf, boeker_reden: w.reden, beheer_token_hash: hashToken(token), created_by_email: 'klantboeking',
  }).select('*').single()
  if (error) {
    if (/klant_meetings_klantslot|duplicate|unique|23505/i.test(error.message)) {
      const { data: dubbel } = await admin.from('klant_meetings').select('*').eq('aanvraag_sleutel', sleutel).maybeSingle()
      if (dubbel) { const m = dubbel as MeetingRij; return { id: m.id, startsAt: m.starts_at, endsAt: m.ends_at, meetUrl: m.meet_url, beheerUrl: null, bevestigingVerstuurd: m.bevestiging_status === 'verzonden', herhaald: true } }
      throw new BoekingFout('Dit tijdstip is net niet meer beschikbaar. Kies een ander moment.', 409)
    }
    throw new BoekingFout('Boeken lukt nu niet. Probeer het later opnieuw.', 500, error.message)
  }
  let m = rij as MeetingRij

  if (await botstNaReservering(admin, m, agenda)) {
    await admin.from('klant_meetings').delete().eq('id', m.id)
    throw new BoekingFout('Dit tijdstip is net niet meer beschikbaar. Kies een ander moment.', 409)
  }

  m = await stapGoogle(admin, m)
  if (m.google_status !== 'ok') {
    const staat = await bestaatGoogleAfspraak(admin, m)
    if (staat === 'ja') m = await stapGoogle(admin, m)
    if (m.google_status !== 'ok') {
      if (staat === 'nee') await admin.from('klant_meetings').delete().eq('id', m.id)
      throw new BoekingFout('Je boeking kon niet bevestigd worden. Probeer het later opnieuw of mail ons op info@nextgenmedia.be.', 503, m.google_fout ?? undefined)
    }
  }
  m = await stapClickup(admin, m)
  try { await planHerinnering(admin, m) } catch (e) { console.error('[klantboeking:herinnering]', e) }
  m = await stuurBevestiging(admin, m, token)
  return { id: m.id, startsAt: m.starts_at, endsAt: m.ends_at, meetUrl: m.meet_url, beheerUrl: beheerUrl(token), bevestigingVerstuurd: m.bevestiging_status === 'verzonden' }
}

// ── Beheren via de link ──────────────────────────────────────────────────────

export async function meetingVoorToken(admin: Admin, token: unknown): Promise<MeetingRij | null> {
  if (!isTokenVorm(token)) return null
  const { data } = await admin.from('klant_meetings').select('*').eq('beheer_token_hash', hashToken(token)).eq('bron', 'klantboeking').maybeSingle()
  return (data as MeetingRij | null) ?? null
}

/** Wat de klant over de eigen boeking te zien krijgt — niets meer. */
export function publiekeWeergave(m: MeetingRij, nu: Date = new Date()) {
  const komend = new Date(m.starts_at).getTime() > nu.getTime()
  return {
    status: m.status, naam: m.klant_ontvangers[0]?.naam ?? null, titel: m.titel, startsAt: m.starts_at, endsAt: m.ends_at,
    tijdzone: m.tijdzone, meetUrl: m.status === 'ingepland' ? m.meet_url : null,
    magAnnuleren: m.status === 'ingepland' && komend, magVerplaatsen: m.status === 'ingepland' && komend,
  }
}

export async function annuleerViaLink(admin: Admin, m: MeetingRij, nu: Date = new Date()): Promise<MeetingRij> {
  if (m.status !== 'ingepland') return m
  if (new Date(m.starts_at).getTime() <= nu.getTime()) throw new BoekingFout('Deze meeting is al begonnen of voorbij.')
  return annuleer(admin, m, 'klant (beheerlink)', true)
}

export async function verplaatsViaLink(admin: Admin, m: MeetingRij, token: string, nieuweStart: unknown, nu: Date = new Date()): Promise<MeetingRij> {
  if (m.status !== 'ingepland') throw new BoekingFout('Deze meeting is geannuleerd. Boek gerust een nieuwe.')
  if (new Date(m.starts_at).getTime() <= nu.getTime()) throw new BoekingFout('Deze meeting is al begonnen of voorbij.')
  const start = String(nieuweStart ?? '')
  const reden = redenNietBoekbaar(start, nu)
  if (reden) throw new BoekingFout(reden)
  const startsAt = new Date(start).toISOString()
  if (startsAt === new Date(m.starts_at).toISOString()) return m
  const agenda = await boekbareAgenda(admin)
  if (m.agenda_id !== agenda.id) throw new BoekingFout('Verplaatsen lukt niet via de link. Mail ons op info@nextgenmedia.be.', 409)
  const vrij = await nogVrij(admin, startsAt, m.id)
  if (!vrij.vrij) throw new BoekingFout('Dit tijdstip is net niet meer beschikbaar. Kies een ander moment.', 409)
  const vorig = { starts_at: m.starts_at, ends_at: m.ends_at }
  try {
    m = await bewaarMeeting(admin, m.id, { starts_at: startsAt, ends_at: new Date(new Date(startsAt).getTime() + KB_DUUR_MIN * 60000).toISOString() })
  } catch (e) {
    if (/klant_meetings_klantslot|duplicate|unique|23505/i.test(e instanceof Error ? e.message : '')) throw new BoekingFout('Dit tijdstip is net niet meer beschikbaar. Kies een ander moment.', 409)
    throw e
  }
  if (await botstNaReservering(admin, m, agenda)) {
    await bewaarMeeting(admin, m.id, vorig)
    throw new BoekingFout('Dit tijdstip is net niet meer beschikbaar. Kies een ander moment.', 409)
  }
  m = await stapGoogle(admin, m, { bijwerken: true })
  if (m.google_status !== 'ok') {
    // Google niet bijgewerkt: terugzetten, de klant behoudt het oude moment.
    m = await bewaarMeeting(admin, m.id, vorig)
    m = await stapGoogle(admin, m, { bijwerken: true })
    throw new BoekingFout('Verplaatsen lukte niet. Je meeting blijft op het oorspronkelijke moment staan.', 503)
  }
  m = await stapClickup(admin, m)
  try { await planHerinnering(admin, m) } catch (e) { console.error('[klantboeking:herinnering]', e) }
  return stuurBevestiging(admin, m, token, true)
}
