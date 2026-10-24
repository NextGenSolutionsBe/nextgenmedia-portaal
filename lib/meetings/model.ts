// Meetingplanner — pure logica (client-safe, testbaar). Server en scherm
// gebruiken dezelfde regels: validatie, tijden in de tijdzone van de meeting
// (standaard Europe/Brussels), het herinneringsmoment, de inhoud van de
// herinneringsmail en van de ClickUp-taak.
//
// Een meeting hoeft niet aan een klant te hangen: wie je uitnodigt, is gewoon
// een naam en een e-mailadres. "Genodigden" (klant_ontvangers) krijgen de
// uitnodiging én de herinnering; "extra deelnemers" (deelnemers) enkel de
// uitnodiging.

import { isDag, isUur } from '@/lib/personeel/tijd'

export const STANDAARD_TIJDZONE = 'Europe/Brussels'
/** @deprecated gebruik STANDAARD_TIJDZONE */
export const MEETING_TIJDZONE = STANDAARD_TIJDZONE
export const TIJDZONE_LABEL = 'Belgische tijd (Europe/Brussels)'
export const DUUR_OPTIES = [15, 30, 45, 60, 90, 120]
export const MAX_DUUR_MIN = 8 * 60
export const MAX_PERSONEN = 20

/** Gangbare keuzes; elke geldige IANA-zone wordt aanvaard. */
export const TIJDZONE_OPTIES: { key: string; label: string }[] = [
  { key: 'Europe/Brussels', label: 'Brussel (België)' },
  { key: 'Europe/Amsterdam', label: 'Amsterdam' },
  { key: 'Europe/Paris', label: 'Parijs' },
  { key: 'Europe/London', label: 'Londen' },
  { key: 'Europe/Madrid', label: 'Madrid' },
  { key: 'Europe/Lisbon', label: 'Lissabon' },
  { key: 'Europe/Berlin', label: 'Berlijn' },
  { key: 'Europe/Istanbul', label: 'Istanbul' },
  { key: 'Asia/Dubai', label: 'Dubai' },
  { key: 'America/New_York', label: 'New York' },
  { key: 'America/Los_Angeles', label: 'Los Angeles' },
  { key: 'UTC', label: 'UTC' },
]

export type Persoon = { naam: string | null; email: string }

const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/
export const isEmail = (s: unknown): boolean => typeof s === 'string' && EMAIL_RE.test(s.trim())

// ── Tijdzones ────────────────────────────────────────────────────────────────

export function isTijdzone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}
const zone = (tz?: string | null) => (tz && isTijdzone(tz) ? tz : STANDAARD_TIJDZONE)

/** "Belgische tijd" voor Brussel, anders de naam van de zone. */
export function tijdzoneLabel(tz?: string | null): string {
  const z = zone(tz)
  if (z === STANDAARD_TIJDZONE) return 'Belgische tijd'
  const optie = TIJDZONE_OPTIES.find((o) => o.key === z)
  return optie ? `tijd ${optie.label} (${z})` : z
}

/** Verschil tussen de zone en UTC op dat moment, in minuten. */
function offsetMinuten(utcMs: number, tz: string): number {
  const delen = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(utcMs))
  const w = (t: string) => Number(delen.find((p) => p.type === t)?.value)
  const lokaal = Date.UTC(w('year'), w('month') - 1, w('day'), w('hour') % 24, w('minute'))
  return Math.round((lokaal - utcMs) / 60000)
}

/** Een muurkloktijd (dag + 'HH:MM') in een zone als ISO-tijdstip (UTC). Zomer- en wintertijd inbegrepen. */
export function zoneNaarIso(d: string, u: string, tz: string = STANDAARD_TIJDZONE): string {
  const [j, m, dd] = d.split('-').map(Number)
  const [h, mi] = u.split(':').map(Number)
  const gok = Date.UTC(j, m - 1, dd, h, mi)
  let t = gok - offsetMinuten(gok, tz) * 60000
  t = gok - offsetMinuten(t, tz) * 60000
  return new Date(t).toISOString()
}

