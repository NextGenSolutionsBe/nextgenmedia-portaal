import assert from 'node:assert/strict'
import { samenvatting, grootte, OPSLAG_LIMIET_GB } from '../lib/opslag'

const GB = 1024 ** 3

// Leeg of kapot: nul, geen fout.
const leeg = samenvatting(null)
assert.equal(leeg.totaalBytes, 0)
assert.equal(leeg.niveau, 'ok')
assert.equal(leeg.delen.length, 1) // enkel de databank

// Echte vorm uit opslag_verbruik().
const o = samenvatting({ databank_bytes: 124_595_347, buckets: [
  { bucket: 'fof-instagram', bytes: 2_256_865_638, bestanden: 166 },
  { bucket: 'opleveringen', bytes: 84_443_070, bestanden: 2 },
  { bucket: 'onbekend', bytes: null, bestanden: 1 },
] })
assert.equal(o.totaalBytes, 124_595_347 + 2_256_865_638 + 84_443_070)
assert.equal(o.bestandenBytes, 2_256_865_638 + 84_443_070)
assert.equal(o.delen[0].sleutel, 'fof-instagram', 'grootste eerst')
assert.equal(o.delen[0].label, "Founders of Flanders: Instagram-video's")
assert.equal(o.delen.find((d) => d.sleutel === 'onbekend')?.label, 'onbekend')
assert.ok(o.procent > 2 && o.procent < 3)
assert.equal(o.niveau, 'ok')

// Drempels.
assert.equal(samenvatting({ databank_bytes: 70 * GB }).niveau, 'let_op')
assert.equal(samenvatting({ databank_bytes: 89.9 * GB }).niveau, 'let_op')
assert.equal(samenvatting({ databank_bytes: 90 * GB }).niveau, 'kritiek')
assert.equal(OPSLAG_LIMIET_GB, 100)

// Weergave.
assert.equal(grootte(2_813_000_000), '2,62 GB')
assert.equal(grootte(15 * GB), '15,0 GB')
assert.equal(grootte(84_443_070), '81 MB')
assert.equal(grootte(0), '0 B')

console.log('opslag: ok')
