// Meeting Inplanner — herinneringen voor verkoopafspraken en klantboekingen van
// begin tot eind, met de echte code (lib/meetings/*, lib/sales/service.ts,
// lib/sales/google-calendar.ts, lib/clickup.ts, lib/email.ts) tegen nagebootste
// Google-, ClickUp- en Resend-API's (tests/hulp-meetings-nep.ts).
//
//   npx tsx tests/meeting-inplanner.test.ts

import { tabellen, nepDb, google, clickup, resend } from './hulp-meetings-nep'
import assert from 'node:assert/strict'
import { afspraakHerinneringBijwerken, verwerkHerinneringen, leesMeeting } from '../lib/meetings/server'
import {
  berekenVrijeSlots, boekKlantmeeting, meetingVoorToken, verplaatsViaLink, annuleerViaLink, publiekeWeergave, BoekingFout, hashToken,
} from '../lib/meetings/klantboeking-server'
import { uur, dag, zoneNaarIso } from '../lib/meetings/model'
import { KB_MIN_VOORAF_TEKST } from '../lib/meetings/klantboeking'

let n = 0
const test = async (naam: string, fn: () => Promise<void>) => { await fn(); n++; console.log(`  ✓ ${naam}`) }
const db = nepDb as never

const AGENDA = 'a0000000-0000-4000-8000-000000000001'
tabellen.sales_clients = [{ id: 'org1', name: 'NextGenMedia', status: 'active', timezone: 'Europe/Brussels', created_at: '2026-01-01T00:00:00Z', slot_interval_min: 30, default_duration_min: 30, buffer_before_min: 0, buffer_after_min: 0, min_notice_min: 60, max_horizon_days: 60, max_per_day: 8 }]
tabellen.sales_calendar_connections.push({
  id: AGENDA, sales_client_id: 'org1', name: 'Bram', provider: 'google', calendar_id: 'bram@agenda', access_token: 'plain:tok', refresh_token: 'plain:ref',
  token_expires_at: new Date(Date.now() + 3600e3).toISOString(), status: 'connected', active: true, pipeline_id: null, clickup_assignee_id: 200511713,
  account_email: 'team@nextgenmedia.be', busy_calendar_ids: ['bram@agenda'], signature_email: 'bram@nextgenmedia.be',
})
tabellen.sales_availability_rules = [0, 1, 2, 3, 4].map((weekday) => ({ sales_client_id: 'org1', weekday, start_time: '09:00:00', end_time: '17:00:00', calendar_id: null }))
tabellen.sales_availability_exceptions = []
tabellen.sales_appointments = []
tabellen.sales_pipelines.push(
  { id: 'p-ngm', key: 'nextgenmedia', name: 'NextGenMedia', clickup_list_id: 'L-NGM', default_calendar_id: AGENDA, reminder_from: null, reminder_reply_to: null },
  { id: 'p-ngs', key: 'nextgensolutions', name: 'NextGenSolutions', clickup_list_id: 'L-NGS', default_calendar_id: null, reminder_from: 'NextGenSolutions <info@nextgensolutions.be>', reminder_reply_to: null },
)
tabellen.sales_leads = [{ id: 'lead1', sales_companies: { name: 'Bakkerij Peeters' }, sales_contacts: { name: 'Ann Peeters' } }]
tabellen.app_settings = []

const overUren = (u: number) => new Date(Date.now() + u * 3600e3).toISOString()
const herinneringenAfspraak = (id: string) => tabellen.klant_meeting_herinneringen.filter((h) => h.afspraak_id === id)
const nieuweSleutel = () => crypto.randomUUID()

function afspraak(id: string, startOverUren: number, extra: Record<string, unknown> = {}) {
  const r = { id, sales_client_id: 'org1', lead_id: 'lead1', calendar_id: AGENDA, pipeline_id: 'p-ngs', status: 'scheduled', titel: 'Kennismaking Bakkerij Peeters — NextGenSolutions',
    attendee_email: 'ann@peeters.be', meet_url: 'https://meet.google.com/aaa-bbbb-ccc', adres: null, starts_at: overUren(startOverUren), ends_at: overUren(startOverUren + 0.5), ...extra }
  // De join van supabase (sales_leads → bedrijf/contact) nabootsen.
  Object.defineProperty(r, 'sales_leads', { value: tabellen.sales_leads[0], enumerable: true })
  tabellen.sales_appointments.push(r)
  return r
}

