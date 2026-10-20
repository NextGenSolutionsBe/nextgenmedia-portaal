// Vroegtijdig stopgezet: Marco's vesting op het werkelijk betaalde bedrag.
// Uitvoeren: npx tsx tests/vesting-stopgezet.test.ts
import assert from 'node:assert/strict'
import { STANDAARD_INSTELLINGEN as I, berekenVesting, type Contract } from '../lib/vesting'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }

/** €10.000 eenmalig, afspraak door Marco, niet zelf gesloten → 50%. */
const contract = (over: Partial<Contract> = {}): Contract => ({
  id: 'c1', nr: 'C-001', klant: 'Test', ondertekend_op: '2026-09-01', start_dienst: '2026-09-01', einde_dienst: null, dienst: null,
  facturatiemodel: 'eenmalig', maandbedrag: null, duur_maanden: null, handmatige_totaalwaarde: 10000, uitgesloten_kosten: 0,
  status: 'stopgezet', betalingen_op_schema: true, appointment_door_marco: true, closed_door_marco: false,
  laatste_betaalde_maand: null, reden_stop: null, notitie: null, contract_id: null, betaald_bij_stop: 3000, ...over,
})
const een = (c: Contract) => berekenVesting([c], [], [], I).contracten[0]

console.log('\nVesting — vroegtijdig stopgezet\n')

test('Voorbeeld uit de afspraak: €3.000 betaald × 50% = €1.500 in de vesting', () => {
  const c = een(contract())
  assert.equal(c.totaal, 10000)
  assert.equal(c.factor, 0.5)
  assert.equal(c.meetellend, 1500)
  assert.equal(c.opBetaaldBedrag, true)
  assert.equal(c.erkenning, 'definitief')
  assert.equal(c.uitgevallen, 7000)
  assert.equal(c.nogTeFactureren, 0)
})

test('Het bedrag aanpassen werkt de berekening meteen bij', () => {
  assert.equal(een(contract({ betaald_bij_stop: 4500 })).meetellend, 2250)
  assert.equal(een(contract({ betaald_bij_stop: 0 })).meetellend, 0)
})

test('Afspraak én closing door Marco (100%) of een eigen percentage', () => {
  assert.equal(een(contract({ closed_door_marco: true })).meetellend, 3000)
  assert.equal(een(contract({ toerekening_pct: 75 })).meetellend, 2250)
})

test('Nog geen betaald bedrag ingevuld: telt voor €0, zoals vroeger', () => {
  const c = een(contract({ betaald_bij_stop: null }))
  assert.equal(c.meetellend, 0)
  assert.equal(c.erkenning, 'uitgesloten')
  assert.equal(c.opBetaaldBedrag, false)
  assert.equal(c.uitgevallen, 10000)
})

test('Enkel bij vroegtijdig stopgezet: niet-betaler blijft €0, een actief contract telt de contractwaarde', () => {
  assert.equal(een(contract({ status: 'niet_betaler' })).meetellend, 0)
  assert.equal(een(contract({ status: 'actief' })).meetellend, 5000)
})

test('"Betalingen op schema" speelt geen rol meer bij een stop; buiten de periode telt nooit', () => {
  assert.equal(een(contract({ betalingen_op_schema: false })).meetellend, 1500)
  assert.equal(een(contract({ ondertekend_op: '2029-09-01' })).meetellend, 0)
})

test('Telt mee in Marco\'s aandeel en in de totalen (op het betaalde bedrag)', () => {
  const v = berekenVesting([contract()], [], [], I)
  assert.equal(v.meetellendeWaarde, 1500)
  assert.equal(v.contractTotalen.marcoRecht, 1500)
  assert.equal(v.contractTotalen.getekend, 3000)
  // €1.500 aan het reguliere tarief (€5.000 per %) = 0,3%
  assert.ok(Math.abs(v.contracten[0].ruweVesting - 0.003) < 1e-9)
})

console.log(`\n${n} tests geslaagd\n`)
