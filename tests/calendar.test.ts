// Calendar — welke ClickUp-items meetings zijn, samenvoegen zonder dubbels,
// strikte vrije momenten, ClickUp-paginering en de gsm-melding van 15 minuten.
// Echte code (lib/meetings/*, lib/sales/*, lib/clickup.ts) tegen nagebootste
// Google-, ClickUp- en Resend-API's (tests/hulp-meetings-nep.ts).
//
//   npx tsx tests/calendar.test.ts

import { tabellen, nepDb, google, clickup } from './hulp-meetings-nep'
import assert from 'node:assert/strict'
import { isClickupMeeting, voegSamen, clickupMeetingBezet, zelfdePersoon, clickupPersoon, heeftUur } from '../lib/meetings/kalender'
import { kalenderData, controleerVrij } from '../lib/meetings/kalender-server'
import { haalSyncTaken, type SyncOphaalInfo } from '../lib/clickup'
import { bouwEvent } from '../lib/sales/clickup-agenda-sync'
import { maakMeetingEvent } from '../lib/sales/google-calendar'
import { zorgVoorGsmMeldingen } from '../lib/meetings/gsm-melding'
import { zoneNaarIso, dag } from '../lib/meetings/model'

let n = 0
const test = async (naam: string, fn: () => Promise<void> | void) => { await fn(); n++; console.log(`  ✓ ${naam}`) }
const db = nepDb as never
const ms = (iso: string) => Date.parse(iso)

const BRAM = 'a0000000-0000-4000-8000-000000000001'
const BRAM_NGM = 'a0000000-0000-4000-8000-000000000002'
const MARCO = 'a0000000-0000-4000-8000-000000000003'
const conn = (id: string, name: string, assignee: number | null, cal: string) => ({
  id, sales_client_id: 'org1', name, provider: 'google', calendar_id: cal, access_token: 'plain:tok', refresh_token: 'plain:ref',
  token_expires_at: new Date(Date.now() + 3600e3).toISOString(), status: 'connected', active: true, pipeline_id: null,
  clickup_assignee_id: assignee, account_email: 'gedeeld@gmail.com', busy_calendar_ids: [cal], signature_email: null,
})
tabellen.sales_clients = [{ id: 'org1', name: 'NextGenMedia', status: 'active', timezone: 'Europe/Brussels', created_at: '2026-01-01T00:00:00Z', slot_interval_min: 30, default_duration_min: 30, buffer_before_min: 0, buffer_after_min: 0, min_notice_min: 60, max_horizon_days: 60, max_per_day: 8 }]
tabellen.sales_calendar_connections.push(conn(BRAM, 'Bram', 200511713, 'bram@agenda'), conn(BRAM_NGM, 'Bram - NextGenMedia', null, 'bram-ngm@agenda'), conn(MARCO, 'Marco', 106693123, 'marco@agenda'))
tabellen.sales_availability_rules = [0, 1, 2, 3, 4].map((weekday) => ({ sales_client_id: 'org1', weekday, start_time: '09:00:00', end_time: '17:00:00', calendar_id: null }))
tabellen.sales_availability_exceptions = []
tabellen.sales_appointments = []
tabellen.sales_pipelines.push({ id: 'p-ngm', key: 'nextgenmedia', name: 'NextGenMedia', clickup_list_id: 'L-NGM', default_calendar_id: BRAM })

/** Eerstvolgende werkdag minstens `na` dagen vooruit (Brussel), als YYYY-MM-DD. */
function werkdag(na: number): string {
  let d = dag(new Date(Date.now() + na * 86400000).toISOString())
  for (;;) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay()
    if (wd !== 0 && wd !== 6) return d
    d = new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)
  }
}
const D = werkdag(3)
const op = (u: string) => zoneNaarIso(D, u)
const dagVan = ms(op('00:00')), dagTot = dagVan + 86400000
const taak = (id: string, name: string, start: string | null, due: string, wie = 200511713) => ({
  id, name, start_date: start ? String(ms(op(start))) : null, due_date: String(ms(op(due))), assignees: [{ id: wie }], url: `https://app.clickup.com/t/${id}`, list: { name: 'NextGenMedia' },
})

