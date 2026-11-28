// Agenda: shoots uit de Shoot planner in de kalender.
// Uitvoeren: npx tsx tests/agenda-shoots.test.ts
import assert from 'node:assert/strict'
import { shootAlsItem, plaatsVan, zoneNaarIso, type ShootRij } from '../lib/agenda/model'
import { afTeSluiten } from '../lib/agenda/dag-afsluiten'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nAgenda: shoots\n')
const rij = (x: Partial<ShootRij>): ShootRij => ({ id: 's1', client_id: 'k1', titel: null, shoot_date: '2026-12-11', start_time: null, end_time: null, location: null, status: 'gepland', betrokkenen: [], created_by: null, updated_at: '2026-11-26T10:00:00Z', ...x })
const perEmail = new Map([['bram@nextgenmedia.be', 'p-bram']])
const perGebruiker = new Map([['u-marco', 'p-marco']])

test('op het uur van het programma, anders een hele dag', () => {
  const i = shootAlsItem(rij({ start_time: '09:00', end_time: '12:30' }), 'TM Technics', perEmail, perGebruiker)
  assert.equal(i.bron, 'shoot')
  assert.equal(i.titel, 'Shoot TM Technics')
  assert.deepEqual(plaatsVan(i), { soort: 'rooster', dag: '2026-12-11', vanMin: 540, totMin: 750 })
  const heel = shootAlsItem(rij({}), '', perEmail, perGebruiker)
  assert.equal(heel.titel, 'Shoot')
  assert.deepEqual(plaatsVan(heel), { soort: 'dag', van: '2026-12-11', tot: '2026-12-11' })
  // Geen of een te vroeg einde = een uur.
  assert.equal(shootAlsItem(rij({ start_time: '9:15' }), '', perEmail, perGebruiker).eind_op, zoneNaarIso('2026-12-11', '10:15'))
  assert.equal(shootAlsItem(rij({ start_time: '14:00', end_time: '13:00' }), '', perEmail, perGebruiker).eind_op, zoneNaarIso('2026-12-11', '15:00'))
})

test('wie erbij is en wie ze maakte, afgerond = afgevinkt', () => {
  const i = shootAlsItem(rij({ titel: ' Contentshoot Els & Tom ', betrokkenen: [{ email: 'Bram@nextgenmedia.be' }, { email: 'klant@x.be' }], created_by: 'u-marco', status: 'afgerond' }), 'TM Technics', perEmail, perGebruiker)
  assert.equal(i.titel, 'Contentshoot Els & Tom')
  assert.deepEqual(i.toegewezen, ['p-bram', 'p-marco'])
  assert.equal(i.eigenaar_id, 'p-marco')
  assert.equal(i.status, 'klaar')
})

test('een shoot hoort niet bij Dag afsluiten', () => {
  const i = shootAlsItem(rij({ shoot_date: '2026-11-26', start_time: '09:00', created_by: 'u-marco' }), '', perEmail, perGebruiker)
  const r = afTeSluiten([i], { ik: 'p-marco', dag: '2026-11-26' })
  assert.equal(r.taken.length + r.meetings.length, 0)
})

console.log(`\n${n} tests geslaagd\n`)
