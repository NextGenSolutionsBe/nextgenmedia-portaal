import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { DATABANK_TIJDELIJK } from '@/lib/supabase/herkansing'
import { controleerKoppelingen, testAfspraak, leesMeeting, veiligeFout, stapGoogle, stapClickup, planHerinnering, annuleer, bewaarMeeting, laatsteHerinnering, type MeetingRij } from '@/lib/meetings/server'
import { kalenderData, controleerVrij } from '@/lib/meetings/kalender-server'
import { cronToegang } from '@/lib/meetings/cron-toegang'
import { haalMeetingEvent, bezetPerAgenda, meldingInfo } from '@/lib/sales/google-calendar'
import { getOrCreateSalesOrg, listOwners, loadCalendar } from '@/lib/sales/service'
import { haalSyncTaken, clickupTijdvelden, clickupZoekVarianten, type SyncOphaalInfo } from '@/lib/clickup'
import { mergeIntervals, type Interval } from '@/lib/sales/availability'
import { dag, uur, zoneNaarIso } from '@/lib/meetings/model'
import {
  berekenVrijeSlots, boekKlantmeeting, meetingVoorToken, verplaatsViaLink, annuleerViaLink, BoekingFout,
} from '@/lib/meetings/klantboeking-server'

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