async function main() {
  console.log('\nCalendar\n')

  await test('1. ClickUp-meeting = start én einde met uur; deadline, 04:00 of omgekeerd niet', () => {
    const t = (start: string | null, due: string) => ({ id: 'x', naam: 'x', startMs: start ? ms(op(start)) : null, dueMs: ms(op(due)) })
    assert.equal(isClickupMeeting(t('10:00', '11:00')), true)
    assert.equal(isClickupMeeting(t(null, '11:00')), false, 'enkel een deadline')
    assert.equal(isClickupMeeting(t('04:00', '11:00')), false, 'start zonder uur')
    assert.equal(isClickupMeeting(t('10:00', '04:00')), false, 'deadline zonder uur')
    assert.equal(isClickupMeeting(t('11:00', '10:00')), false, 'einde vóór begin')
    // ClickUp's eigen vlag wint van de 04:00-herkenning.
    assert.equal(isClickupMeeting({ ...t('04:00', '05:00'), startHeeftUur: true, dueHeeftUur: true }), true)
    assert.equal(heeftUur(ms(op('10:00')), false), false)
    assert.deepEqual(clickupMeetingBezet([t('10:00', '11:00'), t(null, '15:00')]), [{ start: ms(op('10:00')), end: ms(op('11:00')) }])
  })

  await test('2. Samenvoegen: elke afspraak één keer, met de ClickUp-tasknaam als titel', () => {
    const items = voegSamen({
      meetings: [{ id: 'm1', titel: 'Kennismaking', klant_naam: 'Bakkerij', starts_at: op('10:00'), ends_at: op('10:30'), status: 'ingepland', meet_url: 'https://meet.google.com/aaa-bbbb-ccc', clickup_task_id: 'cu-m1', google_event_id: 'g-m1' }],
      afspraken: [{ id: 'a1', starts_at: op('13:00'), ends_at: op('13:30'), status: 'confirmed', company: 'Garage Jan', clickup_task_id: 'cu-a1', external_event_id: 'g-a1' }],
      clickup: [
        { id: 'cu-m1', naam: 'Meeting: Bakkerij — Kennismaking', startMs: ms(op('10:00')), dueMs: ms(op('10:30')) },
        { id: 'cu-a1', naam: 'Afspraak Garage Jan', startMs: ms(op('13:00')), dueMs: ms(op('13:30')) },
        { id: 'cu-shoot', naam: 'Contentshoot TM Technics', startMs: ms(op('14:00')), dueMs: ms(op('16:00')) },
        { id: 'cu-taak', naam: 'Factuur sturen', startMs: null, dueMs: ms(op('12:00')) },
      ],
      google: [
        { id: 'g-m1', titel: 'Kennismaking', start: op('10:00'), eind: op('10:30') },
        { id: 'g-a1', titel: 'Garage Jan', start: op('13:00'), eind: op('13:30') },
        { id: 'g-sync', titel: 'Contentshoot TM Technics', start: op('14:00'), eind: op('16:00'), clickupTaskId: 'cu-shoot' },
        { id: 'g-los', titel: 'Tandarts', start: op('16:30'), eind: op('17:00') },
        { id: 'g-dag', titel: 'Verjaardag', start: `${D}T00:00:00.000Z`, eind: `${D}T00:00:00.000Z`, heleDag: true },
        { id: 'g-vrij', titel: 'Herinnering', start: op('09:00'), eind: op('09:15'), vrij: true },
      ],
    })
    assert.deepEqual(items.map((i) => i.key), ['meeting:m1', 'afspraak:a1', 'clickup:cu-shoot', 'google:g-los'])
    assert.equal(items.find((i) => i.bron === 'clickup')?.titel, 'Contentshoot TM Technics')
    assert.equal(items.find((i) => i.bron === 'meeting')?.meetUrl, 'https://meet.google.com/aaa-bbbb-ccc')
  })

  await test('3. Persoon: "Bram" en "Bram - NextGenMedia" horen samen, Marco niet (zelfde Google-account)', () => {
    const [b, bn, m] = tabellen.sales_calendar_connections as never[]
    assert.equal(zelfdePersoon(b, bn), true)
    assert.equal(zelfdePersoon(b, m), false)
    assert.equal(clickupPersoon(bn, [b, bn, m]), 200511713)
  })

  await test('4. Agendasync: enkel meetings blokkeren en krijgen de gsm-melding van 15 minuten', () => {
    const basis = { id: 't', naam: 'Taak', assigneeIds: [1], url: '', lijstNaam: '' }
    const meeting = bouwEvent({ ...basis, startMs: ms(op('10:00')), dueMs: ms(op('11:00')) }, 'Europe/Brussels')
    assert.equal(meeting.blokkeert, true)
    assert.equal(meeting.meldingMin, 15)
    const deadline = bouwEvent({ ...basis, startMs: null, dueMs: ms(op('12:00')) }, 'Europe/Brussels')
    assert.equal(deadline.blokkeert, false)
    assert.equal(deadline.meldingMin, undefined)
    assert.equal(bouwEvent({ ...basis, startMs: null, dueMs: ms(op('04:00')) }, 'Europe/Brussels').heleDag, true)
    assert.equal(bouwEvent({ ...basis, startMs: ms(op('04:00')), dueMs: ms(op('04:00')) + 2 * 86400000 }, 'Europe/Brussels').heleDag, true)
  })

  await test('5. ClickUp-paginering: doorlezen ondanks korte pagina\'s en een liegende last_page', async () => {
    clickup.werkruimte = Array.from({ length: 5 }, (_, i) => taak(`p${i}`, `Taak ${i}`, null, '15:00'))
    clickup.paginaGrootte = 2
    clickup.zegtLaatstePagina = true
    const info: SyncOphaalInfo = { paginas: 0, perPagina: [], laatstePaginaGemeld: false }
    const taken = await haalSyncTaken([200511713], dagVan - 86400000, dagTot + 86400000, info)
    assert.equal(taken.length, 5)
    assert.deepEqual(info.perPagina, [2, 2, 1, 0])
    assert.equal(info.laatstePaginaKloptNiet, true)
    clickup.paginaGrootte = 100
    clickup.zegtLaatstePagina = false
  })

  await test('6. Calendar toont ClickUp-meetings met tasknaam, negeert taken zonder uur, en rekent de vrije tijd juist', async () => {
    clickup.werkruimte = [
      taak('cu-shoot', 'Contentshoot TM Technics', '10:00', '12:00'),
      taak('cu-deadline', 'Factuur sturen', null, '14:00'),
      taak('cu-dag', 'Mails beantwoorden', null, '04:00'),
      taak('cu-marco', 'Belblok Marco', '15:00', '16:00', 106693123),
    ]
    google.bezet = [{ start: op('13:00'), end: op('13:30') }]
    google.losseEvents = [
      { id: 'g-los', calendarId: 'bram@agenda', summary: 'Tandarts', status: 'confirmed', start: { dateTime: op('13:00') }, end: { dateTime: op('13:30') } },
      { id: 'g-sync', calendarId: 'bram@agenda', summary: 'Contentshoot TM Technics', status: 'confirmed', start: { dateTime: op('10:00') }, end: { dateTime: op('12:00') }, extendedProperties: { private: { clickupTaskId: 'cu-shoot' } } },
    ]
    const d = await kalenderData(db, { agendaId: BRAM, van: dagVan, tot: dagTot })
    assert.equal(d.beschikbaarheid.ok, true, d.beschikbaarheid.fout ?? '')
    assert.deepEqual(d.items.map((i) => `${i.bron}:${i.titel}`), ['clickup:Contentshoot TM Technics', 'google:Tandarts'])
    const vrij = d.segmenten.map((s) => [new Date(s.start).toISOString(), new Date(s.end).toISOString()])
    // Werkuren 9–17 min shoot (10–12) en Google (13–13:30); de deadline en Marco's belblok blokkeren niet.
    assert.deepEqual(vrij, [[op('09:00'), op('10:00')], [op('12:00'), op('13:00')], [op('13:30'), op('17:00')]])
    // Ook via de andere koppeling van Bram (zonder eigen ClickUp-persoon) dezelfde ClickUp-meetings.
    const viaNgm = await kalenderData(db, { agendaId: BRAM_NGM, van: dagVan, tot: dagTot })
    assert.ok(viaNgm.items.some((i) => i.titel === 'Contentshoot TM Technics'))
  })

  await test('7. Kan de beschikbaarheid niet betrouwbaar gecontroleerd worden, dan geen vrije momenten en een duidelijke fout', async () => {
    google.freebusyFout = true
    const g = await kalenderData(db, { agendaId: BRAM, van: dagVan, tot: dagTot })
    assert.equal(g.segmenten.length, 0)
    assert.equal(g.beschikbaarheid.ok, false)
    assert.match(g.beschikbaarheid.fout ?? '', /Google Agenda/)
    google.freebusyFout = false
    clickup.teamFout = true
    const c = await kalenderData(db, { agendaId: BRAM, van: dagVan, tot: dagTot })
    assert.equal(c.segmenten.length, 0)
    assert.match(c.beschikbaarheid.fout ?? '', /ClickUp/)
    assert.equal(c.bronnen.clickup.ok, false)
    clickup.teamFout = false
  })

  await test('8. Vrij-controle vóór opslaan: bezet = nee (409), vrij = ja, eigen meeting telt niet bij verplaatsen', async () => {
    const bezet = await controleerVrij(db, { agendaId: BRAM, start: ms(op('10:30')), eind: ms(op('11:00')) })
    assert.equal(bezet.vrij, false)
    if (!bezet.vrij) assert.equal(bezet.status, 409)
    assert.equal((await controleerVrij(db, { agendaId: BRAM, start: ms(op('14:00')), eind: ms(op('14:30')) })).vrij, true)
    tabellen.klant_meetings.push({ id: 'mm1', titel: 'Intern', klant_naam: 'X', status: 'ingepland', bron: 'intern', agenda_id: BRAM, starts_at: op('15:00'), ends_at: op('15:30'), clickup_task_id: null, google_event_id: null })
    assert.equal((await controleerVrij(db, { agendaId: BRAM, start: ms(op('15:00')), eind: ms(op('15:30')) })).vrij, false, 'een meeting uit de app blokkeert')
    assert.equal((await controleerVrij(db, { agendaId: BRAM, start: ms(op('15:15')), eind: ms(op('15:45')), negeer: { meetingId: 'mm1' } })).vrij, true, 'verplaatsen: de meeting zelf telt niet')
    // Marco's meeting houdt Bram niet bezet.
    tabellen.klant_meetings.push({ id: 'mm2', titel: 'Marco', klant_naam: 'Y', status: 'ingepland', bron: 'intern', agenda_id: MARCO, starts_at: op('16:00'), ends_at: op('16:30'), clickup_task_id: null, google_event_id: null })
    assert.equal((await controleerVrij(db, { agendaId: BRAM, start: ms(op('16:00')), eind: ms(op('16:30')) })).vrij, true)
    tabellen.klant_meetings = []
  })

  await test('9. Nieuwe Google-afspraak met Meet krijgt de gsm-melding (popup 15 min)', async () => {
    const ev = await maakMeetingEvent(BRAM, {
      eventId: 'ngmtest1', meetRequestId: 'r1', summary: 'Test', description: '', startsAt: op('11:00'), endsAt: op('11:30'),
      timezone: 'Europe/Brussels', attendees: [{ email: 'jan@voorbeeld.be' }],
    })
    assert.equal(ev.gsmMelding, 15)
    assert.deepEqual(google.events.get('ngmtest1')?.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] })
  })

  await test('10. Bestaande afspraken krijgen de melding achteraf, zonder bericht aan genodigden, en maar één keer', async () => {
    google.events.set('oud1', { id: 'oud1', calendarId: 'bram@agenda', status: 'confirmed', start: { dateTime: op('12:00') }, end: { dateTime: op('12:30') } })
    tabellen.klant_meetings.push({ id: 'oud-m', titel: 'Oud', klant_naam: 'Z', status: 'ingepland', bron: 'intern', agenda_id: BRAM, starts_at: op('12:00'), ends_at: op('12:30'), google_event_id: 'oud1', google_calendar_id: 'bram@agenda', gsm_melding_status: null })
    const voor = google.patches.length
    const t1 = await zorgVoorGsmMeldingen(db)
    assert.equal(t1.ingesteld, 1)
    const patch = google.patches.slice(voor).find((p) => p.id === 'oud1')
    assert.equal(patch?.sendUpdates, 'none')
    assert.deepEqual(patch?.body, { reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] } })
    assert.equal(tabellen.klant_meetings.find((m) => m.id === 'oud-m')?.gsm_melding_status, 'ingesteld')
    const t2 = await zorgVoorGsmMeldingen(db)
    assert.equal(t2.ingesteld, 0, 'geen tweede keer')
  })

  console.log(`\n${n} tests geslaagd\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })
