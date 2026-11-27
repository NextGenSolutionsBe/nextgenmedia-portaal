// Vegen door de agenda: touchpad (wheel met deltaX) en vinger.
//   npx tsx tests/agenda-veeg.test.ts
import assert from 'node:assert/strict'
import { wiel, vingerRichting, vingerStap, WIEL_DREMPEL, WIEL_STIL, MEE_MAX, type WielStand } from '../lib/agenda/veeg'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }

/** Een reeks wheel-events zoals een touchpad ze geeft (dx per event, 16 ms ertussen). */
function speel(dxs: number[], start = 1000, dy = 0) {
  let s: WielStand | null = null, t = start
  const stappen: number[] = [], mee: number[] = []
  let vang = 0
  for (const dx of dxs) {
    const r = wiel(s, dx, dy, t)
    s = r.s; if (r.stap) stappen.push(r.stap); if (r.vang) vang++; mee.push(r.mee)
    t += 16
  }
  return { stappen, mee, vang, s, t }
}

test('één veeg naar links met naloop = precies één periode verder', () => {
  const veeg = [4, 8, 14, 20, 24, 22, 18, 14, 11, 9, 7, 6, 5, 4, 3, 3, 2, 2, 1, 1]
  const r = speel(veeg)
  assert.deepEqual(r.stappen, [1])
  assert.equal(r.vang, veeg.length)
})

test('naar rechts vegen = vorige periode', () => {
  assert.deepEqual(speel([-6, -14, -22, -26, -20, -12, -6, -3]).stappen, [-1])
})

test('kort tikje opzij: geen stap, de kalender schuift wat mee en veert terug', () => {
  const r = speel([3, 6, 8, 5, 2])
  assert.deepEqual(r.stappen, [])
  assert.ok(r.mee.at(-1)! < 0 && r.mee.at(-1)! >= -MEE_MAX)
})

test('twee vegen na elkaar (met een pauze) = twee periodes', () => {
  const eerste = speel([10, 20, 30, 25, 10, 4, 2])
  const tweede = wiel(eerste.s, 30, 0, eerste.t + WIEL_STIL + 50)
  let s = tweede.s, t = eerste.t + WIEL_STIL + 66, stappen = tweede.stap ? [tweede.stap] : []
  for (const dx of [30, 30, 20]) { const r = wiel(s, dx, 0, t); s = r.s; if (r.stap) stappen.push(r.stap); t += 16 }
  assert.deepEqual([...eerste.stappen, ...stappen], [1, 1])
})

test('nieuwe ruk terwijl de naloop nog loopt telt als nieuwe veeg', () => {
  const r = speel([20, 30, 40, 20, 10, 6, 4, 25, 35, 30])
  assert.deepEqual(r.stappen, [1, 1])
})

test('verticaal scrollen (ook met wat deltaX) blijft gewoon scrollen', () => {
  const r = speel([2, 3, 4, 3, 2], 1000, 20)
  assert.equal(r.vang, 0)
  assert.deepEqual(r.stappen, [])
})

test('de drempel ligt op een duidelijke beweging', () => {
  assert.equal(wiel(null, WIEL_DREMPEL - 1, 0, 0).stap, 0)
  assert.equal(wiel(null, WIEL_DREMPEL, 0, 0).stap, 1)
})

test('vinger: richting pas na een stukje, opzij of op en neer', () => {
  assert.equal(vingerRichting(4, 3), null)
  assert.equal(vingerRichting(-30, 8), 'opzij')
  assert.equal(vingerRichting(12, 30), 'scroll')
})

test('vinger: ver genoeg of snel genoeg = stap, anders terugveren', () => {
  assert.equal(vingerStap(-90, 400), 1)
  assert.equal(vingerStap(80, 300), -1)
  assert.equal(vingerStap(-40, 80), 1) // korte snelle veeg
  assert.equal(vingerStap(-40, 500), 0) // traag en kort
  assert.equal(vingerStap(10, 50), 0)
})

console.log(`\n${n} tests geslaagd\n`)
