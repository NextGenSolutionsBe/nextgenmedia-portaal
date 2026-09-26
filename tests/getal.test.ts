// Getallen lezen zoals een Belgische gebruiker ze typt.
//
//   npx tsx tests/getal.test.ts

import assert from 'node:assert/strict'
import { leesGetal, getalAlsInvoer } from '../lib/getal'
import { getal } from '../lib/facturen/regels'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }

console.log('\nGetallen\n')

test('1. Komma of punt als decimaalteken', () => {
  assert.equal(leesGetal('12,5'), 12.5)
  assert.equal(leesGetal('12.5'), 12.5)
  assert.equal(leesGetal('0,99'), 0.99)
  assert.equal(leesGetal(',5'), 0.5)
  assert.equal(leesGetal('12,'), 12)
})

test('2. Duizendtallen (Belgisch en Engels)', () => {
  assert.equal(leesGetal('1.250,50'), 1250.5)
  assert.equal(leesGetal('1,250.50'), 1250.5)
  assert.equal(leesGetal('1.250'), 1250)
  assert.equal(leesGetal('12.500.000'), 12500000)
  assert.equal(leesGetal('€ 1 250,50'), 1250.5)
  assert.equal(leesGetal('1 250,50'), 1250.5)
})

test('3. Leeg en onzin', () => {
  assert.equal(leesGetal(''), null)
  assert.equal(leesGetal('abc'), null)
  assert.equal(leesGetal('-'), null)
  assert.equal(leesGetal(null), null)
  assert.equal(leesGetal(-3.5), -3.5)
  assert.equal(leesGetal('-3,5'), -3.5)
})

test('4. Terug naar invoer met komma; factuurregels gebruiken dezelfde lezer', () => {
  assert.equal(getalAlsInvoer(12.5), '12,5')
  assert.equal(getalAlsInvoer(1250), '1250')
  assert.equal(getalAlsInvoer(0.1 + 0.2), '0,3')
  assert.equal(getalAlsInvoer(null), '')
  assert.equal(getal('1.250,50'), 1250.5)
  assert.equal(getal('', 21), 21)
})

console.log(`\n${n} tests geslaagd\n`)
