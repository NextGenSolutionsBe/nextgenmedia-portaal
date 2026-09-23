// Facturenlijst: Te factureren → Verstuurd → Betaald. Knoppen, terugdraaien,
// en drie overzichtskaarten die nooit dubbel tellen.
//
//   npx tsx tests/factuur-fasen.test.ts

import assert from 'node:assert/strict'
import {
  faseVan, faseKpi, volgendeStap, vorigeStap, naStap, pasFiltersToe, LEEG_FILTERS, STATUS_INFO,
  type Moment, type PlannerStatus,
} from '../lib/facturatie/planner-model'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
const VANDAAG = '2026-09-23'

const m = (id: string, status: PlannerStatus, bedrag: number, over: Partial<Moment> = {}): Moment => ({
  id, bron: 'invoice', bronId: id, maand: '2026-09', datum: '2026-09-10', client_id: 'k', klant: 'Klant', project: null, omschrijving: null,
  type: 'Eenmalig', bedrag_excl: bedrag, btw_pct: 21, bedrag_incl: bedrag * 1.21, status, ruweStatus: status, herkomst: 'eenmalig', terugkerend: false,
  verantwoordelijke: null, volledig: true, ontbrekend: [], contract_id: null, contract_titel: null, recurring_id: null, invoice_id: id, wam_id: null,
  schema: null, opmerking: null, dienst: null, betaaltermijn: 30, verzonden_op: null, verzonden_door: null, betaald_op: null, verwacht_op: '2026-10-10',
  acties: { bekijkenUrl: null, aanpassenUrl: null, voorbereidenUrl: null, kanVerstuurd: true, kanVerplaatsen: true, kanAnnuleren: true },
  ...over,
})

console.log('\nFacturen — fasen en knoppen\n')

test('1. Elke status valt in precies één fase; geannuleerd in geen', () => {
  for (const s of ['gepland', 'te_versturen', 'controle_vereist', 'achterstallig'] as PlannerStatus[]) assert.equal(faseVan({ status: s }), 'te_factureren', s)
  assert.equal(faseVan({ status: 'verstuurd' }), 'open')
  assert.equal(faseVan({ status: 'betaald' }), 'betaald')
  assert.equal(faseVan({ status: 'geannuleerd' }), null)
  assert.equal(faseVan({ status: 'gecrediteerd' }), null)
})

test('2. Knoppen volgen de volgorde: verstuurd → betaald → niets', () => {
  assert.equal(volgendeStap(m('a', 'gepland', 1))?.label, 'Markeren als verstuurd')
  assert.equal(volgendeStap(m('a', 'verstuurd', 1))?.label, 'Markeren als betaald')
  assert.equal(volgendeStap(m('a', 'betaald', 1)), null)
  assert.equal(volgendeStap(m('a', 'geannuleerd', 1)), null)
})

test('3. Terugdraaien: betaald → verstuurd, verstuurd → te factureren', () => {
  assert.equal(vorigeStap(m('a', 'betaald', 1))?.actie, 'onbetaald')
  assert.equal(vorigeStap(m('a', 'verstuurd', 1))?.actie, 'heropen')
  assert.equal(vorigeStap(m('a', 'gepland', 1)), null)
})

test('4. WAM-termijnen krijgen geen knoppen (die beheer je in Vesting)', () => {
  assert.equal(volgendeStap(m('w', 'gepland', 1, { bron: 'wam' })), null)
  assert.equal(vorigeStap(m('w', 'betaald', 1, { bron: 'wam' })), null)
  assert.ok(volgendeStap(m('r', 'verstuurd', 1, { bron: 'recurring' })))
})

test('5. Kaarten tellen nooit dubbel: betaald enkel bij Betaald', () => {
  const k = faseKpi([m('a', 'gepland', 100), m('b', 'achterstallig', 50), m('c', 'verstuurd', 200), m('d', 'betaald', 300), m('e', 'geannuleerd', 999)])
  assert.deepEqual(k.te_factureren, { bedrag: 150, aantal: 2 })
  assert.deepEqual(k.open, { bedrag: 200, aantal: 1 })
  assert.deepEqual(k.betaald, { bedrag: 300, aantal: 1 })
  assert.equal(k.te_factureren.bedrag + k.open.bedrag + k.betaald.bedrag, 650)
})

test('6. Lokale stap: status en datum meteen bijgewerkt, terugdraaien wist de datum', () => {
  const v = naStap(m('a', 'gepland', 1, { datum: '2026-09-30' }), 'verstuurd', VANDAAG)
  assert.equal(v.status, 'verstuurd'); assert.equal(v.verzonden_op, VANDAAG)
  const b = naStap(v, 'betaald', VANDAAG)
  assert.equal(b.status, 'betaald'); assert.equal(b.betaald_op, VANDAAG)
  const o = naStap(b, 'onbetaald', VANDAAG)
  assert.equal(o.status, 'verstuurd'); assert.equal(o.betaald_op, null)
  const h = naStap(o, 'heropen', VANDAAG)
  assert.equal(h.status, 'gepland'); assert.equal(h.verzonden_op, null)
  assert.equal(naStap(m('x', 'verstuurd', 1, { datum: '2026-09-01' }), 'heropen', VANDAAG).status, 'achterstallig')
})

test('7. Filter per fase ("klik op de kaart")', () => {
  const set = [m('a', 'gepland', 1), m('b', 'verstuurd', 1), m('c', 'betaald', 1)]
  assert.deepEqual(pasFiltersToe(set, { ...LEEG_FILTERS, fase: 'open' }, VANDAAG).map((x) => x.id), ['b'])
  assert.deepEqual(pasFiltersToe(set, { ...LEEG_FILTERS, fase: 'betaald' }, VANDAAG).map((x) => x.id), ['c'])
  assert.equal(pasFiltersToe(set, LEEG_FILTERS, VANDAAG).length, 3)
})

test('8. Betaald toont uitdrukkelijk "Verstuurd & betaald"', () => {
  assert.equal(STATUS_INFO.betaald.label, 'Verstuurd & betaald')
})

console.log(`\n${n} tests geslaagd\n`)
