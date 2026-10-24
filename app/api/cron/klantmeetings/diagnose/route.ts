import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { DATABANK_TIJDELIJK } from '@/lib/supabase/herkansing'
import { controleerKoppelingen, testAfspraak, leesMeeting, veiligeFout, stapGoogle, stapClickup, planHerinnering, annuleer, bewaarMeeting, laatsteHerinnering, type MeetingRij } from '@/lib/meetings/server'
import { kalenderData, controleerVrij, controleerConflicten } from '@/lib/meetings/kalender-server'
import { isClickupMeeting } from '@/lib/meetings/kalender'
import { cronToegang } from '@/lib/meetings/cron-toegang'
import { haalMeetingEvent, bezetPerAgenda, meldingInfo, listCalendars, controleerAgenda, leesEventPersonen } from '@/lib/sales/google-calendar'
import { EMAIL_FROM } from '@/lib/email'
import { getOrCreateSalesOrg, listOwners, loadCalendar } from '@/lib/sales/service'
import { haalSyncTaken, clickupTijdvelden, clickupZoekVarianten, type SyncOphaalInfo } from '@/lib/clickup'
import { mergeIntervals, type Interval } from '@/lib/sales/availability'
import { dag, uur, zoneNaarIso } from '@/lib/meetings/model'
import {
  berekenVrijeSlots, boekKlantmeeting, meetingVoorToken, verplaatsViaLink, annuleerViaLink, BoekingFout,
  klantappMeetings, klantappMeeting, klantappWeergave, verplaatsKlantboeking,
} from '@/lib/meetings/klantboeking-server'
import { KB_MIN_VOORAF_TEKST, perDag } from '@/lib/meetings/klantboeking'
import { can, metStandaard, fullPermissions, MODULE_IMPLEMENTED } from '@/lib/portal-permissions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Controle van de koppelingen achter de Meeting Inplanner, met hetzelfde
 * geheim als de scheduler.
 *  · standaard: leest enkel (Google-agenda, ClickUp-lijst, Resend)
 *  · ?schrijftest=1: afspraak ZONDER genodigden met Meet-link, meteen stil weg
 *  · ?zelftest=klantboeking: één volledige testboeking zoals een klant ze doet
 *    (op het verste vrije moment, naar info@nextgenmedia.be), daarna verplaatst
 *    en geannuleerd via de beheerlink. Echte Google-, ClickUp- en mailstappen.
 *  · ?kalenderdata=1[&agenda=]: leest enkel. Wat Calendar voor de komende
 *    twee weken toont (items per bron, dubbels, vrije momenten per dag).
 *  · ?zelftest=calendar: één meeting zoals Calendar ze plant (vrij moment,
 *    controle vooraf), verplaatst en geannuleerd, met echte Google-, ClickUp-
 *    en herinneringsstappen. Genodigde: info@nextgenmedia.be.
 *  · ?zelftest=klantapp&klant=<uuid>&ander=<uuid>: één boeking zoals een klant
 *    ze in de klantapp doet (klant = een eigen testklant, genodigden enkel
 *    info@), met de klantregels, afscherming per klant, verplaatsen en annuleren.
 *  · ?zelftest=intern: een interne meeting morgenavond (buiten 11–17, binnen
 *    72 uur) met conflictwaarschuwing, echte Google/ClickUp, meteen geannuleerd.
 *  · ?vrijcontrole=1: leest enkel. Legt de klantslots naast de echte ClickUp-
 *    meetings, de Google-bezetting en taken zonder vast uur (enkel tellingen).
 *  · ?organisator=1: leest enkel. Welk account genodigden als organisator en
 *    maker van een app-afspraak zien, of de agenda van info@nextgenmedia.be
 *    bereikbaar is, en vanaf welk adres en domein de mails vertrekken.
 *  · ?kalender=1: leest enkel. Per agenda de werkuren, bezette blokken (per
 *    Google-agenda, zonder titels) en vrije segmenten voor twee weken, plus
 *    hoe de ClickUp-taken binnenkomen (pagina's, tijdvelden).
 * Er komt nooit een token of sleutel in het antwoord.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TEST_ADRES = 'info@nextgenmedia.be'

export async function POST(req: NextRequest) {
  const toegang = await cronToegang(req)
  if (toegang === 'onbereikbaar') return NextResponse.json({ error: DATABANK_TIJDELIJK }, { status: 503 })
  if (toegang === 'nee') return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  const admin = createAdminSupabaseClient()
  try {
    if (req.nextUrl.searchParams.get('zelftest') === 'klantboeking') return NextResponse.json(await zelftestKlantboeking(admin))
    if (req.nextUrl.searchParams.get('clickupvarianten') === '1') {
      const nu = Date.now()
      const zoek = (req.nextUrl.searchParams.get('taken') ?? '').split(',').filter((x) => /^[A-Za-z0-9_-]{5,40}$/.test(x)).slice(0, 10)
      return NextResponse.json({ varianten: await clickupZoekVarianten([200511713, 106693123], nu - 86400000, nu + 60 * 86400000, zoek) })
    }
    if (req.nextUrl.searchParams.get('meldingen') === '1') {
      const ag = req.nextUrl.searchParams.get('agenda')
      const { data } = await admin.from('sales_pipelines').select('default_calendar_id').eq('key', 'nextgenmedia').maybeSingle()
      const id = ag && UUID.test(ag) ? ag : (data?.default_calendar_id as string | null)
      return NextResponse.json(id ? await meldingInfo(id) : { fout: 'geen agenda' })
    }
    if (req.nextUrl.searchParams.get('zelftest') === 'calendar') return NextResponse.json(await zelftestCalendar(admin))
    if (req.nextUrl.searchParams.get('zelftest') === 'intern') return NextResponse.json(await zelftestIntern(admin))
    if (req.nextUrl.searchParams.get('vrijcontrole') === '1') return NextResponse.json(await vrijControle(admin))
    if (req.nextUrl.searchParams.get('organisator') === '1') return NextResponse.json(await organisatorControle(admin))
    if (req.nextUrl.searchParams.get('zelftest') === 'klantapp') {
      const klant = req.nextUrl.searchParams.get('klant') ?? '', ander = req.nextUrl.searchParams.get('ander') ?? ''
      if (!UUID.test(klant) || !UUID.test(ander) || klant === ander) return NextResponse.json({ error: 'klant en ander (twee verschillende testklanten) zijn verplicht' }, { status: 400 })
      return NextResponse.json(await zelftestKlantapp(admin, klant, ander))
    }
    if (req.nextUrl.searchParams.get('kalenderdata') === '1') return NextResponse.json(await kalenderOverzicht(admin, req.nextUrl.searchParams.get('agenda')))
    if (req.nextUrl.searchParams.get('kalender') === '1') return NextResponse.json(await kalenderDiagnose(req.nextUrl.searchParams.get('taken')))
    let agenda = req.nextUrl.searchParams.get('agenda')
    if (!agenda || !UUID.test(agenda)) {
      const { data } = await admin.from('sales_pipelines').select('default_calendar_id').eq('key', 'nextgenmedia').maybeSingle()
      agenda = (data?.default_calendar_id as string | null) ?? null
    }
    const checks = await controleerKoppelingen(admin, agenda)
    const schrijftest = req.nextUrl.searchParams.get('schrijftest') === '1' && agenda ? await testAfspraak(agenda) : null
    return NextResponse.json({ agenda, checks, schrijftest })
  } catch (e) {
    console.error('[cron:klantmeetings:diagnose]', e)
    return NextResponse.json({ error: 'Controle mislukt', detail: veiligeFout(e) }, { status: 500 })
  }
}

export const GET = POST

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function zelftestKlantboeking(admin: { from: (t: string) => any }) {
  const stappen: { stap: string; ok: boolean; detail?: string }[] = []
  const log = (stap: string, ok: boolean, detail?: string) => { stappen.push({ stap, ok, ...(detail ? { detail } : {}) }) }
  let id: string | null = null
  try {
    const b = await berekenVrijeSlots(admin, { vers: true })
    log('Beschikbaarheid (werkuren + Google + ClickUp + app)', b.slots.length > 1, `${b.slots.length} vrije momenten`)
    if (b.slots.length < 2) return { stappen }
    const [tweede, laatste] = [b.slots[b.slots.length - 2], b.slots[b.slots.length - 1]]

    const r = await boekKlantmeeting(admin, {
      aanvraag_sleutel: randomUUID(), naam: 'Test Meeting Inplanner', email: TEST_ADRES, bedrijf: 'NextGenMedia (test)',
      reden: 'Automatische controle van de Meeting Inplanner. Wordt meteen geannuleerd.', start: laatste,
    })
    id = r.id
    log('Boeken', true, `Gepland op ${r.startsAt}`)
    let m = (await leesMeeting(admin, r.id))!
    log('Google-afspraak', m.google_status === 'ok', m.google_fout ?? undefined)
    log('Echte Meet-link', !!m.meet_url && /^https:\/\/meet\.google\.com\//.test(m.meet_url), m.meet_url ? 'meet.google.com/…' : 'ontbreekt')
    if (m.agenda_id && m.google_calendar_id && m.google_event_id) {
      const ev = await haalMeetingEvent(m.agenda_id, m.google_calendar_id, m.google_event_id)
      log('Uitnodiging (genodigde staat op de afspraak in Google)', !!ev?.genodigden.some((g) => g.email === TEST_ADRES))
    }
    log('ClickUp-taak (bestaande werkwijze)', m.clickup_status === 'ok', m.clickup_fout ?? undefined)
    const { data: h } = await admin.from('klant_meeting_herinneringen').select('status, moment').eq('meeting_id', m.id).eq('status', 'gepland')
    log('Herinnering 24 uur vooraf gepland', ((h ?? []) as { moment: string }[]).some((x) => x.moment === '24u'))
    log('Bevestigingsmail', m.bevestiging_status === 'verzonden', m.bevestiging_fout ?? undefined)

    const token = r.beheerUrl?.split('#t=')[1] ?? ''
    const viaLink = await meetingVoorToken(admin, token)
    log('Beheerlink vindt enkel deze boeking', viaLink?.id === m.id)
    m = await verplaatsViaLink(admin, viaLink!, token, tweede)
    const ev2 = m.agenda_id && m.google_calendar_id && m.google_event_id ? await haalMeetingEvent(m.agenda_id, m.google_calendar_id, m.google_event_id) : null
    log('Verplaatsen: zelfde Google-afspraak bijgewerkt, Meet-link blijft', new Date(m.starts_at).toISOString() === new Date(tweede).toISOString() && !!ev2 && ev2.meetUrl === m.meet_url)
    m = await annuleerViaLink(admin, m)
    const { data: h2 } = await admin.from('klant_meeting_herinneringen').select('status').eq('meeting_id', m.id).eq('status', 'gepland')
    log('Annuleren: Google, ClickUp en herinnering', m.status === 'geannuleerd' && m.google_status === 'geannuleerd' && m.clickup_status === 'ok' && (h2 ?? []).length === 0,
      `google=${m.google_status}, clickup=${m.clickup_status}`)
    return { stappen, meetingId: m.id }
  } catch (e) {
    log('Onverwachte fout', false, e instanceof BoekingFout ? `${e.publiek}${e.intern ? ` (${e.intern})` : ''}` : veiligeFout(e))
    // Niets laten slingeren: een half geboekte test wordt alsnog geannuleerd.
    if (id) {
      try {
        const m = await leesMeeting(admin, id)
        if (m && m.status === 'ingepland') { await annuleerViaLink(admin, m); log('Opruimen na fout', true) }
      } catch (x) { log('Opruimen na fout', false, veiligeFout(x)) }
    }
    return { stappen, meetingId: id }
  }
}


/** Per dag (Brussel) de stukken als "HH:MM–HH:MM", enkel tussen 7 en 21 uur. */
function perDagTekst(lijst: Interval[], van: number, tot: number): Record<string, string[]> {
  const uit: Record<string, string[]> = {}
  for (const i of mergeIntervals(lijst)) {
    const s = Math.max(i.start, van), e = Math.min(i.end, tot)
    if (e <= s) continue
    // Opknippen per dag.
    let c = s
    while (c < e) {
      const d = dag(new Date(c).toISOString())
      const volgende = new Date(zoneNaarIso(new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10), '00:00')).getTime()
      const eind = Math.min(e, volgende)
      ;(uit[d] ??= []).push(`${uur(new Date(c).toISOString())}–${eind === volgende ? '24:00' : uur(new Date(eind).toISOString())}`)
      c = eind
    }
  }
  return uit
}

async function kalenderDiagnose(takenParam: string | null) {
  const nu = Date.now()
  const vandaag = dag(new Date(nu).toISOString())
  const wd = (new Date(`${vandaag}T12:00:00Z`).getUTCDay() + 6) % 7
  const maandag = new Date(Date.parse(`${vandaag}T12:00:00Z`) - wd * 86400000).toISOString().slice(0, 10)
  const van = new Date(zoneNaarIso(maandag, '00:00')).getTime()
  const tot = van + 14 * 86400000

  const org = await getOrCreateSalesOrg()
  const owners = await listOwners(org.id)
  const agendas = []
  for (const o of owners) {
    const cal = await loadCalendar(org.id, van, tot, o.id).catch((e) => ({ fout: veiligeFout(e) }) as const)
    const bezet = await bezetPerAgenda(o.id, van, tot).catch((e) => ({ schrijfAgenda: null, agendas: {}, fout: veiligeFout(e) }))
    agendas.push({
      id: o.id, naam: o.name, status: o.status,
      clickup: (o as { clickup_assignee_id?: number | null }).clickup_assignee_id ?? null,
      schrijfAgenda: bezet.schrijfAgenda ? bezet.schrijfAgenda.slice(0, 12) : null,
      bezetFout: bezet.fout ?? null,
      bezetPerAgenda: Object.fromEntries(Object.entries(bezet.agendas).map(([id, a]) => [id.slice(0, 12), { fout: a.fout ?? null, perDag: perDagTekst(a.busy, van, tot) }])),
      vrij: !cal ? { fout: 'geen agenda' } : 'fout' in cal ? { fout: cal.fout } : { connected: cal.connected, perDag: perDagTekst(cal.segments, van, tot), afspraken: cal.appointments.length },
    })
  }

  const info: SyncOphaalInfo = { paginas: 0, perPagina: [], laatstePaginaGemeld: false }
  let sync: Record<string, unknown>
  try {
    const taken = await haalSyncTaken([200511713, 106693123], nu - 86400000, nu + 60 * 86400000, info)
    const metStartEnUur = taken.filter((t) => t.startMs !== null)
    sync = {
      info, totaal: taken.length,
      bram: taken.filter((t) => t.assigneeIds.includes(200511713)).length,
      marco: taken.filter((t) => t.assigneeIds.includes(106693123)).length,
      metStart: metStartEnUur.length,
      vlaggenAanwezig: taken.some((t) => t.startHeeftUur !== null || t.dueHeeftUur !== null),
    }
  } catch (e) {
    sync = { info, fout: veiligeFout(e) }
  }
  const ids = (takenParam ?? '').split(',').map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{5,40}$/.test(x))
  const tijdvelden = ids.length ? await clickupTijdvelden(ids) : null
  return { van: new Date(van).toISOString(), tot: new Date(tot).toISOString(), regelsOrg: org.timezone, agendas, sync, tijdvelden }
}


