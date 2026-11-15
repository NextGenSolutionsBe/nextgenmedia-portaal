// Taken uit de mail: in welke filter, lijkt een ClickUp-taak erop, standaarddeadline.
// Uitvoeren: npx tsx tests/mail-taken.test.ts
import assert from 'node:assert/strict'
import { filterVan, lijktOp, standaardDeadline, woorden, isAfInClickup } from '../lib/mail-opvolging/taken'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nTaken uit de mail\n')

test('Filters: te beslissen, nog te doen, gedaan, verwijderd', () => {
  assert.equal(filterVan({ status: 'voorstel' }), 'beslissen')
  assert.equal(filterVan({ status: 'ingepland', taak_af: false }), 'open')
  assert.equal(filterVan({ status: 'ingepland', taak_af: true }), 'gedaan')
  assert.equal(filterVan({ status: 'in_clickup', clickup_status_type: 'open' }), 'open')
  assert.equal(filterVan({ status: 'in_clickup', clickup_status_type: 'closed' }), 'gedaan')
  assert.equal(filterVan({ status: 'al_gedaan' }), 'gedaan')
  assert.equal(filterVan({ status: 'verwijderd' }), 'verwijderd')
  assert.ok(isAfInClickup('done')); assert.ok(!isAfInClickup('custom'))
})

test('Woorden: zonder stopwoorden en werkwoorden als "sturen", licht gestamd', () => {
  assert.deepEqual([...woorden('Voorstel social media sturen naar Bakkerij Peeters')].sort(), ['bakkerij', 'media', 'peeter', 'social', 'voorstel'])
})

test('Lijkt op: klantnaam in de taak en genoeg dezelfde woorden', () => {
  const t = { wat: 'Voorstel social media sturen', klant: 'Bakkerij Peeters' }
  assert.ok(lijktOp(t, { naam: 'Voorstel social media – Bakkerij Peeters' }))
  assert.ok(!lijktOp(t, { naam: 'Voorstel social media – Garage Vos' }), 'andere klant')
  assert.ok(!lijktOp(t, { naam: 'Bakkerij Peeters – facturen' }), 'andere taak bij dezelfde klant')
  assert.ok(lijktOp({ wat: 'Logo aanpassen', klant: 'Garage Vos' }, { naam: 'Garage Vos: logo aanpassen' }))
  assert.ok(!lijktOp({ wat: 'Terugbellen', klant: null }, { naam: 'Iets anders' }))
})

test('Standaarddeadline: twee werkdagen verder', () => {
  assert.equal(standaardDeadline('2026-11-13'), '2026-11-17', 'vrijdag → dinsdag')
  assert.equal(standaardDeadline('2026-11-16'), '2026-11-18', 'maandag → woensdag')
})

console.log(`\n${n} tests geslaagd\n`)
