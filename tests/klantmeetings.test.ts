// Klantmeetings — validatie, Belgische tijd, herinneringsmoment, mail en ClickUp.
//
//   npx tsx tests/klantmeetings.test.ts

import assert from 'node:assert/strict'
import {
  valideerMeeting, kiesHerinnering, magNogVersturen, herinneringsMail, googleEventId, clickupMarker,
  clickupTaakNaam, clickupOmschrijving, genodigden, googleOmschrijving, stapAgenda, stapMeet, stapClickup,
  stapHerinnering, wijzigingen, normaliseerPersonen, isEmail, wanneer, uur, dag, duurMinuten,
} from '../lib/meetings/model'
import { buildEmailHtml } from '../lib/email-html'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }

console.log('\nKlantmeetings\n')

const NU = new Date('2026-10-20T08:00:00.000Z') // dinsdag 20 okt, 10:00 in Brussel (zomertijd)
const basis = {
  titel: 'Contentplanning Q1', beschrijving: 'Planning overlopen', dag: '2026-10-22', uur: '14:00', duur_minuten: 60,
  klant_ontvangers: [{ naam: 'Rob Hasevoets', email: 'Rob@Voorbeeld.be ' }], deelnemers: [{ naam: 'Sam', email: 'sam@nextgenmedia.be' }],
}

test('1. Geldige meeting: tijden in Brussel naar UTC, e-mail opgeschoond', () => {
  const r = valideerMeeting(basis, NU)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.waarde.startsAt, '2026-10-22T12:00:00.000Z') // 14:00 zomertijd = UTC+2
  assert.equal(r.waarde.endsAt, '2026-10-22T13:00:00.000Z')
  assert.deepEqual(r.waarde.klant_ontvangers, [{ naam: 'Rob Hasevoets', email: 'rob@voorbeeld.be' }])
  assert.equal(r.waarde.herinnering_aan, true)
})

test('2. Zomer- en wintertijd: 25 okt 2026 schuift de klok een uur terug', () => {
  const voor = valideerMeeting({ ...basis, dag: '2026-10-24', uur: '10:00' }, NU)
  const na = valideerMeeting({ ...basis, dag: '2026-10-26', uur: '10:00' }, NU)
  assert.ok(voor.ok && na.ok)
  if (!voor.ok || !na.ok) return
  assert.equal(voor.waarde.startsAt, '2026-10-24T08:00:00.000Z')
  assert.equal(na.waarde.startsAt, '2026-10-26T09:00:00.000Z')
  assert.equal(uur(na.waarde.startsAt), '10:00')
  assert.equal(dag(na.waarde.startsAt), '2026-10-26')
  // Lente 2027: 28 maart gaat de klok vooruit.
  const lente = valideerMeeting({ ...basis, dag: '2027-03-29', uur: '09:30' }, NU)
  assert.ok(lente.ok)
  if (lente.ok) assert.equal(lente.waarde.startsAt, '2027-03-29T07:30:00.000Z')
})

test('3. Geen of ongeldig klantadres blokkeert het inplannen', () => {
  const geen = valideerMeeting({ ...basis, klant_ontvangers: [] }, NU)
  assert.equal(geen.ok, false)
  if (!geen.ok) assert.match(geen.fout, /geen e-mailadres voor de klant/)
  const slecht = valideerMeeting({ ...basis, klant_ontvangers: [{ naam: 'X', email: 'rob@voorbeeld' }] }, NU)
  assert.equal(slecht.ok, false)
  const slechtDeel = valideerMeeting({ ...basis, deelnemers: [{ naam: null, email: 'iemand at nergens' }] }, NU)
  assert.equal(slechtDeel.ok, false)
  if (!slechtDeel.ok) assert.match(slechtDeel.fout, /deelnemer/)
})

test('4. Titel, datum, tijd, duur en verleden worden gecontroleerd', () => {
  assert.equal(valideerMeeting({ ...basis, titel: '  ' }, NU).ok, false)
  assert.equal(valideerMeeting({ ...basis, dag: '22-10-2026' }, NU).ok, false)
  assert.equal(valideerMeeting({ ...basis, uur: '25:00' }, NU).ok, false)
  assert.equal(valideerMeeting({ ...basis, duur_minuten: 0 }, NU).ok, false)
  assert.equal(valideerMeeting({ ...basis, duur_minuten: 9 * 60 }, NU).ok, false)
  const verleden = valideerMeeting({ ...basis, dag: '2026-10-20', uur: '09:00' }, NU)
  assert.equal(verleden.ok, false)
  if (!verleden.ok) assert.match(verleden.fout, /verleden/)
})

test('5. Wie zowel klantontvanger als deelnemer is, staat er maar één keer in', () => {
  const r = valideerMeeting({ ...basis, deelnemers: [{ naam: 'Rob', email: 'rob@voorbeeld.be' }, { naam: 'Sam', email: 'SAM@nextgenmedia.be' }, { naam: 'Sam 2', email: 'sam@nextgenmedia.be' }] }, NU)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.deepEqual(r.waarde.deelnemers.map((p) => p.email), ['sam@nextgenmedia.be'])
  assert.deepEqual(genodigden(r.waarde).map((g) => g.email), ['rob@voorbeeld.be', 'sam@nextgenmedia.be'])
  assert.deepEqual(normaliseerPersonen('x'), [])
  assert.equal(isEmail('a@b.be'), true)
  assert.equal(isEmail('a@b'), false)
})

test('6. Herinnering: standaard 24 uur vooraf', () => {
  const h = kiesHerinnering('2026-10-22T12:00:00.000Z', NU)
  assert.deepEqual(h, { moment: '24u', label: '24 uur vooraf', geplandVoor: '2026-10-21T12:00:00.000Z' })
})

test('7. Laat ingepland: nooit met terugwerkende kracht, dan 2 uur vooraf, anders geen', () => {
  // Meeting over 5 uur: 24u-moment ligt in het verleden → 2 uur vooraf.
  const h = kiesHerinnering('2026-10-20T13:00:00.000Z', NU)
  assert.equal(h?.moment, '2u')
  assert.equal(h?.geplandVoor, '2026-10-20T11:00:00.000Z')
  // Meeting over 2u10: 2u-moment valt binnen 15 minuten → geen herinnering.
  assert.equal(kiesHerinnering('2026-10-20T10:10:00.000Z', NU), null)
  // Meeting over 2u20: nog net 2 uur vooraf.
  assert.equal(kiesHerinnering('2026-10-20T10:20:00.000Z', NU)?.moment, '2u')
  // Nooit een tijdstip in het verleden.
  for (let min = 1; min < 3 * 24 * 60; min += 37) {
    const start = new Date(NU.getTime() + min * 60000).toISOString()
    const k = kiesHerinnering(start, NU)
    if (k) assert.ok(new Date(k.geplandVoor).getTime() > NU.getTime(), `verleden bij ${min} min`)
  }
})

test('8. 24 uur vooraf over de wintertijd heen = echte 24 uur', () => {
  const h = kiesHerinnering('2026-10-26T09:00:00.000Z', NU) // ma 26 okt 10:00
  assert.equal(h?.geplandVoor, '2026-10-25T09:00:00.000Z') // zo 25 okt 10:00 (al wintertijd)
  assert.equal(uur(h!.geplandVoor), '10:00')
})

test('9. Vlak voor de start vertrekt er geen herinnering meer', () => {
  const start = '2026-10-20T12:00:00.000Z'
  assert.equal(magNogVersturen(start, new Date('2026-10-20T11:00:00.000Z')), true)
  assert.equal(magNogVersturen(start, new Date('2026-10-20T11:50:00.000Z')), false)
  assert.equal(magNogVersturen(start, new Date('2026-10-20T12:30:00.000Z')), false)
})

test('10. Herinneringsmail: naam, titel, Brusselse tijd, Meet-link, agenda, organisator', () => {
  const m = herinneringsMail({
    klant_naam: 'ERA NOBIS', titel: 'Contentplanning Q1', starts_at: '2026-10-27T13:00:00.000Z',
    meet_url: 'https://meet.google.com/abc-defg-hij', beschrijving: 'Planning overlopen', organisator_naam: 'Ruben',
    ontvangers: [{ naam: 'Rob', email: 'rob@x.be' }, { naam: 'Lies', email: 'lies@x.be' }],
  })
  assert.equal(m.onderwerp, 'Herinnering: Contentplanning Q1 op di 27 okt om 14:00')
  assert.match(m.tekst, /^Beste Rob en Lies,/)
  assert.match(m.tekst, /dinsdag 27 oktober 2026 om 14:00 \(Belgische tijd\)/)
  assert.match(m.tekst, /https:\/\/meet\.google\.com\/abc-defg-hij/)
  assert.match(m.tekst, /Agenda:\nPlanning overlopen/)
  assert.match(m.tekst, /Ruben\nNextGenMedia$/)
  assert.equal(m.ctaLink, 'https://meet.google.com/abc-defg-hij')
  const html = buildEmailHtml({ bodyText: m.tekst, ctaText: m.ctaTekst, ctaLink: m.ctaLink })
  assert.match(html, /Deelnemen via Google Meet/)
})

test('11. Zonder namen of beschrijving: aanhef met de klantnaam, geen lege agenda', () => {
  const m = herinneringsMail({ klant_naam: 'ERA NOBIS', titel: 'Kennismaking', starts_at: '2026-10-27T13:00:00.000Z', meet_url: null, beschrijving: null, organisator_naam: null, ontvangers: [{ naam: null, email: 'info@x.be' }] })
  assert.match(m.tekst, /^Beste ERA NOBIS,/)
  assert.ok(!/Agenda/.test(m.tekst))
  assert.ok(!/Google Meet/.test(m.tekst))
  assert.equal(m.ctaLink, null)
  assert.match(m.tekst, /Tot dan,\nNextGenMedia$/)
})

