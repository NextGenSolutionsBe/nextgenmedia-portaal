// Personeel is enkel voor hoofdbeheerders — nooit open te zetten voor werknemers.
//
//   npx tsx tests/personeel-afscherming.test.ts

import assert from 'node:assert/strict'
import { magActie, moduleBeschikbaar, moduleInfo, standaardModules, standaardRechten, type AlleInstellingen } from '../lib/instellingen/model'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }

console.log('\nAfscherming Personeel\n')

const inst = { modules: standaardModules(), rechten: standaardRechten() } as unknown as AlleInstellingen
// Zelfs iemand die de module expliciet kreeg en een open rol heeft.
const werknemer = { rol: 'beheerder' as const, modules: ['personeel', 'content'] }
const hoofd = { rol: 'hoofdbeheerder' as const, modules: null }

test('Personeel is gemarkeerd als enkel hoofdbeheerders', () => {
  assert.equal(moduleInfo('personeel')?.adminOnly, true)
  assert.deepEqual(standaardModules().personeel.rollen, ['hoofdbeheerder'])
})

test('Werknemer/beheerder met de module in zijn rechten: geen toegang', () => {
  assert.equal(moduleBeschikbaar(inst, werknemer, 'personeel'), false)
  for (const a of ['bekijken', 'aanpassen', 'verwijderen', 'instellingen'] as const) assert.equal(magActie(inst, werknemer, 'personeel', a), false)
})

test('Ook als de opgeslagen instellingen de rol toch openzetten', () => {
  const open = { ...inst, modules: { ...inst.modules, personeel: { zichtbaar: true, rollen: ['hoofdbeheerder', 'beheerder', 'medewerker'] } } } as AlleInstellingen
  assert.equal(magActie(open, { rol: 'medewerker', modules: ['personeel'] }, 'personeel', 'bekijken'), false)
})

test('Hoofdbeheerder: wel toegang; andere modules blijven gewoon werken', () => {
  assert.equal(magActie(inst, hoofd, 'personeel', 'aanpassen'), true)
  assert.equal(moduleBeschikbaar(inst, werknemer, 'content'), true)
})

console.log(`\n${n} tests geslaagd\n`)
