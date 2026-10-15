// Tests: briefing van een afspraak op de tijdlijn van de lead (pure logica).
// Uitvoeren: npx tsx tests/afspraak-notitie.test.ts
import assert from 'node:assert/strict'
import { afspraakMoment, afspraakNotitie } from '../lib/sales/briefing'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }

console.log('Afspraakbriefing op de tijdlijn')

test('1. Moment in Brusselse tijd, zomer- én wintertijd', () => {
  assert.equal(afspraakMoment(Date.UTC(2026, 8, 24, 14, 0)), '24/09/2026 om 16:00')   // CEST
  assert.equal(afspraakMoment('2026-12-03T08:30:00.000Z'), '03/12/2026 om 09:30')    // CET
  assert.equal(afspraakMoment(Date.UTC(2026, 8, 24, 14, 0), 'UTC'), '24/09/2026 om 14:00')
})

test('2. Briefing én klantnotitie komen samen in één notitie', () => {
  const t = afspraakNotitie({ startMs: Date.UTC(2026, 8, 24, 14, 0), briefing: '  Gesprek met Christophe. ', klantNotitie: 'Komt met offerte.' })
  assert.equal(t, 'Briefing bij de afspraak van 24/09/2026 om 16:00:\nGesprek met Christophe.\n\nAfgesproken met de prospect: Komt met offerte.')
})

test('3. Enkel een briefing, enkel een klantnotitie', () => {
  assert.equal(afspraakNotitie({ startMs: Date.UTC(2026, 8, 24, 14, 0), briefing: 'Alleen briefing' }), 'Briefing bij de afspraak van 24/09/2026 om 16:00:\nAlleen briefing')
  assert.equal(afspraakNotitie({ startMs: Date.UTC(2026, 8, 24, 14, 0), klantNotitie: 'Alleen klant' }), 'Briefing bij de afspraak van 24/09/2026 om 16:00:\n\nAfgesproken met de prospect: Alleen klant')
})

test('4. Niets ingetikt → geen notitie (geen lege regel op de tijdlijn)', () => {
  assert.equal(afspraakNotitie({ startMs: Date.UTC(2026, 8, 24, 14, 0) }), null)
  assert.equal(afspraakNotitie({ startMs: Date.UTC(2026, 8, 24, 14, 0), briefing: '   ', klantNotitie: null }), null)
})

console.log(`\n${n} tests geslaagd`)
