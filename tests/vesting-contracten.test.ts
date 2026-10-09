// Vesting — contractregels: termijn, jaartarief, toerekening en facturen per contract.
//
//   npx tsx tests/vesting-contracten.test.ts

import assert from 'node:assert/strict'
import {
  STANDAARD_INSTELLINGEN as I, berekenVesting, contractjaar, contractSchema, effectieveStatus, stelKoppelingenVoor, toerekeningsfactor,
  type Contract, type ContractTermijn, type GekoppeldeFactuur,
} from '../lib/vesting'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
const bijna = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`)

const contract = (over: Partial<Contract> = {}): Contract => ({
  id: 'c1', nr: 'C-001', klant: 'Test', ondertekend_op: '2026-09-01', start_dienst: '2026-09-01', einde_dienst: null, dienst: null,
  facturatiemodel: 'maandcontract', maandbedrag: 979, duur_maanden: 6, handmatige_totaalwaarde: null, uitgesloten_kosten: 0,
  status: 'actief', betalingen_op_schema: true, appointment_door_marco: true, closed_door_marco: true,
  laatste_betaalde_maand: null, reden_stop: null, notitie: null, contract_id: 'm1', ...over,
})
const termijnen = (aantal: number, over: Partial<ContractTermijn> = {}): ContractTermijn[] =>
  Array.from({ length: aantal }, (_, i) => ({
    id: `t${i + 1}`, contract_id: 'c1', volgnr: i + 1, periode: `2026-${String(9 + i).padStart(2, '0')}`.replace('2026-13', '2027-01').replace('2026-14', '2027-02'),
    factuurdatum: '2026-09-01', bedrag_excl: 979, btw_pct: 21, status: 'gepland', betaald_op: null, invoice_id: null, in_contract: true, notitie: null, ...over,
  }))

console.log('\nVesting — contracten\n')

test('Termijn: 1/8/2026 t.e.m. 31/7/2029; jaar 1/2/3 telkens op 1 augustus', () => {
  assert.equal(contractjaar('2026-08-01', I), 'jaar1')
  assert.equal(contractjaar('2027-07-31', I), 'jaar1')
  assert.equal(contractjaar('2027-08-01', I), 'jaar2')
  assert.equal(contractjaar('2028-08-01', I), 'jaar3')
  assert.equal(contractjaar('2029-07-25', I), 'jaar3')
  assert.equal(contractjaar('2029-08-01', I), 'buiten')
})

test('Getekend vóór 1 augustus 2026 telt mee als jaar 1', () => {
  assert.equal(contractjaar('2026-05-13', I), 'jaar1')
})

test('Toerekening: 50% appointment, 50% closing', () => {
  assert.equal(toerekeningsfactor({ appointment_door_marco: true, closed_door_marco: false }), 0.5)
  assert.equal(toerekeningsfactor({ appointment_door_marco: false, closed_door_marco: true }), 0.5)
  assert.equal(toerekeningsfactor({ appointment_door_marco: true, closed_door_marco: true }), 1)
})

test('Tarieven: eerste 10% aan €5.000/%, daarna het tarief van het jaar van ondertekening', () => {
  // €50.000 netto = 10% aan €5.000; de volgende €10.000 in jaar 1 = 1% extra.
  const a = contract({ id: 'a', nr: 'C-001', facturatiemodel: 'eenmalig', handmatige_totaalwaarde: 60000, ondertekend_op: '2026-09-01' })
  const v = berekenVesting([a], [], [], I)
  bijna(v.contracten[0].ruweVesting, 0.11)
  // Laat getekend (25 juli 2029, jaar 3): €50.000 boven de schijf = 50.000/15.000 %.
  const b = contract({ id: 'b', nr: 'C-002', facturatiemodel: 'eenmalig', handmatige_totaalwaarde: 50000, ondertekend_op: '2029-07-25' })
  const v2 = berekenVesting([a, b], [], [], I)
  const laat = v2.contracten.find((c) => c.id === 'b')!
  assert.equal(laat.jaar, 'jaar3')
  bijna(laat.ruweVesting, 50000 / 15000 / 100)
})

test('Schema: maandcontract = één factuur per maand; eenmalig = één factuur', () => {
  const m = contractSchema(contract())
  assert.equal(m.length, 6)
  assert.equal(m[0].periode, '2026-09'); assert.equal(m[5].periode, '2027-02')
  const e = contractSchema(contract({ facturatiemodel: 'eenmalig', handmatige_totaalwaarde: 4435, start_dienst: null, ondertekend_op: '2026-07-16' }))
  assert.equal(e.length, 1); assert.equal(e[0].bedrag_excl, 4435); assert.equal(e[0].periode, '2026-07')
})

test('Volledige waarde telt voorlopig; definitief zodra alles uit het contract betaald is', () => {
  const half = termijnen(6).map((t, i) => (i < 3 ? { ...t, status: 'betaald' as const } : t))
  const v1 = berekenVesting([contract()], [], [], I, [], half)
  assert.equal(v1.contracten[0].erkenning, 'voorlopig')
  bijna(v1.contracten[0].meetellend, 979 * 6)          // volle getekende waarde
  bijna(v1.contracten[0].betaald, 979 * 3)
  bijna(v1.contracten[0].nogTeFactureren, 979 * 3)
  const alles = termijnen(6, { status: 'betaald' })
  const v2 = berekenVesting([contract()], [], [], I, [], alles)
  assert.equal(v2.contracten[0].erkenning, 'definitief')
  assert.equal(v2.contracten[0].volledigBetaald, true)
})

test('Extra factuur buiten het contract wordt gelogd maar telt niet mee', () => {
  const t = [...termijnen(6, { status: 'betaald' }), { ...termijnen(1)[0], id: 'x', volgnr: 7, in_contract: false, status: 'betaald' as const, bedrag_excl: 300 }]
  const v = berekenVesting([contract()], [], [], I, [], t)
  bijna(v.contracten[0].extraGefactureerd, 300)
  bijna(v.contracten[0].betaald, 979 * 6)
  bijna(v.contracten[0].meetellend, 979 * 6)
})

test('Gekoppelde factuur bepaalt de status (betaald / geannuleerd → weer te factureren)', () => {
  const f = (over: Partial<GekoppeldeFactuur>): GekoppeldeFactuur => ({ id: 'f', referentie: '2026-59', datum: '2026-08-03', maand: '2026-08', bedrag_excl: 979, betaald: false, betaald_op: null, geannuleerd: false, contract_id: 'm1', ...over })
  assert.equal(effectieveStatus({ status: 'gepland', invoice_id: 'f' }, f({})), 'gefactureerd')
  assert.equal(effectieveStatus({ status: 'gepland', invoice_id: 'f' }, f({ betaald: true })), 'betaald')
  assert.equal(effectieveStatus({ status: 'gefactureerd', invoice_id: 'f' }, f({ geannuleerd: true })), 'gepland')
  assert.equal(effectieveStatus({ status: 'betaald', invoice_id: null }, undefined), 'betaald')
})

test('Facturen automatisch koppelen op maand, nooit twee keer dezelfde', () => {
  const t = [
    { id: 't1', periode: '2026-08', bedrag_excl: 979, invoice_id: null, status: 'gepland' as const },
    { id: 't2', periode: '2026-09', bedrag_excl: 979, invoice_id: null, status: 'gepland' as const },
    { id: 't3', periode: '2026-10', bedrag_excl: 979, invoice_id: null, status: 'gepland' as const },
  ]
  const facturen: GekoppeldeFactuur[] = [
    { id: 'a', referentie: '2026-59', datum: '2026-08-03', maand: '2026-08', bedrag_excl: 979, betaald: true, betaald_op: '2026-09-02', geannuleerd: false, contract_id: 'm1' },
    { id: 'b', referentie: '2026-65', datum: '2026-09-01', maand: '2026-09', bedrag_excl: 979, betaald: false, betaald_op: null, geannuleerd: false, contract_id: 'm1' },
    { id: 'c', referentie: 'X', datum: '2026-10-01', maand: '2026-10', bedrag_excl: 979, betaald: false, betaald_op: null, geannuleerd: true, contract_id: 'm1' },
  ]
  assert.deepEqual(stelKoppelingenVoor(t, facturen), [{ termijn_id: 't1', invoice_id: 'a' }, { termijn_id: 't2', invoice_id: 'b' }])
})

test('Stopgezet of niet-betaler = €0, ook al is er al iets betaald', () => {
  const v = berekenVesting([contract({ status: 'stopgezet' })], [], [], I, [], termijnen(6, { status: 'betaald' }))
  assert.equal(v.contracten[0].meetellend, 0)
  assert.equal(v.contracten[0].erkenning, 'uitgesloten')
})

console.log(`\n${n} tests geslaagd\n`)
