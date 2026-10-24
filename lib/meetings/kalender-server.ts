import 'server-only'
import { getOrCreateSalesOrg, listOwners, loadCalendar, type CalendarOwner } from '@/lib/sales/service'
import { lijstAgendaEvents, type AgendaEvent } from '@/lib/sales/google-calendar'
import { haalSyncTaken, clickupConfigured, type SyncTaak } from '@/lib/clickup'
import { syncGezondheid } from '@/lib/sales/clickup-agenda-sync'
import { isBookable, mergeIntervals, type Interval } from '@/lib/sales/availability'
import { veiligeFout } from '@/lib/meetings/server'
import {
  voegSamen, clickupMeetingBezet, zelfdePersoon, clickupPersoon,
  type KalenderItem, type MeetingBron, type AfspraakBron,
} from '@/lib/meetings/kalender'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

/** Een agenda-koppeling zoals listOwners ze geeft: zonder tokens, met naam, merk, ClickUp-persoon en handtekening. */
export type KalenderAgenda = CalendarOwner & { signature_phone?: string | null; signature_email?: string | null }

export type KalenderData = {
  agendas: KalenderAgenda[]
  agendaId: string | null
  items: KalenderItem[]
  /** Vrije (boekbare) stukken. Leeg als de beschikbaarheid niet betrouwbaar is. */
  segmenten: Interval[]
  beschikbaarheid: { ok: boolean; fout: string | null }
  bronnen: { google: { ok: boolean; fout: string | null }; clickup: { ok: boolean; fout: string | null } }
  syncWaarschuwing: string | null
  regels: { slotMin: number; duurMin: number; tijdzone: string }
}

export type Negeer = { meetingId?: string | null; afspraakId?: string | null }

/** Welke agenda tonen we zonder keuze? De vaste closer van NextGenMedia, anders de eerste. */
async function standaardAgenda(admin: Admin, owners: CalendarOwner[]): Promise<CalendarOwner | null> {
  const { data } = await admin.from('sales_pipelines').select('default_calendar_id').eq('key', 'nextgenmedia').maybeSingle()
  const id = (data as { default_calendar_id?: string | null } | null)?.default_calendar_id
  return owners.find((o) => o.id === id) ?? owners[0] ?? null
}

/**
 * Alles voor Calendar in één venster, voor één persoon:
 *  · items: meetings, verkoopafspraken, ClickUp-meetings en losse Google-
 *    afspraken, samengevoegd zonder dubbels (zie voegSamen)
 *  · segmenten: vrije momenten = werkuren − Google vrij/bezet − ClickUp-
 *    meetings − meetings en verkoopafspraken uit de app. STRIKT: lukt Google
 *    of ClickUp niet, dan geen vrije momenten maar een duidelijke fout.
 */
