// Tests contractnavigatie (pure logica). Uitvoeren: npx tsx tests/contract-navigatie.test.ts
import assert from 'node:assert/strict'
import { bepaalBuren, isTekstInvoer, swipeRichting } from '../lib/contract-navigatie'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }
const ids = ['a', 'b', 'c', 'd']

console.log('Contractnavigatie')
test('1. Volgende en vorige volgen de volgorde van het overzicht', () => {
  assert.deepEqual(bepaalBuren(ids, 'b'), { vorige: 'a', volgende: 'c', index: 2, totaal: 4 })
})
test('2. Eerste contract: geen vorige; laatste: geen volgende', () => {
  assert.equal(bepaalBuren(ids, 'a').vorige, null); assert.equal(bepaalBuren(ids, 'a').volgende, 'b')
  assert.equal(bepaalBuren(ids, 'd').volgende, null); assert.equal(bepaalBuren(ids, 'd').index, 4)
})
test('3. Contract dat niet in de (gefilterde) lijst zit → geen buren, index 0', () => {
  assert.deepEqual(bepaalBuren(ids, 'x'), { vorige: null, volgende: null, index: 0, totaal: 4 })
})
test('4. Gefilterde lijst: enkel door de gefilterde contracten', () => {
  const gefilterd = ['a', 'c']
  assert.deepEqual(bepaalBuren(gefilterd, 'a'), { vorige: null, volgende: 'c', index: 1, totaal: 2 })
})
test('5. Toetsenbord niet tijdens typen (input, textarea, select, contenteditable, combobox)', () => {
  assert.ok(isTekstInvoer({ tagName: 'input' })); assert.ok(isTekstInvoer({ tagName: 'TEXTAREA' })); assert.ok(isTekstInvoer({ tagName: 'select' }))
  assert.ok(isTekstInvoer({ tagName: 'div', isContentEditable: true }))
  assert.ok(isTekstInvoer({ tagName: 'div', getAttribute: (n) => (n === 'role' ? 'combobox' : null) }))
  assert.ok(!isTekstInvoer({ tagName: 'button' })); assert.ok(!isTekstInvoer(null))
})
test('6. Veeg: horizontaal genoeg = navigeren, schuin of kort = niets', () => {
  assert.equal(swipeRichting(-120, 10), 'links'); assert.equal(swipeRichting(120, -10), 'rechts')
  assert.equal(swipeRichting(-40, 0), null); assert.equal(swipeRichting(-120, 100), null)
})
console.log(`\n${n} tests geslaagd`)
