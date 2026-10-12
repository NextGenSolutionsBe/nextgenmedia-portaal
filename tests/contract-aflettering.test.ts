// Aflettering contract ↔ facturen — de scenario's uit de opdracht.
//
//   npx tsx tests/contract-aflettering.test.ts

import assert from 'node:assert/strict'
import { berekenAflettering, berekenContractWinst, verminderingVan, itemUitFactuur, itemsUitReeks, factuurStatus, type AflItem, type RuweFactuur, type RuweRegel } from '../lib/contracten/aflettering'

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

console.log('\nVerminderingen, creditnota’s, kosten en winst\n')

test('V1. Onderdeel gaat niet door: oorspronkelijke waarde blijft, effectief daalt, nog te factureren volgt', () => {
  const items = [it('verstuurd', 3000), it('te_factureren', 1500)]
  const zonder = berekenAflettering(6000, items)
  assert.equal(zonder.effectiefCent, 600000); assert.equal(zonder.verminderingCent, 0); assert.equal(zonder.nogTeFacturerenCent, 300000)
  const v = verminderingVan([{ bedrag_excl: 1500, verwijderd_op: null }, { bedrag_excl: 999, verwijderd_op: '2026-10-01' }]) // verwijderd telt niet
  assert.equal(v, 150000)
  const a = berekenAflettering(6000, items, v)
  assert.equal(a.waardeCent, 600000)        // oorspronkelijk ongewijzigd
  assert.equal(a.effectiefCent, 450000)
  assert.equal(a.nogTeFacturerenCent, 150000)
  assert.equal(a.hoofd, 'volledig_ingepland') // 3000 + 1500 dekt de effectieve 4500
})

test('V2. Gecrediteerd zonder creditnota → afwijking zichtbaar; mét creditnota (negatieve factuur) klopt het', () => {
  const v = verminderingVan([{ bedrag_excl: 500, verwijderd_op: null }])
  const zonderCn = berekenAflettering(1000, [it('verstuurd', 1000)], v)
  assert.equal(zonderCn.nogTeFacturerenCent, -50000); assert.equal(zonderCn.afwijking, true) // nooit stil gecorrigeerd
  const cn = itemUitFactuur({ id: 'cn', contract_id: C, invoice_date: '2026-10-10', description: 'Creditnota', status: 'verstuurd', amount_excl: -500, contract_bedrag_excl: null }, [], C)!
  assert.equal(cn.creditnota, true)
  const met = berekenAflettering(1000, [it('verstuurd', 1000), cn], v)
  assert.equal(met.gefactureerdCent, 50000); assert.equal(met.nogTeFacturerenCent, 0); assert.equal(met.hoofd, 'volledig_gefactureerd')
})

test('V3. Statussen gelijk aan Facturen: oude maandrij "gefactureerd"/"betaald" telt als gefactureerd', () => {
  const r = { id: 'r', contract_id: C, description: 'Beheer', start_month: '2026-08', end_month: '2026-10', amount_excl: 100 }
  const m = [
    { recurring_id: 'r', month: '2026-08-01', status: 'gefactureerd' },
    { recurring_id: 'r', month: '2026-09-01', status: 'betaald' },
    { recurring_id: 'r', month: '2026-10-01', status: 'verstuurd', betaald_op: '2026-10-05' },
  ]
  const { items } = itemsUitReeks(r, m, [], null, '2026-12')
  assert.deepEqual(items.map((i) => i.status), ['verstuurd', 'betaald', 'betaald'])
})

test('V4. Maand met een verdwenen eigen factuur verdwijnt niet uit het overzicht', () => {
  const r = { id: 'r', contract_id: C, description: 'Beheer', start_month: '2026-09', end_month: '2026-10', amount_excl: 100 }
  const m = [{ recurring_id: 'r', month: '2026-09-01', status: 'te_versturen', invoice_id: 'weg' }, { recurring_id: 'r', month: '2026-10-01', status: 'te_versturen', invoice_id: 'er' }]
  const { items } = itemsUitReeks(r, m, [], null, '2026-12', new Set(['er']))
  assert.deepEqual(items.map((i) => i.maand), ['2026-09']) // oktober telt via zijn bestaande factuur, september zelf
})

test('V5. Winst = gekoppelde facturen − kosten (zoals Kosten en winst); kost zonder prijs = voorlopig', () => {
  const a = { ...it('verstuurd', 1000, 100), invoice_id: 'f1', sleutel: 'inv:f1' }
  const b = { ...it('te_factureren', 500), invoice_id: 'f2', sleutel: 'inv:f2' }
  const g = { ...it('geannuleerd', 800), invoice_id: 'f3', sleutel: 'inv:f3' }
  const maand = { ...it('verstuurd', 200), bron: 'recurring_maand' as const, recurring_id: 'r', maand: '2026-10', sleutel: 'rec:r:2026-10' }
  const kosten = [
    { invoice_id: 'f1', recurring_id: null, maand: null, line_id: null, kostprijs_excl: 300, status: 'actief' },
    { invoice_id: 'f1', recurring_id: null, maand: null, line_id: null, kostprijs_excl: 50, status: 'geannuleerd' },   // telt niet
    { invoice_id: 'f2', recurring_id: null, maand: null, line_id: null, kostprijs_excl: null, status: 'actief' },      // prijs ontbreekt
    { invoice_id: 'f3', recurring_id: null, maand: null, line_id: null, kostprijs_excl: 400, status: 'actief' },      // geannuleerde factuur
    { invoice_id: null, recurring_id: 'r', maand: '2026-10-01', line_id: null, kostprijs_excl: 20, status: 'actief' },
  ]
  const fc = new Map([['f1', C], ['f2', C], ['f3', C]])
  const w = berekenContractWinst([a, b, g, maand], kosten, new Map(), fc, C)
  assert.equal(w.omzetCent, 180000)       // 1100 + 500 + 200
  assert.equal(w.kostenCent, 32000)       // 300 + 20
  assert.equal(w.winstCent, 148000)
  assert.equal(w.zonderPrijs, 1)
  assert.equal(w.omzetGefactureerdCent, 130000); assert.equal(w.winstGefactureerdCent, 98000)
  assert.equal(w.perItem['inv:f1'].kostenCent, 30000)
})

test('V6. Factuur over twee contracten: een kost aan een regel volgt het contract van die regel', () => {
  const deel = { ...it('verstuurd', 600), invoice_id: 'f', sleutel: 'inv:f', gedeeld: true }
  const kosten = [
    { invoice_id: 'f', recurring_id: null, maand: null, line_id: 'l1', kostprijs_excl: 100, status: 'actief' },
    { invoice_id: 'f', recurring_id: null, maand: null, line_id: 'l2', kostprijs_excl: 70, status: 'actief' },
  ]
  const regelContract = new Map<string, string | null>([['l1', null], ['l2', 'contract-b']]) // l1 erft het factuurcontract
  const w = berekenContractWinst([deel], kosten, regelContract, new Map([['f', C]]), C)
  assert.equal(w.kostenCent, 10000)
})

console.log(`\n${n} tests geslaagd\n`)
