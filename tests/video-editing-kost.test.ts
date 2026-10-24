// Kosten "Video editing student".
//
//   npx tsx tests/video-editing-kost.test.ts

import assert from 'node:assert/strict'
import { berekenVideoKost, leesUren, videoTarief, berekeningTekst } from '../lib/kosten/video-editing'
import { tariefOp, normaliseerTarief } from '../lib/personeel/kost'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nVideo editing student\n')

const t1 = normaliseerTarief({ id: 't1', geldig_vanaf: '2026-09-01', geldig_tot: '2026-10-31', basis_uur: 14, lijnen: [{ id: 'a', label: 'Werkgeversbijdragen', soort: 'per_uur', waarde: 4 }] })
const t2 = normaliseerTarief({ id: 't2', geldig_vanaf: '2026-11-01', basis_uur: 16, lijnen: [{ id: 'a', label: 'Werkgeversbijdragen', soort: 'per_uur', waarde: 4 }] })

test('11. Alida – 3 uur: 3 × € 18 totale kost = € 54 (loon 3 × € 14 = € 42)', () => {
  const b = berekenVideoKost(3, videoTarief(tariefOp([t1, t2], '2026-10-09')!))
  assert.equal(b.totaal, 54); assert.equal(b.loon, 42); assert.equal(b.bedrag, 54); assert.equal(b.soort, 'bedrijfskost')
  assert.ok(berekeningTekst(b).includes('3 u × € 18,00'))
})

test('Enkel uurloon bekend → "Loonkost op basis van uurloon", geen werkgeverskost', () => {
  const kaal = normaliseerTarief({ id: 'k', geldig_vanaf: '2026-01-01', basis_uur: 15.5, lijnen: [] })
  const b = berekenVideoKost(2.5, videoTarief(kaal))
  assert.equal(b.soort, 'loonkost_uurloon'); assert.equal(b.bedrag, 38.75); assert.equal(b.totaal, 38.75)
  assert.ok(berekeningTekst(b).startsWith('Loonkost op basis van uurloon'))
})

test('12. Tariefwijziging verandert de momentopname niet', () => {
  const snapshot = berekenVideoKost(3, videoTarief(tariefOp([t1, t2], '2026-10-09')!))
  // Later komt er een nieuw tarief; de opgeslagen kost rekent verder met haar eigen tarief.
  const herberekend = berekenVideoKost(4, snapshot)
  assert.equal(herberekend.totaal_uur, 18); assert.equal(herberekend.totaal, 72)
  assert.equal(berekenVideoKost(3, videoTarief(tariefOp([t1, t2], '2026-11-05')!)).totaal, 60) // nieuwe prestatie → nieuw tarief
})

test('Uren met decimalen, geen onzin', () => {
  assert.equal(leesUren('2,5'), 2.5); assert.equal(leesUren('3'), 3)
  assert.equal(leesUren('0'), null); assert.equal(leesUren('25'), null); assert.equal(leesUren('abc'), null)
})

console.log(`\n${n} tests geslaagd\n`)