const MIN_MS = 60000

/** Wat Calendar toont voor de komende twee weken, voor de controle met echte data. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function kalenderOverzicht(admin: { from: (t: string) => any }, agendaParam: string | null) {
  const nu = Date.now()
  const van = new Date(zoneNaarIso(dag(new Date(nu).toISOString()), '00:00')).getTime()
  const tot = van + 14 * 86400000
  const d = await kalenderData(admin, { agendaId: agendaParam && UUID.test(agendaParam) ? agendaParam : null, van, tot })
  const sleutels = d.items.map((i) => i.key)
  const events = d.items.map((i) => i.googleEventId).filter(Boolean)
  const taken = d.items.map((i) => i.clickupTaskId).filter(Boolean)
  return {
    agenda: d.agendaId, beschikbaarheid: d.beschikbaarheid, bronnen: d.bronnen, syncWaarschuwing: d.syncWaarschuwing,
    perBron: d.items.reduce<Record<string, number>>((a, i) => { a[i.bron] = (a[i.bron] ?? 0) + 1; return a }, {}),
    dubbels: {
      sleutels: sleutels.length - new Set(sleutels).size,
      googleEvents: events.length - new Set(events).size,
      clickupTaken: taken.length - new Set(taken).size,
    },
    items: d.items.map((i) => ({ bron: i.bron, titel: i.titel, start: i.start, eind: i.eind, gsm: i.gsm, meet: !!i.meetUrl })),
    vrijPerDag: perDagTekst(d.segmenten, van, tot),
  }
}

/** Calendar van begin tot eind met echte koppelingen; ruimt zichzelf op. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function zelftestCalendar(admin: { from: (t: string) => any }) {
  const stappen: { stap: string; ok: boolean; detail?: string }[] = []
  const log = (stap: string, ok: boolean, detail?: string) => { stappen.push({ stap, ok, ...(detail ? { detail } : {}) }) }
  let m: MeetingRij | null = null
  try {
    const nu = Date.now()
    const van = nu + 48 * 3600_000, tot = van + 12 * 86400000
    const d = await kalenderData(admin, { van, tot })
    log('Beschikbaarheid betrouwbaar (Google + ClickUp + app)', d.beschikbaarheid.ok, d.beschikbaarheid.fout ?? `${d.segmenten.length} vrije stukken`)
    if (!d.beschikbaarheid.ok || !d.agendaId) return { stappen }
    const agendaId = d.agendaId
    // Twee vrije halve uren: het laatste vrije stuk van minstens een uur (zo ver mogelijk weg).
    const ruim = d.segmenten.filter((s) => s.end - s.start >= 60 * MIN_MS && s.start > van)
    const seg = ruim[ruim.length - 1]
    if (!seg) { log('Vrij moment gevonden', false, 'geen vrij stuk van een uur'); return { stappen } }
    const a = { start: seg.end - 60 * MIN_MS, eind: seg.end - 30 * MIN_MS }
    const b = { start: seg.end - 30 * MIN_MS, eind: seg.end }
    log('Vrij moment gevonden', true, new Date(a.start).toISOString())
    const v1 = await controleerVrij(admin, { agendaId, start: a.start, eind: a.eind })
    log('Controle vóór opslaan: vrij', v1.vrij)

    // Zoals POST /api/admin/meetings met controleer_vrij.
    const { data: rij, error } = await admin.from('klant_meetings').insert({
      aanvraag_sleutel: randomUUID(), client_id: null, klant_naam: 'Test Calendar', titel: 'Test Calendar (automatische controle)',
      beschrijving: 'Automatische controle van Calendar. Wordt meteen verplaatst en geannuleerd.',
      starts_at: new Date(a.start).toISOString(), ends_at: new Date(a.eind).toISOString(), tijdzone: 'Europe/Brussels',
      agenda_id: agendaId, organisator_naam: 'Bram', klant_ontvangers: [{ naam: 'Test Calendar', email: TEST_ADRES }], deelnemers: [], herinnering_aan: true,
      created_by_email: 'zelftest',
    }).select('*').single()
    if (error) throw new Error(error.message)
    m = rij as MeetingRij
    m = await stapGoogle(admin, m)
    log('Google-afspraak', m.google_status === 'ok', m.google_fout ?? undefined)
    log('Echte Meet-link', /^https:\/\/meet\.google\.com\//.test(m.meet_url ?? ''), m.meet_url ? 'meet.google.com/…' : undefined)
    const ev1 = m.google_event_id && m.google_calendar_id ? await haalMeetingEvent(agendaId, m.google_calendar_id, m.google_event_id) : null
    log('Uitnodiging: genodigde staat op de afspraak', !!ev1?.genodigden.some((g) => g.email === TEST_ADRES))
    log('Gsm-melding 15 min op de afspraak (gelezen uit Google)', ev1?.gsmMelding === 15 && m.gsm_melding_status === 'ingesteld', `google=${ev1?.gsmMelding ?? 'geen'}, status=${m.gsm_melding_status ?? 'leeg'}`)
    m = await stapClickup(admin, m)
    log('ClickUp-taak (bestaande werkwijze)', m.clickup_status === 'ok' && !!m.clickup_task_id, m.clickup_fout ?? undefined)
    const h1 = await planHerinnering(admin, m)
    log('Herinneringsmail 24 uur vooraf gepland', !!h1 && Math.abs(Date.parse(h1.gepland_voor) - (a.start - 86400000)) < 60_000)

    const d2 = await kalenderData(admin, { agendaId, van, tot })
    const keer = d2.items.filter((i) => i.key === `meeting:${m!.id}` || i.googleEventId === m!.google_event_id || i.clickupTaskId === m!.clickup_task_id).length
    log('In Calendar, precies één keer (niet dubbel via ClickUp of Google)', keer === 1, `${keer}x`)
    const v2 = await controleerVrij(admin, { agendaId, start: a.start, eind: a.eind })
    log('Zelfde moment nog eens boeken: geweigerd', !v2.vrij, !v2.vrij ? v2.reden : 'stond nog vrij')

    // Verplaatsen zoals slepen in de week: PATCH wijzig met controleer_vrij.
    const v3 = await controleerVrij(admin, { agendaId, start: b.start, eind: b.eind, negeer: { meetingId: m.id } })
    log('Verplaatsen: nieuw moment vrij (de meeting zelf telt niet)', v3.vrij, !v3.vrij ? v3.reden : undefined)
    const oudEvent = m.google_event_id, oudeTaak = m.clickup_task_id
    m = await bewaarMeeting(admin, m.id, { starts_at: new Date(b.start).toISOString(), ends_at: new Date(b.eind).toISOString() })
    m = await stapGoogle(admin, m, { bijwerken: true })
    m = m.google_status === 'ok' ? await stapClickup(admin, m) : m
    await planHerinnering(admin, m)
    const ev2 = m.google_event_id && m.google_calendar_id ? await haalMeetingEvent(agendaId, m.google_calendar_id, m.google_event_id) : null
    log('Verplaatst: zelfde Google-afspraak en ClickUp-taak', m.google_event_id === oudEvent && m.clickup_task_id === oudeTaak && m.google_status === 'ok' && m.clickup_status === 'ok')
    log('Meet-link en gsm-melding blijven', !!ev2?.meetUrl && ev2.gsmMelding === 15)
    const h2 = await laatsteHerinnering(admin, m.id)
    log('Herinnering mee verplaatst', !!h2 && Math.abs(Date.parse(h2.gepland_voor) - (b.start - 86400000)) < 60_000 && h2.status === 'gepland')
    const v4 = await controleerVrij(admin, { agendaId, start: b.start, eind: b.eind })
    log('Dubbel boeken op het nieuwe moment: geweigerd', !v4.vrij)

    m = await annuleer(admin, m, 'zelftest', true)
    const h3 = await laatsteHerinnering(admin, m.id)
    log('Annuleren: Google, ClickUp en herinnering', m.status === 'geannuleerd' && m.google_status === 'geannuleerd' && m.clickup_status === 'ok' && (!h3 || h3.status === 'geannuleerd'), `google=${m.google_status}, clickup=${m.clickup_status}`)
    const d3 = await kalenderData(admin, { agendaId, van, tot })
    log('Na annuleren weg uit Calendar en weer vrij', !d3.items.some((i) => i.key === `meeting:${m!.id}`) && (await controleerVrij(admin, { agendaId, start: b.start, eind: b.eind })).vrij)
    return { stappen, meetingId: m.id }
  } catch (e) {
    log('Onverwachte fout', false, veiligeFout(e))
    if (m && m.status === 'ingepland') { try { await annuleer(admin, m, 'zelftest (opruimen)', true) } catch { /* zichtbaar in de app */ } }
    return { stappen, meetingId: m?.id ?? null }
  }
}


