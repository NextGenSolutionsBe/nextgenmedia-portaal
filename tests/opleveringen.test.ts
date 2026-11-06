// Video-opleveringen: versielabels, twee revisierondes, 3 dagen beschikbaar,
// status, feedback met tijdcodes.
//
//   npx tsx tests/opleveringen.test.ts

import assert from 'node:assert/strict'
import {
  versieLabel, revisieStand, beschikbaarheid, resterend, opleveringStatus, actieveVersie, valideerFeedback, tijdLabel, grootteLabel,
  bestandSoort, veiligeNaam, bestandPad, nieuweVervaldatum, type Versie,
} from '../lib/opleveringen'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nVideo-opleveringen\n')

const v = (nummer: number, o: Partial<Versie> = {}): Versie => ({ id: `v${nummer}`, nummer, is_finaal: false, bericht: null, gepubliceerd_op: '2026-11-01T10:00:00Z', verloopt_op: '2026-11-04T10:00:00Z', verwijderd_op: null, ...o })

test('1. Labels: Eerste versie, Revisieronde 1, Revisieronde 2, Finale versie', () => {
  assert.equal(versieLabel(v(1)), 'Eerste versie')
  assert.equal(versieLabel(v(2)), 'Revisieronde 1')
  assert.equal(versieLabel(v(3)), 'Revisieronde 2')
  assert.equal(versieLabel(v(4, { is_finaal: true })), 'Finale versie')
  assert.equal(versieLabel(v(1, { is_finaal: true })), 'Finale versie', 'meteen goed = meteen finaal')
})

test('2. Twee revisierondes: daarna geen nieuwe revisie meer (tenzij het team een extra ronde geeft)', () => {
  assert.deepEqual(revisieStand([]), { gebruikt: 0, over: 2, volgende: 1, max: 2 })
  assert.deepEqual(revisieStand([{ soort: 'revisie' }, { soort: 'opmerking' }]), { gebruikt: 1, over: 1, volgende: 2, max: 2 })
  assert.deepEqual(revisieStand([{ soort: 'revisie' }, { soort: 'revisie' }]), { gebruikt: 2, over: 0, volgende: null, max: 2 })
  assert.equal(revisieStand([{ soort: 'revisie' }, { soort: 'revisie' }], 3).volgende, 3, 'extra ronde')
})

test('3. Drie dagen beschikbaar, met een leesbare aftelling; daarna weg', () => {
  const nu = new Date('2026-11-02T08:00:00Z')
  const b = beschikbaarheid(v(1), nu)
  assert.equal(b.status, 'beschikbaar')
  assert.equal(b.tekst, 'Nog 2 dagen en 2 uur beschikbaar')
  assert.equal(beschikbaarheid(v(1), new Date('2026-11-04T10:00:01Z')).status, 'verlopen')
  assert.equal(beschikbaarheid(v(1, { verwijderd_op: '2026-11-03T00:00:00Z' }), nu).status, 'verlopen', 'al opgeruimd')
  assert.equal(beschikbaarheid(v(1, { gepubliceerd_op: null, verloopt_op: null }), nu).status, 'concept')
  assert.equal(resterend(90 * 60_000), '1 uur')
  assert.equal(resterend(25 * 60_000), '25 minuten')
  assert.equal(resterend(86_400_000), '1 dag')
  assert.equal(nieuweVervaldatum(new Date('2026-11-01T10:00:00Z')), '2026-11-04T10:00:00.000Z')
})

test('4. Status volgt de laatst gedeelde versie en het antwoord van de klant', () => {
  assert.equal(opleveringStatus([v(1, { gepubliceerd_op: null })], []), 'concept')
  assert.equal(opleveringStatus([v(1)], []), 'wacht_op_klant')
  assert.equal(opleveringStatus([v(1)], [{ versie_id: 'v1', soort: 'opmerking' }]), 'wacht_op_klant', 'een opmerking is geen beslissing')
  assert.equal(opleveringStatus([v(1)], [{ versie_id: 'v1', soort: 'revisie' }]), 'revisie_gevraagd')
  assert.equal(opleveringStatus([v(1), v(2, { gepubliceerd_op: null })], [{ versie_id: 'v1', soort: 'revisie' }]), 'revisie_gevraagd', 'nieuwe versie nog niet gedeeld')
  assert.equal(opleveringStatus([v(1), v(2)], [{ versie_id: 'v1', soort: 'revisie' }]), 'wacht_op_klant')
  assert.equal(opleveringStatus([v(1), v(2)], [{ versie_id: 'v1', soort: 'revisie' }, { versie_id: 'v2', soort: 'goedkeuring' }]), 'goedgekeurd')
  assert.equal(opleveringStatus([v(1), v(2), v(3, { is_finaal: true })], []), 'finaal')
})

test('5. De klant reageert enkel op de laatste gedeelde versie, en maar één keer (revisie of goedkeuring)', () => {
  assert.equal(actieveVersie([v(1), v(2)], [])?.id, 'v2')
  assert.equal(actieveVersie([v(1)], [{ versie_id: 'v1', soort: 'revisie' }]), null)
  assert.equal(actieveVersie([v(1)], [{ versie_id: 'v1', soort: 'opmerking' }])?.id, 'v1')
  assert.equal(actieveVersie([v(1, { gepubliceerd_op: null })], []), null)
})

test('6. Feedback met tijdcodes nakijken', () => {
  const r = valideerFeedback({ soort: 'revisie', tekst: '  Muziek iets zachter  ', punten: [{ tijd: 32.44, tekst: 'Logo groter' }, { tijd: null, tekst: 'Einde korter' }, { tijd: 5, tekst: '' }, { tijd: -3, tekst: 'Begin' }] })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.waarde.tekst, 'Muziek iets zachter')
  assert.deepEqual(r.waarde.punten, [{ tijd: 32.4, tekst: 'Logo groter' }, { tijd: null, tekst: 'Einde korter' }, { tijd: null, tekst: 'Begin' }])
  assert.equal(valideerFeedback({ soort: 'revisie', tekst: '' }).ok, false)
  assert.equal(valideerFeedback({ soort: 'goedkeuring' }).ok, true, 'goedkeuren mag zonder tekst')
  assert.equal(valideerFeedback({ soort: 'iets' }).ok, false)
})

test('7. Tijd, grootte, soort en veilige namen', () => {
  assert.equal(tijdLabel(75.4), '1:15')
  assert.equal(tijdLabel(3725), '1:02:05')
  assert.equal(tijdLabel(null), '')
  assert.equal(grootteLabel(4.2 * 1024 ** 3), '4,2 GB')
  assert.equal(grootteLabel(500), '500 B')
  assert.equal(bestandSoort('video/quicktime'), 'video')
  assert.equal(bestandSoort('image/jpeg'), 'foto')
  assert.equal(bestandSoort('application/zip'), 'ander')
  assert.equal(veiligeNaam('Aftermovie Oeterdal (4K) – finaal.mov'), 'Aftermovie-Oeterdal-4K-finaal.mov')
  assert.equal(veiligeNaam('../../etc/passwd'), 'etc-passwd')
  assert.equal(bestandPad('o1', 'v1', 'b1', 'Mijn video.mp4'), 'o1/v1/b1-Mijn-video.mp4')
})

console.log(`\n${n} tests geslaagd\n`)
