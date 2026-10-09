// Inplannen binnen beschikbaarheid en bevestiging.
//
//   npx tsx tests/personeel-planning.test.ts

import assert from 'node:assert/strict'
import { binnenBeschikbaarheid, beschikbaarheidTekst, bevestigingVan } from '../lib/personeel/planning'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
const a = (id: string, datum: string, s: string, e: string, status = 'ingediend') => ({ id, datum, start_tijd: s, eind_tijd: e, status })

console.log('\nPlanning binnen beschikbaarheid\n')

test('1. Binnen één aangeboden blok mag, erbuiten niet', () => {
  const aanbod = [a('x', '2026-09-28', '13:00:00', '17:00:00')]
  assert.equal(binnenBeschikbaarheid({ datum: '2026-09-28', start_tijd: '13:00', eind_tijd: '17:00' }, aanbod)?.id, 'x')
  assert.equal(binnenBeschikbaarheid({ datum: '2026-09-28', start_tijd: '14:00', eind_tijd: '16:00' }, aanbod)?.id, 'x')
  assert.equal(binnenBeschikbaarheid({ datum: '2026-09-28', start_tijd: '12:00', eind_tijd: '16:00' }, aanbod), null)
  assert.equal(binnenBeschikbaarheid({ datum: '2026-09-29', start_tijd: '13:00', eind_tijd: '17:00' }, aanbod), null)
})

test('2. Ingetrokken of afgewezen aanbod telt niet; goedgekeurd wel', () => {
  assert.equal(binnenBeschikbaarheid({ datum: '2026-09-28', start_tijd: '13:00', eind_tijd: '14:00' }, [a('x', '2026-09-28', '13:00', '17:00', 'ingetrokken')]), null)
  assert.equal(binnenBeschikbaarheid({ datum: '2026-09-28', start_tijd: '13:00', eind_tijd: '14:00' }, [a('x', '2026-09-28', '13:00', '17:00', 'afgewezen')]), null)
  assert.equal(binnenBeschikbaarheid({ datum: '2026-09-28', start_tijd: '13:00', eind_tijd: '14:00' }, [a('x', '2026-09-28', '13:00', '17:00', 'goedgekeurd')])?.id, 'x')
})

test('3. Aaneensluitende blokken tellen samen', () => {
  const aanbod = [a('y', '2026-09-28', '15:00', '17:00'), a('x', '2026-09-28', '13:00', '15:00')]
  assert.equal(binnenBeschikbaarheid({ datum: '2026-09-28', start_tijd: '13:00', eind_tijd: '17:00' }, aanbod)?.id, 'x')
  assert.equal(binnenBeschikbaarheid({ datum: '2026-09-28', start_tijd: '13:00', eind_tijd: '18:00' }, aanbod), null)
})

test('4. Tekst en bevestigingsstatus', () => {
  assert.equal(beschikbaarheidTekst('2026-09-28', [a('x', '2026-09-28', '13:00:00', '17:00:00'), a('z', '2026-09-28', '09:00', '11:00')]), '09:00–11:00, 13:00–17:00')
  assert.equal(beschikbaarheidTekst('2026-09-30', []), '')
  assert.equal(bevestigingVan({ bevestiging: null }), 'bevestigd')
  assert.equal(bevestigingVan({ bevestiging: 'te_bevestigen' }), 'te_bevestigen')
})

console.log(`\n${n} tests geslaagd\n`)
