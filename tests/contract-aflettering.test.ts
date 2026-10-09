// Aflettering contract ↔ facturen — de scenario's uit de opdracht.
//
//   npx tsx tests/contract-aflettering.test.ts

import assert from 'node:assert/strict'
import { berekenAflettering, itemUitFactuur, itemsUitReeks, factuurStatus, type AflItem, type RuweFactuur, type RuweRegel } from '../lib/contracten/aflettering'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nContract-aflettering\n')

const C = 'contract-a'
const it = (status: AflItem['status'], contract: number, extra = 0, deel: Partial<AflItem> = {}): AflItem => ({
  sleutel: Math.random().toString(36), bron: 'invoice', invoice_id: null, recurring_id: null, maand: null, datum: null, referentie: null, omschrijving: null,
  status, contractCent: Math.round(contract * 100), extraCent: Math.round(extra * 100), verdelingOnbekend: false, gedeeld: false, ...deel,
})

test('1. Getekend contract zonder contractwaarde: ontbreekt ≠ € 0', () => {
  const a = berekenAflettering(null, [])
  assert.equal(a.hoofd, 'waarde_ontbreekt'); assert.deepEqual(a.badges, ['waarde_ontbreekt', 'geen_facturen']); assert.equal(a.nogTeFacturerenCent, null)
  const nul = berekenAflettering(0, [])
  assert.equal(nul.hoofd, 'volledig_gefactureerd') // bewust € 0: niets te factureren
  assert.equal(nul.badges.includes('geen_facturen'), false)
})

test('2. Contract met waarde maar zonder gekoppelde facturen', () => {
  const a = berekenAflettering(5874, [it('geannuleerd', 979)])
  assert.equal(a.hoofd, 'geen_facturen'); assert.equal(a.nogInTePlannenCent, 587400); assert.equal(a.nogTeFacturerenCent, 587400)
})

test('3. Gedeeltelijk ingepland en gedeeltelijk gefactureerd', () => {
  const a = berekenAflettering(5874, [it('betaald', 979), it('verstuurd', 979), it('te_factureren', 979)])
  assert.equal(a.ingeplandCent, 293700); assert.equal(a.gefactureerdCent, 195800) // betaald telt één keer
  assert.equal(a.nogTeFacturerenCent, 391600); assert.equal(a.nogInTePlannenCent, 293700); assert.equal(a.hoofd, 'onvolledig'); assert.equal(a.afwijking, false)
})

test('4. Volledig ingepland, nog niet volledig gefactureerd', () => {
  const items = [1, 2, 3, 4, 5, 6].map((i) => it(i <= 2 ? 'verstuurd' : 'te_factureren', 979))
  const a = berekenAflettering(5874, items)
  assert.equal(a.hoofd, 'volledig_ingepland'); assert.equal(a.nogInTePlannenCent, null); assert.equal(a.nogTeFacturerenCent, 391600)
})

test('5. Volledig gefactureerd met kilometervergoeding: € 86 extra geeft geen afwijking', () => {
  const items = [1, 2, 3, 4, 5].map(() => it('betaald', 979)).concat(it('verstuurd', 979, 86))
  const a = berekenAflettering(5874, items)
  assert.equal(a.gefactureerdCent, 587400); assert.equal(a.extraCent, 8600); assert.equal(a.totaalGekoppeldCent, 596000)
  assert.equal(a.hoofd, 'volledig_gefactureerd'); assert.equal(a.afwijking, false); assert.equal(a.nogTeFacturerenCent, 0)
})

test('6. Overschrijding wordt getoond, niet op nul gezet', () => {
  const a = berekenAflettering(1000, [it('verstuurd', 1200)])
  assert.equal(a.nogTeFacturerenCent, -20000); assert.equal(a.afwijking, true); assert.equal(a.overschotIngeplandCent, 20000)
})

test('7. Annulering en creditnota', () => {
  const a = berekenAflettering(2000, [it('verstuurd', 1000), it('gecrediteerd', 1000), it('verstuurd', -250)])
  assert.equal(a.gefactureerdCent, 75000); assert.equal(a.gecrediteerdCent, 100000); assert.equal(a.nogTeFacturerenCent, 125000)
})

