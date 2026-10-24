// Klantapp — Meeting boeken: boeken, Mijn meetings, verplaatsen en annuleren
// vanuit de klantapp, plus de interne conflictwaarschuwing (intern mag elk
// tijdstip). Echte code tegen nagebootste Google-, ClickUp- en Resend-API's.
//
//   npx tsx tests/klantapp-meetings.test.ts

import { tabellen, nepDb, google, clickup, resend } from './hulp-meetings-nep'
import assert from 'node:assert/strict'
import {
  berekenVrijeSlots, boekKlantmeeting, klantappMeetings, klantappMeeting, klantappWeergave, verplaatsKlantboeking, annuleerViaLink,
  bevestigingOpnieuw, schoonDeelnemers, BoekingFout,
} from '../lib/meetings/klantboeking-server'
import { controleerConflicten } from '../lib/meetings/kalender-server'
import { leesMeeting } from '../lib/meetings/server'
import { metStandaard, sanitizePermissions, can, presetPermissions } from '../lib/portal-permissions'
import { zoneNaarIso, dag } from '../lib/meetings/model'
import { KB_MIN_VOORAF_TEKST } from '../lib/meetings/klantboeking'

let n = 0
const test = async (naam: string, fn: () => Promise<void> | void) => { await fn(); n++; console.log(`  ✓ ${naam}`) }
const db = nepDb as never

const AGENDA = 'a0000000-0000-4000-8000-000000000001'
const KLANT_A = 'c0000000-0000-4000-8000-00000000000a'
const KLANT_B = 'c0000000-0000-4000-8000-00000000000b'
tabellen.sales_clients = [{ id: 'org1', name: 'NextGenMedia', status: 'active', timezone: 'Europe/Brussels', created_at: '2026-01-01T00:00:00Z', slot_interval_min: 30, default_duration_min: 30, buffer_before_min: 0, buffer_after_min: 0, min_notice_min: 60, max_horizon_days: 60, max_per_day: 8 }]
tabellen.sales_calendar_connections.push({
  id: AGENDA, sales_client_id: 'org1', name: 'Bram', provider: 'google', calendar_id: 'bram@agenda', access_token: 'plain:tok', refresh_token: 'plain:ref',
  token_expires_at: new Date(Date.now() + 3600e3).toISOString(), status: 'connected', active: true, pipeline_id: null, clickup_assignee_id: 200511713,
  account_email: 'team@nextgenmedia.be', busy_calendar_ids: ['bram@agenda'], signature_email: 'bram@nextgenmedia.be',
})
tabellen.sales_availability_rules = [0, 1, 2, 3, 4].map((weekday) => ({ sales_client_id: 'org1', weekday, start_time: '09:00:00', end_time: '17:00:00', calendar_id: null }))
tabellen.sales_availability_exceptions = []
tabellen.sales_appointments = []
tabellen.sales_pipelines.push({ id: 'p-ngm', key: 'nextgenmedia', name: 'NextGenMedia', clickup_list_id: 'L-NGM', default_calendar_id: AGENDA })
tabellen.app_settings = []
tabellen.clients = [{ id: KLANT_A, company_name: 'Bakkerij Peeters' }, { id: KLANT_B, company_name: 'Garage Janssens' }]

const sleutel = () => crypto.randomUUID()
const klantapp = (clientId: string, bedrijf: string, extra?: unknown) => ({ clientId, bedrijf, doorEmail: 'ann@peeters.be', extraDeelnemers: extra })

async function main() {
  console.log('\nKlantapp — Meeting boeken\n')

  await test('1. Module "Meeting boeken" staat standaard aan, ook voor oudere subaccounts; uitzetten blijft bewaard', () => {
    assert.equal(can(metStandaard({ tasks: { view: true } }), 'meetings', 'book'), true)
    assert.equal(can(metStandaard(presetPermissions('marketing')), 'meetings', 'view'), true)
    const uit = sanitizePermissions({ meetings: { view: false, book: false }, tasks: { view: true, complete: false } })
    assert.deepEqual(uit.meetings, { view: false, book: false })
    assert.equal(uit.tasks?.complete, undefined, 'andere modules: enkel true bewaard zoals voorheen')
    assert.equal(can(metStandaard(uit), 'meetings', 'view'), false)
  })

  let slots: string[] = []
  await test('2. Klant ziet enkel 11:00–16:30, minstens 72 uur vooraf, en geen agenda-inhoud', async () => {
    clickup.werkruimte = [{ id: 'cu-geheim', name: 'Geheime meeting Garage Janssens', start_date: null, due_date: '0', assignees: [{ id: 200511713 }] }]
    const b = await berekenVrijeSlots(db, { vers: true })
    slots = b.slots
    assert.ok(slots.length > 10)
    assert.ok(slots.every((s) => { const u = new Date(s).toLocaleTimeString('nl-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }); return u >= '11:00' && u <= '16:30' }))
    assert.ok(slots.every((s) => Date.parse(s) >= Date.now() + 72 * 3600e3 - 1000))
    assert.ok(!JSON.stringify(b).includes('Geheim'))
    clickup.werkruimte = []
  })

  let id = ''
  await test('3. Boeken vanuit de klantapp: aan de klant gekoppeld, collega uitgenodigd, geen beheerlink, bevestiging naar de klantapp', async () => {
    const voor = resend.verstuurd.length
    const r = await boekKlantmeeting(db, { aanvraag_sleutel: sleutel(), naam: 'Ann Peeters', email: 'ann@peeters.be', reden: 'Campagne voorjaar', start: slots[0] }, new Date(),
      klantapp(KLANT_A, 'Bakkerij Peeters', [{ naam: 'Jan', email: 'jan@peeters.be' }, { naam: 'Dubbel', email: 'ANN@peeters.be' }, { naam: 'Fout', email: 'geen-mail' }]))
    id = r.id
    assert.equal(r.beheerUrl, null)
    const m = (await leesMeeting(db, id))!
    assert.equal(m.client_id, KLANT_A)
    assert.equal(m.beheer_token_hash, null)
    assert.equal(m.titel, 'Gratis kennismaking met NextGenMedia (Bakkerij Peeters)')
    assert.deepEqual(m.klant_ontvangers.map((p) => p.email), ['ann@peeters.be', 'jan@peeters.be'])
    assert.equal(m.google_status, 'ok')
    assert.ok(m.meet_url?.startsWith('https://meet.google.com/'))
    assert.deepEqual(google.events.get(m.google_event_id!)?.attendees.map((a: { email: string }) => a.email), ['ann@peeters.be', 'jan@peeters.be'])
    assert.equal(m.clickup_status, 'ok')
    const mail = resend.verstuurd[voor]
    assert.deepEqual(mail.to, ['ann@peeters.be'])
    assert.deepEqual(mail.cc, ['jan@peeters.be'])
    assert.match(String(mail.text), /Onderwerp: Campagne voorjaar/)
    assert.match(String(mail.text), /Je spreekt met Bram \(bram@nextgenmedia\.be\)/)
    assert.match(String(mail.text), /\/portal\/meetings/)
    assert.doesNotMatch(String(mail.text), /#t=/)
    assert.equal(resend.verstuurd.length, voor + 1)
  })

  await test('4. Dubbele klik of herladen: zelfde aanvraag boekt niets opnieuw', async () => {
    const m = (await leesMeeting(db, id))!
    const voorG = google.aangemaakt, voorM = resend.verstuurd.length
    const r = await boekKlantmeeting(db, { aanvraag_sleutel: m.aanvraag_sleutel, naam: 'Ann Peeters', email: 'ann@peeters.be', start: slots[0] }, new Date(), klantapp(KLANT_A, 'Bakkerij Peeters'))
    assert.equal(r.herhaald, true)
    assert.equal(google.aangemaakt, voorG)
    assert.equal(resend.verstuurd.length, voorM)
  })

  await test('5. Hetzelfde moment door een andere klant: geweigerd, niets aangemaakt', async () => {
    const voorG = google.aangemaakt, voorC = clickup.aangemaakt, voorM = resend.verstuurd.length
    await assert.rejects(
      boekKlantmeeting(db, { aanvraag_sleutel: sleutel(), naam: 'Piet', email: 'piet@janssens.be', start: slots[0] }, new Date(), klantapp(KLANT_B, 'Garage Janssens')),
      (e: unknown) => e instanceof BoekingFout && e.status === 409,
    )
    assert.equal(google.aangemaakt, voorG)
    assert.equal(clickup.aangemaakt, voorC)
    assert.equal(resend.verstuurd.length, voorM)
  })

  await test('6. Klantregels: binnen 72 uur of buiten 11–17 kan niet', async () => {
    const binnen72 = zoneNaarIso(dag(new Date(Date.now() + 24 * 3600e3).toISOString()), '14:00')
    await assert.rejects(boekKlantmeeting(db, { aanvraag_sleutel: sleutel(), naam: 'Ann', email: 'ann@peeters.be', start: binnen72 }, new Date(), klantapp(KLANT_A, 'Bakkerij Peeters')),
      (e: unknown) => e instanceof BoekingFout && e.publiek === KB_MIN_VOORAF_TEKST)
    const laat = zoneNaarIso(dag(slots[slots.length - 1]), '16:45')
    await assert.rejects(boekKlantmeeting(db, { aanvraag_sleutel: sleutel(), naam: 'Ann', email: 'ann@peeters.be', start: laat }, new Date(), klantapp(KLANT_A, 'Bakkerij Peeters')),
      (e: unknown) => e instanceof BoekingFout && /tussen 11:00 en 17:00/.test(e.publiek))
  })

  await test('7. Mijn meetings: enkel die van de eigen klant, nooit die van een andere', async () => {
    const a = await klantappMeetings(db, KLANT_A)
    const b = await klantappMeetings(db, KLANT_B)
    assert.deepEqual(a.map((m) => m.id), [id])
    assert.equal(b.length, 0)
    assert.equal(await klantappMeeting(db, KLANT_B, id), null)
    const w = klantappWeergave(a[0])
    assert.equal(w.onderwerp, 'Campagne voorjaar')
    assert.equal(JSON.stringify(w).includes('google_event_id') || JSON.stringify(w).includes('clickup'), false)
  })

  await test('8. Verplaatsen in de klantapp: zelfde afspraak, klantregels, één "Verplaatst"-mail met link naar de klantapp', async () => {
    const m = (await leesMeeting(db, id))!
    const voorM = resend.verstuurd.length
    const x = await verplaatsKlantboeking(db, m, { soort: 'klantapp' }, slots[2])
    assert.equal(x.google_event_id, m.google_event_id)
    assert.equal(x.clickup_task_id, m.clickup_task_id)
    assert.equal(new Date(x.starts_at).toISOString(), slots[2])
    assert.equal(resend.verstuurd.length, voorM + 1)
    assert.match(String(resend.verstuurd[voorM].subject), /^Verplaatst:/)
    assert.match(String(resend.verstuurd[voorM].text), /\/portal\/meetings/)
    const binnen72 = zoneNaarIso(dag(new Date(Date.now() + 24 * 3600e3).toISOString()), '14:00')
    await assert.rejects(verplaatsKlantboeking(db, x, { soort: 'klantapp' }, binnen72), (e: unknown) => e instanceof BoekingFout && e.publiek === KB_MIN_VOORAF_TEKST)
  })

  await test('9. Bevestiging opnieuw (intern): vertrekt echt opnieuw, nog steeds naar de klantapp', async () => {
    const m = (await leesMeeting(db, id))!
    const voorM = resend.verstuurd.length
    const x = await bevestigingOpnieuw(db, m)
    assert.equal(x.bevestiging_status, 'verzonden')
    assert.equal(resend.verstuurd.length, voorM + 1)
    assert.equal(x.beheer_token_hash, null)
  })

  await test('10. Annuleren in de klantapp: Google geannuleerd, uit Mijn meetings als komend', async () => {
    const m = (await leesMeeting(db, id))!
    const x = await annuleerViaLink(db, m, new Date(), 'klantapp (ann@peeters.be)')
    assert.equal(x.status, 'geannuleerd')
    assert.equal(google.events.get(m.google_event_id!)?.status, 'cancelled')
    assert.equal(x.geannuleerd_door, 'klantapp (ann@peeters.be)')
  })

  await test('11. Hoogstens drie komende boekingen per klant', async () => {
    for (const s of [slots[4], slots[6], slots[8]]) {
      await boekKlantmeeting(db, { aanvraag_sleutel: sleutel(), naam: 'Ann', email: `ann+${s.slice(11, 13)}@peeters.be`, start: s }, new Date(), klantapp(KLANT_A, 'Bakkerij Peeters'))
    }
    await assert.rejects(boekKlantmeeting(db, { aanvraag_sleutel: sleutel(), naam: 'Ann', email: 'nog@peeters.be', start: slots[10] }, new Date(), klantapp(KLANT_A, 'Bakkerij Peeters')),
      (e: unknown) => e instanceof BoekingFout && e.status === 429)
  })

  await test('12. Extra deelnemers: enkel geldige, unieke adressen, hoogstens vijf', () => {
    const r = schoonDeelnemers([{ email: 'a@x.be' }, { email: 'A@x.be' }, { email: 'hoofd@x.be' }, { email: 'fout' }, ...'bcdefgh'.split('').map((c) => ({ email: `${c}@x.be` }))], 'hoofd@x.be')
    assert.deepEqual(r.map((p) => p.email), ['a@x.be', 'b@x.be', 'c@x.be', 'd@x.be', 'e@x.be'])
  })

  await test('13. Intern mag elk tijdstip: buiten de werkuren en binnen 72 uur geen verbod, wel een waarschuwing bij een overlap', async () => {
    const morgen = dag(new Date(Date.now() + 86400e3).toISOString())
    const avond = { start: Date.parse(zoneNaarIso(morgen, '19:00')), eind: Date.parse(zoneNaarIso(morgen, '19:30')) }
    const c1 = await controleerConflicten(db, { agendaId: AGENDA, ...avond })
    assert.equal(c1.betrouwbaar, true)
    assert.equal(c1.lijst.length, 0, '19:00 de dag erna: geen overlap, dus geen waarschuwing')
    clickup.werkruimte = [{ id: 'cu-shoot', name: 'Contentshoot', start_date: String(avond.start - 30 * 60e3), due_date: String(avond.eind), assignees: [{ id: 200511713 }], url: 'x', list: { name: 'L' } }]
    const c2 = await controleerConflicten(db, { agendaId: AGENDA, ...avond })
    assert.deepEqual(c2.lijst.map((x) => x.titel), ['Contentshoot'])
    clickup.werkruimte = []
  })

  console.log(`\n${n} tests geslaagd\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })
