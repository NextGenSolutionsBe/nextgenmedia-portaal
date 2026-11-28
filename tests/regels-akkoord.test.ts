// Regels die de drie vennoten tekenen: gedeeld door Uitgaven vennoten en Vesting.
// Uitvoeren: npx tsx tests/regels-akkoord.test.ts
import assert from 'node:assert/strict'
import {
  REGELSETS, vestingRegelsTekst, regelsTekstVoor, tekenStandVoor, controleerVestingRegels, verschilMetVorige,
  type AlgemeneRegelsVersie,
} from '../lib/regels-akkoord'
import { regelsTekst, type RegelHandtekening } from '../lib/vennoot-uitgaven'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nRegels (vennoten en vesting)\n')

const versie = (v: number, regels: string[], extra: Partial<AlgemeneRegelsVersie> = {}): AlgemeneRegelsVersie =>
  ({ id: `id-${v}`, versie: v, regels, created_at: null, created_by: null, ...extra })
const teken = (vennoot: RegelHandtekening['vennoot'], tekst: string): RegelHandtekening =>
  ({ vennoot, naam: vennoot, getekend_op: '2026-11-11T10:00:00Z', inhoud_tekst: tekst })

test('Twee regelsets met elk hun eigen route', () => {
  assert.equal(REGELSETS.vesting.api, '/api/admin/vesting/regels')
  assert.equal(REGELSETS.vennoten.api, '/api/admin/vennoten')
  assert.equal(REGELSETS.vesting.metBudget, false)
  assert.equal(REGELSETS.vennoten.metBudget, true)
})

test('Vesting: de getekende tekst is versie + genummerde regels', () => {
  assert.equal(vestingRegelsTekst({ versie: 2, regels: ['Eerste', 'Tweede'] }), 'Regels vesting, versie 2\n1. Eerste\n2. Tweede')
})

test('Vennoten: de tekst blijft exact dezelfde, dus bestaande handtekeningen blijven geldig', () => {
  const v = versie(3, ['Fiets mag'], { maandbudget: 250, start_maand: '2026-11' })
  assert.equal(regelsTekstVoor('vennoten', v), regelsTekst({ versie: 3, regels: ['Fiets mag'], maandbudget: 250, start_maand: '2026-11' }))
})

test('Tekenstand: enkel handtekeningen op exact deze tekst tellen', () => {
  const v = versie(1, ['Een regel'])
  const tekst = regelsTekstVoor('vesting', v)
  const half = tekenStandVoor('vesting', v, [teken('marco', tekst), teken('bram', 'Regels vesting, versie 0\n1. Oud')])
  assert.ok(half.marco); assert.equal(half.bram, null); assert.equal(half.allen, false)
  const vol = tekenStandVoor('vesting', v, [teken('marco', tekst), teken('bram', tekst), teken('chiara', tekst)])
  assert.equal(vol.allen, true)
  assert.equal(tekenStandVoor('vesting', null, []).allen, false, 'nog geen regels = niemand tekende')
  // Een handtekening op de vennotentekst telt niet voor vesting.
  assert.equal(tekenStandVoor('vennoten', versie(1, ['Een regel'], { maandbudget: 250, start_maand: '2026-11' }), [teken('marco', tekst)]).marco, null)
})

test('Invoer vesting: één per lijn, nummering weg, lege lijnen weg, grenzen', () => {
  const ok = controleerVestingRegels({ regels: '1. Eerste  regel\n\n- Tweede\n• Derde\n2) Vierde' })
  assert.ok(ok.ok)
  if (ok.ok) assert.deepEqual(ok.waarde.regels, ['Eerste regel', 'Tweede', 'Derde', 'Vierde'])
  assert.equal(controleerVestingRegels({ regels: '  \n ' }).ok, false)
  assert.equal(controleerVestingRegels({ regels: Array.from({ length: 61 }, (_, i) => `R${i}`) }).ok, false)
  assert.equal(controleerVestingRegels({ regels: ['x'.repeat(1001)] }).ok, false)
})

test('Verschil met de vorige versie: nieuw, weg, budget en start', () => {
  const vorige = versie(1, ['A', 'B'], { maandbudget: 250, start_maand: '2026-11' })
  const nu = versie(2, ['A', 'C'], { maandbudget: 300, start_maand: '2026-11' })
  assert.deepEqual(verschilMetVorige(nu, vorige), { nieuw: [false, true], weg: ['B'], budget: true, start: false })
  assert.deepEqual(verschilMetVorige(versie(1, ['A']), null), { nieuw: [false], weg: [], budget: false, start: false })
})

console.log(`\n${n} tests geslaagd\n`)
