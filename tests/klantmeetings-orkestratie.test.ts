// Klantmeetings — de stappen naast de databank, met nagebootste Google-, ClickUp-
// en Resend-API's (tests/hulp-meetings-nep.ts). Test de echte code van
// lib/meetings/server.ts, lib/sales/google-calendar.ts, lib/clickup.ts en
// lib/email.ts: geen dubbele afspraken, taken of mails bij herhalingen.
//
//   npx tsx tests/klantmeetings-orkestratie.test.ts

import { tabellen, nepDb, google, clickup, resend } from './hulp-meetings-nep'
import assert from 'node:assert/strict'
import {
  stapGoogle, stapClickup, planHerinnering, verwerkHerinneringen, herinneringOpnieuw, annuleer, leesMeeting, bewaarMeeting,
  laatsteHerinnering, veiligeFout, type MeetingRij,
} from '../lib/meetings/server'
import { valideerMeeting, googleEventId, dag, uur } from '../lib/meetings/model'

let n = 0
const test = async (naam: string, fn: () => Promise<void>) => { await fn(); n++; console.log(`  ✓ ${naam}`) }
const db = nepDb as never

const AGENDA = 'a0000000-0000-4000-8000-000000000001'
const AGENDA_ZONDER_TOKEN = 'a0000000-0000-4000-8000-000000000002'
tabellen.sales_calendar_connections.push(
  { id: AGENDA, name: 'Bram', calendar_id: 'bram@agenda', access_token: 'plain:tok', refresh_token: 'plain:ref', token_expires_at: new Date(Date.now() + 3600e3).toISOString(), status: 'connected', active: true, pipeline_id: null, clickup_assignee_id: 200511713 },
  { id: AGENDA_ZONDER_TOKEN, name: 'Oud', calendar_id: 'oud@agenda', access_token: null, refresh_token: null, status: 'expired', active: true, pipeline_id: null, clickup_assignee_id: null },
)
tabellen.sales_pipelines.push({ id: 'p-ngm', key: 'nextgenmedia', clickup_list_id: 'L-NGM' }, { id: 'p-ngs', key: 'nextgensolutions', clickup_list_id: 'L-NGS' })

const overUren = (u: number) => new Date(Date.now() + u * 3600e3).toISOString()
/** Nieuwe meeting zoals de API ze in de databank zet. */
async function nieuweMeeting(startOverUren: number, extra: Partial<MeetingRij> = {}): Promise<MeetingRij> {
  const start = overUren(startOverUren)
  const v = valideerMeeting({ titel: 'Contentplanning', beschrijving: 'Planning overlopen', dag: dag(start), uur: uur(start), duur_minuten: 45, klant_ontvangers: [{ naam: 'Rob', email: 'rob@klant.be' }], deelnemers: [{ naam: 'Sam', email: 'sam@nextgenmedia.be' }] })
  if (!v.ok) throw new Error(v.fout)
  const { data, error } = await (nepDb.from('klant_meetings').insert({
    aanvraag_sleutel: crypto.randomUUID(), client_id: 'c1', klant_naam: 'ERA NOBIS', titel: v.waarde.titel, beschrijving: v.waarde.beschrijving,
    starts_at: v.waarde.startsAt, ends_at: v.waarde.endsAt, agenda_id: AGENDA, organisator_naam: 'Bram', organisator_email: null,
    klant_ontvangers: v.waarde.klant_ontvangers, deelnemers: v.waarde.deelnemers, herinnering_aan: true, created_by_email: 'info@nextgenmedia.be', ...extra,
  }).select().single() as unknown as Promise<{ data: MeetingRij; error: unknown }>)
  assert.equal(error, null)
  return data
}
async function plan(m: MeetingRij) {
  m = await stapGoogle(db, m)
  m = await stapClickup(db, m)
  const h = await planHerinnering(db, m)
  return { m, h }
}
const takenVoor = (id: string) => [...clickup.taken.values()].filter((t) => String(t.description).includes(`ngm-meeting:${id}`))
const herinneringenVan = (id: string) => tabellen.klant_meeting_herinneringen.filter((h) => h.meeting_id === id)
const maakDue = (id: string) => { for (const h of herinneringenVan(id)) if (h.status === 'gepland') h.gepland_voor = new Date(Date.now() - 60e3).toISOString() }

