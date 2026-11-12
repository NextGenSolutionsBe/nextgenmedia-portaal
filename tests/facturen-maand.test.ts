// Facturen per maand: maandoverzicht en maandelijks omzetdoel (€30.000, ALLE omzet).
//
//   npx tsx tests/facturen-maand.test.ts

import assert from 'node:assert/strict'
import { maandOverzicht, omzetMeter, shiftYM, type Moment } from '../lib/facturatie/planner-model'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nFacturen per maand\n')

const m = (id: string, status: Moment['status'], datum: string, bedrag: number, deel: Partial<Moment> = {}) =>
  ({ id, status, datum, bedrag_excl: bedrag, bron: 'invoice', herkomst: 'eenmalig', ...deel }) as Moment

const LIJST: Moment[] = [
  m('a', 'verstuurd', '2026-10-01', 12000, { recurring_omzet: true }),
  m('b', 'gepland', '2026-10-20', 9000, { recurring_omzet: true, bron: 'recurring', herkomst: 'recurring' }),
  m('c', 'betaald', '2026-10-05', 1000),                                     // betaald = al gefactureerd, niet nog eens
  m('d', 'achterstallig', '2026-10-02', 2500),                               // eenmalige shoot telt WEL mee
  m('e', 'geannuleerd', '2026-10-03', 5000),                                 // telt nergens
  m('f', 'gepland', '2026-10-10', 700, { bron: 'wam', herkomst: 'wam' }),    // WAM-termijn: ook een facturatie-item
  m('g', 'gepland', '2026-11-01', 4000),                                     // andere maand
]

test('Maandoverzicht: al gefactureerd + nog te factureren = verwacht maandtotaal (alle items)', () => {
  assert.deepEqual(maandOverzicht(LIJST, '2026-10'), { gefactureerd: 13000, open: 12200, totaal: 25200, aantalGefactureerd: 2, aantalOpen: 3 })
})

test('Omzetmeter = volledige maandomzet, eenmalig én terugkerend; gelijk aan het maandoverzicht', () => {
  const r = omzetMeter(LIJST, '2026-10')
  assert.equal(r.verwacht, maandOverzicht(LIJST, '2026-10').totaal)
  assert.equal(r.gefactureerd, 13000); assert.equal(r.open, 12200); assert.equal(r.verwacht, 25200)
  assert.equal(r.pct, 84); assert.equal(r.nodig, 4800); assert.equal(r.bereikt, false)
  assert.equal(omzetMeter(LIJST, '2026-11').verwacht, 4000)
  assert.equal(omzetMeter(LIJST, '2026-09').verwacht, 0)
})

test('Voorbeeld november 2026: €17.795,23 gepland, niets gefactureerd', () => {
  const nov = [m('x', 'gepland', '2026-11-03', 15481.27), m('y', 'gepland', '2026-11-30', 2133.96, { bron: 'recurring' }), m('z', 'gepland', '2026-11-15', 180, { bron: 'wam', herkomst: 'wam' })]
  const r = omzetMeter(nov, '2026-11')
  assert.equal(r.verwacht, 17795.23); assert.equal(r.gefactureerd, 0); assert.equal(r.open, 17795.23)
  assert.equal(r.pct, 59.3); assert.equal(r.nodig, 12204.77)
})

test('Factureren verschuift enkel van “nog te factureren” naar “gefactureerd”; het totaal blijft', () => {
  const na = LIJST.map((x) => (x.id === 'b' ? { ...x, status: 'verstuurd' as const } : x))
  const r = omzetMeter(na, '2026-10')
  assert.equal(r.verwacht, 25200); assert.equal(r.gefactureerd, 22000); assert.equal(r.open, 3200)
})

test('Doel bereikt: balk max. 100 %, echte bedrag en percentage blijven zichtbaar', () => {
  const r = omzetMeter([m('x', 'verstuurd', '2026-12-01', 31000)], '2026-12')
  assert.equal(r.bereikt, true); assert.equal(r.pct, 103.3); assert.equal(r.nodig, 0)
  assert.equal(r.vulGefactureerd, 100); assert.equal(r.vulOpen, 0)
})

test('Maandwissel over de jaargrens', () => {
  assert.equal(shiftYM('2026-12', 1), '2027-01')
  assert.equal(shiftYM('2027-01', -1), '2026-12')
})

console.log(`\n${n} tests geslaagd\n`)