export async function kalenderData(admin: Admin, opts: {
  agendaId?: string | null; van: number; tot: number; vrij?: boolean
  negeer?: Negeer
  /** Mag de kijker verkoopafspraken in detail zien (Verkoop-recht)? */
  verkoopDetails?: boolean
}): Promise<KalenderData> {
  const org = await getOrCreateSalesOrg()
  const owners = await listOwners(org.id)
  const agenda = owners.find((o) => o.id === opts.agendaId) ?? await standaardAgenda(admin, owners)
  const regels = { slotMin: org.slot_interval_min || 30, duurMin: org.default_duration_min || 30, tijdzone: org.timezone || 'Europe/Brussels' }
  // listOwners strip de Google-tokens al; de rest (naam, merk, handtekening) heeft agendabeheer nodig.
  const agendas = owners as KalenderAgenda[]
  const leeg: KalenderData = {
    agendas, agendaId: null, items: [], segmenten: [],
    beschikbaarheid: { ok: false, fout: 'Er is nog geen agenda gekoppeld.' },
    bronnen: { google: { ok: false, fout: null }, clickup: { ok: false, fout: null } },
    syncWaarschuwing: null, regels,
  }
  if (!agenda) return leeg

  const persoon = owners.filter((o) => zelfdePersoon(agenda, o)).map((o) => o.id)
  const assignee = clickupPersoon(agenda, owners)
  const ruimVan = opts.van - 86400000, ruimTot = opts.tot + 86400000

  // ── Bronnen ophalen, elk met een eigen status ──────────────────────────────
  const clickupP: Promise<{ taken: SyncTaak[]; fout: string | null }> = (async () => {
    if (!clickupConfigured()) return { taken: [], fout: 'ClickUp is niet gekoppeld (CLICKUP_API_KEY ontbreekt).' }
    if (!assignee) return { taken: [], fout: `Aan de agenda "${agenda.name}" is geen ClickUp-persoon gekoppeld.` }
    try {
      return { taken: await haalSyncTaken([assignee], ruimVan, ruimTot), fout: null }
    } catch (e) {
      return { taken: [], fout: `ClickUp antwoordde niet (${veiligeFout(e)}).` }
    }
  })()
  const googleP: Promise<{ events: AgendaEvent[]; fout: string | null }> = lijstAgendaEvents(agenda.id, opts.van, opts.tot)
    .then((events) => ({ events, fout: null }))
    .catch((e) => ({ events: [], fout: `Google Agenda antwoordde niet (${veiligeFout(e)}).` }))
  const meetingsP = admin.from('klant_meetings')
    .select('*')
    .in('agenda_id', persoon).eq('status', 'ingepland')
    .lt('starts_at', new Date(ruimTot).toISOString()).gt('ends_at', new Date(ruimVan).toISOString())
  // Welke ClickUp-meetings zette de agendasync al (met gsm-melding) in Google?
  const syncP = assignee
    ? admin.from('clickup_agenda_targets').select('id').eq('clickup_assignee_id', assignee)
        .then(async (r: { data: { id: string }[] | null }) => {
          const ids = (r.data ?? []).map((x) => x.id)
          if (!ids.length) return new Set<string>()
          const { data } = await admin.from('clickup_agenda_items').select('clickup_task_id, vingerafdruk').in('target_id', ids)
          return new Set(((data ?? []) as { clickup_task_id: string; vingerafdruk: string }[]).filter((x) => /\|v2:m$/.test(x.vingerafdruk)).map((x) => x.clickup_task_id))
        })
        .catch(() => undefined)
    : Promise.resolve(undefined)
  const [cu, gg, mtRes, clickupMetMelding] = await Promise.all([clickupP, googleP, meetingsP, syncP])
  const meetings = ((mtRes as { data: (MeetingBron & { agenda_id: string })[] | null }).data ?? [])
  const meetingsFout = (mtRes as { error?: { message?: string } | null }).error?.message ?? null

  // Extra bezet: ClickUp-meetings en meetings uit de app (die nog niet in Google staan).
  const negeerMeeting = opts.negeer?.meetingId ? meetings.find((m) => m.id === opts.negeer?.meetingId) : null
  const eigenTaken = new Set([negeerMeeting?.clickup_task_id].filter(Boolean) as string[])
  const extraBezet = mergeIntervals([
    ...clickupMeetingBezet(cu.taken.filter((t) => !eigenTaken.has(t.id))),
    ...meetings.filter((m) => m.id !== negeerMeeting?.id).map((m) => ({ start: Date.parse(m.starts_at), end: Date.parse(m.ends_at) })),
  ])
  const negeerBlok = negeerMeeting ? { start: Date.parse(negeerMeeting.starts_at), end: Date.parse(negeerMeeting.ends_at) } : null

  const cal = await loadCalendar(org.id, opts.van, opts.tot, agenda.id, { strikt: true, extraBezet, negeerBlok })
  // Bij het verplaatsen van een verkoopafspraak: haar eigen blok terug vrijgeven.
  let segmenten = cal?.segments ?? []
  const negeerAfspraak = opts.negeer?.afspraakId ? cal?.appointments.find((a) => a.id === opts.negeer?.afspraakId) : null
  if (negeerAfspraak) {
    // De taak van die afspraak blokkeert ze ook (ClickUp-meeting): zonder herberekening
    // geven we enkel haar eigen tijdvak terug vrij, binnen de werkuren.
    segmenten = mergeIntervals([...segmenten, { start: Date.parse(negeerAfspraak.starts_at), end: Date.parse(negeerAfspraak.ends_at) }])
  }

  const fouten = [cal?.beschikbaarheidFout, cu.fout, meetingsFout ? `Meetings niet gelezen (${meetingsFout}).` : null].filter(Boolean) as string[]
  const betrouwbaar = fouten.length === 0 && !!cal
  const sync = await syncGezondheid()
  const syncWaarschuwing = sync.actief && sync.verouderd
    ? (sync.laatsteOkOp
        ? `De ClickUp-agendasync liep ${sync.minutenSindsOk} minuten geleden voor het laatst (hoort elke minuut). Calendar leest ClickUp wel rechtstreeks, maar de Google-agenda op je gsm loopt mogelijk achter.`
        : 'De ClickUp-agendasync heeft nog nooit gelopen.')
    : null

  const afspraken: AfspraakBron[] = (cal?.appointments ?? [])
    .filter((a) => !a.calendar_id || persoon.includes(a.calendar_id))
    .map((a) => ({
      id: a.id, starts_at: a.starts_at, ends_at: a.ends_at, status: a.status,
      titel: (a as { titel?: string | null }).titel ?? null, company: a.company, contact: a.contact,
      meet_url: (a as { meet_url?: string | null }).meet_url ?? null,
      clickup_task_id: a.clickup_task_id ?? null, external_event_id: a.external_event_id ?? null,
      gsm_melding_status: (a as { gsm_melding_status?: string | null }).gsm_melding_status ?? null,
      details: opts.verkoopDetails !== false,
    }))
  const items = voegSamen({
    meetings: meetings.filter((m) => Date.parse(m.ends_at) > opts.van && Date.parse(m.starts_at) < opts.tot),
    afspraken: afspraken.filter((a) => Date.parse(a.ends_at) > opts.van && Date.parse(a.starts_at) < opts.tot),
    clickup: cu.taken.filter((t) => t.dueMs > opts.van && (t.startMs ?? t.dueMs) < opts.tot),
    google: gg.events.map((e) => ({ id: e.id, titel: e.titel, start: e.start, eind: e.eind, meetUrl: e.meetUrl, link: e.link, clickupTaskId: e.clickupTaskId, heleDag: e.heleDag, vrij: e.vrij, geannuleerd: e.geannuleerd })),
    clickupMetMelding: clickupMetMelding ?? undefined,
  })

  return {
    agendas, agendaId: agenda.id, items,
    segmenten: betrouwbaar && opts.vrij !== false ? segmenten : [],
    beschikbaarheid: { ok: betrouwbaar, fout: betrouwbaar ? null : `Vrije momenten kunnen nu niet betrouwbaar berekend worden. ${fouten.join(' ')}`.trim() },
    bronnen: {
      google: { ok: !gg.fout && !cal?.beschikbaarheidFout, fout: gg.fout ?? cal?.beschikbaarheidFout ?? null },
      clickup: { ok: !cu.fout, fout: cu.fout },
    },
    syncWaarschuwing, regels,
  }
}

/**
 * Is [start, eind) op deze agenda nu (vers berekend) nog vrij? Voor het opslaan
 * vanuit Calendar (slepen) en bij verplaatsen. Strikt: kan het niet gecontroleerd
 * worden, dan is het antwoord nee, met de reden.
 */
export async function controleerVrij(admin: Admin, opts: { agendaId: string; start: number; eind: number; negeer?: Negeer }): Promise<{ vrij: true } | { vrij: false; reden: string; status: number }> {
  const d = await kalenderData(admin, { agendaId: opts.agendaId, van: opts.start - 86400000, tot: opts.eind + 86400000, negeer: opts.negeer })
  if (d.agendaId !== opts.agendaId) return { vrij: false, reden: 'Deze agenda bestaat niet (meer).', status: 400 }
  if (!d.beschikbaarheid.ok) return { vrij: false, reden: d.beschikbaarheid.fout ?? 'Beschikbaarheid niet te controleren.', status: 503 }
  if (!isBookable(d.segmenten, opts.start, opts.eind)) {
    return { vrij: false, reden: 'Dit moment is intussen niet meer vrij. Kies een ander tijdstip.', status: 409 }
  }
  return { vrij: true }
}