async function main() {
  console.log('\nMeeting Inplanner — verkoopafspraken en klantboekingen\n')

  // ── Herinneringen voor verkoopafspraken ──────────────────────────────────
  await test('1. Verkoopafspraak geboekt: herinnering 24 uur vooraf naar de prospect', async () => {
    const a = afspraak('ap-1', 72)
    await afspraakHerinneringBijwerken(db, a.id)
    const h = herinneringenAfspraak(a.id)
    assert.equal(h.length, 1)
    assert.equal(h[0].moment, '24u')
    assert.equal(new Date(h[0].gepland_voor).getTime(), new Date(a.starts_at).getTime() - 24 * 3600e3)
    assert.deepEqual(h[0].ontvangers, [{ naam: 'Ann Peeters', email: 'ann@peeters.be' }])
    await afspraakHerinneringBijwerken(db, a.id) // zelfde gegevens → niets nieuw
    assert.equal(herinneringenAfspraak(a.id).length, 1)
  })

  await test('2. Verplaatst: oude herinnering ingetrokken, nieuwe op het nieuwe uur', async () => {
    const a = tabellen.sales_appointments.find((x) => x.id === 'ap-1')!
    a.starts_at = overUren(96); a.ends_at = overUren(96.5)
    await afspraakHerinneringBijwerken(db, a.id)
    const h = herinneringenAfspraak(a.id)
    assert.equal(h.filter((x) => x.status === 'gepland').length, 1)
    assert.equal(h.filter((x) => x.status === 'geannuleerd').length, 1)
    assert.equal(new Date(h.find((x) => x.status === 'gepland')!.gepland_voor).getTime(), new Date(a.starts_at).getTime() - 24 * 3600e3)
  })

  await test('3. Scheduler: vertrekt één keer met de afzender van het merk', async () => {
    const h = herinneringenAfspraak('ap-1').find((x) => x.status === 'gepland')!
    h.gepland_voor = new Date(Date.now() - 60e3).toISOString()
    const voor = resend.verstuurd.length
    assert.equal((await verwerkHerinneringen(db)).verzonden, 1)
    assert.equal((await verwerkHerinneringen(db)).verzonden, 0)
    assert.equal(resend.verstuurd.length, voor + 1)
    const mail = resend.verstuurd[resend.verstuurd.length - 1]
    assert.equal(mail.from, 'NextGenSolutions <info@nextgensolutions.be>')
    assert.deepEqual(mail.to, ['ann@peeters.be'])
    assert.match(String(mail.text), /^Beste Ann Peeters,/)
    assert.match(String(mail.text), /meet\.google\.com\/aaa-bbbb-ccc/)
    assert.match(String(mail.text), /NextGenSolutions$/)
  })

  await test('4. Al verstuurd en enkel iets anders gewijzigd: geen tweede herinnering', async () => {
    await afspraakHerinneringBijwerken(db, 'ap-1')
    assert.equal(herinneringenAfspraak('ap-1').filter((x) => ['gepland', 'bezig'].includes(x.status)).length, 0)
  })

  await test('5. Geannuleerd: nog niet verstuurde herinnering ingetrokken', async () => {
    const a = afspraak('ap-2', 80)
    await afspraakHerinneringBijwerken(db, a.id)
    a.status = 'cancelled'
    await afspraakHerinneringBijwerken(db, a.id)
    assert.ok(herinneringenAfspraak(a.id).every((x) => x.status === 'geannuleerd'))
  })

  await test('6. Afspraak zonder Meet-link en zonder adres: herinnering mislukt met reden', async () => {
    const a = afspraak('ap-3', 80, { meet_url: null, adres: null, pipeline_id: 'p-ngm' })
    await afspraakHerinneringBijwerken(db, a.id)
    herinneringenAfspraak(a.id)[0].gepland_voor = new Date(Date.now() - 60e3).toISOString()
    assert.equal((await verwerkHerinneringen(db)).mislukt, 1)
    assert.match(herinneringenAfspraak(a.id)[0].fout, /geen Meet-link en geen adres/)
    a.status = 'cancelled' // niet meer in de weg voor de klantboekingen hieronder
  })

  // ── Klantboekingen: beschikbaarheid ──────────────────────────────────────
  let slots: string[] = []
  await test('7. Vrije momenten: enkel weekdagen, 11:00–16:30, minstens 72 uur vooraf', async () => {
    const b = await berekenVrijeSlots(db, { vers: true })
    slots = b.slots
    assert.ok(slots.length > 20)
    assert.ok(slots.every((s) => uur(s) >= '11:00' && uur(s) <= '16:30'))
    assert.ok(slots.every((s) => new Date(s).getTime() >= Date.now() + 72 * 3600e3 - 1000))
    assert.ok(slots.every((s) => { const wd = new Date(`${dag(s)}T12:00:00Z`).getUTCDay(); return wd !== 0 && wd !== 6 }))
  })

  await test('8. Bezet in Google, in ClickUp of door een meeting in de app: niet aangeboden', async () => {
    const [s1, s2, s3] = [slots[0], slots[3], slots[6]]
    google.bezet = [{ start: s1, end: new Date(new Date(s1).getTime() + 30 * 60e3).toISOString() }]
    clickup.werkruimte = [{ id: 'cu-x', name: 'Geheim klantwerk', start_date: String(new Date(s2).getTime()), due_date: String(new Date(s2).getTime() + 30 * 60e3), assignees: [{ id: 200511713 }] }]
    tabellen.klant_meetings.push({ id: 'km-x', bron: 'intern', status: 'ingepland', agenda_id: AGENDA, starts_at: s3, ends_at: new Date(new Date(s3).getTime() + 30 * 60e3).toISOString(), klant_ontvangers: [], deelnemers: [] })
    const b = await berekenVrijeSlots(db, { vers: true })
    assert.ok(!b.slots.includes(s1) && !b.slots.includes(s2) && !b.slots.includes(s3))
    assert.ok(b.slots.includes(slots[1]))
    assert.ok(!JSON.stringify(b).includes('Geheim'))
    google.bezet = []; clickup.werkruimte = []
    tabellen.klant_meetings = tabellen.klant_meetings.filter((m) => m.id !== 'km-x')
  })

  await test('9. ClickUp of Google niet betrouwbaar te lezen: geen enkel tijdstip, geen gok', async () => {
    clickup.teamFout = true
    await assert.rejects(berekenVrijeSlots(db, { vers: true }), (e: unknown) => e instanceof BoekingFout && e.status === 503 && /niet betrouwbaar/.test(e.publiek))
    clickup.teamFout = false
    google.freebusyKalenderFout = true
    await assert.rejects(berekenVrijeSlots(db, { vers: true }), (e: unknown) => e instanceof BoekingFout && e.status === 503)
    google.freebusyKalenderFout = false
    google.freebusyFout = true
    await assert.rejects(berekenVrijeSlots(db, { vers: true }), (e: unknown) => e instanceof BoekingFout && e.status === 503)
    google.freebusyFout = false
  })

  // ── Klantboekingen: boeken ───────────────────────────────────────────────
  let token = ''
  let geboekt = ''
  await test('10. Klant boekt: één afspraak met Meet, ClickUp-taak, herinnering en bevestiging', async () => {
    const voor = { g: google.aangemaakt, c: clickup.aangemaakt, r: resend.verstuurd.length }
    const sleutel = nieuweSleutel()
    const r = await boekKlantmeeting(db, { aanvraag_sleutel: sleutel, naam: 'Jan Janssens', email: 'Jan@Voorbeeld.be', bedrijf: 'Janssens BV', reden: 'Nieuwe website', start: slots[1] })
    geboekt = r.id
    assert.ok(r.beheerUrl && /\/boeken\/beheer#t=[A-Za-z0-9_-]{43}$/.test(r.beheerUrl))
    token = r.beheerUrl!.split('#t=')[1]
    assert.equal(r.bevestigingVerstuurd, true)
    assert.match(r.meetUrl ?? '', /^https:\/\/meet\.google\.com\//)
    assert.equal(google.aangemaakt, voor.g + 1)
    assert.equal(clickup.aangemaakt, voor.c + 1)
    assert.equal(resend.verstuurd.length, voor.r + 1)
    const m = (await leesMeeting(db, r.id))!
    assert.equal(m.bron, 'klantboeking')
    assert.equal(m.beheer_token_hash, hashToken(token))
    assert.ok(!JSON.stringify(m).includes(token)) // enkel de hash staat in de databank
    assert.deepEqual(google.events.get(m.google_event_id!)!.attendees, [{ email: 'jan@voorbeeld.be', displayName: 'Jan Janssens' }])
    assert.equal(clickup.taken.get(m.clickup_task_id!)!.list, 'L-NGM')
    assert.equal(tabellen.klant_meeting_herinneringen.filter((h) => h.meeting_id === m.id && h.status === 'gepland')[0].moment, '24u')
    const mail = resend.verstuurd[resend.verstuurd.length - 1]
    assert.match(mail.subject, /^Bevestigd: meeting met NextGenMedia op /)
    assert.ok(String(mail.text).includes(token))
    assert.ok(!tabellen.email_messages.some((e) => String(e.body ?? '').includes(token))) // niet in het logboek
    // Herhaling (time-out, dubbele klik): niets dubbel.
    const z = await boekKlantmeeting(db, { aanvraag_sleutel: sleutel, naam: 'Jan Janssens', email: 'jan@voorbeeld.be', start: slots[1] })
    assert.equal(z.herhaald, true)
    assert.equal(google.aangemaakt, voor.g + 1)
    assert.equal(resend.verstuurd.length, voor.r + 1)
  })

  await test('11. Hetzelfde moment is daarna niet meer te boeken', async () => {
    await assert.rejects(boekKlantmeeting(db, { aanvraag_sleutel: nieuweSleutel(), naam: 'Piet', email: 'piet@x.be', start: slots[1] }),
      (e: unknown) => e instanceof BoekingFout && e.status === 409)
  })

  await test('12. Twee klanten tegelijk op hetzelfde moment: één boeking, één afspraak', async () => {
    const voor = google.aangemaakt
    const res = await Promise.allSettled([
      boekKlantmeeting(db, { aanvraag_sleutel: nieuweSleutel(), naam: 'Klant A', email: 'a@x.be', start: slots[8] }),
      boekKlantmeeting(db, { aanvraag_sleutel: nieuweSleutel(), naam: 'Klant B', email: 'b@x.be', start: slots[8] }),
    ])
    assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1)
    const fout = res.find((r) => r.status === 'rejected') as PromiseRejectedResult
    assert.ok(fout.reason instanceof BoekingFout && fout.reason.status === 409)
    assert.equal(google.aangemaakt, voor + 1)
    assert.equal(tabellen.klant_meetings.filter((m) => m.bron === 'klantboeking' && m.status === 'ingepland' && new Date(m.starts_at).toISOString() === slots[8]).length, 1)
  })

  await test('13. Regels: binnen 72 uur, buiten 11–17 uur, ongeldig e-mailadres → geweigerd', async () => {
    const vroeg = zoneNaarIso(dag(overUren(30)), '14:00')
    await assert.rejects(boekKlantmeeting(db, { aanvraag_sleutel: nieuweSleutel(), naam: 'Jan', email: 'jan@x.be', start: vroeg }), (e: unknown) => e instanceof BoekingFout && e.publiek === KB_MIN_VOORAF_TEKST)
    const laat = zoneNaarIso(dag(slots[10]), '17:00')
    await assert.rejects(boekKlantmeeting(db, { aanvraag_sleutel: nieuweSleutel(), naam: 'Jan', email: 'jan@x.be', start: laat }), (e: unknown) => e instanceof BoekingFout && /tussen 11:00 en 17:00/.test(e.publiek))
    await assert.rejects(boekKlantmeeting(db, { aanvraag_sleutel: nieuweSleutel(), naam: 'Jan', email: 'jan@x', start: slots[10] }), (e: unknown) => e instanceof BoekingFout && /e-mailadres/.test(e.publiek))
  })

  await test('14. Google weigert de afspraak: niet geboekt, geen ClickUp-taak, geen mail, moment vrij', async () => {
    const voor = { c: clickup.aangemaakt, r: resend.verstuurd.length }
    google.weigerAanmaak = true
    await assert.rejects(boekKlantmeeting(db, { aanvraag_sleutel: nieuweSleutel(), naam: 'Jan', email: 'jan2@x.be', start: slots[12] }), (e: unknown) => e instanceof BoekingFout && e.status === 503)
    assert.equal(clickup.aangemaakt, voor.c)
    assert.equal(resend.verstuurd.length, voor.r)
    assert.ok(!tabellen.klant_meetings.some((m) => m.bron === 'klantboeking' && new Date(m.starts_at).toISOString() === slots[12]))
    assert.ok((await berekenVrijeSlots(db, { vers: true })).slots.includes(slots[12]))
  })

  await test('15. Hoogstens drie komende boekingen per e-mailadres', async () => {
    for (const i of [14, 16]) await boekKlantmeeting(db, { aanvraag_sleutel: nieuweSleutel(), naam: 'Jan', email: 'jan@voorbeeld.be', start: slots[i] })
    await assert.rejects(boekKlantmeeting(db, { aanvraag_sleutel: nieuweSleutel(), naam: 'Jan', email: 'jan@voorbeeld.be', start: slots[18] }), (e: unknown) => e instanceof BoekingFout && e.status === 429)
  })

  // ── Klantboekingen: beheren via de link ──────────────────────────────────
  await test('16. Beheerlink: enkel de eigen boeking, een fout token geeft niets', async () => {
    const m = await meetingVoorToken(db, token)
    assert.equal(m?.id, geboekt)
    assert.equal(await meetingVoorToken(db, token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')), null)
    assert.equal(await meetingVoorToken(db, 'kort'), null)
    const w = publiekeWeergave(m!)
    assert.deepEqual(Object.keys(w).sort(), ['endsAt', 'magAnnuleren', 'magVerplaatsen', 'meetUrl', 'naam', 'startsAt', 'status', 'tijdzone', 'titel'])
  })

  await test('17. Verplaatsen via de link: zelfde afspraak bijgewerkt, herinnering mee, bevestiging "Verplaatst"', async () => {
    let m = (await meetingVoorToken(db, token))!
    const voor = google.aangemaakt
    m = await verplaatsViaLink(db, m, token, slots[20])
    assert.equal(new Date(m.starts_at).toISOString(), slots[20])
    assert.equal(google.aangemaakt, voor)
    assert.equal(new Date(google.events.get(m.google_event_id!)!.start.dateTime).toISOString(), slots[20])
    const actief = tabellen.klant_meeting_herinneringen.filter((h) => h.meeting_id === m.id && h.status === 'gepland')
    assert.equal(actief.length, 1)
    assert.equal(new Date(actief[0].gepland_voor).getTime(), new Date(slots[20]).getTime() - 24 * 3600e3)
    assert.match(resend.verstuurd[resend.verstuurd.length - 1].subject, /^Verplaatst:/)
    // Naar een moment binnen 72 uur kan niet.
    await assert.rejects(verplaatsViaLink(db, m, token, zoneNaarIso(dag(overUren(30)), '14:00')), (e: unknown) => e instanceof BoekingFout && e.publiek === KB_MIN_VOORAF_TEKST)
  })

  await test('18. Annuleren via de link: afspraak, ClickUp en herinnering mee, geen extra mail van de app', async () => {
    let m = (await meetingVoorToken(db, token))!
    const voor = resend.verstuurd.length
    m = await annuleerViaLink(db, m)
    assert.equal(m.status, 'geannuleerd')
    assert.equal(google.events.get(m.google_event_id!)!.status, 'cancelled')
    assert.match(clickup.taken.get(m.clickup_task_id!)!.name, /^\[GEANNULEERD\] /)
    assert.ok(tabellen.klant_meeting_herinneringen.filter((h) => h.meeting_id === m.id).every((h) => h.status !== 'gepland'))
    assert.equal(resend.verstuurd.length, voor)
    assert.equal(publiekeWeergave(m).magAnnuleren, false)
    // Het moment is weer vrij.
    assert.ok((await berekenVrijeSlots(db, { vers: true })).slots.includes(slots[20]))
  })

  console.log(`\n${n} tests geslaagd\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })
