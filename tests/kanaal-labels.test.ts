// Contentkalender — platformlabels per item: waar verschijnt de content?
//
//   npx tsx tests/kanaal-labels.test.ts

import assert from 'node:assert/strict'
import { publicatieKanalen } from '../lib/social-platforms'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
const labels = (ruw: unknown) => publicatieKanalen(ruw).map((k) => k.label)

console.log('\nContentkalender — platformlabels\n')

test('1. Meta verschijnt op Instagram én Facebook: twee labels', () => {
  assert.deepEqual(labels(['meta']), ['Instagram', 'Facebook'])
})

test('2. Oude items op instagram/facebook: één keer elk, niet dubbel', () => {
  assert.deepEqual(labels(['instagram', 'facebook']), ['Instagram', 'Facebook'])
  assert.deepEqual(labels(['facebook']), ['Facebook'], 'een oud item enkel voor Facebook toont enkel Facebook')
  assert.deepEqual(labels(['meta', 'instagram']), ['Instagram', 'Facebook'])
  assert.deepEqual(labels(['facebook/instagram']), ['Instagram', 'Facebook'])
})

test('3. Vaste volgorde: Instagram, Facebook, LinkedIn, TikTok, YouTube, Pinterest, X', () => {
  assert.deepEqual(labels(['twitter', 'linkedin', 'meta', 'tiktok']), ['Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'X'])
  assert.deepEqual(labels(['youtube', 'pinterest']), ['YouTube', 'Pinterest'])
})

test('4. Eén waarde (oud platformveld) en lege invoer', () => {
  assert.deepEqual(labels('linkedin'), ['LinkedIn'])
  assert.deepEqual(labels([]), [])
  assert.deepEqual(labels(null), [])
  assert.deepEqual(labels(['', '  ']), [])
})

test('5. Onbekend kanaal: zoals het is, achteraan', () => {
  assert.deepEqual(labels(['threads', 'linkedin']), ['LinkedIn', 'Threads'])
})

console.log(`\n${n} tests geslaagd\n`)
