// Agenda: uitnodigingen uit de mail lezen (agendabestand van Teams, Google, Zoom).
// Uitvoeren: npx tsx tests/agenda-ics.test.ts
import assert from 'node:assert/strict'
import { leesIcs, vergaderLink, kuisBeschrijving, zoneVan } from '../lib/agenda/ics'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nAgenda: uitnodigingen\n')

const TEAMS = [
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'PRODID:Microsoft Exchange Server 2010',
  'BEGIN:VTIMEZONE',
  'TZID:Romance Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'ORGANIZER;CN=Jan Peeters:mailto:jan@kilowot.be',
  'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Bram Reinq',
  ' uin:mailto:Bram@NextGenMedia.be',
  'ATTENDEE;CN="Marco, C.":mailto:marco@nextgenmedia.be',
  'DESCRIPTION;LANGUAGE=nl-BE:Agenda: opstart campagne\\nTweede regel\\n_______________',
  ' _________________________________\\nMicrosoft Teams-vergadering\\nDeelnemen: https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d\\n',
  'UID:040000008200E00074C5B7101A82E00800000000',
  'SUMMARY;LANGUAGE=nl-BE:Opstart\\, campagne Kilowot',
  'DTSTART;TZID=Romance Standard Time:20261126T140000',
  'DTEND;TZID=Romance Standard Time:20261126T150000',
  'LOCATION;LANGUAGE=nl-BE:Microsoft Teams-vergadering',
  'X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d',
  'BEGIN:VALARM',
  'DESCRIPTION:REMINDER',
  'TRIGGER;RELATED=START:-PT15M',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

test('Teams: titel, tijd in Belgische tijd, link, organisator en deelnemers', () => {
  const [e] = leesIcs(TEAMS)
  assert.equal(e.titel, 'Opstart, campagne Kilowot')
  assert.equal(e.start_op, '2026-11-26T13:00:00.000Z') // 14:00 in Brussel (wintertijd)
  assert.equal(e.eind_op, '2026-11-26T14:00:00.000Z')
  assert.equal(e.platform, 'teams')
  assert.match(e.meet_url ?? '', /^https:\/\/teams\.microsoft\.com\/l\/meetup-join\//)
  assert.equal(e.locatie, 'Microsoft Teams-vergadering')
  assert.deepEqual(e.organisator, { naam: 'Jan Peeters', email: 'jan@kilowot.be' })
  assert.deepEqual(e.deelnemers.map((d) => d.email), ['bram@nextgenmedia.be', 'marco@nextgenmedia.be'])
  assert.equal(e.deelnemers[1].naam, 'Marco, C.')
  assert.equal(e.beschrijving, 'Agenda: opstart campagne\nTweede regel')
  assert.equal(e.geannuleerd, false)
  assert.equal(e.methode, 'REQUEST')
})

test('annulering, UTC-tijd, hele dag en duur', () => {
  const ics = 'BEGIN:VCALENDAR\nMETHOD:CANCEL\nBEGIN:VEVENT\nUID:x1\nSUMMARY:Weg\nDTSTART:20260701T080000Z\nDURATION:PT45M\nSTATUS:CANCELLED\nEND:VEVENT\nBEGIN:VEVENT\nUID:x2\nSUMMARY:Beurs\nDTSTART;VALUE=DATE:20260702\nDTEND;VALUE=DATE:20260703\nEND:VEVENT\nEND:VCALENDAR'
  const [a, b] = leesIcs(ics)
  assert.equal(a.geannuleerd, true)
  assert.equal(a.start_op, '2026-07-01T08:00:00.000Z')
  assert.equal(a.eind_op, '2026-07-01T08:45:00.000Z')
  assert.equal(b.heel_dag, true)
  assert.equal(b.start_op, '2026-07-01T22:00:00.000Z') // middernacht in Brussel (zomertijd)
})

test('vergaderlink uit gewone tekst (Meet, Zoom), zonder leestekens erachter', () => {
  assert.deepEqual(vergaderLink('Link: https://meet.google.com/abc-defg-hij.'), { url: 'https://meet.google.com/abc-defg-hij', platform: 'meet' })
  assert.equal(vergaderLink('https://us02web.zoom.us/j/8123456789?pwd=abc>')?.platform, 'zoom')
  assert.equal(vergaderLink('geen link hier'), null)
})

test('tijdzones en het Teams-blok onderaan', () => {
  assert.equal(zoneVan('Romance Standard Time'), 'Europe/Brussels')
  assert.equal(zoneVan('Europe/Paris'), 'Europe/Paris')
  assert.equal(zoneVan('(UTC+01:00) Brussels, Copenhagen, Madrid, Paris'), 'Europe/Brussels')
  assert.equal(zoneVan(undefined), 'Europe/Brussels')
  assert.equal(kuisBeschrijving('Hallo\n\nJoin Zoom Meeting\nhttps://zoom.us/j/1'), 'Hallo')
  assert.equal(kuisBeschrijving('[https://www.hogeschoolpxl.be/Assets/Footer.png]'), '')
  assert.equal(kuisBeschrijving('Agenda [cid:image001.png@01DC]\nPunt 1'), 'Agenda \nPunt 1'.replace(' \n', '\n'))
})

console.log(`\n${n} tests geslaagd\n`)
