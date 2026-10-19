// "Op getekend zetten": een contract dat buiten de app ondertekend werd.
//
//   npx tsx tests/contract-manueel-getekend.test.ts

import assert from 'node:assert/strict'
import {
  isManueelGetekend, redenNietOpGetekend, valideerOpGetekend, signedAtVoor, statusNaOngedaan, vandaagBrussel, MAX_NOTITIE,
} from '../lib/contracten/manueel-getekend'
import { opvolgRedenen, nogTeOndertekenen } from '../lib/contracten/looptijd'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
const VANDAAG = '2026-10-19'

console.log('\nContracten — op getekend zetten\n')

test('1. Enkel een contract dat nog niet getekend, geannuleerd of vervangen is', () => {
  for (const s of ['draft', 'sent', 'viewed', 'expired', 'filled', null]) assert.equal(redenNietOpGetekend(s), null, String(s))
  assert.match(redenNietOpGetekend('signed')!, /al op getekend/)
  assert.match(redenNietOpGetekend('cancelled')!, /geannuleerd/)
  assert.match(redenNietOpGetekend('vervangen')!, /vervangen/)
  assert.match(redenNietOpGetekend('template')!, /template/)
})

test('2. Datum: leeg = vandaag, nooit in de toekomst, notitie optioneel en ingekort', () => {
  assert.deepEqual(valideerOpGetekend({}, VANDAAG), { ok: true, datum: VANDAAG, notitie: null })
  assert.deepEqual(valideerOpGetekend({ datum: '2026-10-02', notitie: '  per mail bevestigd ' }, VANDAAG), { ok: true, datum: '2026-10-02', notitie: 'per mail bevestigd' })
  assert.equal(valideerOpGetekend({ datum: '2026-10-20' }, VANDAAG).ok, false)
  assert.equal(valideerOpGetekend({ datum: '02/10/2026' }, VANDAAG).ok, false)
  const lang = valideerOpGetekend({ notitie: 'x'.repeat(MAX_NOTITIE + 50) }, VANDAAG)
  assert.ok(lang.ok && lang.notitie!.length === MAX_NOTITIE)
})

test('3. signed_at: vandaag = nu, een eerdere dag = middag UTC (geen dagverschuiving)', () => {
  const nu = new Date('2026-10-19T08:30:00Z')
  assert.equal(signedAtVoor('2026-10-19', '2026-10-19', nu), '2026-10-19T08:30:00.000Z')
  assert.equal(signedAtVoor('2026-10-02', '2026-10-19', nu), '2026-10-02T12:00:00.000Z')
  // Kwart na middernacht in Brussel is in UTC nog gisteren.
  assert.equal(vandaagBrussel(new Date('2026-10-18T22:15:00Z')), '2026-10-19')
})

test('4. Herkenning: enkel getekend + wijze manueel', () => {
  assert.equal(isManueelGetekend({ status: 'signed', ondertekening_wijze: 'manueel' }), true)
  assert.equal(isManueelGetekend({ status: 'signed', ondertekening_wijze: null }), false)
  assert.equal(isManueelGetekend({ status: 'sent', ondertekening_wijze: 'manueel' }), false)
})

test('5. Ongedaan maken zet de vorige status terug', () => {
  assert.equal(statusNaOngedaan('viewed', '2026-10-01T00:00:00Z'), 'viewed')
  assert.equal(statusNaOngedaan('draft', null), 'draft')
  assert.equal(statusNaOngedaan(null, '2026-10-01T00:00:00Z'), 'sent')
  assert.equal(statusNaOngedaan(undefined, null), 'draft')
  // Nooit terug naar getekend of geannuleerd.
  assert.equal(statusNaOngedaan('signed', null), 'draft')
  assert.equal(statusNaOngedaan('cancelled', '2026-10-01T00:00:00Z'), 'sent')
})

test('6. Op getekend = telt als ondertekend: geen opvolging, niet meer "nog te ondertekenen"', () => {
  const c = { status: 'signed', looptijd_status: 'lopend', client_id: 'k1', sent_at: '2026-09-01T00:00:00Z', heeftPdf: true }
  assert.equal(nogTeOndertekenen(c), false)
  assert.deepEqual(opvolgRedenen(c, new Date('2026-10-19T12:00:00Z')), [])
})

console.log(`\n${n} tests geslaagd\n`)
