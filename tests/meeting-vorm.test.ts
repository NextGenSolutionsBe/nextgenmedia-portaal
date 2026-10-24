// Meeting Inplanner — online of op locatie, en de mail aan de deelnemers.
// Echte code (lib/meetings/*, lib/sales/google-calendar.ts) tegen nagebootste
// Google-, ClickUp- en Resend-API's (tests/hulp-meetings-nep.ts).
//
//   npx tsx tests/meeting-vorm.test.ts

import { tabellen, nepDb, google, resend } from './hulp-meetings-nep'
import assert from 'node:assert/strict'
import { stapGoogle, bewaarMeeting, bouwHerinnering, leesMeeting, type MeetingRij } from '../lib/meetings/server'
import { valideerVorm, valideerMeeting, waarTekst, klantAdres, wijzigingen, stapMeet, clickupOmschrijving, zoneNaarIso, dag } from '../lib/meetings/model'
import { meetingMailVoorstel, splitsAdressen, adresUit, routeLink, BRIEFING_PLAATSHOUDER } from '../lib/meetings/meeting-mail'
import { verstuurMeetingMail } from '../lib/meetings/meeting-mail-server'

let n = 0
const test = async (naam: string, fn: () => Promise<void> | void) => { await fn(); n++; console.log(`  ✓ ${naam}`) }
const db = nepDb as never

const AGENDA = 'a0000000-0000-4000-8000-000000000001'
tabellen.sales_calendar_connections.push({
  id: AGENDA, sales_client_id: 'org1', name: 'Bram', provider: 'google', calendar_id: 'bram@agenda', access_token: 'plain:tok', refresh_token: 'plain:ref',
  token_expires_at: new Date(Date.now() + 3600e3).toISOString(), status: 'connected', active: true, pipeline_id: null, clickup_assignee_id: 200511713,
  account_email: 'team@nextgenmedia.be', busy_calendar_ids: ['bram@agenda'], signature_email: 'bram@nextgenmedia.be',
})
tabellen.sales_pipelines.push({ id: 'p-ngm', key: 'nextgenmedia', name: 'NextGenMedia', clickup_list_id: 'L-NGM', default_calendar_id: AGENDA })
tabellen.app_settings = []

const overmorgen = dag(new Date(Date.now() + 2 * 86400e3).toISOString())
const ADRES = 'Kerkstraat 12, 3500 Hasselt'

function meeting(extra: Partial<MeetingRij> = {}): MeetingRij {
  const r = {
    id: crypto.randomUUID(), aanvraag_sleutel: crypto.randomUUID(), client_id: null, klant_naam: 'Bakkerij Peeters', titel: 'Opnameplan voorjaar',
    beschrijving: 'We overlopen de shotlist en de planning.', starts_at: zoneNaarIso(overmorgen, '14:00'), ends_at: zoneNaarIso(overmorgen, '15:00'),
    agenda_id: AGENDA, organisator_naam: 'Bram', organisator_email: 'bram@nextgenmedia.be',
    klant_ontvangers: [{ naam: 'Ann Peeters', email: 'ann@peeters.be' }], deelnemers: [{ naam: 'Jan Peeters', email: 'jan@peeters.be' }],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: null, created_by_email: 'test',
    ...extra,
  }
  tabellen.klant_meetings.push({ ...r, bron: 'intern', status: 'ingepland', tijdzone: 'Europe/Brussels', herinnering_aan: true, google_status: 'wacht', clickup_status: 'wacht',
    google_event_id: null, google_calendar_id: null, meet_url: null, vorm: 'online', locatie: null, met_meet: true, ...extra })
  return tabellen.klant_meetings[tabellen.klant_meetings.length - 1] as MeetingRij
}

