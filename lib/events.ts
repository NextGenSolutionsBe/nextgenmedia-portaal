/**
 * Workshops & events: webinars, workshops, events en opleidingen waarvoor
 * klanten zich in de klantapp inschrijven. Pure module (geen server, geen
 * databank): validatie, aftelling, prijs en akkoord, agendabestand (.ics) en
 * de twee mails die de app zelf verstuurt (bevestiging en herinnering).
 *
 * Betalen gebeurt nooit in de app. Wie zich inschrijft voor een betalend event
 * gaat akkoord met een Peppol-factuur achteraf.
 */

import { geldigPad, publiekeUrl } from '@/lib/marketing-media'
import { isEmail, zoneNaarIso, datumLang, uur, dag, STANDAARD_TIJDZONE } from '@/lib/meetings/model'

// ── Soorten en statussen ─────────────────────────────────────────────────────

export const EVENT_SOORTEN = ['webinar', 'workshop', 'event', 'opleiding', 'andere'] as const
export type EventSoort = (typeof EVENT_SOORTEN)[number]
export const SOORT_LABEL: Record<EventSoort, { enkel: string; meer: string }> = {
  webinar: { enkel: 'Webinar', meer: 'Webinars' },
  workshop: { enkel: 'Workshop', meer: 'Workshops' },
  event: { enkel: 'Event', meer: 'Events' },
  opleiding: { enkel: 'Opleiding', meer: 'Opleidingen' },
  andere: { enkel: 'Andere', meer: 'Andere' },
}
/** Het label van een event: de eigen naam bij 'andere' (bv. Masterclass), anders de vaste soort. */
export const soortLabel = (e: { soort: EventSoort; soort_label?: string | null }): string =>
  e.soort === 'andere' && e.soort_label?.trim() ? e.soort_label.trim() : SOORT_LABEL[e.soort]?.enkel ?? 'Event'
export const isEventSoort = (v: unknown): v is EventSoort => (EVENT_SOORTEN as readonly string[]).includes(String(v))

export type EventStatus = 'concept' | 'gepubliceerd' | 'geannuleerd'
export type EventVorm = 'online' | 'locatie'
export type FactuurStatus = 'geen' | 'te_factureren' | 'gefactureerd'
export const FACTUUR_LABEL: Record<FactuurStatus, string> = { geen: 'Gratis', te_factureren: 'Te factureren', gefactureerd: 'Gefactureerd' }

export type KlantEvent = {
  id: string
  titel: string
  soort: EventSoort
  /** Eigen naam als soort 'andere' is (bv. Masterclass). */
  soort_label?: string | null
  status: EventStatus
  samenvatting: string | null
  beschrijving: string | null
  cover_pad: string | null
  spreker: string | null
  start_op: string
  einde_op: string
  tijdzone: string
  vorm: EventVorm
  locatie: string | null
  met_meet: boolean
  capaciteit: number | null
  prijs_cents: number
  inschrijven_tot: string | null
  agenda_id: string | null
  google_calendar_id: string | null
  google_event_id: string | null
  google_ical_uid: string | null
  meet_url: string | null
  google_status: 'nog_niet' | 'ok' | 'fout' | 'geannuleerd'
  google_fout: string | null
  inschrijving_versie: number
  google_sync_versie: number
  gepubliceerd_op: string | null
  geannuleerd_op: string | null
  created_by_email: string | null
  created_at: string
  updated_at: string
}

export type Inschrijving = {
  id: string
  event_id: string
  client_id: string
  ingeschreven_door_auth: string | null
  ingeschreven_door_naam: string | null
  naam: string
  email: string
  status: 'ingeschreven' | 'geannuleerd'
  prijs_cents: number
  akkoord_factuur_op: string | null
  akkoord_tekst: string | null
  factuur_status: FactuurStatus
  bevestiging_status: 'nog_niet' | 'bezig' | 'verzonden' | 'mislukt' | 'overgeslagen'
  bevestiging_op: string | null
  bevestiging_fout: string | null
  herinnering_status: 'gepland' | 'bezig' | 'verzonden' | 'mislukt' | 'overgeslagen'
  herinnering_op: string | null
  herinnering_fout: string | null
  geannuleerd_op: string | null
  geannuleerd_door: string | null
  created_at: string
}

