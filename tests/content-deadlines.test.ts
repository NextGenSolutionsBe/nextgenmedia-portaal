// Goedkeuringsdeadlines contentkalender — de pure regels.
//
//   npx tsx tests/content-deadlines.test.ts

import assert from 'node:assert/strict'
import { dagenTot, eindeMoment, isVerstreken, maandBereik, maandenTekst, maandLabel, tel, valideerDeadline, vandaagBrussel } from '../lib/content/deadline-model'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }

console.log('\nGoedkeuringsdeadlines\n')

test('Maanden in mensentaal (NL en EN), ook over jaren heen', () => {
  assert.equal(maandLabel('2026-10'), 'oktober 2026')
  assert.equal(maandenTekst(['2026-10']), 'oktober 2026')
  assert.equal(maandenTekst(['2026-11', '2026-10']), 'oktober en november 2026')
  assert.equal(maandenTekst(['2026-10', '2026-11', '2026-12']), 'oktober, november en december 2026')
  assert.equal(maandenTekst(['2026-12', '2027-01']), 'december 2026 en januari 2027')
  assert.equal(maandenTekst(['2026-10', '2026-11'], 'en'), 'October and November 2026')
})

test('Dagen tot de deadline: de deadline-dag telt nog mee', () => {
  assert.equal(dagenTot('2026-10-06', '2026-10-01'), 5)
  assert.equal(dagenTot('2026-10-06', '2026-10-06'), 0)
  assert.equal(isVerstreken('2026-10-06', '2026-10-06'), false)
  assert.equal(isVerstreken('2026-10-06', '2026-10-07'), true)
  assert.equal(dagenTot('2026-03-30', '2026-03-28'), 2) // over de zomertijd heen
})

test('Aftelklok eindigt om 23:59:59 Brussel (zomer- en winteruur)', () => {
  assert.equal(eindeMoment('2026-07-15'), '2026-07-15T21:59:59.000Z') // UTC+2
  assert.equal(eindeMoment('2026-12-15'), '2026-12-15T22:59:59.000Z') // UTC+1
})

test('Maandbereik voor planned_date (december → januari)', () => {
  assert.deepEqual(maandBereik('2026-10'), { van: '2026-10-01', tot: '2026-11-01' })
  assert.deepEqual(maandBereik('2026-12'), { van: '2026-12-01', tot: '2027-01-01' })
})

test('Invoer: minstens één geldige maand en een geldige datum; dubbels weg', () => {
  assert.deepEqual(valideerDeadline({ maanden: ['2026-11', '2026-10', '2026-10', 'onzin'], deadline: '2026-09-25' }), { ok: true, maanden: ['2026-10', '2026-11'], deadline: '2026-09-25' })
  assert.equal(valideerDeadline({ maanden: [], deadline: '2026-09-25' }).ok, false)
  assert.equal(valideerDeadline({ maanden: ['2026-13'], deadline: '2026-09-25' }).ok, false)
  assert.equal(valideerDeadline({ maanden: ['2026-10'], deadline: 'morgen' }).ok, false)
})

test('Tellingen: enkel "bij klant" is wat na de deadline automatisch goedgekeurd wordt', () => {
  assert.deepEqual(tel(['ready_for_review', 'ready_for_review', 'changes_requested', 'approved', 'scheduled', 'published', 'draft']),
    { bij_klant: 2, feedback: 1, goedgekeurd: 3, concept: 1, totaal: 7 })
})

test('Vandaag in Brussel (rond middernacht UTC)', () => {
  assert.equal(vandaagBrussel(new Date('2026-10-01T22:30:00Z')), '2026-10-02') // al 00:30 in Brussel
  assert.equal(vandaagBrussel(new Date('2026-10-01T21:30:00Z')), '2026-10-01')
})

console.log(`\n${n} tests geslaagd\n`)
