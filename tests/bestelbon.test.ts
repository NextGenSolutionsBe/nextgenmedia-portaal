// Op getekend zetten via een bestelbon: het nummer is verplicht en netjes.
// Uitvoeren: npx tsx tests/bestelbon.test.ts
import assert from 'node:assert/strict'
import { valideerOpGetekend, normaliseerBestelbon } from '../lib/contracten/manueel-getekend'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nBestelbon\n')

test('Via bestelbon zonder nummer: geweigerd', () => {
  const r = valideerOpGetekend({ via: 'bestelbon', bestelbon_nummer: '  ' }, '2026-11-12')
  assert.equal(r.ok, false)
})

test('Via bestelbon zonder nummer maar met de bestelbon als bijlage: mag (het nummer wordt eruit gelezen)', () => {
  assert.deepEqual(valideerOpGetekend({ via: 'bestelbon', bestelbon_nummer: '', bestelbon_uit_bijlage: true }, '2026-11-12'), { ok: true, datum: '2026-11-12', notitie: null, via: 'bestelbon' })
  assert.equal(valideerOpGetekend({ via: 'bestelbon', bestelbon_uit_bijlage: 'ja' }, '2026-11-12').ok, false, 'enkel echt true')
})

test('Via bestelbon met nummer: via en nummer mee', () => {
  const r = valideerOpGetekend({ via: 'bestelbon', bestelbon_nummer: ' PO  2026-0815 ' }, '2026-11-12')
  assert.deepEqual(r, { ok: true, datum: '2026-11-12', notitie: null, via: 'bestelbon', bestelbon: 'PO 2026-0815' })
})

test('Per mail: geen nummer nodig; onbekende manier telt niet', () => {
  assert.deepEqual(valideerOpGetekend({ via: 'mail' }, '2026-11-12'), { ok: true, datum: '2026-11-12', notitie: null, via: 'mail' })
  assert.deepEqual(valideerOpGetekend({ via: 'fax' }, '2026-11-12'), { ok: true, datum: '2026-11-12', notitie: null })
})

test('Nummer netjes: spaties samen, max 60 tekens, leeg = null', () => {
  assert.equal(normaliseerBestelbon('  a   b '), 'a b')
  assert.equal(normaliseerBestelbon(''), null)
  assert.equal(normaliseerBestelbon('x'.repeat(80))?.length, 60)
})

console.log(`\n${n} tests geslaagd\n`)
