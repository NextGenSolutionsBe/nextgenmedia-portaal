// Uitgevallen waarde vs. nog binnen te komen (pure logica).
// Uitvoeren: npx tsx tests/vesting-uitgevallen.test.ts
import assert from 'node:assert/strict'
import { STANDAARD_INSTELLINGEN as I, berekenVesting, type Contract, type ContractTermijn, type WamRij, type WamTermijn } from '../lib/vesting'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }

const wam = (id: string, over: Partial<WamRij> = {}): WamRij => ({
  id, nr: `CW-${id}`, klant: `Klant ${id}`, client_id: null, contractwaarde: 2160, netto_ontvangen: 0, status: 'voltooid', betalingen_op_schema: true,
  notitie: null, start_datum: null, contract_maanden: null, bedrag_per_factuur: null, frequentie: null, btw_pct: 21, omschrijving: null, ...over,
})
/** 12 termijnen van €180: de eerste `betaald` betaald, de rest gepland in de toekomst. */
const wamTermijnen = (wamId: string, betaald: number): WamTermijn[] => Array.from({ length: 12 }, (_, i) => ({
  id: `${wamId}-${i + 1}`, wam_id: wamId, volgnr: i + 1, periode: `2026-${String(i + 1).padStart(2, '0')}`, factuurdatum: '2026-01-01',
  bedrag_excl: 180, btw_pct: 21, status: i < betaald ? 'betaald' : 'gepland', betaald_op: null, invoice_id: null, clickup_task_id: null, notitie: null,
}))
const contract = (over: Partial<Contract> = {}): Contract => ({
  id: 'c1', nr: 'C-001', klant: 'Test', ondertekend_op: '2026-09-01', start_dienst: '2026-09-01', einde_dienst: null, dienst: null,
  facturatiemodel: 'maandcontract', maandbedrag: 1000, duur_maanden: 6, handmatige_totaalwaarde: null, uitgesloten_kosten: 0,
  status: 'actief', betalingen_op_schema: true, appointment_door_marco: true, closed_door_marco: true,
  laatste_betaalde_maand: null, reden_stop: null, notitie: null, contract_id: null, ...over,
})
const contractTermijnen = (betaald: number): ContractTermijn[] => Array.from({ length: 6 }, (_, i) => ({
  id: `t${i + 1}`, contract_id: 'c1', volgnr: i + 1, periode: '2026-09', factuurdatum: '2026-09-01', bedrag_excl: 1000, btw_pct: 21,
  status: i < betaald ? 'betaald' : 'gepland', betaald_op: null, invoice_id: null, in_contract: true, notitie: null,
}))

console.log('\nVesting — uitgevallen vs. nog binnen te komen\n')

test('Lopende WAM-klant met geplande facturen: niets uitgevallen, alles nog binnen te komen', () => {
  const v = berekenVesting([], [wam('5')], [], I, wamTermijnen('5', 4))
  assert.equal(v.uitgevallenWaarde, 0)
  assert.equal(v.nogBinnen.wam, 8 * 180)
  assert.equal(v.nogBinnen.totaal, 8 * 180)
  assert.equal(v.wam.rijen[0].uitgevallen, 0)
})

test('Gestopte en niet-betalende WAM-klant: wat niet binnenkwam, is uitgevallen', () => {
  for (const status of ['stopgezet', 'niet_betaler'] as const) {
    const v = berekenVesting([], [wam('9', { status })], [], I, wamTermijnen('9', 3))
    assert.equal(v.uitgevallenWaarde, 9 * 180, status)
    assert.equal(v.nogBinnen.totaal, 0, status)
  }
})

test('WAM-kosten blijven bij uitgevallen', () => {
  const v = berekenVesting([], [wam('5')], [{ id: 'k', datum: null, omschrijving: 'kost', bedrag: 250 }], I, wamTermijnen('5', 12))
  assert.equal(v.uitgevallenWaarde, 250)
  assert.equal(v.nogBinnen.totaal, 0)
})

test('Contracten: lopend = nog binnen te komen, gestopt = uitgevallen (nooit allebei)', () => {
  const lopend = berekenVesting([contract()], [], [], I, [], contractTermijnen(2))
  assert.equal(lopend.uitgevallenWaarde, 0)
  assert.equal(lopend.nogBinnen.contracten, 4000)
  const gestopt = berekenVesting([contract({ status: 'stopgezet', laatste_betaalde_maand: '2026-10-01' })], [], [], I, [], contractTermijnen(2))
  assert.equal(gestopt.uitgevallenWaarde, 4000)
  assert.equal(gestopt.nogBinnen.contracten, 0)
})

test('Samen: WAM en contracten tellen op in nog binnen te komen', () => {
  const v = berekenVesting([contract()], [wam('5'), wam('9', { status: 'stopgezet' })], [], I, [...wamTermijnen('5', 4), ...wamTermijnen('9', 3)], contractTermijnen(2))
  assert.deepEqual(v.nogBinnen, { totaal: 8 * 180 + 4000, wam: 8 * 180, contracten: 4000 })
  assert.equal(v.uitgevallenWaarde, 9 * 180)
})

console.log(`\n${n} tests geslaagd\n`)