async function main() {
  console.log('\nKlantmeetings — orkestratie\n')

  await test('1. Inplannen: echte afspraak met Meet-link, ClickUp-taak en herinnering 24 uur vooraf', async () => {
    const { m, h } = await plan(await nieuweMeeting(72))
    assert.equal(m.google_status, 'ok')
    assert.equal(m.google_event_id, googleEventId(m.id))
    assert.match(m.meet_url ?? '', /^https:\/\/meet\.google\.com\//)
    const ev = google.events.get(m.google_event_id!)!
    assert.deepEqual(ev.attendees.map((a: { email: string }) => a.email), ['rob@klant.be', 'sam@nextgenmedia.be'])
    assert.equal(ev.start.timeZone, 'Europe/Brussels')
    assert.equal(m.clickup_status, 'ok')
    const taak = clickup.taken.get(m.clickup_task_id!)!
    assert.equal(taak.list, 'L-NGM') // lijst van het merk NextGenMedia
    assert.deepEqual(taak.assignees, [200511713]) // eigenaar van de agenda
    assert.equal(taak.name, 'Meeting: ERA NOBIS — Contentplanning')
    assert.ok(String(taak.description).includes(m.meet_url!))
    assert.equal(h?.moment, '24u')
    assert.equal(new Date(h!.gepland_voor).getTime(), new Date(m.starts_at).getTime() - 24 * 3600e3)
    assert.deepEqual(h?.ontvangers.map((p) => p.email), ['rob@klant.be']) // deelnemers krijgen geen herinnering
  })

  await test('2. Laat ingepland (over 5 uur): herinnering 2 uur vooraf, nooit in het verleden', async () => {
    const { h } = await plan(await nieuweMeeting(5))
    assert.equal(h?.moment, '2u')
    assert.ok(new Date(h!.gepland_voor).getTime() > Date.now())
  })

  await test('3. Heel laat ingepland (over 1 uur): geen herinnering, en dat is zichtbaar', async () => {
    const { m, h } = await plan(await nieuweMeeting(1))
    assert.equal(h, null)
    assert.equal(herinneringenVan(m.id).length, 0)
    assert.equal(await laatsteHerinnering(db, m.id), null)
  })

  await test('4. Google antwoordt niet na het aanmaken: opnieuw proberen geeft dezelfde afspraak, geen tweede', async () => {
    const voor = google.aangemaakt
    google.verliesAntwoord = true
    let m = await stapGoogle(db, await nieuweMeeting(48))
    assert.equal(m.google_status, 'fout')
    assert.equal(google.aangemaakt, voor + 1)
    m = await stapGoogle(db, m)
    assert.equal(m.google_status, 'ok')
    assert.equal(google.aangemaakt, voor + 1)
    assert.equal(m.google_event_id, googleEventId(m.id))
    assert.ok(m.meet_url)
  })

  await test('5. Meet-link laat op zich wachten: opnieuw aanvragen zonder tweede afspraak', async () => {
    google.meetTraag = true
    let m = await stapGoogle(db, await nieuweMeeting(48))
    google.meetTraag = false
    assert.equal(m.google_status, 'ok')
    assert.equal(m.meet_url, null)
    const voor = google.aangemaakt
    m = await stapGoogle(db, m)
    assert.ok(m.meet_url)
    assert.equal(google.aangemaakt, voor)
  })

  await test('6. ClickUp antwoordt niet na het aanmaken: de taak wordt teruggevonden, geen tweede', async () => {
    let m = await stapGoogle(db, await nieuweMeeting(48))
    clickup.verliesAntwoord = true
    m = await stapClickup(db, m)
    assert.equal(m.clickup_status, 'fout')
    assert.equal(takenVoor(m.id).length, 1)
    await bewaarMeeting(db, m.id, { clickup_gestart_op: new Date(Date.now() - 3 * 60e3).toISOString() }) // claim verlopen
    m = (await stapClickup(db, (await leesMeeting(db, m.id))!))
    assert.equal(m.clickup_status, 'ok')
    assert.equal(takenVoor(m.id).length, 1)
    assert.equal(m.clickup_task_id, takenVoor(m.id)[0].id)
  })

  await test('7. Twee gelijktijdige ClickUp-pogingen: één taak', async () => {
    const m = await stapGoogle(db, await nieuweMeeting(48))
    const [a, b] = await Promise.all([stapClickup(db, m), stapClickup(db, m)])
    assert.equal(takenVoor(m.id).length, 1)
    const eind = (await leesMeeting(db, m.id))!
    assert.equal(eind.clickup_status, 'ok')
    assert.ok([a.clickup_task_id, b.clickup_task_id].includes(eind.clickup_task_id))
  })

  await test('8. Aanpassen: zelfde afspraak bijgewerkt, Meet-link blijft, ClickUp volgt, herinnering vervangen', async () => {
    let { m, h } = await plan(await nieuweMeeting(72))
    const link = m.meet_url
    const nieuweStart = overUren(96)
    m = await bewaarMeeting(db, m.id, { starts_at: nieuweStart, ends_at: new Date(new Date(nieuweStart).getTime() + 45 * 60e3).toISOString(), titel: 'Contentplanning (verzet)' })
    const voor = google.aangemaakt
    m = await stapGoogle(db, m, { bijwerken: true })
    m = await stapClickup(db, m)
    const h2 = await planHerinnering(db, m)
    assert.equal(google.aangemaakt, voor)
    assert.equal(m.meet_url, link)
    const patch = google.patches.find((p) => p.id === m.google_event_id && p.body.summary === 'Contentplanning (verzet)')
    assert.ok(patch && patch.sendUpdates === 'all' && !patch.body.conferenceData)
    assert.equal(clickup.taken.get(m.clickup_task_id!)!.name, 'Meeting: ERA NOBIS — Contentplanning (verzet)')
    assert.equal(herinneringenVan(m.id).find((x) => x.id === h!.id)!.status, 'geannuleerd')
    assert.equal(h2!.status, 'gepland')
    assert.equal(new Date(h2!.gepland_voor).getTime(), new Date(nieuweStart).getTime() - 24 * 3600e3)
    assert.equal(herinneringenVan(m.id).filter((x) => x.status === 'gepland').length, 1)
  })

  await test('9. Annuleren: afspraak geannuleerd, ClickUp [GEANNULEERD] en dicht, herinnering ingetrokken, geen mail', async () => {
    let { m } = await plan(await nieuweMeeting(72))
    const mails = resend.verstuurd.length
    m = await annuleer(db, m, 'info@nextgenmedia.be', true)
    assert.equal(m.status, 'geannuleerd')
    assert.equal(m.google_status, 'geannuleerd')
    assert.equal(google.events.get(m.google_event_id!)!.status, 'cancelled')
    assert.equal(google.verwijderd.find((x) => x.id === m.google_event_id)?.sendUpdates, 'all')
    const taak = clickup.taken.get(m.clickup_task_id!)!
    assert.match(taak.name, /^\[GEANNULEERD\] /)
    assert.equal(taak.status, 'complete')
    assert.ok(herinneringenVan(m.id).every((x) => x.status === 'geannuleerd'))
    maakDue(m.id); await verwerkHerinneringen(db)
    assert.equal(resend.verstuurd.length, mails)
  })

  await test('10. Scheduler: herinnering vertrekt één keer, met Meet-link; een tweede run verstuurt niets', async () => {
    const { m } = await plan(await nieuweMeeting(72))
    maakDue(m.id)
    const voor = resend.verstuurd.length
    const r1 = await verwerkHerinneringen(db)
    const r2 = await verwerkHerinneringen(db)
    assert.equal(r1.verzonden, 1)
    assert.equal(r2.verzonden, 0)
    assert.equal(resend.verstuurd.length, voor + 1)
    const mail = resend.verstuurd[resend.verstuurd.length - 1]
    assert.deepEqual(mail.to, ['rob@klant.be'])
    assert.ok(String(mail.text).includes(m.meet_url!))
    assert.match(mail.subject, /^Herinnering: Contentplanning op /)
    const h = herinneringenVan(m.id)[0]
    assert.equal(h.status, 'verzonden')
    assert.ok(h.verzonden_op)
    assert.ok(tabellen.email_messages.some((e) => e.verzend_sleutel === h.verzend_sleutel && e.kind === 'klantmeeting_herinnering'))
  })

  await test('11. Verbinding valt weg na verzenden: herkansing met dezelfde sleutel, nog steeds één mail', async () => {
    const { m } = await plan(await nieuweMeeting(72))
    maakDue(m.id)
    const voor = resend.verstuurd.length
    resend.verliesAntwoord = true
    const r1 = await verwerkHerinneringen(db)
    assert.equal(r1.onzeker, 1)
    const h = herinneringenVan(m.id)[0]
    assert.equal(h.status, 'bezig')
    assert.equal((await verwerkHerinneringen(db)).verzonden, 0) // nog geen tien minuten: niet aanraken
    h.bezig_sinds = new Date(Date.now() - 11 * 60e3).toISOString()
    const r3 = await verwerkHerinneringen(db)
    assert.equal(r3.verzonden, 1)
    assert.equal(resend.verstuurd.length, voor + 1)
    assert.equal(herinneringenVan(m.id)[0].status, 'verzonden')
  })

  await test('12. Mailprovider weigert: status mislukt met de fout; opnieuw versturen lukt, één mail', async () => {
    const { m } = await plan(await nieuweMeeting(72))
    maakDue(m.id)
    resend.weiger = 'The domain is not verified'
    const voor = resend.verstuurd.length
    assert.equal((await verwerkHerinneringen(db)).mislukt, 1)
    const h = herinneringenVan(m.id)[0]
    assert.equal(h.status, 'mislukt')
    assert.equal(h.fout, 'The domain is not verified')
    const r = await herinneringOpnieuw(db, (await leesMeeting(db, m.id))!)
    assert.equal(r.ok, true)
    assert.equal(resend.verstuurd.length, voor + 1)
    assert.equal(herinneringenVan(m.id).filter((x) => x.status === 'verzonden').length, 1)
  })

  await test('13. Scheduler liep achter tot vlak voor de start: niet meer versturen', async () => {
    const { m } = await plan(await nieuweMeeting(3))
    await bewaarMeeting(db, m.id, { starts_at: overUren(0.1) })
    maakDue(m.id)
    const voor = resend.verstuurd.length
    assert.equal((await verwerkHerinneringen(db)).overgeslagen, 1)
    assert.equal(herinneringenVan(m.id)[0].status, 'overgeslagen')
    assert.equal(resend.verstuurd.length, voor)
  })

  await test('14. Geen Meet-link: de herinnering vertrekt niet zonder link en meldt waarom', async () => {
    const m0 = await nieuweMeeting(72)
    await planHerinnering(db, m0) // Google-stap nog niet gelukt
    maakDue(m0.id)
    const voor = resend.verstuurd.length
    assert.equal((await verwerkHerinneringen(db)).mislukt, 1)
    assert.match(herinneringenVan(m0.id)[0].fout, /Meet-link/)
    assert.equal(resend.verstuurd.length, voor)
  })

  await test('15. Agenda niet (meer) gekoppeld: duidelijke fout op de agenda-stap, rest blijft werken', async () => {
    const m0 = await nieuweMeeting(72, { agenda_id: AGENDA_ZONDER_TOKEN })
    const { m, h } = await plan(m0)
    assert.equal(m.google_status, 'fout')
    assert.match(m.google_fout ?? '', /niet \(meer\) gekoppeld/)
    assert.equal(m.clickup_status, 'ok')
    assert.ok(h)
  })

  await test('16. Foutmeldingen bevatten geen sleutels', async () => {
    assert.equal(veiligeFout(new Error('401 Bearer ya29.a0AfH6SMBx-geheim')), '401 Bearer ***')
    assert.equal(veiligeFout('fout bij https://x.test/?key=abc123&b=1'), 'fout bij https://x.test/?key=***&b=1')
    assert.ok(!veiligeFout(new Error('re_123456789abcdef mislukt')).includes('re_123456789'))
  })

  await test('17. Nooit twee lopende herinneringen voor dezelfde meeting', async () => {
    const m = await nieuweMeeting(72)
    await Promise.all([planHerinnering(db, m), planHerinnering(db, m), planHerinnering(db, m)])
    assert.equal(herinneringenVan(m.id).filter((x) => ['gepland', 'bezig', 'mislukt'].includes(x.status)).length, 1)
  })

  console.log(`\n${n} tests geslaagd\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })
