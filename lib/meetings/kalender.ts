// Calendar — pure regels (client-safe, testbaar).
//
// Calendar toont alle meetings van één persoon op één plek:
//   · meetings uit de app (intern gepland en klantboekingen, klant_meetings)
//   · verkoopafspraken (sales_appointments)
//   · ClickUp-meetings: ENKEL taken met een start- én eindmoment mét uur
//   · Google-afspraken die nergens anders vandaan komen
// Elke afspraak verschijnt één keer: wat aan een meeting of verkoopafspraak
// gekoppeld is (ClickUp-taak of Google-event), wordt niet nog eens los getoond.

import { STANDAARD_TIJDZONE, uur } from '@/lib/meetings/model'
import { mergeIntervals, type Interval } from '@/lib/sales/availability'

export type ClickupTaak = {
  id: string
  naam: string
  startMs: number | null
  dueMs: number
  url?: string
  lijstNaam?: string
  /** ClickUp's eigen vlag "er staat een uur bij"; null/undefined als ClickUp ze niet meestuurt. */
  startHeeftUur?: boolean | null
  dueHeeftUur?: boolean | null
}

/**
 * Staat er een uur bij dit ClickUp-moment? ClickUp zet een datum zonder uur op
 * 04:00 lokale tijd; stuurt ClickUp zijn eigen vlag mee, dan geldt die.
 */
export function heeftUur(ms: number, vlag?: boolean | null): boolean {
  if (typeof vlag === 'boolean') return vlag
  return uur(new Date(ms).toISOString(), STANDAARD_TIJDZONE) !== '04:00'
}

/**
 * Is deze ClickUp-taak een meeting? Enkel met een specifieke startdatum én
 * -tijd en een specifieke einddatum én -tijd (in ClickUp: start date en due
 * date, allebei met een uur), en het einde na het begin. Een gewone taak met
 * enkel een deadline, of zonder uur, is geen afspraak en blokkeert niets.
 */
export function isClickupMeeting(t: ClickupTaak): boolean {
  if (t.startMs === null || !Number.isFinite(t.startMs) || !Number.isFinite(t.dueMs)) return false
  if (!heeftUur(t.startMs, t.startHeeftUur) || !heeftUur(t.dueMs, t.dueHeeftUur)) return false
  return t.dueMs > t.startMs
}

/** Bezette blokken uit ClickUp: enkel de meetings. */
export function clickupMeetingBezet(taken: ClickupTaak[]): Interval[] {
  return mergeIntervals(taken.filter(isClickupMeeting).map((t) => ({ start: t.startMs as number, end: t.dueMs })))
}

export type KalenderBron = 'meeting' | 'klantboeking' | 'afspraak' | 'clickup' | 'google'

export type KalenderItem = {
  /** Uniek in de lijst: '<bron>:<id>'. */
  key: string
  bron: KalenderBron
  id: string
  titel: string
  start: string
  eind: string
  meetUrl: string | null
  /** Link naar de bron (ClickUp-taak of Google-afspraak). */
  link: string | null
  /** Kan door slepen verplaatst worden (meetings en verkoopafspraken uit de app). */
  verplaatsbaar: boolean
  clickupTaskId: string | null
  googleEventId: string | null
  /** Extra regel onder de titel (lijstnaam, klant, ...). */
  sub: string | null
}

export type MeetingBron = {
  id: string; titel: string; klant_naam?: string | null; starts_at: string; ends_at: string; status: string
  bron?: string | null; meet_url?: string | null; clickup_task_id?: string | null; google_event_id?: string | null
}
export type AfspraakBron = {
  id: string; starts_at: string; ends_at: string; status: string
  titel?: string | null; company?: string | null; contact?: string | null
  meet_url?: string | null; clickup_task_id?: string | null; external_event_id?: string | null
  /** Mag de kijker de details van deze verkoopafspraak zien? */
  details?: boolean
}
export type GoogleBron = {
  id: string; titel: string; start: string; eind: string
  meetUrl?: string | null; link?: string | null
  /** Waarmerk van de ClickUp-sync: dit event IS een ClickUp-taak. */
  clickupTaskId?: string | null
  heleDag?: boolean
  vrij?: boolean
  geannuleerd?: boolean
}

/**
 * Alle bronnen samenvoegen tot één chronologische lijst, zonder dubbels:
 *  · een ClickUp-taak die aan een meeting of verkoopafspraak hangt → enkel die meeting
 *  · een Google-event van een meeting of verkoopafspraak → enkel die meeting
 *  · een Google-event van de ClickUp-sync → enkel de ClickUp-meeting (of niets
 *    als de taak geen meeting is)
 *  · Google-events zonder uur (hele dag) of als "vrij" gemarkeerd → niet getoond
 */
export function voegSamen(b: { meetings: MeetingBron[]; afspraken: AfspraakBron[]; clickup: ClickupTaak[]; google: GoogleBron[] }): KalenderItem[] {
  const uit: KalenderItem[] = []
  const gekoppeldeTaken = new Set<string>()
  const gekoppeldeEvents = new Set<string>()

  for (const m of b.meetings) {
    if (m.status !== 'ingepland') continue
    if (m.clickup_task_id) gekoppeldeTaken.add(m.clickup_task_id)
    if (m.google_event_id) gekoppeldeEvents.add(m.google_event_id)
    uit.push({
      key: `meeting:${m.id}`, bron: m.bron === 'klantboeking' ? 'klantboeking' : 'meeting', id: m.id,
      titel: m.titel, start: m.starts_at, eind: m.ends_at, meetUrl: m.meet_url ?? null, link: null,
      verplaatsbaar: true, clickupTaskId: m.clickup_task_id ?? null, googleEventId: m.google_event_id ?? null,
      sub: m.klant_naam && !m.titel.includes(m.klant_naam) ? m.klant_naam : null,
    })
  }
  for (const a of b.afspraken) {
    if (a.status === 'cancelled') continue
    if (a.clickup_task_id) gekoppeldeTaken.add(a.clickup_task_id)
    if (a.external_event_id) gekoppeldeEvents.add(a.external_event_id)
    const zien = a.details !== false
    uit.push({
      key: `afspraak:${a.id}`, bron: 'afspraak', id: a.id,
      titel: zien ? (a.titel || [a.company, a.contact].filter(Boolean).join(' — ') || 'Verkoopafspraak') : 'Verkoopafspraak',
      start: a.starts_at, eind: a.ends_at, meetUrl: zien ? a.meet_url ?? null : null, link: null,
      verplaatsbaar: zien, clickupTaskId: a.clickup_task_id ?? null, googleEventId: a.external_event_id ?? null,
      sub: zien && a.titel && a.company ? a.company : null,
    })
  }
  const getoondeTaken = new Set<string>()
  for (const t of b.clickup) {
    if (gekoppeldeTaken.has(t.id) || getoondeTaken.has(t.id) || !isClickupMeeting(t)) continue
    getoondeTaken.add(t.id)
    uit.push({
      key: `clickup:${t.id}`, bron: 'clickup', id: t.id, titel: t.naam,
      start: new Date(t.startMs as number).toISOString(), eind: new Date(t.dueMs).toISOString(),
      meetUrl: meetLinkUit(t.naam), link: t.url ?? null, verplaatsbaar: false,
      clickupTaskId: t.id, googleEventId: null, sub: t.lijstNaam || null,
    })
  }
  const getoondeEvents = new Set<string>()
  for (const g of b.google) {
    if (g.geannuleerd || g.heleDag || g.vrij) continue
    if (gekoppeldeEvents.has(g.id) || getoondeEvents.has(g.id)) continue
    if (g.clickupTaskId) continue
    getoondeEvents.add(g.id)
    uit.push({
      key: `google:${g.id}`, bron: 'google', id: g.id, titel: g.titel || '(zonder titel)',
      start: g.start, eind: g.eind, meetUrl: g.meetUrl ?? null, link: g.link ?? null, verplaatsbaar: false,
      clickupTaskId: null, googleEventId: g.id, sub: null,
    })
  }
  return uit.sort((x, y) => x.start.localeCompare(y.start) || x.eind.localeCompare(y.eind) || x.key.localeCompare(y.key))
}

/** Een Meet-link in een tekst (bv. de ClickUp-taaknaam), anders null. */
export function meetLinkUit(tekst: string | null | undefined): string | null {
  const m = String(tekst ?? '').match(/https?:\/\/meet\.google\.com\/[a-z0-9-]+/i)
  return m ? m[0] : null
}

/** Bezette blokken van alle zichtbare items (voor de vrije momenten). */
export function itemsBezet(items: KalenderItem[]): Interval[] {
  return mergeIntervals(items.map((i) => ({ start: new Date(i.start).getTime(), end: new Date(i.eind).getTime() })))
}

export const BRON_LABEL: Record<KalenderBron, string> = {
  meeting: 'Meeting', klantboeking: 'Klantboeking', afspraak: 'Verkoopafspraak', clickup: 'ClickUp', google: 'Google Agenda',
}

/** Gsm-melding: zoveel minuten vóór de start, via de Google Agenda-app. */
export const GSM_MELDING_MIN = 15

type AgendaPersoon = { id: string; name?: string | null; account_email?: string | null; clickup_assignee_id?: number | null }

/** "Bram — ClickUp", "Bram - NextGenMedia" → "bram". */
export const korteNaam = (n?: string | null): string => String(n ?? '').split(/\s+[—–-]\s+/)[0].trim().toLowerCase()

/**
 * Horen twee agenda-koppelingen bij dezelfde persoon? Zelfde Google-account
 * EN dezelfde ClickUp-persoon (of, als die ontbreekt, dezelfde voornaam).
 *
 * Waarom niet enkel het Google-account: bij NextGenMedia hangen de agenda's
 * van Bram én Marco aan hetzelfde Google-account. Op account alleen telde een
 * afspraak van Marco dan ook als bezet bij Bram — terwijl de bedoeling altijd
 * was dat enkel de eigen koppelingen (bv. "Bram" en "Bram - NextGenMedia")
 * elkaar blokkeren.
 */
export function zelfdePersoon(a: AgendaPersoon, b: AgendaPersoon): boolean {
  if (a.id === b.id) return true
  if (!a.account_email || a.account_email !== b.account_email) return false
  if (a.clickup_assignee_id && b.clickup_assignee_id) return Number(a.clickup_assignee_id) === Number(b.clickup_assignee_id)
  const na = korteNaam(a.name)
  return !!na && na === korteNaam(b.name)
}

/** De ClickUp-persoon van een agenda, of van een andere koppeling van dezelfde persoon. */
export function clickupPersoon(agenda: AgendaPersoon, alle: AgendaPersoon[]): number | null {
  if (agenda.clickup_assignee_id) return Number(agenda.clickup_assignee_id)
  const ander = alle.find((o) => o.clickup_assignee_id && zelfdePersoon(agenda, o))
  return ander?.clickup_assignee_id ? Number(ander.clickup_assignee_id) : null
}