/** Klantapp — Meeting boeken van begin tot eind, met echte koppelingen; ruimt zichzelf op. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function zelftestKlantapp(admin: { from: (t: string) => any }, klant: string, ander: string) {
  const stappen: { stap: string; ok: boolean; detail?: string }[] = []
  const log = (stap: string, ok: boolean, detail?: string) => { stappen.push({ stap, ok, ...(detail ? { detail } : {}) }) }
  const COLLEGA = 'info+collega@nextgenmedia.be'
  let id: string | null = null
  const aantal = async () => ((await admin.from('klant_meetings').select('id', { count: 'exact', head: true })) as { count: number | null }).count ?? 0
  try {
    // 1. Module zichtbaar: eigenaars hebben alle rechten, subaccounts krijgen 'meetings' standaard.
    const { data: cus } = await admin.from('client_users').select('permissions')
    const subs = (cus ?? []) as { permissions: unknown }[]
    const zien = subs.filter((c) => can(metStandaard(c.permissions as never), 'meetings', 'view')).length
    log('Module "Meeting boeken" staat aan (eigenaars + subaccounts)', MODULE_IMPLEMENTED.meetings && can(fullPermissions(), 'meetings', 'book'), `${zien}/${subs.length} subaccounts zien de module`)

    // 2–6. Beschikbaarheid zoals de klant ze krijgt.
    const b = await berekenVrijeSlots(admin, { vers: true })
    const u = (s: string) => uur(s)
    log('Beschikbaarheid strikt opgehaald (Google + ClickUp + app)', b.slots.length > 2, `${b.slots.length} vrije momenten`)
    if (b.slots.length < 3) return { stappen }
    log('Geen tijdstip vóór 11:00 of na 16:30 (Belgische tijd)', b.slots.every((s) => u(s) >= '11:00' && u(s) <= '16:30'))
    log('Geen tijdstip binnen 72 uur', b.slots.every((s) => Date.parse(s) >= Date.now() + 72 * 3600_000 - 60_000))
    // Exact wat /api/portal/meetings/beschikbaarheid teruggeeft.
    const naarKlant = perDag(b.slots)
    log('Klant krijgt enkel begintijden, geen agenda-inhoud', naarKlant.every((d) => Object.keys(d).sort().join() === 'dag,label,slots' && d.slots.every((x) => Object.keys(x).sort().join() === 'start,uur')))

    const voor = await aantal()
    const morgen = zoneNaarIso(dag(new Date(Date.now() + 86400000).toISOString()), '14:00')
    const binnen72 = await boekKlantmeeting(admin, { aanvraag_sleutel: randomUUID(), naam: 'Test Klantapp', email: TEST_ADRES, start: morgen }, new Date(), { clientId: klant, bedrijf: 'Test', doorEmail: TEST_ADRES })
      .then(() => 'geboekt', (e) => e instanceof BoekingFout ? e.publiek : veiligeFout(e))
    log('Boeking binnen 72 uur geweigerd, niets aangemaakt', binnen72 === KB_MIN_VOORAF_TEKST && (await aantal()) === voor, binnen72)
    const laat = zoneNaarIso(dag(b.slots[b.slots.length - 1]), '16:45')
    const na17 = await boekKlantmeeting(admin, { aanvraag_sleutel: randomUUID(), naam: 'Test Klantapp', email: TEST_ADRES, start: laat }, new Date(), { clientId: klant, bedrijf: 'Test', doorEmail: TEST_ADRES })
      .then(() => 'geboekt', (e) => e instanceof BoekingFout ? e.publiek : veiligeFout(e))
    log('Start 16:45 (eindigt na 17:00) geweigerd, niets aangemaakt', /tussen 11:00 en 17:00/.test(na17) && (await aantal()) === voor, na17)

    // Boeken zoals de klantapp: laatste vrije moment, collega erbij, onderwerp.
    const [tweede, laatste] = [b.slots[b.slots.length - 2], b.slots[b.slots.length - 1]]
    const sleutel = randomUUID()
    const invoer = { aanvraag_sleutel: sleutel, naam: 'Test Klantapp', email: TEST_ADRES, reden: 'Automatische controle van Meeting boeken in de klantapp. Wordt meteen geannuleerd.', start: laatste }
    const r = await boekKlantmeeting(admin, invoer, new Date(), { clientId: klant, bedrijf: 'NextGenMedia (test klantapp)', doorEmail: TEST_ADRES, extraDeelnemers: [{ naam: 'Collega', email: COLLEGA }] })
    id = r.id
    let m = (await leesMeeting(admin, r.id))!
    log('Boeken: aan de juiste klant, zonder publieke beheerlink', m.client_id === klant && !m.beheer_token_hash && r.beheerUrl === null, `start ${r.startsAt}`)
    log('Google-afspraak', m.google_status === 'ok', m.google_fout ?? undefined)
    log('Echte Meet-link', /^https:\/\/meet\.google\.com\//.test(m.meet_url ?? ''), m.meet_url ? 'meet.google.com/…' : 'ontbreekt')
    const ev = m.agenda_id && m.google_calendar_id && m.google_event_id ? await haalMeetingEvent(m.agenda_id, m.google_calendar_id, m.google_event_id) : null
    log('Uitnodiging aan klant én collega (staan op de Google-afspraak)', !!ev && [TEST_ADRES, COLLEGA].every((a) => ev.genodigden.some((g) => g.email === a)))
    log('Gsm-melding 15 min voor de organisator (gelezen uit Google)', ev?.gsmMelding === 15, `google=${ev?.gsmMelding ?? 'geen'}, status=${m.gsm_melding_status ?? 'leeg'}`)
    log('ClickUp-taak (bestaande werkwijze)', m.clickup_status === 'ok' && !!m.clickup_task_id, m.clickup_fout ?? undefined)
    const h = await laatsteHerinnering(admin, m.id)
    log('Herinnering 24 uur vooraf gepland', !!h && h.status === 'gepland' && Math.abs(Date.parse(h.gepland_voor) - (Date.parse(m.starts_at) - 86400000)) < 60_000)
    log('Bevestigingsmail verstuurd', m.bevestiging_status === 'verzonden', m.bevestiging_fout ?? undefined)
    const { data: mails } = await admin.from('email_messages').select('subject, body, to_client_id').eq('related_id', m.id).eq('kind', 'klantboeking_bevestiging')
    const mail = ((mails ?? []) as { subject: string; body: string; to_client_id: string | null }[])[0]
    log('Bevestiging: onderwerp, datum/uur, duur, Meet, organisator, link naar de klantapp, gelogd bij de klant',
      !!mail && mail.to_client_id === klant && /Onderwerp: Automatische controle/.test(mail.body) && /30 minuten/.test(mail.body) && /Belgische tijd/.test(mail.body)
        && /meet\.google\.com/.test(mail.body) && /Je spreekt met /.test(mail.body) && /\/portal\/meetings/.test(mail.body) && !/#t=/.test(mail.body),
      mail?.subject)

    const nog = await boekKlantmeeting(admin, invoer, new Date(), { clientId: klant, bedrijf: 'NextGenMedia (test klantapp)', doorEmail: TEST_ADRES })
    const { count: mailsNa } = await admin.from('email_messages').select('id', { count: 'exact', head: true }).eq('related_id', m.id)
    log('Dubbele klik: zelfde aanvraag maakt niets opnieuw', nog.herhaald === true && nog.id === m.id && mailsNa === 1)
    const dubbel = await boekKlantmeeting(admin, { aanvraag_sleutel: randomUUID(), naam: 'Andere klant', email: TEST_ADRES, start: laatste }, new Date(), { clientId: ander, bedrijf: 'Andere testklant', doorEmail: TEST_ADRES })
      .then(() => 'geboekt', (e) => e instanceof BoekingFout ? String(e.status) : veiligeFout(e))
    log('Zelfde moment door een andere klant: geweigerd', dubbel === '409', dubbel)

    const eigen = await klantappMeetings(admin, klant)
    const vreemd = await klantappMeetings(admin, ander)
    log('Mijn meetings: zichtbaar bij de eigen klant, niet bij een andere', eigen.some((x) => x.id === m.id) && !vreemd.some((x) => x.id === m.id) && (await klantappMeeting(admin, ander, m.id)) === null)
    const w = JSON.stringify(klantappWeergave(m))
    log('Klantweergave zonder interne velden', !/google_event_id|clickup|agenda_id|beheer_token/.test(w) && w.includes('meet.google.com'))
    const d = await kalenderData(admin, { agendaId: m.agenda_id, van: Date.parse(m.starts_at) - 3600_000, tot: Date.parse(m.ends_at) + 3600_000 })
    const keer = d.items.filter((i) => i.key === `klantboeking:${m.id}` || i.key === `meeting:${m.id}` || i.googleEventId === m.google_event_id || i.clickupTaskId === m.clickup_task_id).length
    log('In de interne Calendar, precies één keer, met Meet-link', keer === 1 && d.items.some((i) => (i.key.endsWith(m.id)) && !!i.meetUrl), `${keer}x`)

    // Verplaatsen door de klant: klantregels, zelfde afspraak, één "Verplaatst"-mail.
    const geweigerd = await verplaatsKlantboeking(admin, m, { soort: 'klantapp' }, morgen).then(() => 'verplaatst', (e) => e instanceof BoekingFout ? e.publiek : veiligeFout(e))
    log('Klant verplaatst naar binnen 72 uur: geweigerd', geweigerd === KB_MIN_VOORAF_TEKST, geweigerd)
    const oudEvent = m.google_event_id, oudeTaak = m.clickup_task_id
    m = await verplaatsKlantboeking(admin, m, { soort: 'klantapp' }, tweede)
    const ev2 = m.agenda_id && m.google_calendar_id && m.google_event_id ? await haalMeetingEvent(m.agenda_id, m.google_calendar_id, m.google_event_id) : null
    log('Verplaatst: zelfde Google-afspraak en ClickUp-taak, Meet-link blijft', new Date(m.starts_at).toISOString() === new Date(tweede).toISOString() && m.google_event_id === oudEvent && m.clickup_task_id === oudeTaak && m.clickup_status === 'ok' && ev2?.meetUrl === m.meet_url)
    const h2 = await laatsteHerinnering(admin, m.id)
    log('Herinnering mee verplaatst', !!h2 && h2.status === 'gepland' && Math.abs(Date.parse(h2.gepland_voor) - (Date.parse(tweede) - 86400000)) < 60_000)
    const { data: m2 } = await admin.from('email_messages').select('subject').eq('related_id', m.id).eq('kind', 'klantboeking_bevestiging')
    log('Eén bevestiging van de wijziging', ((m2 ?? []) as { subject: string }[]).filter((x) => /^Verplaatst:/.test(x.subject)).length === 1)

    m = await annuleerViaLink(admin, m, new Date(), 'klantapp (zelftest)')
    const h3 = await laatsteHerinnering(admin, m.id)
    log('Annuleren door de klant: Google, ClickUp en herinnering', m.status === 'geannuleerd' && m.google_status === 'geannuleerd' && m.clickup_status === 'ok' && (!h3 || h3.status !== 'gepland'), `google=${m.google_status}, clickup=${m.clickup_status}`)
    return { stappen, meetingId: m.id }
  } catch (e) {
    log('Onverwachte fout', false, e instanceof BoekingFout ? `${e.publiek}${e.intern ? ` (${e.intern})` : ''}` : veiligeFout(e))
    if (id) {
      try {
        const m = await leesMeeting(admin, id)
        if (m && m.status === 'ingepland') { await annuleerViaLink(admin, m, new Date(), 'zelftest (opruimen)'); log('Opruimen na fout', true) }
      } catch (x) { log('Opruimen na fout', false, veiligeFout(x)) }
    }
    return { stappen, meetingId: id }
  }
}

/** Intern plannen op elk tijdstip: morgen 19:00, buiten de klanturen en binnen 72 uur. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function zelftestIntern(admin: { from: (t: string) => any }) {
  const stappen: { stap: string; ok: boolean; detail?: string }[] = []
  const log = (stap: string, ok: boolean, detail?: string) => { stappen.push({ stap, ok, ...(detail ? { detail } : {}) }) }
  let m: MeetingRij | null = null
  try {
    const { data: p } = await admin.from('sales_pipelines').select('default_calendar_id').eq('key', 'nextgenmedia').maybeSingle()
    const agendaId = (p?.default_calendar_id as string | null) ?? null
    if (!agendaId) { log('Standaardagenda', false); return { stappen } }
    const morgen = dag(new Date(Date.now() + 86400000).toISOString())
    const start = Date.parse(zoneNaarIso(morgen, '19:00')), eind = Date.parse(zoneNaarIso(morgen, '19:30'))
    const c1 = await controleerConflicten(admin, { agendaId, start, eind })
    log('Conflictcontrole betrouwbaar (Google + ClickUp + app)', c1.betrouwbaar, c1.fout ?? `${c1.lijst.length} overlap(pen)`)
    const vrij = await controleerVrij(admin, { agendaId, start, eind })
    log('Buiten de werkuren: geen "vrij" moment, maar intern toch planbaar', !vrij.vrij, !vrij.vrij ? vrij.reden : 'stond vrij')

    // Zoals POST /api/admin/meetings: geen 11–17- of 72-uursregel, enkel een waarschuwing bij een overlap.
    const { data: rij, error } = await admin.from('klant_meetings').insert({
      aanvraag_sleutel: randomUUID(), client_id: null, klant_naam: 'Test intern', titel: 'Test intern plannen (automatische controle)',
      beschrijving: 'Automatische controle: interne meeting buiten de klanturen. Wordt meteen geannuleerd.',
      starts_at: new Date(start).toISOString(), ends_at: new Date(eind).toISOString(), tijdzone: 'Europe/Brussels',
      agenda_id: agendaId, organisator_naam: 'Bram', klant_ontvangers: [{ naam: 'Test intern', email: TEST_ADRES }], deelnemers: [], herinnering_aan: true,
      created_by_email: 'zelftest',
    }).select('*').single()
    if (error) throw new Error(error.message)
    m = rij as MeetingRij
    m = await stapGoogle(admin, m)
    log('Ingepland morgen 19:00 met Google-afspraak en Meet-link', m.google_status === 'ok' && /^https:\/\/meet\.google\.com\//.test(m.meet_url ?? ''), m.google_fout ?? `${morgen} 19:00`)
    const ev = m.google_event_id && m.google_calendar_id ? await haalMeetingEvent(agendaId, m.google_calendar_id, m.google_event_id) : null
    log('Gsm-melding 15 min op de afspraak', ev?.gsmMelding === 15, `google=${ev?.gsmMelding ?? 'geen'}`)
    m = await stapClickup(admin, m)
    log('ClickUp-taak', m.clickup_status === 'ok' && !!m.clickup_task_id, m.clickup_fout ?? undefined)
    const h = await planHerinnering(admin, m)
    const herinneringTijd = Date.parse(m.starts_at) - 86400000
    log('Herinnering nooit met terugwerkende kracht', herinneringTijd > Date.now() ? !!h && Date.parse(h.gepland_voor) > Date.now() : !h,
      herinneringTijd > Date.now() ? `gepland voor ${h?.gepland_voor ?? '—'}` : 'minder dan 24 uur vooraf: geen herinnering')
    const c2 = await controleerConflicten(admin, { agendaId, start, eind })
    log('Tweede meeting op hetzelfde uur: waarschuwing met de overlap', c2.lijst.some((x) => /Test intern plannen/.test(x.titel)), c2.lijst.map((x) => x.titel).join(', '))
    const c3 = await controleerConflicten(admin, { agendaId, start, eind, negeer: { meetingId: m.id } })
    log('De meeting zelf telt niet als conflict bij verplaatsen', !c3.lijst.some((x) => /Test intern plannen/.test(x.titel)))
    m = await annuleer(admin, m, 'zelftest', true)
    log('Opgeruimd: Google, ClickUp, herinnering', m.status === 'geannuleerd' && m.google_status === 'geannuleerd' && m.clickup_status === 'ok', `google=${m.google_status}, clickup=${m.clickup_status}`)
    return { stappen, meetingId: m.id }
  } catch (e) {
    log('Onverwachte fout', false, veiligeFout(e))
    if (m && m.status === 'ingepland') { try { await annuleer(admin, m, 'zelftest (opruimen)', true) } catch { /* zichtbaar in de app */ } }
    return { stappen, meetingId: m?.id ?? null }
  }
}


/**
 * Leest enkel. Komen de vrije momenten voor klanten ooit op een echte
 * ClickUp-meeting of Google-bezetting terecht? En blokkeren taken zonder vast
 * uur echt niets? Enkel tellingen en uren, geen titels.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function vrijControle(admin: { from: (t: string) => any }) {
  const b = await berekenVrijeSlots(admin, { vers: true })
  if (!b.slots.length) return { slots: 0 }
  const { data: ag } = await admin.from('sales_calendar_connections').select('clickup_assignee_id').eq('id', b.agendaId).maybeSingle()
  const van = Date.parse(b.slots[0]) - 3600_000, tot = Date.parse(b.slots[b.slots.length - 1]) + 2 * 3600_000
  const [taken, g] = await Promise.all([
    haalSyncTaken([Number(ag?.clickup_assignee_id)], van - 86400_000, tot + 86400_000),
    bezetPerAgenda(b.agendaId, van, tot),
  ])
  const slot = (s: string) => ({ start: Date.parse(s), end: Date.parse(s) + 30 * MIN_MS })
  const raakt = (a: Interval, x: Interval) => a.start < x.end && x.start < a.end
  const meetings = taken.filter(isClickupMeeting).map((t) => ({ start: t.startMs as number, end: t.dueMs })).filter((i) => i.end > van && i.start < tot)
  const google = Object.values(g.agendas).flatMap((a) => a.busy)
  const geenMeeting = taken.filter((t) => !isClickupMeeting(t) && t.dueMs > van && t.dueMs < tot)
  // Een taak zonder vast uur (of met enkel een deadline) mag een slot op dat moment niet wegnemen.
  const opTaakMoment = b.slots.filter((s) => geenMeeting.some((t) => {
    const i = slot(s)
    return (t.dueMs >= i.start && t.dueMs < i.end) || (t.startMs !== null && t.startMs < i.end && t.dueMs > i.start)
  }))
  const opDagVanTaak = b.slots.filter((s) => geenMeeting.some((t) => dag(new Date(t.dueMs).toISOString()) === dag(s)))
  return {
    periode: { van: new Date(van).toISOString(), tot: new Date(tot).toISOString() },
    klantslots: b.slots.length,
    clickup: { taken: taken.length, meetings: meetings.length, zonderVastUurOfEnkelDeadline: geenMeeting.length },
    google: { bezetteBlokken: google.length, fout: g.fout ?? Object.values(g.agendas).find((a) => a.fout)?.fout ?? null },
    slotsOpClickupMeeting: b.slots.filter((s) => meetings.some((m) => raakt(slot(s), m))).length,
    slotsOpGoogleBezet: b.slots.filter((s) => google.some((x) => raakt(slot(s), x))).length,
    slotsOpMomentVanTaakZonderUur: opTaakMoment.length,
    slotsOpDagVanTaakZonderUur: opDagVanTaak.length,
  }
}


const INFO_ADRES = 'info@nextgenmedia.be'

/** Leest enkel: organisator in Google, toegang tot de info@-agenda, afzender en domein bij Resend. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function organisatorControle(admin: { from: (t: string) => any }) {
  const { data: conns } = await admin.from('sales_calendar_connections').select('id, name, account_email, calendar_id, active, status').eq('provider', 'google')
  const lijst = (conns ?? []) as { id: string; name: string; account_email: string | null; calendar_id: string; active: boolean; status: string }[]
  const { data: p } = await admin.from('sales_pipelines').select('default_calendar_id').eq('key', 'nextgenmedia').maybeSingle()
  const standaard = (p?.default_calendar_id as string | null) ?? null
  const accounts = Array.from(new Set(lijst.map((c) => c.account_email).filter(Boolean)))

  // Per Google-account: welke agenda's, en kan het in die van info@ schrijven?
  const perAccount = []
  for (const acc of accounts) {
    const c = lijst.find((x) => x.account_email === acc && x.status === 'connected')
    if (!c) continue
    const agendas = await listCalendars(c.id)
    const info = agendas.find((a) => a.id.toLowerCase() === INFO_ADRES)
    perAccount.push({
      account: acc,
      aantalAgendas: agendas.length,
      hoofdagenda: agendas.find((a) => a.primary)?.id ?? null,
      infoAgenda: info ? { rol: info.accessRole, schrijven: info.accessRole === 'owner' || info.accessRole === 'writer' } : null,
      nextgenmediaAgendas: agendas.filter((a) => /@nextgenmedia\.be$/i.test(a.id)).map((a) => ({ id: a.id, rol: a.accessRole })),
    })
  }

  // De standaardagenda (klantboekingen) en een echte afspraak van de app erop.
  const st = lijst.find((c) => c.id === standaard)
  const agenda = st ? await controleerAgenda(st.id) : null
  const { data: mt } = await admin.from('klant_meetings').select('id, agenda_id, google_calendar_id, google_event_id, created_at')
    .not('google_event_id', 'is', null).order('created_at', { ascending: false }).limit(5)
  let voorbeeld: Record<string, unknown> | null = null
  for (const m of (mt ?? []) as { id: string; agenda_id: string; google_calendar_id: string; google_event_id: string }[]) {
    try {
      const e = await leesEventPersonen(m.agenda_id, m.google_calendar_id, m.google_event_id)
      if (e) { voorbeeld = { meetingId: m.id, ...e }; break }
    } catch { /* volgende proberen */ }
  }

  // Mail: afzender in de app en wat Resend over het domein en een verstuurde mail zegt.
  const resend: Record<string, unknown> = { afzenderInApp: EMAIL_FROM }
  const sleutel = process.env.RESEND_API_KEY
  if (sleutel) {
    const d = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${sleutel}` } }).catch(() => null)
    const dj = d ? await d.json().catch(() => ({})) as { data?: { name?: string; status?: string }[]; message?: string; name?: string } : null
    resend.domeinen = d?.ok ? (dj?.data ?? []).map((x) => ({ naam: x.name, status: x.status })) : { fout: dj?.message ?? dj?.name ?? `status ${d?.status ?? 'geen antwoord'}` }
    const { data: laatste } = await admin.from('email_messages').select('provider_id, kind, created_at').not('provider_id', 'is', null).order('created_at', { ascending: false }).limit(1)
    const pid = ((laatste ?? []) as { provider_id: string; kind: string; created_at: string }[])[0]
    if (pid) {
      const e = await fetch(`https://api.resend.com/emails/${encodeURIComponent(pid.provider_id)}`, { headers: { Authorization: `Bearer ${sleutel}` } }).catch(() => null)
      const ej = e ? await e.json().catch(() => ({})) as { from?: string; last_event?: string; message?: string; name?: string } : null
      resend.laatsteMail = e?.ok ? { soort: pid.kind, op: pid.created_at, van: ej?.from, status: ej?.last_event } : { soort: pid.kind, fout: ej?.message ?? ej?.name ?? `status ${e?.status ?? 'geen antwoord'}` }
    }
  } else resend.fout = 'RESEND_API_KEY ontbreekt'

  return {
    koppelingen: lijst.map((c) => ({ id: c.id, naam: c.name, account: c.account_email, schrijfAgenda: c.calendar_id, actief: c.active, standaard: c.id === standaard })),
    perAccount,
    standaardAgenda: agenda,
    voorbeeldAfspraak: voorbeeld,
    mail: resend,
  }
}
