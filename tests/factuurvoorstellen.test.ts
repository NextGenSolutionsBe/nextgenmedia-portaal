// Factuurvoorstellen vanuit een contract.
//
//   npx tsx tests/factuurvoorstellen.test.ts

import assert from 'node:assert/strict'
import { maakVoorstellen, ontbrekend, periodeLabel, duurUitContract, frequentieUitContract, type Afspraken } from '../lib/facturatie/factuurvoorstellen'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nFactuurvoorstellen\n')

const TM: Afspraken = { dienst: 'Socialmediabeheer', klant: 'TM Technics', start: '2026-11-01', frequentie: 'maandelijks', duurMaanden: 6, bedrag: 979, btwPct: 21, moment: 'eerste' }

test('8. TM Technics: zes maandvoorstellen van € 979, totaal € 5.874, op de eerste van de maand', () => {
  const v = maakVoorstellen(TM)
  assert.equal(v.length, 6)
  assert.equal(Math.round(v.reduce((t, x) => t + x.bedrag_excl, 0) * 100), 587400)
  assert.deepEqual(v.map((x) => x.datum), ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01'])
  assert.equal(v[0].artikel, 'Socialmediabeheer – november 2026')
  assert.equal(v[0].omschrijving, 'Maandelijks socialmediabeheer voor TM Technics voor november 2026, conform de overeengekomen dienstverlening.')
  assert.equal(v[0].bestaatAl, null)
})

test('9. Opnieuw genereren: bestaande periodes worden herkend (geen dubbels)', () => {
  const v = maakVoorstellen(TM, { '2026-11': 'Socialmediabeheer – november 2026', '2026-12': 'Socialmediabeheer – december 2026' })
  assert.equal(v.filter((x) => x.bestaatAl).length, 2)
  assert.deepEqual(v.filter((x) => !x.bestaatAl).map((x) => x.periode), ['2027-01', '2027-02', '2027-03', '2027-04'])
})

test('Niets stil invullen: ontbrekende afspraken blokkeren de voorstellen', () => {
  const leeg: Afspraken = { dienst: 'Socialmediabeheer', klant: 'X', start: null, frequentie: null, duurMaanden: null, bedrag: null, btwPct: null, moment: null }
  assert.deepEqual(ontbrekend(leeg), ['facturatiefrequentie', 'start van de dienstverlening', 'bedrag per periode', 'btw-tarief', 'facturatiemoment'])
  assert.deepEqual(maakVoorstellen(leeg), [])
  assert.deepEqual(ontbrekend({ ...TM, duurMaanden: null }), ['contractduur'])
})

test('Kwartaal, facturatiemoment en eenmalig', () => {
  const q = maakVoorstellen({ ...TM, frequentie: 'kwartaal', duurMaanden: 12, bedrag: 2937, moment: 'laatste' })
  assert.equal(q.length, 4); assert.equal(q[0].datum, '2027-01-31'); assert.equal(q[0].artikel, 'Socialmediabeheer – november 2026 – januari 2027')
  assert.ok(q[0].omschrijving.startsWith('Driemaandelijks socialmediabeheer'))
  const s = maakVoorstellen({ ...TM, start: '2026-11-15', moment: 'start' })
  assert.equal(s[3].datum, '2027-02-15')
  const d = maakVoorstellen({ ...TM, start: '2026-11-15', moment: 'dag', dag: 31 })
  assert.equal(d[3].datum, '2027-02-28')
  const e = maakVoorstellen({ ...TM, dienst: 'Website', frequentie: 'eenmalig', duurMaanden: null, bedrag: 2500 }, { eenmalig: 'Website' })
  assert.equal(e.length, 1); assert.equal(e[0].bestaatAl, 'Website'); assert.equal(e[0].periode, 'eenmalig')
})

test('Contractgegevens lezen: duur en frequentie', () => {
  assert.equal(duurUitContract('6m', null, null), 6)
  assert.equal(duurUitContract(null, '2026-11-01', '2027-04-30'), 6)
  assert.equal(duurUitContract('onbepaald', null, null), null)
  assert.equal(frequentieUitContract('maandelijks'), 'maandelijks')
  assert.equal(frequentieUitContract(null, 'eenmalig'), 'eenmalig')
  assert.equal(frequentieUitContract(null, '12m'), null)
  assert.equal(periodeLabel('2026-11', 2), 'november – december 2026')
})

console.log(`\n${n} tests geslaagd\n`)