/** Heeft dit event een Google Meet-link? Online altijd; op locatie enkel als gevraagd. */
export const heeftMeet = (e: Pick<KlantEvent, 'vorm' | 'met_meet'>): boolean => e.vorm === 'online' || !!e.met_meet

// ── Validatie (admin) ────────────────────────────────────────────────────────

export const MAX_DEELNEMERS_PER_INSCHRIJVING = 5
export const MAX_CAPACITEIT = 5000
const DAG_RE = /^\d{4}-\d{2}-\d{2}$/
const UUR_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const tekst = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max)
const ofNull = (s: string): string | null => (s ? s : null)

export type EventInvoer = {
  titel?: unknown; soort?: unknown; soort_label?: unknown; samenvatting?: unknown; beschrijving?: unknown; cover_pad?: unknown; spreker?: unknown
  datum?: unknown; start?: unknown; einde?: unknown; einddatum?: unknown
  vorm?: unknown; locatie?: unknown; met_meet?: unknown
  capaciteit?: unknown; prijs?: unknown; inschrijven_tot?: unknown; agenda_id?: unknown
}

export type GeldigEvent = {
  titel: string; soort: EventSoort; soort_label: string | null; samenvatting: string | null; beschrijving: string | null; cover_pad: string | null; spreker: string | null
  start_op: string; einde_op: string; tijdzone: string
  vorm: EventVorm; locatie: string | null; met_meet: boolean
  capaciteit: number | null; prijs_cents: number; inschrijven_tot: string | null; agenda_id: string | null
}

/** "95", "95,50", "€ 1.250" → centen. Leeg of 0 = gratis. null = ongeldig. */
export function leesPrijs(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null
  const s = String(v ?? '').replace(/[€\s]/g, '')
  if (!s) return 0
  // Belgische schrijfwijze: punt = duizendtal, komma = decimaal.
  const genormd = s.includes(',') ? s.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s
  if (!/^\d+(\.\d{1,2})?$/.test(genormd)) return null
  return Math.round(Number(genormd) * 100)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function valideerEvent(b: EventInvoer, nu: Date = new Date(), opties: { bestaand?: boolean } = {}): { ok: true; waarde: GeldigEvent } | { ok: false; fout: string } {
  const titel = tekst(b.titel, 140)
  if (titel.length < 3) return { ok: false, fout: 'Geef het event een titel.' }
  if (!isEventSoort(b.soort)) return { ok: false, fout: 'Kies wat voor event het is.' }
  const soort_label = b.soort === 'andere' ? tekst(b.soort_label, 40) : ''
  if (b.soort === 'andere' && soort_label.length < 2) return { ok: false, fout: 'Typ wat voor event het is (bv. Masterclass).' }
  const datum = tekst(b.datum, 10)
  if (!DAG_RE.test(datum)) return { ok: false, fout: 'Kies een datum.' }
  const start = tekst(b.start, 5)
  const einde = tekst(b.einde, 5)
  if (!UUR_RE.test(start) || !UUR_RE.test(einde)) return { ok: false, fout: 'Vul een begin- en einduur in.' }
  const einddatum = tekst(b.einddatum, 10) || datum
  if (!DAG_RE.test(einddatum) || einddatum < datum) return { ok: false, fout: 'De einddatum ligt voor de startdatum.' }
  const start_op = zoneNaarIso(datum, start, STANDAARD_TIJDZONE)
  const einde_op = zoneNaarIso(einddatum, einde, STANDAARD_TIJDZONE)
  if (Date.parse(einde_op) <= Date.parse(start_op)) return { ok: false, fout: 'Het einduur moet na het beginuur liggen.' }
  if (Date.parse(einde_op) - Date.parse(start_op) > 14 * 24 * 3600_000) return { ok: false, fout: 'Een event duurt maximaal twee weken.' }
  // Een nieuw event in het verleden heeft geen zin; een bestaand mag blijven staan (afgelopen events bijwerken).
  if (!opties.bestaand && Date.parse(start_op) < nu.getTime()) return { ok: false, fout: 'Deze datum en dit uur zijn al voorbij.' }

  const vorm: EventVorm = b.vorm === 'locatie' ? 'locatie' : 'online'
  const locatie = tekst(b.locatie, 300)
  if (vorm === 'locatie' && locatie.length < 3) return { ok: false, fout: 'Vul het adres van het event in.' }
  const met_meet = vorm === 'online' ? true : b.met_meet === true

  let capaciteit: number | null = null
  const capRuw = String(b.capaciteit ?? '').trim()
  if (capRuw) {
    const c = Number(capRuw)
    if (!Number.isInteger(c) || c < 1 || c > MAX_CAPACITEIT) return { ok: false, fout: `Het aantal plaatsen is een getal tussen 1 en ${MAX_CAPACITEIT}, of leeg voor onbeperkt.` }
    capaciteit = c
  }
  const prijs_cents = leesPrijs(b.prijs)
  if (prijs_cents === null) return { ok: false, fout: 'Vul de prijs in als bedrag, bv. 95 of 95,50. Leeg of 0 is gratis.' }
  if (prijs_cents > 10_000_000) return { ok: false, fout: 'Die prijs is te hoog.' }

  let inschrijven_tot: string | null = null
  const totRuw = tekst(b.inschrijven_tot, 10)
  if (totRuw) {
    if (!DAG_RE.test(totRuw)) return { ok: false, fout: 'Kies een geldige datum om de inschrijvingen af te sluiten.' }
    inschrijven_tot = zoneNaarIso(totRuw, '23:59', STANDAARD_TIJDZONE)
    if (totRuw > datum) return { ok: false, fout: 'De inschrijvingen sluiten ten laatste op de dag van het event.' }
  }

  const cover = tekst(b.cover_pad, 200)
  if (cover && !geldigPad(cover, 'events')) return { ok: false, fout: 'Laad de coverfoto opnieuw op.' }
  const agenda = tekst(b.agenda_id, 36)
  if (agenda && !UUID_RE.test(agenda)) return { ok: false, fout: 'Kies een geldige Google-agenda.' }

  return {
    ok: true,
    waarde: {
      titel, soort: b.soort, soort_label: soort_label || null, samenvatting: ofNull(tekst(b.samenvatting, 300)), beschrijving: ofNull(tekst(b.beschrijving, 20000)),
      cover_pad: ofNull(cover), spreker: ofNull(tekst(b.spreker, 160)),
      start_op, einde_op, tijdzone: STANDAARD_TIJDZONE,
      vorm, locatie: vorm === 'locatie' ? locatie : null, met_meet,
      capaciteit, prijs_cents, inschrijven_tot, agenda_id: ofNull(agenda),
    },
  }
}

/** Velden voor het formulier uit een bestaand event (Brusselse muurklok). */
export function naarFormulier(e: KlantEvent): Record<string, string | boolean> {
  return {
    titel: e.titel, soort: e.soort, soort_label: e.soort_label ?? '', samenvatting: e.samenvatting ?? '', beschrijving: e.beschrijving ?? '', cover_pad: e.cover_pad ?? '', spreker: e.spreker ?? '',
    datum: dag(e.start_op), start: uur(e.start_op), einde: uur(e.einde_op), einddatum: dag(e.einde_op),
    vorm: e.vorm, locatie: e.locatie ?? '', met_meet: e.met_meet,
    capaciteit: e.capaciteit ? String(e.capaciteit) : '', prijs: e.prijs_cents ? String(e.prijs_cents / 100).replace('.', ',') : '',
    inschrijven_tot: e.inschrijven_tot ? dag(e.inschrijven_tot) : '', agenda_id: e.agenda_id ?? '',
  }
}

/** Wat moet er gebeuren met de inschrijvers als dit verandert? Tijd of plaats = Google verwittigt hen. */
export function belangrijkeWijziging(oud: Pick<KlantEvent, 'start_op' | 'einde_op' | 'vorm' | 'locatie' | 'titel'>, nieuw: Pick<GeldigEvent, 'start_op' | 'einde_op' | 'vorm' | 'locatie' | 'titel'>): boolean {
  return Date.parse(oud.start_op) !== Date.parse(nieuw.start_op) || Date.parse(oud.einde_op) !== Date.parse(nieuw.einde_op)
    || oud.vorm !== nieuw.vorm || (oud.locatie ?? '') !== (nieuw.locatie ?? '') || oud.titel !== nieuw.titel
}

// ── Prijs en akkoord ─────────────────────────────────────────────────────────

// Ronde bedragen zonder decimalen (€ 95), anders altijd twee (€ 95,50).
const euroRond = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 })
const euroCent = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const euro = (cents: number): string => (cents % 100 === 0 ? euroRond : euroCent).format(cents / 100).replace(/[\u00a0\u202f]/g, ' ')
export const prijsTekst = (cents: number): string => (cents > 0 ? `${euro(cents)} excl. btw` : 'Gratis')

/** De tekst waarmee de klant akkoord gaat. Wordt zo bewaard bij de inschrijving. */
export function akkoordTekst(e: Pick<KlantEvent, 'titel' | 'prijs_cents'>, aantal: number): string {
  const totaal = aantal > 1 ? ` (${aantal} deelnemers: ${euro(e.prijs_cents * aantal)} excl. btw)` : ''
  return `Ik ga akkoord dat NextGenMedia mij na de inschrijving voor "${e.titel}" een Peppol-factuur stuurt van ${euro(e.prijs_cents)} excl. btw per deelnemer${totaal}. Er wordt niets betaald in de app.`
}

// ── Inschrijven ──────────────────────────────────────────────────────────────

export type InschrijvingDicht = 'concept' | 'geannuleerd' | 'voorbij' | 'gesloten' | 'volzet'
export const DICHT_LABEL: Record<InschrijvingDicht, string> = {
  concept: 'Nog niet gepubliceerd', geannuleerd: 'Geannuleerd', voorbij: 'Afgelopen', gesloten: 'Inschrijvingen gesloten', volzet: 'Volzet',
}

/** Kan iemand zich nu nog inschrijven? */
export function inschrijvingOpen(e: Pick<KlantEvent, 'status' | 'start_op' | 'inschrijven_tot' | 'capaciteit'>, bezet: number, nu: number = Date.now()): { open: true; vrij: number | null } | { open: false; reden: InschrijvingDicht } {
  if (e.status === 'concept') return { open: false, reden: 'concept' }
  if (e.status === 'geannuleerd') return { open: false, reden: 'geannuleerd' }
  if (Date.parse(e.start_op) <= nu) return { open: false, reden: 'voorbij' }
  if (e.inschrijven_tot && Date.parse(e.inschrijven_tot) < nu) return { open: false, reden: 'gesloten' }
  if (e.capaciteit != null && bezet >= e.capaciteit) return { open: false, reden: 'volzet' }
  return { open: true, vrij: e.capaciteit != null ? e.capaciteit - bezet : null }
}

export type Deelnemer = { naam: string; email: string }

/**
 * Deelnemers van één inschrijving: de ingelogde persoon zelf (vast) plus
 * eventueel collega's. Elk e-mailadres één keer.
 */
export function valideerDeelnemers(ik: Deelnemer, extra: unknown, metZelf = true): { ok: true; lijst: Deelnemer[] } | { ok: false; fout: string } {
  const lijst: Deelnemer[] = []
  if (metZelf) {
    if (!isEmail(ik.email)) return { ok: false, fout: 'Je account heeft geen geldig e-mailadres.' }
    lijst.push({ naam: tekst(ik.naam, 120) || ik.email.split('@')[0], email: ik.email.trim().toLowerCase() })
  }
  const ruw = Array.isArray(extra) ? extra : []
  for (const x of ruw) {
    const r = (x ?? {}) as { naam?: unknown; email?: unknown }
    const naam = tekst(r.naam, 120)
    const email = tekst(r.email, 200).toLowerCase()
    if (!naam && !email) continue
    if (naam.length < 2) return { ok: false, fout: 'Vul de naam van elke collega in.' }
    if (!isEmail(email)) return { ok: false, fout: `"${email || naam}" is geen geldig e-mailadres.` }
    if (lijst.some((d) => d.email === email)) return { ok: false, fout: `${email} staat er al bij.` }
    lijst.push({ naam, email })
  }
  if (lijst.length === 0) return { ok: false, fout: 'Voeg minstens één deelnemer toe.' }
  if (lijst.length > MAX_DEELNEMERS_PER_INSCHRIJVING) return { ok: false, fout: `Je schrijft maximaal ${MAX_DEELNEMERS_PER_INSCHRIJVING} mensen tegelijk in.` }
  return { ok: true, lijst }
}

/** Antwoord van de databankfunctie klant_event_inschrijven als melding voor de klant. */
export function inschrijfFout(code: string, extra: { email?: string; vrij?: number } = {}): string {
  switch (code) {
    case 'niet_gevonden': return 'Dit event bestaat niet (meer).'
    case 'niet_open': return 'Je kan je voor dit event (nog) niet inschrijven.'
    case 'voorbij': return 'Dit event is al begonnen.'
    case 'gesloten': return 'De inschrijvingen voor dit event zijn gesloten.'
    case 'al_ingeschreven': return `${extra.email ?? 'Deze persoon'} is al ingeschreven.`
    case 'volzet': return extra.vrij ? `Er ${extra.vrij === 1 ? 'is nog 1 plaats' : `zijn nog ${extra.vrij} plaatsen`} vrij. Schrijf minder mensen in.` : 'Dit event is volzet.'
    default: return 'Inschrijven lukte niet. Probeer het opnieuw.'
  }
}

// ── Aftelling ────────────────────────────────────────────────────────────────

export type Aftelling =
  | { fase: 'komend'; dagen: number; uren: number; minuten: number; seconden: number; tekst: string }
  | { fase: 'bezig'; tekst: string }
  | { fase: 'voorbij'; tekst: string }

/** "Nog 12 dagen", "Nog 5 uur", "Nog 20 minuten", "Nu bezig", "Afgelopen". */
export function aftelling(startOp: string, eindeOp: string, nu: number = Date.now()): Aftelling {
  const start = Date.parse(startOp)
  const einde = Date.parse(eindeOp)
  if (nu >= einde) return { fase: 'voorbij', tekst: 'Afgelopen' }
  if (nu >= start) return { fase: 'bezig', tekst: 'Nu bezig' }
  const ms = start - nu
  const dagen = Math.floor(ms / 86_400_000)
  const uren = Math.floor((ms % 86_400_000) / 3_600_000)
  const minuten = Math.floor((ms % 3_600_000) / 60_000)
  const seconden = Math.floor((ms % 60_000) / 1000)
  const t = dagen >= 1 ? `Nog ${dagen} ${dagen === 1 ? 'dag' : 'dagen'}`
    : uren >= 1 ? `Nog ${uren} uur`
    : `Nog ${Math.max(1, minuten)} ${minuten === 1 ? 'minuut' : 'minuten'}`
  return { fase: 'komend', dagen, uren, minuten, seconden, tekst: t }
}

// ── Weergave ─────────────────────────────────────────────────────────────────

/** "dinsdag 17 november 2026 · 14:00–16:00" (of over meerdere dagen). */
export function wanneerTekst(e: Pick<KlantEvent, 'start_op' | 'einde_op'>): string {
  const zelfdeDag = dag(e.start_op) === dag(e.einde_op)
  return zelfdeDag
    ? `${datumLang(e.start_op)} · ${uur(e.start_op)}–${uur(e.einde_op)}`
    : `${datumLang(e.start_op)} ${uur(e.start_op)} tot ${datumLang(e.einde_op)} ${uur(e.einde_op)}`
}
export const waarTekst = (e: Pick<KlantEvent, 'vorm' | 'locatie' | 'met_meet'>): string =>
  e.vorm === 'online' ? 'Online via Google Meet' : `${e.locatie ?? 'Op locatie'}${e.met_meet ? ' (ook via Google Meet)' : ''}`
export const coverUrl = (e: Pick<KlantEvent, 'cover_pad'>): string | null => publiekeUrl(e.cover_pad)

export const googleEventIdVoor = (eventId: string): string => `ngmev${eventId.replace(/-/g, '').toLowerCase()}`

