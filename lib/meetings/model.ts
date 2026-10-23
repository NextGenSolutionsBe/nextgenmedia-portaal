// Klantmeetings — pure logica (client-safe, testbaar). Server en scherm
// gebruiken dezelfde regels: validatie, tijden in Europe/Brussels, het
// herinneringsmoment, de inhoud van de herinneringsmail en van de ClickUp-taak.

import { brusselNaarIso, dagBrussel, uurBrussel, isDag, isUur, TIJDZONE } from '@/lib/personeel/tijd'

export const MEETING_TIJDZONE = TIJDZONE
export const TIJDZONE_LABEL = 'Belgische tijd (Europe/Brussels)'
export const DUUR_OPTIES = [15, 30, 45, 60, 90, 120]
export const MAX_DUUR_MIN = 8 * 60
export const MAX_PERSONEN = 20

export type Persoon = { naam: string | null; email: string }

const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/
export const isEmail = (s: unknown): boolean => typeof s === 'string' && EMAIL_RE.test(s.trim())

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
  titel?: unknown; beschrijving?: unknown; dag?: unknown; uur?: unknown; duur_minuten?: unknown
  klant_ontvangers?: unknown; deelnemers?: unknown; herinnering_aan?: unknown
}
export type GeldigeMeeting = {
  titel: string; beschrijving: string | null; startsAt: string; endsAt: string; duur: number
  klant_ontvangers: Persoon[]; deelnemers: Persoon[]; herinnering_aan: boolean
}

/**
 * Controle vóór er iets naar Google, ClickUp of de mailprovider gaat. Een
 * klantontvanger met een geldig e-mailadres is verplicht: die krijgt de
 * uitnodiging en de herinnering.
 */
export function valideerMeeting(b: MeetingInvoer, nu: Date = new Date()): { ok: true; waarde: GeldigeMeeting } | { ok: false; fout: string } {
  const titel = String(b.titel ?? '').trim().slice(0, 200)
  if (!titel) return { ok: false, fout: 'Geef de meeting een titel.' }
  if (!isDag(b.dag)) return { ok: false, fout: 'Kies een geldige datum.' }
  if (!isUur(b.uur)) return { ok: false, fout: 'Kies een geldige starttijd (uu:mm).' }
  const duur = Math.round(Number(b.duur_minuten))
  if (!Number.isFinite(duur) || duur < 5 || duur > MAX_DUUR_MIN) return { ok: false, fout: `De duur ligt tussen 5 minuten en ${MAX_DUUR_MIN / 60} uur.` }
  const startsAt = brusselNaarIso(b.dag, b.uur)
  if (new Date(startsAt).getTime() <= nu.getTime()) return { ok: false, fout: 'De starttijd ligt in het verleden.' }
  const endsAt = new Date(new Date(startsAt).getTime() + duur * 60000).toISOString()

  const klant = normaliseerPersonen(b.klant_ontvangers)
  if (!klant.length) return { ok: false, fout: 'Er is geen e-mailadres voor de klant. Vul het adres in dat de uitnodiging en de herinnering moet krijgen.' }
  const slechtKlant = klant.find((p) => !isEmail(p.email))
  if (slechtKlant) return { ok: false, fout: `"${slechtKlant.email}" is geen geldig e-mailadres.` }
  const klantSet = new Set(klant.map((p) => p.email))
  const deelnemers = normaliseerPersonen(b.deelnemers).filter((p) => !klantSet.has(p.email))
  const slechtDeel = deelnemers.find((p) => !isEmail(p.email))
  if (slechtDeel) return { ok: false, fout: `"${slechtDeel.email}" (deelnemer) is geen geldig e-mailadres.` }
  if (klant.length + deelnemers.length > MAX_PERSONEN) return { ok: false, fout: `Maximaal ${MAX_PERSONEN} genodigden per meeting.` }

  const beschrijving = String(b.beschrijving ?? '').trim().slice(0, 5000)
  return {
    ok: true,
    waarde: { titel, beschrijving: beschrijving || null, startsAt, endsAt, duur, klant_ontvangers: klant, deelnemers, herinnering_aan: b.herinnering_aan !== false },
  }
}

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

// ── Weergave van datum en tijd ───────────────────────────────────────────────

export function datumLang(iso: string): string {
  return new Intl.DateTimeFormat('nl-BE', { timeZone: MEETING_TIJDZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))
}
export function datumKort(iso: string): string {
  return new Intl.DateTimeFormat('nl-BE', { timeZone: MEETING_TIJDZONE, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso))
}
export const uur = (iso: string): string => uurBrussel(iso)
export const dag = (iso: string): string => dagBrussel(iso)
/** "dinsdag 27 oktober 2026 om 14:00" */
export const wanneer = (iso: string): string => `${datumLang(iso)} om ${uur(iso)}`
export const duurMinuten = (startsAt: string, endsAt: string): number => Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000)

// ── Herinneringsmail ─────────────────────────────────────────────────────────

const naamLijst = (namen: string[]): string => (namen.length <= 1 ? namen.join('') : `${namen.slice(0, -1).join(', ')} en ${namen[namen.length - 1]}`)

export type MailMeeting = {
  klant_naam: string; titel: string; starts_at: string; meet_url: string | null; beschrijving: string | null
  organisator_naam: string | null; ontvangers: Persoon[]
}

/** Onderwerp en tekst van de herinnering. Enkel gegevens die in de meeting staan, niets verzonnen. */
export function herinneringsMail(m: MailMeeting): { onderwerp: string; tekst: string; ctaTekst: string | null; ctaLink: string | null } {
  const namen = m.ontvangers.map((p) => p.naam).filter((n): n is string => !!n)
  const aanhef = namen.length ? naamLijst(namen) : m.klant_naam
  const delen = [
    `Beste ${aanhef},`,
    `Een korte herinnering aan onze meeting "${m.titel}" op ${wanneer(m.starts_at)} (Belgische tijd).`,
  ]
  if (m.meet_url) delen.push(`Je neemt deel via Google Meet:\n${m.meet_url}`)
  if (m.beschrijving) delen.push(`Agenda:\n${m.beschrijving}`)
  delen.push(`Tot dan,\n${m.organisator_naam ? `${m.organisator_naam}\n` : ''}NextGenMedia`)
  return {
    onderwerp: `Herinnering: ${m.titel} op ${datumKort(m.starts_at)} om ${uur(m.starts_at)}`,
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

// ── ClickUp (zelfde werkwijze als de verkoopafspraken) ───────────────────────

/** Unieke referentie in de taakomschrijving: zo vinden we een taak terug na een onduidelijke fout. */
export const clickupMarker = (meetingId: string): string => `ngm-meeting:${meetingId}`

/** Zelfde opbouw als "Afspraak: {bedrijf} — {contact}" bij de verkoopafspraken. */
export const clickupTaakNaam = (m: { klant_naam: string; titel: string }): string => `Meeting: ${m.klant_naam} — ${m.titel}`

export function clickupOmschrijving(m: {
  id: string; klant_naam: string; titel: string; starts_at: string; ends_at: string; meet_url: string | null; beschrijving: string | null
  organisator_naam: string | null; klant_ontvangers: Persoon[]; deelnemers: Persoon[]
}, appUrl: string): string {
  const persoon = (p: Persoon) => (p.naam ? `${p.naam} <${p.email}>` : p.email)
  return [
    `Klantmeeting ingepland via de app.`,
    `Wanneer: ${wanneer(m.starts_at)} – ${uur(m.ends_at)} (Belgische tijd)`,
    `Klant: ${m.klant_naam}`,
    `Klantontvanger(s): ${m.klant_ontvangers.map(persoon).join(', ') || '—'}`,
    m.deelnemers.length ? `Deelnemers: ${m.deelnemers.map(persoon).join(', ')}` : null,
    m.organisator_naam ? `Organisator: ${m.organisator_naam}` : null,
    `Google Meet: ${m.meet_url ?? 'nog geen link'}`,
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
  if (m.meet_url) return { label: 'Meet-link klaar', toon: 'ok' }
  if (m.google_status === 'ok') return { label: 'Meet-link ontbreekt', toon: 'fout' }
  return { label: 'Meet wacht op agenda', toon: 'neutraal' }
}
export function stapClickup(m: MeetingStatusVelden): StapWeergave {
  if (m.clickup_status === 'ok') return { label: m.status === 'geannuleerd' ? 'ClickUp afgesloten' : 'In ClickUp', toon: m.status === 'geannuleerd' ? 'neutraal' : 'ok' }
  if (m.clickup_status === 'overgeslagen') return { label: 'ClickUp overgeslagen', toon: 'neutraal' }
  if (m.clickup_status === 'fout') return { label: 'ClickUp mislukt', toon: 'fout' }
  return { label: 'ClickUp bezig', toon: 'bezig' }
}
export function stapHerinnering(m: MeetingStatusVelden, h: HerinneringStatusVelden): StapWeergave {
  if (!m.herinnering_aan) return { label: 'Geen herinnering', toon: 'neutraal' }
  if (!h) return { label: m.status === 'geannuleerd' ? 'Herinnering geannuleerd' : 'Geen herinnering meer mogelijk', toon: 'neutraal' }
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
export function wijzigingen(oud: { starts_at: string; ends_at: string; titel: string; beschrijving: string | null; klant_ontvangers: Persoon[]; deelnemers: Persoon[]; herinnering_aan: boolean },
  nieuw: GeldigeMeeting): { tijd: boolean; inhoud: boolean; genodigden: boolean; ontvangers: boolean; herinnering: boolean; iets: boolean } {
  const tijd = new Date(oud.starts_at).getTime() !== new Date(nieuw.startsAt).getTime() || new Date(oud.ends_at).getTime() !== new Date(nieuw.endsAt).getTime()
  const inhoud = oud.titel !== nieuw.titel || (oud.beschrijving ?? null) !== (nieuw.beschrijving ?? null)
  const sleutel = (l: Persoon[]) => l.map((p) => `${p.email}|${p.naam ?? ''}`).sort().join(';')
  const ontvangers = sleutel(oud.klant_ontvangers) !== sleutel(nieuw.klant_ontvangers)
  const genodigden = ontvangers || sleutel(oud.deelnemers) !== sleutel(nieuw.deelnemers)
  const herinnering = oud.herinnering_aan !== nieuw.herinnering_aan
  return { tijd, inhoud, genodigden, ontvangers, herinnering, iets: tijd || inhoud || genodigden || herinnering }
}