async function main() {
  console.log('\nMeeting Inplanner — online of op locatie, mail aan deelnemers\n')

  await test('1. Online is de standaard; op locatie vraagt een adres; Meet bij locatie enkel als je die kiest', () => {
    assert.deepEqual(valideerVorm({}), { ok: true, vorm: 'online', locatie: null, metMeet: true })
    assert.deepEqual(valideerVorm({ vorm: 'online', locatie: 'genegeerd', met_meet: false }), { ok: true, vorm: 'online', locatie: null, metMeet: true })
    assert.equal(valideerVorm({ vorm: 'locatie', locatie: ' ' }).ok, false)
    assert.deepEqual(valideerVorm({ vorm: 'locatie', locatie: 'Kerkstraat 12\n3500 Hasselt' }), { ok: true, vorm: 'locatie', locatie: ADRES, metMeet: false })
    assert.equal((valideerVorm({ vorm: 'locatie', locatie: ADRES, met_meet: true }) as { metMeet: boolean }).metMeet, true)
    assert.equal(valideerVorm({ vorm: 'ergens' }).ok, false)
    const v = valideerMeeting({ titel: 'X', dag: overmorgen, uur: '10:00', duur_minuten: 30, klant_ontvangers: [{ email: 'a@b.be' }], vorm: 'locatie' })
    assert.equal(v.ok, false, 'zonder adres geen meeting op locatie')
  })

  await test('2. Adres uit het klantdossier; "Waar" in één zin', () => {
    assert.equal(klantAdres({ adres_straat: 'Kerkstraat 12', adres_postcode: '3500', adres_gemeente: 'Hasselt', adres_land: 'België' }), ADRES)
    assert.equal(klantAdres({ adres_straat: 'Rue 1', adres_postcode: '75001', adres_gemeente: 'Paris', adres_land: 'Frankrijk' }), 'Rue 1, 75001 Paris, Frankrijk')
    assert.equal(klantAdres({}), null)
    assert.equal(waarTekst({ vorm: 'online' }), 'Online via Google Meet')
    assert.equal(waarTekst({ vorm: 'locatie', locatie: ADRES, met_meet: true }), `Op locatie: ${ADRES} (met Google Meet-link)`)
  })

  await test('3. Online ↔ locatie, ander adres of Meet erbij telt als wijziging', () => {
    const oud = { starts_at: zoneNaarIso(overmorgen, '14:00'), ends_at: zoneNaarIso(overmorgen, '15:00'), titel: 'X', beschrijving: null, klant_ontvangers: [{ naam: null, email: 'a@b.be' }], deelnemers: [], herinnering_aan: true, tijdzone: 'Europe/Brussels' }
    const basis = valideerMeeting({ titel: 'X', dag: overmorgen, uur: '14:00', duur_minuten: 60, klant_ontvangers: [{ email: 'a@b.be' }] })
    const locatie = valideerMeeting({ titel: 'X', dag: overmorgen, uur: '14:00', duur_minuten: 60, klant_ontvangers: [{ email: 'a@b.be' }], vorm: 'locatie', locatie: ADRES })
    assert.ok(basis.ok && locatie.ok)
    if (!basis.ok || !locatie.ok) return
    assert.equal(wijzigingen(oud, basis.waarde).iets, false, 'een oude meeting zonder vorm is online')
    assert.equal(wijzigingen(oud, locatie.waarde).plaats, true)
    assert.equal(wijzigingen({ ...oud, vorm: 'locatie', locatie: ADRES, met_meet: false }, locatie.waarde).iets, false)
    assert.equal(wijzigingen({ ...oud, vorm: 'locatie', locatie: 'Elders 1, 1000 Brussel', met_meet: false }, locatie.waarde).plaats, true)
  })

  await test('4. Op locatie zonder Meet: adres in de Google-afspraak, geen Meet-link', async () => {
    let m = meeting({ vorm: 'locatie', locatie: ADRES, met_meet: false })
    m = await stapGoogle(db, m)
    assert.equal(m.google_status, 'ok')
    assert.equal(m.meet_url, null)
    const ev = google.events.get(m.google_event_id!)!
    assert.equal(ev.location, ADRES)
    assert.equal(ev.conferenceData, undefined)
    assert.equal(ev.hangoutLink, undefined)
    assert.deepEqual(ev.attendees.map((a: { email: string }) => a.email), ['ann@peeters.be', 'jan@peeters.be'])
    assert.equal(stapMeet({ ...m, status: 'ingepland' }).label, 'Op locatie, geen Meet')
    const h = bouwHerinnering(m, m.klant_ontvangers)
    assert.match(h.tekst, /Locatie:\nKerkstraat 12, 3500 Hasselt/)
    assert.doesNotMatch(h.tekst, /Google Meet/)
    assert.match(clickupOmschrijving(m, 'https://app'), /Locatie: Kerkstraat 12, 3500 Hasselt/)
    assert.doesNotMatch(clickupOmschrijving(m, 'https://app'), /Google Meet/)
  })

  await test('5. Op locatie met Meet erbij: adres én een echte Meet-link', async () => {
    let m = meeting({ vorm: 'locatie', locatie: ADRES, met_meet: true })
    m = await stapGoogle(db, m)
    assert.match(m.meet_url ?? '', /^https:\/\/meet\.google\.com\//)
    assert.equal(google.events.get(m.google_event_id!)!.location, ADRES)
  })

  await test('6. Online: Meet-link, geen adres; daarna naar locatie zonder Meet en terug', async () => {
    let m = meeting()
    m = await stapGoogle(db, m)
    const eventId = m.google_event_id!
    assert.match(m.meet_url ?? '', /^https:\/\/meet\.google\.com\//)
    assert.equal(google.events.get(eventId)!.location, undefined)
    // Naar locatie zonder Meet: zelfde afspraak, adres erbij, Meet-link eraf.
    m = await bewaarMeeting(db, m.id, { vorm: 'locatie', locatie: ADRES, met_meet: false })
    m = await stapGoogle(db, m, { bijwerken: true })
    assert.equal(m.google_event_id, eventId)
    assert.equal(m.meet_url, null)
    assert.equal(google.events.get(eventId)!.location, ADRES)
    assert.equal(google.events.get(eventId)!.hangoutLink, undefined)
    // Terug online: adres weg, nieuwe Meet-link.
    m = await bewaarMeeting(db, m.id, { vorm: 'online', locatie: null, met_meet: true })
    m = await stapGoogle(db, m, { bijwerken: true })
    assert.equal(m.google_event_id, eventId)
    assert.equal(google.events.get(eventId)!.location, '')
    assert.match(m.meet_url ?? '', /^https:\/\/meet\.google\.com\//)
    assert.equal((await leesMeeting(db, m.id))!.meet_url, m.meet_url)
  })

  await test('7. Mailvoorstel online: iedereen als ontvanger, datum, tijdzone, duur, Meet, organisator, briefing', () => {
    const v = meetingMailVoorstel({ ...meeting(), meet_url: 'https://meet.google.com/abc-defg-hij' })
    assert.deepEqual(v.aan, ['ann@peeters.be', 'jan@peeters.be'])
    assert.match(v.onderwerp, /^Meeting op .+ om 14:00: Opnameplan voorjaar$/)
    assert.match(v.tekst, /^Beste Ann en Jan,/)
    assert.match(v.tekst, /om 14:00 \(Belgische tijd\), 60 minuten/)
    assert.match(v.tekst, /Waar: online via Google Meet\nhttps:\/\/meet\.google\.com\/abc-defg-hij/)
    assert.match(v.tekst, /Organisator: Bram \(bram@nextgenmedia\.be\)/)
    assert.match(v.tekst, /Waarover gaat het\?\nWe overlopen de shotlist/)
    assert.equal(v.ctaLink, 'https://meet.google.com/abc-defg-hij')
  })

  await test('8. Mailvoorstel op locatie: adres en routeknop, geen Meet; zonder briefing een in te vullen plek', () => {
    const v = meetingMailVoorstel({ ...meeting(), vorm: 'locatie', locatie: ADRES, met_meet: false, meet_url: null, beschrijving: null })
    assert.match(v.tekst, /Waar: Kerkstraat 12, 3500 Hasselt/)
    assert.doesNotMatch(v.tekst, /meet\.google/)
    assert.ok(v.tekst.includes(BRIEFING_PLAATSHOUDER))
    assert.equal(v.ctaTekst, 'Route in Google Maps')
    assert.equal(v.ctaLink, routeLink(ADRES))
    const metMeet = meetingMailVoorstel({ ...meeting(), vorm: 'locatie', locatie: ADRES, met_meet: true, meet_url: 'https://meet.google.com/x' })
    assert.match(metMeet.tekst, /Liever online\? Neem deel via Google Meet: https:\/\/meet\.google\.com\/x/)
  })

  await test('9. Ontvangers en afzender lezen', () => {
    assert.deepEqual(splitsAdressen('Ann@Peeters.be, jan@peeters.be; ann@peeters.be\n'), ['ann@peeters.be', 'jan@peeters.be'])
    assert.equal(adresUit('NextGenMedia <info@nextgenmedia.be>'), 'info@nextgenmedia.be')
    assert.equal(adresUit('castermansmarco2504@gmail.com'), 'castermansmarco2504@gmail.com')
  })

  await test('10. Mail met een niet ingevulde briefing of zonder geldig adres: niets verstuurd', async () => {
    const m = meeting({ beschrijving: null })
    const v = meetingMailVoorstel(m)
    const voor = resend.verstuurd.length
    const r1 = await verstuurMeetingMail(db, m, { aan: v.aan, onderwerp: v.onderwerp, tekst: v.tekst, verzend_sleutel: crypto.randomUUID() }, { userId: null, email: 'test' })
    assert.equal(r1.ok, false)
    assert.match(!r1.ok ? r1.fout : '', /tussen \{\{ \}\}/)
    const r2 = await verstuurMeetingMail(db, m, { aan: 'geen-adres', onderwerp: 'X', tekst: 'Y', verzend_sleutel: crypto.randomUUID() }, { userId: null, email: 'test' })
    assert.equal(r2.ok, false)
    assert.equal(resend.verstuurd.length, voor)
  })

  await test('11. Domein niet geverifieerd bij Resend: niets verstuurd, wel precies wat er nodig is', async () => {
    resend.domeinen = [{ name: 'nextgenmedia.be', status: 'pending' }]
    const m = meeting()
    const voor = resend.verstuurd.length
    const r = await verstuurMeetingMail(db, m, { aan: 'ann@peeters.be', onderwerp: 'X', tekst: 'Y', verzend_sleutel: crypto.randomUUID() }, { userId: null, email: 'test' })
    assert.equal(r.ok, false)
    assert.match(!r.ok ? r.fout : '', /nog niet geverifieerd[^]*Level27[^]*niets verstuurd/)
    assert.equal(resend.verstuurd.length, voor)
    assert.equal(tabellen.email_messages.filter((x) => x.related_id === m.id).length, 0)
  })

  await test('12. Versturen: vanuit info@, naar alle deelnemers, kopie naar info@, gelogd; dubbele klik verstuurt één keer', async () => {
    resend.domeinen = [{ name: 'nextgenmedia.be', status: 'verified' }]
    const m = meeting({ meet_url: 'https://meet.google.com/abc-defg-hij' })
    const v = meetingMailVoorstel(m)
    const sleutel = crypto.randomUUID()
    const invoer = { aan: v.aan.join(', '), onderwerp: v.onderwerp, tekst: v.tekst, cta_tekst: v.ctaTekst, cta_link: v.ctaLink, verzend_sleutel: sleutel, kopie_info: true }
    const voor = resend.verstuurd.length
    const r = await verstuurMeetingMail(db, m, invoer, { userId: null, email: 'bram@nextgenmedia.be' })
    assert.ok(r.ok)
    const mail = resend.verstuurd[voor]
    assert.equal(mail.from, 'NextGenMedia <info@nextgenmedia.be>')
    assert.deepEqual(mail.to, ['ann@peeters.be', 'jan@peeters.be'])
    assert.deepEqual(mail.bcc, ['info@nextgenmedia.be'])
    assert.match(String(mail.text), /meet\.google\.com\/abc-defg-hij/)
    const log = tabellen.email_messages.filter((x) => x.related_id === m.id)
    assert.equal(log.length, 1)
    assert.equal(log[0].kind, 'meeting_mail')
    assert.equal(log[0].status, 'sent')
    assert.equal(log[0].from_email, 'NextGenMedia <info@nextgenmedia.be>')
    const nog = await verstuurMeetingMail(db, m, invoer, { userId: null, email: 'bram@nextgenmedia.be' })
    assert.ok(nog.ok && nog.al_verstuurd)
    assert.equal(resend.verstuurd.length, voor + 1)
  })

  console.log(`\n${n} tests geslaagd\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })
