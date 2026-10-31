// Workshops & events: validatie, prijs en akkoord, deelnemers, aftelling,
// agendabestand, mails en wanneer de herinnering vertrekt.
//
//   npx tsx tests/events.test.ts

import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
import {
  valideerEvent, leesPrijs, akkoordTekst, prijsTekst, valideerDeelnemers, inschrijvingOpen, inschrijfFout,
  aftelling, bouwIcs, googleAgendaLink, bevestigingsMail, herinneringsMail, herinneringNodig, belangrijkeWijziging,
  googleEventIdVoor, naarFormulier, soortLabel, type KlantEvent,
} from '../lib/events'
import { PORTAL_MODULES, STANDAARD_AAN, MODULE_IMPLEMENTED, MODULE_ACTIONS } from '../lib/portal-permissions'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nWorkshops & events\n')

const NU = new Date('2026-11-02T09:00:00Z')
const basis = { titel: 'Workshop Instagram Reels', soort: 'workshop', datum: '2026-11-17', start: '14:00', einde: '16:30', vorm: 'online' }

const ev = (over: Partial<KlantEvent> = {}): KlantEvent => ({
  id: '11111111-2222-4333-8444-555555555555', titel: 'Workshop Instagram Reels', soort: 'workshop', status: 'gepubliceerd',
  samenvatting: 'Leer in twee uur scrollstoppende reels maken.', beschrijving: null, cover_pad: null, spreker: 'Bram',
  start_op: '2026-11-17T13:00:00.000Z', einde_op: '2026-11-17T15:30:00.000Z', tijdzone: 'Europe/Brussels',
  vorm: 'online', locatie: null, met_meet: true, capaciteit: 20, prijs_cents: 9500, inschrijven_tot: null,
  agenda_id: null, google_calendar_id: null, google_event_id: null, google_ical_uid: 'ngmev1@google.com', meet_url: 'https://meet.google.com/abc-defg-hij',
  google_status: 'ok', google_fout: null, inschrijving_versie: 0, google_sync_versie: 0, gepubliceerd_op: null, geannuleerd_op: null,
  created_by_email: null, created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z', ...over,
})

test('1. Event: Brusselse tijd wordt UTC (wintertijd), online heeft altijd Meet, leeg = gratis en onbeperkt', () => {
  const v = valideerEvent(basis, NU)
  assert.ok(v.ok)
  if (!v.ok) return
  assert.equal(v.waarde.start_op, '2026-11-17T13:00:00.000Z')
  assert.equal(v.waarde.einde_op, '2026-11-17T15:30:00.000Z')
  assert.equal(v.waarde.met_meet, true)
  assert.equal(v.waarde.prijs_cents, 0)
  assert.equal(v.waarde.capaciteit, null)
  assert.deepEqual(naarFormulier(ev()).start, '14:00')
})

test('2. Event: verplichte velden, einde na start, verleden enkel voor een bestaand event, adres bij locatie', () => {
  assert.match((valideerEvent({ ...basis, titel: 'x' }, NU) as { fout: string }).fout, /titel/)
  assert.match((valideerEvent({ ...basis, soort: 'feest' }, NU) as { fout: string }).fout, /wat voor event/)
  assert.match((valideerEvent({ ...basis, einde: '13:00' }, NU) as { fout: string }).fout, /na het beginuur/)
  assert.match((valideerEvent({ ...basis, datum: '2026-10-01' }, NU) as { fout: string }).fout, /voorbij/)
  assert.ok(valideerEvent({ ...basis, datum: '2026-10-01' }, NU, { bestaand: true }).ok)
  assert.match((valideerEvent({ ...basis, vorm: 'locatie' }, NU) as { fout: string }).fout, /adres/)
  const loc = valideerEvent({ ...basis, vorm: 'locatie', locatie: 'Kerkstraat 1, 2000 Antwerpen', met_meet: false }, NU)
  assert.ok(loc.ok && loc.waarde.met_meet === false && loc.waarde.locatie === 'Kerkstraat 1, 2000 Antwerpen')
  const meerdaags = valideerEvent({ ...basis, soort: 'opleiding', einddatum: '2026-11-18', einde: '17:00' }, NU)
  assert.ok(meerdaags.ok)
  assert.match((valideerEvent({ ...basis, inschrijven_tot: '2026-11-20' }, NU) as { fout: string }).fout, /ten laatste/)
  assert.match((valideerEvent({ ...basis, capaciteit: '0' }, NU) as { fout: string }).fout, /plaatsen/)
  assert.match((valideerEvent({ ...basis, cover_pad: 'nieuws/2026-10/11111111-1111-4111-8111-111111111111.jpg' }, NU) as { fout: string }).fout, /coverfoto/)
})

test('3. Prijs: Belgische schrijfwijze, gratis, ongeldig', () => {
  assert.equal(leesPrijs('95'), 9500)
  assert.equal(leesPrijs('95,50'), 9550)
  assert.equal(leesPrijs('€ 1.250'), 125000)
  assert.equal(leesPrijs('1.250,75'), 125075)
  assert.equal(leesPrijs(''), 0)
  assert.equal(leesPrijs('gratis'), null)
  assert.equal(prijsTekst(0), 'Gratis')
  assert.equal(prijsTekst(9500), '€ 95 excl. btw')
  assert.equal(prijsTekst(9550), '€ 95,50 excl. btw')
})

test('4. Akkoord: Peppol-factuur met bedrag per deelnemer en totaal', () => {
  const t = akkoordTekst(ev(), 2)
  assert.match(t, /Peppol-factuur/)
  assert.match(t, /€ 95 excl\. btw per deelnemer/)
  assert.match(t, /2 deelnemers: € 190 excl\. btw/)
  assert.doesNotMatch(akkoordTekst(ev(), 1), /deelnemers:/)
})

test('5. Deelnemers: ikzelf plus collega\'s, geen dubbels, maximum vijf', () => {
  const ik = { naam: 'Jan Peeters', email: 'Jan@Bakkerij.be' }
  const r = valideerDeelnemers(ik, [{ naam: 'Els', email: 'els@bakkerij.be' }, { naam: '', email: '' }])
  assert.ok(r.ok && r.lijst.length === 2 && r.lijst[0].email === 'jan@bakkerij.be')
  assert.match((valideerDeelnemers(ik, [{ naam: 'Jan 2', email: 'jan@bakkerij.be' }]) as { fout: string }).fout, /staat er al bij/)
  assert.match((valideerDeelnemers(ik, [{ naam: 'Els', email: 'geen-mail' }]) as { fout: string }).fout, /geen geldig/)
  const veel = Array.from({ length: 5 }, (_, i) => ({ naam: `Collega ${i}`, email: `c${i}@x.be` }))
  assert.match((valideerDeelnemers(ik, veel) as { fout: string }).fout, /maximaal 5/)
})

test('6. Inschrijving open: concept, geannuleerd, voorbij, gesloten, volzet; vrije plaatsen', () => {
  const nu = Date.parse('2026-11-10T10:00:00Z')
  assert.deepEqual(inschrijvingOpen(ev(), 5, nu), { open: true, vrij: 15 })
  assert.deepEqual(inschrijvingOpen(ev({ capaciteit: null }), 5, nu), { open: true, vrij: null })
  assert.deepEqual(inschrijvingOpen(ev(), 20, nu), { open: false, reden: 'volzet' })
  assert.deepEqual(inschrijvingOpen(ev({ status: 'concept' }), 0, nu), { open: false, reden: 'concept' })
  assert.deepEqual(inschrijvingOpen(ev({ status: 'geannuleerd' }), 0, nu), { open: false, reden: 'geannuleerd' })
  assert.deepEqual(inschrijvingOpen(ev({ inschrijven_tot: '2026-11-09T22:59:00Z' }), 0, nu), { open: false, reden: 'gesloten' })
  assert.deepEqual(inschrijvingOpen(ev(), 0, Date.parse('2026-11-17T13:00:00Z')), { open: false, reden: 'voorbij' })
  assert.match(inschrijfFout('volzet', { vrij: 1 }), /nog 1 plaats/)
})

test('7. Aftelling: dagen, uren, minuten, bezig, afgelopen', () => {
  const s = '2026-11-17T13:00:00.000Z', e = '2026-11-17T15:30:00.000Z'
  assert.equal(aftelling(s, e, Date.parse('2026-11-05T13:00:00Z')).tekst, 'Nog 12 dagen')
  assert.equal(aftelling(s, e, Date.parse('2026-11-16T12:00:00Z')).tekst, 'Nog 1 dag')
  assert.equal(aftelling(s, e, Date.parse('2026-11-17T08:00:00Z')).tekst, 'Nog 5 uur')
  assert.equal(aftelling(s, e, Date.parse('2026-11-17T12:40:00Z')).tekst, 'Nog 20 minuten')
  assert.equal(aftelling(s, e, Date.parse('2026-11-17T14:00:00Z')).tekst, 'Nu bezig')
  assert.equal(aftelling(s, e, Date.parse('2026-11-17T16:00:00Z')).tekst, 'Afgelopen')
})

test('8. Agendabestand: UTC-tijden, Meet-link, zelfde UID als Google, regels gevouwen, tekst geëscapet', () => {
  const ics = bouwIcs(ev({ titel: 'Reels, tips; en meer' }), { appLink: 'https://app.nextgenmedia.be/portal/events/x', nu: NU })
  assert.match(ics, /DTSTART:20261117T130000Z\r\n/)
  assert.match(ics, /DTEND:20261117T153000Z\r\n/)
  assert.match(ics, /UID:ngmev1@google\.com/)
  assert.match(ics, /SUMMARY:Reels\\, tips\\; en meer/)
  assert.match(ics, /LOCATION:https:\/\/meet\.google\.com\/abc-defg-hij/)
  assert.ok(ics.split('\r\n').every((r) => r.length <= 75), 'geen regel langer dan 75 tekens')
  const g = googleAgendaLink(ev(), 'https://app.nextgenmedia.be/portal/events/x')
  assert.match(g, /dates=20261117T130000Z%2F20261117T153000Z/)
  assert.equal(googleEventIdVoor('11111111-2222-4333-8444-555555555555'), 'ngmev11111111222243338444555555555555')
  assert.match(googleEventIdVoor('11111111-2222-4333-8444-555555555555'), /^[a-v0-9]{5,1024}$/, 'geldige Google-event-id (base32hex)')
})

test('9. Mails: bevestiging met Meet-link en factuurmelding; herinnering "morgen" met Meet als knop', () => {
  const app = 'https://app.nextgenmedia.be/portal/events/x'
  const b = bevestigingsMail(ev(), { naam: 'Jan Peeters', email: 'jan@x.be' }, { appLink: app })
  assert.equal(b.onderwerp, 'Je bent ingeschreven: Workshop Instagram Reels')
  assert.match(b.tekst, /^Hoi Jan,/)
  assert.match(b.tekst, /Google Meet: https:\/\/meet\.google\.com\/abc-defg-hij/)
  assert.match(b.tekst, /Peppol-factuur van € 95 excl\. btw/)
  const gratis = bevestigingsMail(ev({ prijs_cents: 0, vorm: 'locatie', locatie: 'Kerkstraat 1, Antwerpen', met_meet: false, meet_url: null }), { naam: 'Els', email: 'els@x.be' }, { appLink: app, doorAnder: 'Jan Peeters' })
  assert.match(gratis.tekst, /Jan Peeters heeft je ingeschreven/)
  assert.match(gratis.tekst, /Waar: Kerkstraat 1, Antwerpen/)
  assert.doesNotMatch(gratis.tekst, /factuur|Meet/)
  const h = herinneringsMail(ev(), { naam: 'Jan Peeters', email: 'jan@x.be' }, { appLink: app, nu: new Date('2026-11-16T14:00:00Z') })
  assert.equal(h.onderwerp, 'Morgen: Workshop Instagram Reels')
  assert.match(h.tekst, /begint morgen om 14:00/)
  assert.equal(h.ctaLink, 'https://meet.google.com/abc-defg-hij')
})

test('10. Herinnering: vanaf 24 uur vooraf, niet voor wie net inschreef, niet meer vlak voor de start', () => {
  const i = { created_at: '2026-11-01T10:00:00Z', status: 'ingeschreven' as const, herinnering_status: 'gepland' as const }
  assert.equal(herinneringNodig(ev(), i, Date.parse('2026-11-15T13:00:00Z')), 'later')
  assert.equal(herinneringNodig(ev(), i, Date.parse('2026-11-16T14:00:00Z')), 'nu')
  assert.equal(herinneringNodig(ev(), i, Date.parse('2026-11-17T12:50:00Z')), 'nooit')
  assert.equal(herinneringNodig(ev(), { ...i, created_at: '2026-11-17T11:00:00Z' }, Date.parse('2026-11-17T11:05:00Z')), 'nooit')
  assert.equal(herinneringNodig(ev({ status: 'geannuleerd' }), i, Date.parse('2026-11-16T14:00:00Z')), 'nooit')
  assert.equal(herinneringNodig(ev(), { ...i, herinnering_status: 'verzonden' }, Date.parse('2026-11-16T14:00:00Z')), 'nooit')
})

test('11. Wijziging van tijd, plaats of titel verwittigt de deelnemers; een andere omschrijving niet', () => {
  const v = valideerEvent(basis, NU)
  assert.ok(v.ok)
  if (!v.ok) return
  assert.equal(belangrijkeWijziging(ev(), v.waarde), false)
  assert.equal(belangrijkeWijziging(ev(), { ...v.waarde, start_op: '2026-11-17T14:00:00.000Z' }), true)
  assert.equal(belangrijkeWijziging(ev(), { ...v.waarde, vorm: 'locatie', locatie: 'Gent' }), true)
})

test('11b. Eigen soort: "andere" vraagt een label en toont dat overal', () => {
  assert.match((valideerEvent({ ...basis, soort: 'andere', soort_label: '' }, NU) as { fout: string }).fout, /Masterclass/)
  const v = valideerEvent({ ...basis, soort: 'andere', soort_label: 'Masterclass' }, NU)
  assert.ok(v.ok && v.waarde.soort_label === 'Masterclass')
  assert.equal(soortLabel({ soort: 'andere', soort_label: 'Masterclass' }), 'Masterclass')
  assert.equal(soortLabel({ soort: 'workshop', soort_label: 'genegeerd' }), 'Workshop')
  assert.match(bevestigingsMail({ ...ev(), soort: 'andere', soort_label: 'Masterclass' }, { naam: 'Jan', email: 'jan@x.be' }, { appLink: 'https://x' }).tekst, /voor de masterclass "/)
})

test('12. Klantapp-module Workshops & events bestaat, werkt en staat standaard aan', () => {
  assert.ok((PORTAL_MODULES as readonly string[]).includes('events'))
  assert.equal(MODULE_IMPLEMENTED.events, true)
  assert.ok(STANDAARD_AAN.includes('events'))
  assert.deepEqual([...MODULE_ACTIONS.events], ['view', 'inschrijven'])
})

console.log(`\n${n} tests geslaagd\n`)