/** Omschrijving van het Google-event (staat in de agenda van de deelnemers). */
export function googleOmschrijving(e: Pick<KlantEvent, 'samenvatting' | 'soort' | 'soort_label'>, appLink: string): string {
  return [e.samenvatting?.trim() || null, `Details en uitschrijven: ${appLink}`, `${soortLabel(e)} van NextGenMedia.`].filter(Boolean).join('\n\n')
}

// ── Agendabestand (.ics) ─────────────────────────────────────────────────────

const icsTijd = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsTekst = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1')
/** Regels langer dan 75 tekens vouwen (RFC 5545). */
function vouw(regel: string): string {
  const delen: string[] = []
  let rest = regel
  while (rest.length > 74) { delen.push(rest.slice(0, 74)); rest = rest.slice(74) }
  delen.push(rest)
  return delen.join('\r\n ')
}

export function bouwIcs(e: Pick<KlantEvent, 'id' | 'titel' | 'samenvatting' | 'start_op' | 'einde_op' | 'vorm' | 'locatie' | 'met_meet' | 'meet_url' | 'google_ical_uid' | 'status'>, o: { appLink: string; nu?: Date }): string {
  const plaats = e.vorm === 'locatie' ? (e.locatie ?? '') : (e.meet_url ?? 'Online via Google Meet')
  const omschrijving = [
    e.samenvatting?.trim() || null,
    heeftMeet(e) && e.meet_url ? `Deelnemen via Google Meet: ${e.meet_url}` : null,
    `Details: ${o.appLink}`,
  ].filter(Boolean).join('\n\n')
  const regels = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NextGenMedia//Events//NL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.google_ical_uid || `event-${e.id}@nextgenmedia.be`}`,
    `DTSTAMP:${icsTijd((o.nu ?? new Date()).toISOString())}`,
    `DTSTART:${icsTijd(e.start_op)}`,
    `DTEND:${icsTijd(e.einde_op)}`,
    `SUMMARY:${icsTekst(e.titel)}`,
    `DESCRIPTION:${icsTekst(omschrijving)}`,
    `LOCATION:${icsTekst(plaats)}`,
    `URL:${o.appLink}`,
    `STATUS:${e.status === 'geannuleerd' ? 'CANCELLED' : 'CONFIRMED'}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Herinnering', 'TRIGGER:-PT15M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ]
  return regels.map(vouw).join('\r\n') + '\r\n'
}

/** Link "Toevoegen aan Google Agenda" (opent een ingevuld nieuw event). */
export function googleAgendaLink(e: Pick<KlantEvent, 'titel' | 'start_op' | 'einde_op' | 'vorm' | 'locatie' | 'meet_url'>, appLink: string): string {
  const p = new URLSearchParams({
    action: 'TEMPLATE', text: e.titel, dates: `${icsTijd(e.start_op)}/${icsTijd(e.einde_op)}`,
    details: [e.meet_url ? `Google Meet: ${e.meet_url}` : null, `Details: ${appLink}`].filter(Boolean).join('\n'),
    location: e.vorm === 'locatie' ? (e.locatie ?? '') : (e.meet_url ?? 'Online'),
  })
  return `https://calendar.google.com/calendar/render?${p.toString()}`
}

// ── Mails ────────────────────────────────────────────────────────────────────

type MailEvent = Pick<KlantEvent, 'titel' | 'soort' | 'soort_label' | 'start_op' | 'einde_op' | 'vorm' | 'locatie' | 'met_meet' | 'meet_url' | 'prijs_cents' | 'spreker'>
export type EventMail = { onderwerp: string; tekst: string; ctaTekst: string; ctaLink: string }
const voornaam = (naam: string) => naam.trim().split(/\s+/)[0] || naam

function praktisch(e: MailEvent): string {
  const regels = [
    `Wanneer: ${wanneerTekst(e)}`,
    e.vorm === 'locatie' ? `Waar: ${e.locatie ?? ''}` : null,
    heeftMeet(e) ? (e.meet_url ? `Google Meet: ${e.meet_url}` : 'Google Meet: de link volgt in de herinnering en staat in je klantapp.') : null,
    e.spreker ? `Door: ${e.spreker}` : null,
  ]
  return regels.filter(Boolean).join('\n')
}