test('12. Vaste Google event-id: enkel tekens die Google aanvaardt', () => {
  const id = googleEventId('1F2E3D4C-5b6a-4789-9abc-def012345678')
  assert.equal(id, 'ngm1f2e3d4c5b6a47899abcdef012345678')
  assert.match(id, /^[a-v0-9]{5,1024}$/)
  assert.equal(googleEventId('1F2E3D4C-5b6a-4789-9abc-def012345678'), id)
  assert.equal(googleOmschrijving({ beschrijving: null }), 'Ingepland door NextGenMedia.')
})

test('13. ClickUp: zelfde naamopbouw als afspraken, referentie om dubbels te vermijden', () => {
  const m = {
    id: 'abc', klant_naam: 'ERA NOBIS', titel: 'Kennismaking', starts_at: '2026-10-27T13:00:00.000Z', ends_at: '2026-10-27T13:30:00.000Z',
    meet_url: 'https://meet.google.com/x', beschrijving: null, organisator_naam: 'Ruben', klant_ontvangers: [{ naam: 'Rob', email: 'rob@x.be' }], deelnemers: [],
  }
  assert.equal(clickupTaakNaam(m), 'Meeting: ERA NOBIS — Kennismaking')
  const o = clickupOmschrijving(m, 'https://app.nextgenmedia.be')
  assert.match(o, /dinsdag 27 oktober 2026 om 14:00 – 14:30 \(Belgische tijd\)/)
  assert.match(o, /Rob <rob@x\.be>/)
  assert.ok(o.includes(clickupMarker('abc')))
  assert.ok(o.includes('https://app.nextgenmedia.be/admin/meetings?meeting=abc'))
  assert.ok(!/Deelnemers/.test(o))
})

test('14. Status per stap is los zichtbaar', () => {
  const m = { status: 'ingepland', google_status: 'ok', meet_url: 'https://meet.google.com/x', clickup_status: 'fout', herinnering_aan: true }
  assert.equal(stapAgenda(m).toon, 'ok')
  assert.equal(stapMeet(m).toon, 'ok')
  assert.equal(stapClickup(m).label, 'ClickUp mislukt')
  assert.equal(stapHerinnering(m, { status: 'mislukt', gepland_voor: '2026-10-26T13:00:00.000Z' }).toon, 'fout')
  assert.equal(stapHerinnering(m, null).label, 'Geen herinnering meer mogelijk')
  assert.equal(stapHerinnering({ ...m, herinnering_aan: false }, null).label, 'Geen herinnering')
  assert.equal(stapMeet({ ...m, meet_url: null }).label, 'Meet-link ontbreekt')
  assert.equal(stapMeet({ ...m, google_status: 'fout', meet_url: null }).toon, 'neutraal')
  const geannuleerd = { ...m, status: 'geannuleerd', google_status: 'geannuleerd', clickup_status: 'ok' }
  assert.equal(stapAgenda(geannuleerd).label, 'Afspraak geannuleerd')
  assert.equal(stapClickup(geannuleerd).label, 'ClickUp afgesloten')
  assert.equal(stapHerinnering(geannuleerd, null).label, 'Herinnering geannuleerd')
})

test('15. Wijzigingen: enkel bijwerken wat veranderd is', () => {
  const r = valideerMeeting(basis, NU)
  assert.ok(r.ok)
  if (!r.ok) return
  const oud = { starts_at: r.waarde.startsAt, ends_at: r.waarde.endsAt, titel: r.waarde.titel, beschrijving: r.waarde.beschrijving, klant_ontvangers: r.waarde.klant_ontvangers, deelnemers: r.waarde.deelnemers, herinnering_aan: true }
  assert.equal(wijzigingen(oud, r.waarde).iets, false)
  const later = valideerMeeting({ ...basis, uur: '15:00' }, NU)
  assert.ok(later.ok)
  if (later.ok) { const w = wijzigingen(oud, later.waarde); assert.equal(w.tijd, true); assert.equal(w.ontvangers, false) }
  const ander = valideerMeeting({ ...basis, klant_ontvangers: [{ naam: 'Lies', email: 'lies@x.be' }] }, NU)
  assert.ok(ander.ok)
  if (ander.ok) { const w = wijzigingen(oud, ander.waarde); assert.equal(w.ontvangers, true); assert.equal(w.genodigden, true); assert.equal(w.tijd, false) }
})

test('16. Weergave: datum en duur', () => {
  assert.equal(wanneer('2026-12-01T08:30:00.000Z'), 'dinsdag 1 december 2026 om 09:30')
  assert.equal(duurMinuten('2026-12-01T08:30:00.000Z', '2026-12-01T09:15:00.000Z'), 45)
})

console.log(`\n${n} tests geslaagd\n`)