export const dag = (iso: string, tz?: string | null): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: zone(tz), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
export const uur = (iso: string, tz?: string | null): string =>
  new Intl.DateTimeFormat('nl-BE', { timeZone: zone(tz), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
export function datumLang(iso: string, tz?: string | null): string {
  return new Intl.DateTimeFormat('nl-BE', { timeZone: zone(tz), weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))
}
export function datumKort(iso: string, tz?: string | null): string {
  return new Intl.DateTimeFormat('nl-BE', { timeZone: zone(tz), weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso))
}
/** "dinsdag 27 oktober 2026 om 14:00" */
export const wanneer = (iso: string, tz?: string | null): string => `${datumLang(iso, tz)} om ${uur(iso, tz)}`
export const duurMinuten = (startsAt: string, endsAt: string): number => Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000)

// ── Validatie ────────────────────────────────────────────────────────────────

/** Lijst van personen opschonen: trimmen, e-mail in kleine letters, dubbels weg. Ongeldige blijven staan (de validatie meldt ze). */
export function normaliseerPersonen(v: unknown): Persoon[] {
  if (!Array.isArray(v)) return []
  const gezien = new Set<string>()
  const uit: Persoon[] = []
  for (const r of v) {
    const email = String((r as { email?: unknown })?.email ?? '').trim().toLowerCase()
    if (!email || gezien.has(email)) continue
    gezien.add(email)
    const naam = String((r as { naam?: unknown })?.naam ?? '').trim().slice(0, 120)
    uit.push({ naam: naam || null, email })
  }
  return uit
}

export type MeetingInvoer = {
  titel?: unknown; beschrijving?: unknown; dag?: unknown; uur?: unknown; duur_minuten?: unknown; eind_uur?: unknown; tijdzone?: unknown
  klant_ontvangers?: unknown; deelnemers?: unknown; herinnering_aan?: unknown
  /** 'online' (standaard) of 'locatie'. */
  vorm?: unknown; locatie?: unknown; met_meet?: unknown
}
export type MeetingVorm = 'online' | 'locatie'
export type GeldigeMeeting = {
  titel: string; beschrijving: string | null; startsAt: string; endsAt: string; duur: number; tijdzone: string
  klant_ontvangers: Persoon[]; deelnemers: Persoon[]; herinnering_aan: boolean
  vorm: MeetingVorm; locatie: string | null; metMeet: boolean
}

export const MAX_LOCATIE = 300

/**
 * Online = altijd een Meet-link, geen adres. Op locatie = een adres is
 * verplicht; een Meet-link enkel als je die er bewust bij vraagt.
 */
export function valideerVorm(b: { vorm?: unknown; locatie?: unknown; met_meet?: unknown }): { ok: true; vorm: MeetingVorm; locatie: string | null; metMeet: boolean } | { ok: false; fout: string } {
  const vorm = b.vorm === undefined || b.vorm === null || b.vorm === '' ? 'online' : String(b.vorm)
  if (vorm === 'online') return { ok: true, vorm, locatie: null, metMeet: true }
  if (vorm !== 'locatie') return { ok: false, fout: 'Kies online of op locatie.' }
  const locatie = String(b.locatie ?? '').trim().replace(/\s*\n\s*/g, ', ')
  if (locatie.length < 3) return { ok: false, fout: 'Vul het adres van de meeting in.' }
  if (locatie.length > MAX_LOCATIE) return { ok: false, fout: `Het adres mag hoogstens ${MAX_LOCATIE} tekens hebben.` }
  return { ok: true, vorm, locatie, metMeet: b.met_meet === true }
}

/** "Waar" in één zin, voor schermen en mails. */
export function waarTekst(m: { vorm?: string | null; locatie?: string | null; met_meet?: boolean | null }): string {
  if (m.vorm === 'locatie') return `Op locatie: ${m.locatie ?? '—'}${m.met_meet ? ' (met Google Meet-link)' : ''}`
  return 'Online via Google Meet'
}

/** Volledig adres van een klant uit het dossier, of null. */
export function klantAdres(k: { adres_straat?: string | null; adres_postcode?: string | null; adres_gemeente?: string | null; adres_land?: string | null } | null | undefined): string | null {
  if (!k) return null
  const plaats = [k.adres_postcode, k.adres_gemeente].map((x) => (x ?? '').trim()).filter(Boolean).join(' ')
  const land = (k.adres_land ?? '').trim()
  const delen = [(k.adres_straat ?? '').trim(), plaats, /^(be|belgi[eë]|belgium)$/i.test(land) ? '' : land].filter(Boolean)
  return delen.length ? delen.join(', ') : null
}

/**
 * Controle vóór er iets naar Google, ClickUp of de mailprovider gaat. Minstens
 * één genodigde met een geldig e-mailadres is verplicht: die krijgt de
 * uitnodiging en de herinnering. Duur of eindtijd, één van beide volstaat.
 */
export function valideerMeeting(b: MeetingInvoer, nu: Date = new Date()): { ok: true; waarde: GeldigeMeeting } | { ok: false; fout: string } {
  const titel = String(b.titel ?? '').trim().slice(0, 200)
  if (!titel) return { ok: false, fout: 'Geef de meeting een titel.' }
  const tijdzone = b.tijdzone === undefined || b.tijdzone === null || b.tijdzone === '' ? STANDAARD_TIJDZONE : String(b.tijdzone)
  if (!isTijdzone(tijdzone)) return { ok: false, fout: 'Kies een geldige tijdzone.' }
  if (!isDag(b.dag)) return { ok: false, fout: 'Kies een geldige datum.' }
  if (!isUur(b.uur)) return { ok: false, fout: 'Kies een geldige starttijd (uu:mm).' }
  const startsAt = zoneNaarIso(b.dag, b.uur, tijdzone)
  // Bestaat dit uur wel? Bij de overgang naar zomertijd valt er een uur weg.
  if (uur(startsAt, tijdzone) !== b.uur) return { ok: false, fout: 'Dit tijdstip bestaat niet op die dag (overgang naar zomertijd). Kies een ander uur.' }
  if (new Date(startsAt).getTime() <= nu.getTime()) return { ok: false, fout: 'De starttijd ligt in het verleden.' }

  let duur: number
  if (b.eind_uur !== undefined && b.eind_uur !== null && b.eind_uur !== '') {
    if (!isUur(b.eind_uur)) return { ok: false, fout: 'Kies een geldige eindtijd (uu:mm).' }
    duur = Math.round((new Date(zoneNaarIso(b.dag, b.eind_uur, tijdzone)).getTime() - new Date(startsAt).getTime()) / 60000)
    if (duur <= 0) return { ok: false, fout: 'De eindtijd ligt vóór of op de starttijd.' }
  } else {
    duur = Math.round(Number(b.duur_minuten))
  }
  if (!Number.isFinite(duur) || duur < 5 || duur > MAX_DUUR_MIN) return { ok: false, fout: `De duur ligt tussen 5 minuten en ${MAX_DUUR_MIN / 60} uur.` }
  const endsAt = new Date(new Date(startsAt).getTime() + duur * 60000).toISOString()

  const klant = normaliseerPersonen(b.klant_ontvangers)
  if (!klant.length) return { ok: false, fout: 'Vul minstens één genodigde met een e-mailadres in. Die krijgt de uitnodiging en de herinnering.' }
  const slechtKlant = klant.find((p) => !isEmail(p.email))
  if (slechtKlant) return { ok: false, fout: `"${slechtKlant.email}" is geen geldig e-mailadres.` }
  const klantSet = new Set(klant.map((p) => p.email))
  const deelnemers = normaliseerPersonen(b.deelnemers).filter((p) => !klantSet.has(p.email))
  const slechtDeel = deelnemers.find((p) => !isEmail(p.email))
  if (slechtDeel) return { ok: false, fout: `"${slechtDeel.email}" (extra deelnemer) is geen geldig e-mailadres.` }
  if (klant.length + deelnemers.length > MAX_PERSONEN) return { ok: false, fout: `Maximaal ${MAX_PERSONEN} genodigden per meeting.` }

  const plaats = valideerVorm(b)
  if (!plaats.ok) return { ok: false, fout: plaats.fout }

  const beschrijving = String(b.beschrijving ?? '').trim().slice(0, 5000)
  return {
    ok: true,
    waarde: {
      titel, beschrijving: beschrijving || null, startsAt, endsAt, duur, tijdzone, klant_ontvangers: klant, deelnemers, herinnering_aan: b.herinnering_aan !== false,
      vorm: plaats.vorm, locatie: plaats.locatie, metMeet: plaats.metMeet,
    },
  }
}

/** Weergavenaam van een meeting zonder klant: de eerste genodigde. */
export const naamZonderKlant = (genodigden: Persoon[]): string => genodigden[0]?.naam || genodigden[0]?.email || 'Losse meeting'

// ── Herinnering ──────────────────────────────────────────────────────────────

/** Standaard 24 uur vooraf. Wordt de meeting later ingepland, dan 2 uur vooraf als dat nog kan. */
export const HERINNERING_MOMENTEN = [
  { key: '24u', voorMin: 24 * 60, label: '24 uur vooraf' },
  { key: '2u', voorMin: 2 * 60, label: '2 uur vooraf' },
] as const
/** Een herinnering die binnen dit aantal minuten zou vertrekken, plannen we niet meer in. */
export const MIN_VOORSPRONG_MIN = 15
/** Zo kort voor de start sturen we niets meer, ook niet als de planner achterliep. */
export const LAATSTE_VERZENDING_MIN = 15

export type HerinneringKeuze = { moment: string; label: string; geplandVoor: string }

/**
 * Het eerste herinneringsmoment dat nog in de toekomst ligt. Nooit met
 * terugwerkende kracht: is 24 uur vooraf al voorbij, dan 2 uur vooraf; is ook
 * dat te laat, dan geen herinnering (null).
 */
export function kiesHerinnering(startsAt: string, nu: Date = new Date()): HerinneringKeuze | null {
  const start = new Date(startsAt).getTime()
  for (const m of HERINNERING_MOMENTEN) {
    const t = start - m.voorMin * 60000
    if (t >= nu.getTime() + MIN_VOORSPRONG_MIN * 60000) return { moment: m.key, label: m.label, geplandVoor: new Date(t).toISOString() }
  }
  return null
}

/** Mag een herinnering die nu aan de beurt is nog vertrekken? Niet vlak voor of na de start. */
export function magNogVersturen(startsAt: string, nu: Date = new Date()): boolean {
  return nu.getTime() < new Date(startsAt).getTime() - LAATSTE_VERZENDING_MIN * 60000
}

export const momentLabel = (key: string | null | undefined): string => HERINNERING_MOMENTEN.find((m) => m.key === key)?.label ?? (key ?? '')

// ── Herinneringsmail ─────────────────────────────────────────────────────────

const naamLijst = (namen: string[]): string => (namen.length <= 1 ? namen.join('') : `${namen.slice(0, -1).join(', ')} en ${namen[namen.length - 1]}`)

export type MailMeeting = {
  klant_naam: string; titel: string; starts_at: string; meet_url: string | null; beschrijving: string | null
  organisator_naam: string | null; ontvangers: Persoon[]; tijdzone?: string | null
  /** Merk onder de mail (NextGenMedia of NextGenSolutions). */
  afzender?: string | null
  /** Voor een afspraak ter plaatse in plaats van via Meet. */
  locatie?: string | null
}

/** Onderwerp en tekst van de herinnering. Enkel gegevens die in de meeting staan, niets verzonnen. */
export function herinneringsMail(m: MailMeeting): { onderwerp: string; tekst: string; ctaTekst: string | null; ctaLink: string | null } {
  const tz = zone(m.tijdzone)
  const namen = m.ontvangers.map((p) => p.naam).filter((n): n is string => !!n)
  const aanhef = namen.length ? naamLijst(namen) : m.klant_naam
  const delen = [
    `Beste ${aanhef},`,
    `Een korte herinnering aan onze meeting "${m.titel}" op ${wanneer(m.starts_at, tz)} (${tijdzoneLabel(tz)}).`,
  ]
  if (m.meet_url) delen.push(`Je neemt deel via Google Meet:\n${m.meet_url}`)
  if (m.locatie) delen.push(`Locatie:\n${m.locatie}`)
  if (m.beschrijving) delen.push(`Agenda:\n${m.beschrijving}`)
  delen.push(`Tot dan,\n${m.organisator_naam ? `${m.organisator_naam}\n` : ''}${m.afzender || 'NextGenMedia'}`)
  return {
    onderwerp: `Herinnering: ${m.titel} op ${datumKort(m.starts_at, tz)} om ${uur(m.starts_at, tz)}`,
    tekst: delen.join('\n\n'),
    ctaTekst: m.meet_url ? 'Deelnemen via Google Meet' : null,
    ctaLink: m.meet_url,
  }
}

// ── Google Calendar ──────────────────────────────────────────────────────────

/**
 * Vaste event-id per meeting (Google: kleine letters a–v en cijfers). Een tweede
 * poging met dezelfde id wordt door Google geweigerd in plaats van dubbel
 * aangemaakt — zo ontstaat er nooit een tweede afspraak na een time-out.
 */
export const googleEventId = (meetingId: string): string => `ngm${meetingId.replace(/-/g, '').toLowerCase()}`

/** Enkel wat de genodigden nodig hebben: de agenda van de meeting. */
export function googleOmschrijving(m: { beschrijving: string | null }): string {
  return [m.beschrijving?.trim() || null, 'Ingepland door NextGenMedia.'].filter(Boolean).join('\n\n')
}

export function genodigden(m: { klant_ontvangers: Persoon[]; deelnemers: Persoon[] }): { email: string; displayName?: string }[] {
  return [...m.klant_ontvangers, ...m.deelnemers].map((p) => (p.naam ? { email: p.email, displayName: p.naam } : { email: p.email }))
}

export const ANTWOORD_LABEL: Record<string, string> = {
  needsAction: 'nog niet geantwoord', accepted: 'aanvaard', declined: 'geweigerd', tentative: 'misschien',
}

// ── ClickUp (zelfde werkwijze als de verkoopafspraken) ───────────────────────

/** Unieke referentie in de taakomschrijving: zo vinden we een taak terug na een onduidelijke fout. */
export const clickupMarker = (meetingId: string): string => `ngm-meeting:${meetingId}`

/** Zelfde opbouw als "Afspraak: {bedrijf} — {contact}" bij de verkoopafspraken. */
/** Taaknaam in ClickUp. Staat de naam al in de titel (klantboeking), dan niet nog eens ervoor. */
export const clickupTaakNaam = (m: { klant_naam: string; titel: string }): string =>
  m.klant_naam && m.titel.includes(m.klant_naam) ? `Meeting: ${m.titel}` : `Meeting: ${m.klant_naam} — ${m.titel}`

export type Koppelingen = { klant?: string | null; project?: string | null; clickupItemId?: string | null }

export function clickupOmschrijving(m: {
  id: string; klant_naam: string; titel: string; starts_at: string; ends_at: string; meet_url: string | null; beschrijving: string | null
  organisator_naam: string | null; klant_ontvangers: Persoon[]; deelnemers: Persoon[]; tijdzone?: string | null
  vorm?: string | null; locatie?: string | null; met_meet?: boolean | null
}, appUrl: string, koppelingen: Koppelingen = {}): string {
  const tz = zone(m.tijdzone)
  const persoon = (p: Persoon) => (p.naam ? `${p.naam} <${p.email}>` : p.email)
  return [
    `Meeting ingepland via de app.`,
    `Wanneer: ${wanneer(m.starts_at, tz)} – ${uur(m.ends_at, tz)} (${tijdzoneLabel(tz)})`,
    `Klant: ${koppelingen.klant ?? 'geen klant gekoppeld'}`,
    koppelingen.project ? `Project: ${koppelingen.project}` : null,
    koppelingen.clickupItemId ? `Gekoppeld ClickUp-item: https://app.clickup.com/t/${koppelingen.clickupItemId}` : null,
    `Genodigden: ${m.klant_ontvangers.map(persoon).join(', ') || '—'}`,
    m.deelnemers.length ? `Extra deelnemers: ${m.deelnemers.map(persoon).join(', ')}` : null,
    m.organisator_naam ? `Organisator: ${m.organisator_naam}` : null,
    m.vorm === 'locatie' ? `Locatie: ${m.locatie ?? '—'}` : null,
    m.met_meet === false ? null : `Google Meet: ${m.meet_url ?? 'nog geen link'}`,
    m.beschrijving ? `\n${m.beschrijving}` : null,
    `\nIn de app: ${appUrl}/admin/meetings?meeting=${m.id}`,
    `Ref: ${clickupMarker(m.id)}`,
  ].filter((x) => x !== null).join('\n')
}

// ── Status per stap (voor het scherm) ────────────────────────────────────────

export type Toon = 'ok' | 'bezig' | 'fout' | 'neutraal'
export type StapWeergave = { label: string; toon: Toon }

export type MeetingStatusVelden = {
  status: string; google_status: string; google_fout?: string | null; meet_url: string | null
  clickup_status: string; clickup_fout?: string | null; herinnering_aan: boolean
  uitnodiging_status?: string | null
  met_meet?: boolean | null
}
export type HerinneringStatusVelden = { status: string; gepland_voor: string; fout?: string | null; verzonden_op?: string | null } | null

export function stapAgenda(m: MeetingStatusVelden): StapWeergave {
  if (m.google_status === 'ok') return { label: 'In Google Agenda', toon: 'ok' }
  if (m.google_status === 'geannuleerd') return { label: 'Afspraak geannuleerd', toon: 'neutraal' }
  if (m.google_status === 'fout') return { label: 'Agenda mislukt', toon: 'fout' }
  return { label: 'Agenda bezig', toon: 'bezig' }
}
export function stapMeet(m: MeetingStatusVelden): StapWeergave {
  if (m.status === 'geannuleerd') return { label: 'Meet vervallen', toon: 'neutraal' }
  if (m.met_meet === false) return { label: 'Op locatie, geen Meet', toon: 'neutraal' }
  if (m.meet_url) return { label: 'Meet-link klaar', toon: 'ok' }
  if (m.google_status === 'ok') return { label: 'Meet-link ontbreekt', toon: 'fout' }
  return { label: 'Meet wacht op agenda', toon: 'neutraal' }
}
/** De uitnodiging verstuurt Google zelf, bij het aanmaken van de afspraak. */
export function stapUitnodiging(m: MeetingStatusVelden): StapWeergave {
  if (m.status === 'geannuleerd') return { label: 'Uitnodiging vervallen', toon: 'neutraal' }
  if (m.uitnodiging_status === 'verzonden' || (!m.uitnodiging_status && m.google_status === 'ok')) return { label: 'Uitnodiging verstuurd', toon: 'ok' }
  if (m.uitnodiging_status === 'mislukt' || m.google_status === 'fout') return { label: 'Uitnodiging niet verstuurd', toon: 'fout' }
  return { label: 'Uitnodiging wacht', toon: 'bezig' }
}
export function stapClickup(m: MeetingStatusVelden): StapWeergave {
  if (m.clickup_status === 'ok') return { label: m.status === 'geannuleerd' ? 'ClickUp afgesloten' : 'In ClickUp', toon: m.status === 'geannuleerd' ? 'neutraal' : 'ok' }
  if (m.clickup_status === 'overgeslagen') return { label: 'ClickUp overgeslagen', toon: 'neutraal' }
  if (m.clickup_status === 'fout') return { label: 'ClickUp mislukt', toon: 'fout' }
  if (m.clickup_status === 'wacht') return { label: 'ClickUp wacht op agenda', toon: 'neutraal' }
  return { label: 'ClickUp bezig', toon: 'bezig' }
}
export function stapHerinnering(m: MeetingStatusVelden, h: HerinneringStatusVelden): StapWeergave {
  if (!m.herinnering_aan) return { label: 'Geen herinnering', toon: 'neutraal' }
  if (!h) return { label: m.status === 'geannuleerd' ? 'Herinnering geannuleerd' : m.google_status === 'ok' ? 'Geen herinnering meer mogelijk' : 'Herinnering wacht op agenda', toon: 'neutraal' }
  switch (h.status) {
    case 'gepland': return { label: `Herinnering ${datumKort(h.gepland_voor)} ${uur(h.gepland_voor)}`, toon: 'ok' }
    case 'bezig': return { label: 'Herinnering wordt verstuurd', toon: 'bezig' }
    case 'verzonden': return { label: 'Herinnering verstuurd', toon: 'ok' }
    case 'mislukt': return { label: 'Herinnering mislukt', toon: 'fout' }
    case 'geannuleerd': return { label: 'Herinnering geannuleerd', toon: 'neutraal' }
    case 'overgeslagen': return { label: 'Herinnering te laat, niet verstuurd', toon: 'neutraal' }
    default: return { label: h.status, toon: 'neutraal' }
  }
}

/** Welke onderdelen veranderen bij een aanpassing? Zo werken we enkel bij wat nodig is. */
export function wijzigingen(oud: { starts_at: string; ends_at: string; titel: string; beschrijving: string | null; klant_ontvangers: Persoon[]; deelnemers: Persoon[]; herinnering_aan: boolean; tijdzone?: string | null
  vorm?: string | null; locatie?: string | null; met_meet?: boolean | null },
  nieuw: GeldigeMeeting): { tijd: boolean; inhoud: boolean; genodigden: boolean; ontvangers: boolean; herinnering: boolean; plaats: boolean; iets: boolean } {
  const tijd = new Date(oud.starts_at).getTime() !== new Date(nieuw.startsAt).getTime() || new Date(oud.ends_at).getTime() !== new Date(nieuw.endsAt).getTime()
    || zone(oud.tijdzone) !== nieuw.tijdzone
  const inhoud = oud.titel !== nieuw.titel || (oud.beschrijving ?? null) !== (nieuw.beschrijving ?? null)
  const sleutel = (l: Persoon[]) => l.map((p) => `${p.email}|${p.naam ?? ''}`).sort().join(';')
  const ontvangers = sleutel(oud.klant_ontvangers) !== sleutel(nieuw.klant_ontvangers)
  const genodigden = ontvangers || sleutel(oud.deelnemers) !== sleutel(nieuw.deelnemers)
  const herinnering = oud.herinnering_aan !== nieuw.herinnering_aan
  // Online ↔ op locatie, een ander adres of de Meet-link erbij/eraf: Google, ClickUp en de herinnering volgen.
  const plaats = (oud.vorm ?? 'online') !== nieuw.vorm || (oud.locatie ?? null) !== nieuw.locatie || (oud.met_meet ?? true) !== nieuw.metMeet
  return { tijd, inhoud, genodigden, ontvangers, herinnering, plaats, iets: tijd || inhoud || genodigden || herinnering || plaats }
}

/** Dezelfde meeting al eens ingepland? Zelfde start, titel en minstens één zelfde genodigde. */
export function lijktOp(a: { titel: string; starts_at: string; klant_ontvangers: Persoon[] }, b: { titel: string; startsAt: string; klant_ontvangers: Persoon[] }): boolean {
  if (new Date(a.starts_at).getTime() !== new Date(b.startsAt).getTime()) return false
  if (a.titel.trim().toLowerCase() !== b.titel.trim().toLowerCase()) return false
  const mails = new Set(a.klant_ontvangers.map((p) => p.email.toLowerCase()))
  return b.klant_ontvangers.some((p) => mails.has(p.email.toLowerCase()))
}

/** Maandag (YYYY-MM-DD) van de week waarin de dag `d` valt. */
export function maandagVan(d: string): string {
  const [j, m, dd] = d.split('-').map(Number)
  const t = new Date(Date.UTC(j, m - 1, dd))
  const wd = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - wd)
  return t.toISOString().slice(0, 10)
}
export function plusDagen(d: string, n: number): string {
  const [j, m, dd] = d.split('-').map(Number)
  const t = new Date(Date.UTC(j, m - 1, dd + n))
  return t.toISOString().slice(0, 10)
}