/** Meteen na het inschrijven. Met het agendabestand als bijlage. */
export function bevestigingsMail(e: MailEvent, d: Deelnemer, o: { appLink: string; doorAnder?: string | null }): EventMail {
  const soort = soortLabel(e).toLowerCase()
  const wie = o.doorAnder ? `${o.doorAnder} heeft je ingeschreven` : 'Je bent ingeschreven'
  const delen = [
    `Hoi ${voornaam(d.naam)},`,
    `${wie} voor de ${soort} "${e.titel}". Fijn dat je erbij bent.`,
    praktisch(e),
    'In de bijlage zit een agendabestand. Open het om het event in je agenda te zetten. De dag voordien krijg je nog een herinnering.',
    e.prijs_cents > 0 ? `Je krijgt achteraf een Peppol-factuur van ${euro(e.prijs_cents)} excl. btw.` : null,
    'Kan je toch niet? Schrijf je uit in de klantapp, dan geven we je plaats aan iemand anders.',
  ]
  return { onderwerp: `Je bent ingeschreven: ${e.titel}`, tekst: delen.filter(Boolean).join('\n\n'), ctaTekst: 'Bekijk in je klantapp', ctaLink: o.appLink }
}

/** Ongeveer een dag vooraf, via de scheduler. */
export function herinneringsMail(e: MailEvent, d: Deelnemer, o: { appLink: string; nu?: Date }): EventMail {
  const nu = o.nu ?? new Date()
  const morgen = new Date(nu.getTime() + 86_400_000)
  const isMorgen = dag(e.start_op) === dag(morgen.toISOString())
  const isVandaag = dag(e.start_op) === dag(nu.toISOString())
  const wanneerKort = isVandaag ? `vandaag om ${uur(e.start_op)}` : isMorgen ? `morgen om ${uur(e.start_op)}` : `op ${datumLang(e.start_op)} om ${uur(e.start_op)}`
  const delen = [
    `Hoi ${voornaam(d.naam)},`,
    `Even een seintje: "${e.titel}" begint ${wanneerKort}.`,
    praktisch(e),
    heeftMeet(e) && e.meet_url ? 'Klik een paar minuten vooraf op de Meet-link, dan kan je rustig je camera en micro testen.' : null,
    'Kan je toch niet? Laat het ons weten of schrijf je uit in de klantapp.',
  ]
  const kop = isVandaag ? 'Vandaag' : isMorgen ? 'Morgen' : 'Binnenkort'
  return {
    onderwerp: `${kop}: ${e.titel}`, tekst: delen.filter(Boolean).join('\n\n'),
    ctaTekst: heeftMeet(e) && e.meet_url ? 'Deelnemen via Google Meet' : 'Bekijk in je klantapp',
    ctaLink: heeftMeet(e) && e.meet_url ? e.meet_url : o.appLink,
  }
}

// ── Herinnering: wanneer ─────────────────────────────────────────────────────

/** De herinnering vertrekt vanaf 24 uur voor de start. */
export const HERINNERING_VOORAF_MS = 24 * 3600_000
/** Wie zich minder dan 3 uur voor de start inschrijft, heeft net de bevestiging: geen herinnering meer. */
export const GEEN_HERINNERING_BINNEN_MS = 3 * 3600_000
/** Te kort voor de start: dan heeft een herinnering geen zin meer. */
export const LAATSTE_HERINNERING_MS = 20 * 60_000

export function herinneringNodig(e: Pick<KlantEvent, 'start_op' | 'status'>, i: Pick<Inschrijving, 'created_at' | 'status' | 'herinnering_status'>, nu: number = Date.now()): 'nu' | 'later' | 'nooit' {
  if (e.status !== 'gepubliceerd' || i.status !== 'ingeschreven' || i.herinnering_status !== 'gepland') return 'nooit'
  const start = Date.parse(e.start_op)
  if (start - Date.parse(i.created_at) < GEEN_HERINNERING_BINNEN_MS) return 'nooit'
  if (start - nu < LAATSTE_HERINNERING_MS) return 'nooit'
  return start - nu <= HERINNERING_VOORAF_MS ? 'nu' : 'later'
}