const regel = (deel: Partial<RuweRegel>): RuweRegel => ({ id: Math.random().toString(36), invoice_id: 'f1', recurring_id: null, contract_id: null, aantal: 1, prijs_excl: 0, btw_pct: 21, korting_pct: 0, korting_eur: 0, is_extra: false, ...deel })
const factuur = (deel: Partial<RuweFactuur>): RuweFactuur => ({ id: 'f1', contract_id: C, invoice_date: '2026-11-01', description: 'x', status: 'te_versturen', amount_excl: 0, contract_bedrag_excl: null, ...deel })

test('Factuurregels: binnen contractwaarde vs extra, en één factuur verdeeld over twee contracten', () => {
  const regels = [regel({ prijs_excl: 979 }), regel({ aantal: 215, prijs_excl: 0.4, is_extra: true })]
  const i = itemUitFactuur(factuur({ amount_excl: 1065 }), regels, C)!
  assert.equal(i.contractCent, 97900); assert.equal(i.extraCent, 8600); assert.equal(i.verdelingOnbekend, false)
  // Regel 2 hoort expliciet bij contract B → bij A enkel regel 1, bij B enkel regel 2: nooit dubbel.
  const gedeeld = [regel({ prijs_excl: 600 }), regel({ prijs_excl: 400, contract_id: 'contract-b' })]
  const a = itemUitFactuur(factuur({}), gedeeld, C)!, b = itemUitFactuur(factuur({}), gedeeld, 'contract-b')!
  assert.equal(a.contractCent + b.contractCent, 100000); assert.equal(a.gedeeld, true); assert.equal(b.contractCent, 40000)
  assert.equal(itemUitFactuur(factuur({ contract_id: 'contract-z' }), [], C), null)
})

test('Oude factuur zonder regels: verdeling te controleren, niet stil als meerwerk', () => {
  const i = itemUitFactuur(factuur({ amount_excl: 1065 }), [], C)!
  assert.equal(i.contractCent, 106500); assert.equal(i.extraCent, 0); assert.equal(i.verdelingOnbekend, true)
  assert.equal(berekenAflettering(1065, [i]).afwijking, true)
  const bekend = itemUitFactuur(factuur({ amount_excl: 1065, contract_bedrag_excl: 979 }), [], C)!
  assert.equal(bekend.extraCent, 8600); assert.equal(bekend.verdelingOnbekend, false)
})

test('Status: betaald telt als gefactureerd, gecrediteerd/geannuleerd niet', () => {
  assert.equal(factuurStatus({ status: 'verstuurd', betaalstatus: 'betaald' }), 'betaald')
  assert.equal(factuurStatus({ status: 'verstuurd', betaald_bedrag: 1184.59, amount_incl: 1184.59 }), 'betaald')
  assert.equal(factuurStatus({ status: 'te_versturen' }), 'te_factureren')
  assert.equal(factuurStatus({ status: 'gecrediteerd' }), 'gecrediteerd')
})

test('Maandelijkse reeks: maanden tot eind; eigen maandfactuur telt niet dubbel; doorlopend tot nu', () => {
  const r = { id: 'r1', contract_id: C, description: 'Social', start_month: '2026-11', end_month: '2027-04', amount_excl: 979 }
  const m = [{ recurring_id: 'r1', month: '2026-11', status: 'verstuurd', betaald_op: '2026-12-01' }, { recurring_id: 'r1', month: '2026-12', status: 'te_versturen', invoice_id: 'eigen' }, { recurring_id: 'r1', month: '2027-01', status: 'geannuleerd' }]
  const { items, doorlopend } = itemsUitReeks(r, m, [], null, '2026-10')
  assert.equal(items.length, 5); assert.equal(doorlopend, false)
  assert.equal(items[0].status, 'betaald'); assert.equal(items[1].maand, '2027-01'); assert.equal(items[1].status, 'geannuleerd')
  const d = itemsUitReeks({ ...r, end_month: null }, [], [], null, '2027-01')
  assert.equal(d.items.length, 3); assert.equal(d.doorlopend, true)
  assert.equal(itemsUitReeks({ ...r, end_month: null }, [], [], '2026-12', '2027-06').items.length, 2) // contracteinde begrenst
})

console.log(`\n${n} tests geslaagd\n`)
