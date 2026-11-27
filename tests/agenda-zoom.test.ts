// Inzoomen op dagen (gsm): knijpen, opzij schuiven, op een hele dag uitkomen.
//   npx tsx tests/agenda-zoom.test.ts
import assert from 'node:assert/strict'
import { zichtStappen, schaalVoor, weekendGewicht, WEEKEND_SMAL, maxBegin, klem, verend, naarStap, zichtVoor, beginNaKnijpen, beginNaVegen, snelheid, dagVanDeel, deelVanDag } from '../lib/agenda/zoom'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }
const bijna = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`)

test('stappen: week 7-5-4-3-2-1, werkweek 5-4-3-2-1', () => {
  assert.deepEqual(zichtStappen(7), [7, 5, 4, 3, 2, 1])
  assert.deepEqual(zichtStappen(5), [5, 4, 3, 2, 1])
})

test('schaal: hele week = 1, drie dagen van zeven = 7/3', () => {
  assert.equal(schaalVoor(7, 7), 1)
  bijna(schaalVoor(7, 3), 7 / 3)
  assert.equal(schaalVoor(7, 9), 1)
})

test('weekend smal bij de hele week, even breed vanaf vijf dagen, ertussen geleidelijk', () => {
  assert.equal(weekendGewicht(1), WEEKEND_SMAL)
  assert.equal(weekendGewicht(7 / 5), 1)
  const midden = weekendGewicht(1.2)
  assert.ok(midden > WEEKEND_SMAL && midden < 1)
})

test('begin blijft binnen de week; over de rand verend', () => {
  bijna(maxBegin(7 / 3), 4 / 7)
  assert.equal(klem(-0.1, 2), 0)
  bijna(klem(0.9, 2), 0.5)
  assert.ok(verend(-0.1, 2) > -0.1 && verend(-0.1, 2) < 0)
  assert.ok(verend(0.7, 2) > 0.5 && verend(0.7, 2) < 0.7)
  assert.equal(verend(0.3, 2), 0.3)
})

test('na knijpen: dichtstbijzijnde aantal dagen, een duidelijke knijp schuift minstens één stap', () => {
  assert.equal(naarStap(7, 1.05), 7) // nauwelijks bewogen
  assert.equal(naarStap(7, 7 / 3.1), 3)
  assert.equal(naarStap(7, 1.25, 1), 5) // 5,6 dagen: duidelijk geknepen → 5
  assert.equal(naarStap(7, 1.1, 1), 7) // te weinig
  assert.equal(naarStap(7, 7 / 3.4, 7 / 3), 4) // van 3 een beetje uit elkaar → 4
  assert.equal(naarStap(7, 7 / 3.2, 7 / 3), 3) // nauwelijks → blijft 3
  assert.equal(naarStap(7, 7, 7), 1)
})

test('opgeslagen keuze: altijd een geldige stap', () => {
  assert.equal(zichtVoor(7, null), 7)
  assert.equal(zichtVoor(7, 3), 3)
  assert.equal(zichtVoor(5, 7), 5)
  assert.equal(zichtVoor(7, 6), 7) // gelijk ver: de hele week
  assert.equal(zichtVoor(7, Number.NaN), 7)
})

test('knijpen houdt de dag onder je vingers op zijn plaats', () => {
  // Vingers in het midden van het scherm op vrijdag (dag 4 van 7, midden = 4,5/7), naar 3 dagen.
  assert.equal(beginNaKnijpen(4.5 / 7, 0.5, 7, 3), 3) // do, vr, za: vrijdag in het midden
  // Vingers links op maandag: begint op maandag.
  assert.equal(beginNaKnijpen(0.2 / 7, 0.05, 7, 3), 0)
  // Vingers rechts op zondag: eindigt op zondag.
  assert.equal(beginNaKnijpen(6.8 / 7, 0.95, 7, 3), 4)
  assert.equal(beginNaKnijpen(0.5, 0.5, 7, 7), 0)
})

test('vegen: op een hele dag, een snelle korte veeg schuift één dag, nooit buiten de week', () => {
  const strook = 7 / 3 * 350 // drie dagen op een scherm van 350 px
  // Langzaam een beetje gesleept (minder dan een halve dag): terug.
  assert.equal(beginNaVegen(0.05, 0, strook, 7, 3, 0), 0)
  // Langzaam over de helft van een dag: naar de volgende dag.
  assert.equal(beginNaVegen(0.1, 0, strook, 7, 3, 0), 1)
  // Kort maar snel naar links: één dag verder.
  assert.equal(beginNaVegen(0.02, 0.5, strook, 7, 3, 0), 1)
  // Kort maar snel naar rechts: één dag terug.
  assert.equal(beginNaVegen(2 / 7 - 0.02, -0.5, strook, 7, 3, 2), 1)
  // Heel snel: meerdere dagen, maar nooit voorbij zondag.
  assert.equal(beginNaVegen(0.3, 5, strook, 7, 3, 2), 4)
  assert.equal(beginNaVegen(0, -5, strook, 7, 3, 0), 0)
  // Een harde veeg met twee dagen in beeld schuift hoogstens twee dagen.
  assert.equal(beginNaVegen(0.05, 3, 7 / 2 * 350, 7, 2, 0), 2)
})

test('snelheid uit de laatste 100 ms', () => {
  assert.equal(snelheid([]), 0)
  bijna(snelheid([{ x: 0, t: 0 }, { x: 100, t: 150 }, { x: 160, t: 200 }, { x: 200, t: 250 }]), 100 / 100)
  bijna(snelheid([{ x: 200, t: 0 }, { x: 150, t: 50 }]), -1)
})

test('plek op de strook ↔ dag, ook met een smaller weekend', () => {
  const g = [1, 1, 1, 1, 1, 0.55, 0.55]
  bijna(dagVanDeel(0, g), 0)
  bijna(dagVanDeel(4.5 / 6.1, g), 4.5) // midden vrijdag
  bijna(dagVanDeel(5.275 / 6.1, g), 5.5) // midden zaterdag
  for (const d of [0, 1.25, 4.5, 5.5, 6.9]) bijna(dagVanDeel(deelVanDag(d, g), g), d)
  const gelijk = [1, 1, 1, 1, 1, 1, 1]
  bijna(deelVanDag(3, gelijk), 3 / 7)
})

console.log(`\n${n} tests geslaagd`)
