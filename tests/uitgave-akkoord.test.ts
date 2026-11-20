// Uitgaven vennoten: akkoord per uitgave op exact die cijfers.
// Uitvoeren: npx tsx tests/uitgave-akkoord.test.ts
import assert from 'node:assert/strict'
import { akkoordStand, uitgaveTekst, wachtOpAkkoord, type Uitgave, type UitgaveAkkoord } from '../lib/vennoot-uitgaven'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nAkkoord per uitgave\n')

const u: Uitgave = { id: 'u1', vennoot: 'bram', datum: '2026-11-08', omschrijving: 'Broodje bij klant', doel: 'Klantbezoek', bedrag: 12.5, bewijs_pad: 'b/1.jpg', bewijs_naam: 'bon.jpg', gearchiveerd_op: null, gearchiveerd_door: null, archief_reden: null, created_at: '2026-11-08T10:00:00Z', created_by: 'Bram' }
const ok = (vennoot: UitgaveAkkoord['vennoot'], x: Uitgave = u): UitgaveAkkoord => ({ uitgave_id: x.id, vennoot, naam: vennoot, akkoord_op: '2026-11-09T10:00:00Z', inhoud_tekst: uitgaveTekst(x) })

test('De tekst bevat alles waarover akkoord gegeven wordt', () => {
  const t = uitgaveTekst(u)
  for (const deel of ['Uitgave u1', 'Voor: bram', 'Datum: 2026-11-08', 'Wat: Broodje bij klant', 'Waarvoor: Klantbezoek', 'Bedrag: 12.50', 'Bon: bon.jpg (b/1.jpg)']) assert.ok(t.includes(deel), deel)
})

test('Twee van de drie: nog niet allen; de derde: allen', () => {
  const twee = akkoordStand(u, [ok('bram'), ok('marco')])
  assert.ok(twee.bram && twee.marco); assert.equal(twee.chiara, null); assert.equal(twee.allen, false)
  assert.equal(akkoordStand(u, [ok('bram'), ok('marco'), ok('chiara')]).allen, true)
})

test('Bedrag aangepast na een akkoord: opnieuw akkoord nodig', () => {
  const nieuw = { ...u, bedrag: 15 }
  const s = akkoordStand(nieuw, [ok('bram'), ok('marco'), ok('chiara')])
  assert.equal(s.allen, false); assert.equal(s.bram, null); assert.equal(s.aangepast, true)
})

test('Wat wacht op mij: enkel niet-gearchiveerde zonder mijn akkoord', () => {
  const archief = { ...u, id: 'u2', gearchiveerd_op: '2026-11-10T00:00:00Z' }
  const ander = { ...u, id: 'u3' }
  const wacht = wachtOpAkkoord([u, archief, ander], [ok('chiara')], 'chiara')
  assert.deepEqual(wacht.map((x) => x.id), ['u3'])
})

console.log(`\n${n} tests geslaagd\n`)
