// Planningkleur in de contentkalender (oranje = geplaatst, groen = ingepland, wit = nog niets).
//
//   npx tsx tests/planning-kleur.test.ts

import assert from 'node:assert/strict'
import { planningkleur, nuInBrussel } from '../lib/content/planning-kleur'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nPlanningkleur\n')

const nu = { dag: '2026-10-20', tijd: '14:30' }

test('Wit: in de kalender, nog niets ingepland (concept, feedback, goedgekeurd, aanpassing)', () => {
  for (const status of ['draft', 'ready_for_review', 'approved', 'changes_requested']) {
    assert.equal(planningkleur({ status, planned_date: '2026-10-25' }, nu), 'niet_ingepland')
    assert.equal(planningkleur({ status, planned_date: '2026-10-01' }, nu), 'niet_ingepland') // ook in het verleden: nooit ingepland = niet geplaatst
  }
})

test('Groen: ingepland en het moment komt nog', () => {
  assert.equal(planningkleur({ status: 'scheduled', planned_date: '2026-10-25' }, nu), 'ingepland')
  assert.equal(planningkleur({ status: 'scheduled', planned_date: '2026-10-20', planned_time: '18:00' }, nu), 'ingepland')
  assert.equal(planningkleur({ status: 'scheduled', planned_date: '2026-10-20' }, nu), 'ingepland') // vandaag zonder tijdstip
})

test('Oranje: gepubliceerd, of ingepland en het moment is voorbij', () => {
  assert.equal(planningkleur({ status: 'published', planned_date: '2026-10-25' }, nu), 'geplaatst')
  assert.equal(planningkleur({ status: 'scheduled', planned_date: '2026-10-19' }, nu), 'geplaatst')
  assert.equal(planningkleur({ status: 'scheduled', planned_date: '2026-10-20', planned_time: '09:00' }, nu), 'geplaatst')
  assert.equal(planningkleur({ status: 'scheduled', planned_date: '2026-10-20', planned_time: '14:30:00' }, nu), 'geplaatst')
})

test('Huidig moment in Brussel (zomertijd en wintertijd)', () => {
  assert.deepEqual(nuInBrussel(new Date('2026-07-01T22:30:00Z')), { dag: '2026-07-02', tijd: '00:30' })
  assert.deepEqual(nuInBrussel(new Date('2026-12-01T10:05:00Z')), { dag: '2026-12-01', tijd: '11:05' })
})

console.log(`\n${n} tests geslaagd\n`)
