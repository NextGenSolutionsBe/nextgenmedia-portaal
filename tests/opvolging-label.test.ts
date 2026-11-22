// Op te volgen: het datumlabel per regel.
// Uitvoeren: npx tsx tests/opvolging-label.test.ts
import assert from 'node:assert/strict'
import {
  teDoen, gewenst, beschikbaar, meeting, looptAf, taakLabel, vergelijkLabels, standaardTaakDag, plusWerkdagen, plusDagen, REF, type OpvolgLabel,
} from '../lib/opvolging-label'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nOp te volgen: labels\n')

// Zondag 22 november 2026
const VANDAAG = '2026-11-22'

test('te doen: te laat, vandaag, morgen, later met de dag erbij', () => {
  assert.deepEqual(teDoen('2026-11-19', VANDAAG), { tekst: '3 dagen te laat', toon: 'te_laat', datum: '2026-11-19' })
  assert.equal(teDoen('2026-11-21', VANDAAG).tekst, '1 dag te laat')
  assert.deepEqual(teDoen('2026-11-22', VANDAAG), { tekst: 'Vandaag te doen', toon: 'vandaag', datum: '2026-11-22' })
  assert.equal(teDoen('2026-11-23', VANDAAG).tekst, 'Morgen te doen')
  assert.equal(teDoen('2026-11-23', VANDAAG).toon, 'binnenkort')
  const later = teDoen('2026-11-26', VANDAAG)
  assert.equal(later.toon, 'later')
  assert.match(later.tekst, /^Te doen op do\.? 26 nov/)
})

test('werkdagen slaan het weekend over', () => {
  assert.equal(plusWerkdagen('2026-11-20', 1), '2026-11-23') // vrijdag + 1 = maandag
  assert.equal(plusWerkdagen('2026-11-22', 1), '2026-11-23') // zondag + 1 = maandag
  assert.equal(plusWerkdagen('2026-11-23', 3), '2026-11-26')
  assert.equal(plusDagen('2026-11-30', 3), '2026-12-03')
})

test('beschikbaar: uren op de laatste dag, anders dagen, daarna verlopen', () => {
  const nu = new Date('2026-11-22T10:00:00Z')
  assert.equal(beschikbaar('2026-11-22T15:00:00Z', nu).tekst, 'Nog 5 uur beschikbaar')
  assert.equal(beschikbaar('2026-11-22T15:00:00Z', nu).toon, 'vandaag')
  assert.equal(beschikbaar('2026-11-23T12:00:00Z', nu).tekst, 'Nog 1 dag beschikbaar')
  assert.equal(beschikbaar('2026-11-24T10:00:00Z', nu).tekst, 'Nog 2 dagen beschikbaar')
  assert.deepEqual(beschikbaar('2026-11-21T10:00:00Z', nu), { tekst: 'Verlopen', toon: 'te_laat', datum: '2026-11-21' })
})

test('meeting: vandaag en morgen met het uur, in Belgische tijd', () => {
  assert.deepEqual(meeting('2026-11-22T13:00:00Z', VANDAAG), { tekst: 'Vandaag 14:00', toon: 'vandaag', datum: '2026-11-22' })
  assert.equal(meeting('2026-11-23T08:30:00Z', VANDAAG).tekst, 'Morgen 09:30')
  assert.match(meeting('2026-11-27T09:00:00Z', VANDAAG).tekst, /27 nov\.? 10:00$/)
})

test('gewenst en loopt af', () => {
  assert.equal(gewenst('2026-11-20', VANDAAG).tekst, 'Gewenste datum 2 dagen voorbij')
  assert.equal(gewenst('2026-11-22', VANDAAG).tekst, 'Gewenst vandaag')
  assert.equal(looptAf('2026-11-20', VANDAAG).tekst, '2 dagen verlopen')
  assert.equal(looptAf('2026-11-29', VANDAAG).tekst, 'Loopt af over 7 dagen')
  assert.equal(looptAf('2026-11-29', VANDAAG).toon, 'binnenkort')
  assert.equal(looptAf('2026-12-30', VANDAAG).toon, 'later')
})

test('een taak met een datum geeft het label van die datum', () => {
  assert.equal(taakLabel({ deadline: '2026-11-22' }, VANDAAG).tekst, 'Vandaag te doen')
  assert.equal(taakLabel({ deadline: null }, VANDAAG).toon, 'info')
})

test('sorteren: langst te laat eerst, dan vandaag, morgen, later, zonder label achteraan', () => {
  const l: (OpvolgLabel | null)[] = [
    teDoen('2026-11-26', VANDAAG), null, teDoen('2026-11-22', VANDAAG), teDoen('2026-11-20', VANDAAG), teDoen('2026-11-10', VANDAAG), teDoen('2026-11-23', VANDAAG),
  ]
  const s = [...l].sort(vergelijkLabels).map((x) => x?.datum ?? null)
  assert.deepEqual(s, ['2026-11-10', '2026-11-20', '2026-11-22', '2026-11-23', '2026-11-26', null])
})

test('standaarddag voor een nieuwe taak: vandaag als het al moest', () => {
  assert.equal(standaardTaakDag(teDoen('2026-11-19', VANDAAG), VANDAAG), VANDAAG)
  assert.equal(standaardTaakDag(teDoen('2026-11-26', VANDAAG), VANDAAG), '2026-11-26')
  assert.equal(standaardTaakDag(null, VANDAAG), VANDAAG)
})

test('ref van een teamtaak', () => {
  assert.ok(REF.test('contracten:6beece21-2132-41bc-903b-ec218768e523'))
  assert.ok(!REF.test('contracten:abc'))
  assert.ok(!REF.test('x:6beece21-2132-41bc-903b-ec218768e523'))
})

console.log(`\n${n} tests geslaagd\n`)
