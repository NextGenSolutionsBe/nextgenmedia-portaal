// Account-based marketing: nummers om te bellen, opvolgen en notities.
// Uitvoeren: npx tsx tests/abm-bellen.test.ts
import assert from 'node:assert/strict'
import { belNummers, netNummer, opvolgLabel, controleerNotitie } from '../lib/abm'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nABM: bellen en opvolgen\n')

test('nummers uit één veld: netjes en als tel-link', () => {
  assert.deepEqual(belNummers('+32470831282; +32470047424').map((x) => x.weergave), ['+32 470 83 12 82', '+32 470 04 74 24'])
  assert.deepEqual(belNummers('011 45 48 45 / 0479 12 34 56').map((x) => x.tel), ['+3211454845', '+32479123456'])
  assert.equal(belNummers('02 345 67 89')[0].weergave, '+32 2 345 67 89')
  assert.equal(belNummers('0032 89 36 50 40')[0].tel, '+3289365040')
  assert.deepEqual(belNummers('+32470831282, +32470831282').length, 1)
  assert.deepEqual(belNummers('geen nummer'), [])
  assert.deepEqual(belNummers(null), [])
  assert.equal(netNummer('+31612345678'), '+31612345678')
})

test('opvolglabel: te laat, vandaag, morgen, later', () => {
  assert.deepEqual(opvolgLabel('2026-11-24', '2026-11-26'), { tekst: '2 dagen te laat', toon: 'laat' })
  assert.deepEqual(opvolgLabel('2026-11-25', '2026-11-26'), { tekst: '1 dag te laat', toon: 'laat' })
  assert.equal(opvolgLabel('2026-11-26', '2026-11-26')?.toon, 'vandaag')
  assert.equal(opvolgLabel('2026-11-27', '2026-11-26')?.tekst, 'Opvolgen morgen')
  assert.match(opvolgLabel('2026-12-02', '2026-11-26')!.tekst, /^Opvolgen op wo 2 dec/)
  assert.equal(opvolgLabel(null, '2026-11-26'), null)
  assert.equal(opvolgLabel('morgen', '2026-11-26'), null)
})

test('notitie of gesprek: tekst of uitkomst verplicht', () => {
  assert.equal(controleerNotitie({ tekst: '  ' }).ok, false)
  const g = controleerNotitie({ uitkomst: 'voicemail', telefoon: '+32470831282' })
  assert.ok(g.ok && g.waarde.soort === 'gesprek' && g.waarde.tekst === null)
  const t = controleerNotitie({ tekst: ' Belt terug na 16u ', soort: 'notitie' })
  assert.ok(t.ok && t.waarde.soort === 'notitie' && t.waarde.tekst === 'Belt terug na 16u')
  const onbekend = controleerNotitie({ tekst: 'x', uitkomst: 'iets' })
  assert.ok(onbekend.ok && onbekend.waarde.uitkomst === null)
})

console.log(`\n${n} tests geslaagd\n`)
