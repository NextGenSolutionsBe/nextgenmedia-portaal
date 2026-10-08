// Facturen per maand: maandoverzicht, recurring-doel (€30.000), geen dubbeltelling.
//
//   npx tsx tests/facturen-maand.test.ts

import assert from 'node:assert/strict'
import { maandOverzicht, recurringMeter, shiftYM, type Moment } from '../lib/facturatie/planner-model'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nFacturen per maand\n')

const m = (id: string, status: Moment['status'], datum: string, bedrag: number, deel: Partial<Moment> = {}) =>
  ({ id, status, datum, bedrag_excl: bedrag, bron: 'invoice', herkomst: 'eenmalig', ...deel }) as Moment

const LIJST: Moment[] = [
  m('a', 'verstuurd', '2026-10-01', 12000, { recurring_omzet: true }),
  m('b', 'gepland', '2026-10-20', 9000, { recurring_omzet: true, bron: 'recurring', herkomst: 'recurring' }),
  m('c', 'betaald', '2026-10-05', 1000, { recurring_omzet: true }),         // betaald = al gefactureerd, niet nog eens
  m('d', 'achterstallig', '2026-10-02', 2500),                               // eenmalige shoot
  m('e', 'geannuleerd', '2026-10-03', 5000, { recurring_omzet: true }),     // telt nergens
  m('f', 'gepland', '2026-10-10', 700, { bron: 'wam', herkomst: 'wam', recurring_omzet: false }), // WAM: geen NGM-omzet
  m('g', 'gepland', '2026-11-01', 4000, { recurring_omzet: true }),         // andere maand
]

test('Maandoverzicht: al gefactureerd + nog te factureren = verwacht maandtotaal', () => {
  assert.deepEqual(maandOverzicht(LIJST, '2026-10'), { gefactureerd: 13000, open: 11500, totaal: 24500, aantalGefactureerd: 2, aantalOpen: 2 })
})

test('Recurring-meter: eenmalig telt niet, betaald niet dubbel, elke maand apart', () => {
  const r = recurringMeter(LIJST, '2026-10')
  assert.equal(r.gefactureerd, 13000); assert.equal(r.open, 9000); assert.equal(r.verwacht, 22000)
  assert.equal(r.pct, 73.3); assert.equal(r.nodig, 8000); assert.equal(r.bereikt, false)
  assert.equal(recurringMeter(LIJST, '2026-11').verwacht, 4000)
  assert.equal(recurringMeter(LIJST, '2026-09').verwacht, 0)
})

test('Factureren verschuift enkel van “nog te factureren” naar “gefactureerd”; het totaal blijft', () => {
  const na = LIJST.map((x) => (x.id === 'b' ? { ...x, status: 'verstuurd' as const } : x))
  const r = recurringMeter(na, '2026-10')
  assert.equal(r.verwacht, 22000); assert.equal(r.gefactureerd, 22000); assert.equal(r.open, 0)
})

test('Doel bereikt: balk max. 100 %, echte bedrag en percentage blijven zichtbaar', () => {
  const r = recurringMeter([m('x', 'verstuurd', '2026-12-01', 31000, { recurring_omzet: true })], '2026-12')
  assert.equal(r.bereikt, true); assert.equal(r.pct, 103.3); assert.equal(r.nodig, 0)
  assert.equal(r.vulGefactureerd, 100); assert.equal(r.vulOpen, 0)
})

test('Maandwissel over de jaargrens', () => {
  assert.equal(shiftYM('2026-12', 1), '2027-01')
  assert.equal(shiftYM('2027-01', -1), '2026-12')
})

console.log(`\n${n} tests geslaagd\n`)
