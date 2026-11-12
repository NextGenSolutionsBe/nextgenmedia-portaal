// Facturen van een contract: pas "te factureren" zodra het contract getekend is,
// en de contractstatus "niet geaccepteerd". Uitvoeren: npx tsx tests/factuur-contract-stand.test.ts
import assert from 'node:assert/strict'
import { contractStand } from '../lib/facturen/contract-stand'
import { canonicalStatus, isNietDoorgegaan, statusInfo, followUp } from '../lib/contract-status'
import { nogTeOndertekenen } from '../lib/contracten/looptijd'
import { redenNietOpGetekend, statusNaOngedaan } from '../lib/contracten/manueel-getekend'
import {
  bepaalStatus, maandKpi, faseKpi, tabTellingen, rondeItems, resultaat, samenvatting, pasFiltersToe, LEEG_FILTERS, volgendeStap, momentSleutel, type Moment,
} from '../lib/facturatie/planner-model'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }
const VANDAAG = '2026-10-21'

const maak = (p: Partial<Moment> & { datum: string; status: Moment['status'] }): Moment => ({
  id: momentSleutel('invoice', p.datum + Math.random()), bron: 'invoice', bronId: 'x', maand: p.datum.slice(0, 7), datum: p.datum,
  client_id: 'k1', klant: 'Klant', project: null, omschrijving: null, type: 'Eenmalig',
  bedrag_excl: p.bedrag_excl ?? 1000, btw_pct: 21, bedrag_incl: (p.bedrag_excl ?? 1000) * 1.21,
  status: p.status, ruweStatus: 'te_versturen', herkomst: 'contract', terugkerend: false, verantwoordelijke: 'Bram',
  volledig: true, ontbrekend: [], contract_id: 'c1', contract_titel: 'Contract', contract_status: p.contract_status ?? null,
  recurring_id: null, invoice_id: 'i1', wam_id: null, schema: null, opmerking: null, dienst: null, betaaltermijn: 30,
  verzonden_op: null, verzonden_door: null, betaald_op: null, verwacht_op: '2026-11-20',
  acties: { bekijkenUrl: null, aanpassenUrl: null, voorbereidenUrl: null, kanVerstuurd: true, kanVerplaatsen: true, kanAnnuleren: true },
})
const st = (ruweStatus: string, contractStatus: string | null, datum = VANDAAG) => bepaalStatus({ ruweStatus, datum, ontbrekend: [], vandaag: VANDAAG, contractStatus })

console.log('\nFacturen van een contract — pas na ondertekening\n')

test('1. Contractstand: getekend of geen contract = vrij; verstuurd/geopend/verlopen = wacht; geannuleerd/niet geaccepteerd = vervallen', () => {
  for (const s of [null, undefined, '', 'signed', 'getekend']) assert.equal(contractStand(s), 'vrij', String(s))
  for (const s of ['draft', 'sent', 'viewed', 'filled', 'expired', 'verzonden']) assert.equal(contractStand(s), 'wacht', s)
  for (const s of ['cancelled', 'geannuleerd', 'niet_geaccepteerd', 'declined', 'vervangen']) assert.equal(contractStand(s), 'vervallen', s)
})

test('2. Planner: factuur van een niet-getekend contract staat niet bij te factureren', () => {
  assert.equal(st('te_versturen', 'sent'), 'wacht_op_contract')
  assert.equal(st('te_versturen', 'viewed', '2026-09-01'), 'wacht_op_contract')   // ook niet achterstallig
  assert.equal(st('te_versturen', 'niet_geaccepteerd'), 'contract_vervallen')
  assert.equal(st('te_versturen', 'cancelled'), 'contract_vervallen')
  assert.equal(st('te_versturen', 'signed'), 'te_versturen')
  assert.equal(st('te_versturen', null), 'te_versturen')
})

test('3. Wat al verstuurd, betaald of geannuleerd is, blijft dat', () => {
  assert.equal(st('verstuurd', 'sent'), 'verstuurd')
  assert.equal(st('betaald', 'cancelled'), 'betaald')
  assert.equal(st('geannuleerd', 'sent'), 'geannuleerd')
})

const lijst: Moment[] = [
  maak({ datum: VANDAAG, status: 'te_versturen', bedrag_excl: 500, contract_status: 'signed' }),
  maak({ datum: VANDAAG, status: 'wacht_op_contract', bedrag_excl: 1000, contract_status: 'sent' }),
  maak({ datum: '2026-10-05', status: 'contract_vervallen', bedrag_excl: 2000, contract_status: 'niet_geaccepteerd' }),
]

test('4. Tellingen, kaarten, facturatieronde en omzet negeren niet-getekende contracten', () => {
  assert.equal(tabTellingen(lijst).te_factureren, 1)
  assert.equal(faseKpi(lijst).te_factureren.bedrag, 500)
  assert.equal(maandKpi(lijst, '2026-10').teFactureren, 500)
  assert.equal(rondeItems(lijst, VANDAAG).length, 1)
  assert.equal(resultaat(lijst).omzet, 500)
  const sam = samenvatting(lijst, VANDAAG)
  assert.equal(sam.vandaag, 1)
  assert.equal(sam.maandBedragTotaal, 500)
  assert.equal(volgendeStap(lijst[1]), null)   // geen "Markeren als gefactureerd"
})

test('5. In "Alles": wachtende facturen zichtbaar, niet-doorgegane enkel met "toon geannuleerd"', () => {
  const zicht = pasFiltersToe(lijst, LEEG_FILTERS, VANDAAG)
  assert.equal(zicht.length, 2)
  assert.ok(zicht.some((m) => m.status === 'wacht_op_contract'))
  assert.equal(pasFiltersToe(lijst, { ...LEEG_FILTERS, toonGeannuleerd: true }, VANDAAG).length, 3)
})

test('6. Contractstatus "niet geaccepteerd": label, aliassen, niet meer te ondertekenen', () => {
  for (const s of ['niet_geaccepteerd', 'declined', 'geweigerd']) assert.equal(canonicalStatus(s), 'niet_geaccepteerd', s)
  assert.equal(statusInfo('niet_geaccepteerd').label, 'Niet geaccepteerd')
  assert.equal(isNietDoorgegaan('niet_geaccepteerd'), true)
  assert.equal(isNietDoorgegaan('cancelled'), true)
  assert.equal(isNietDoorgegaan('sent'), false)
  assert.equal(nogTeOndertekenen({ status: 'niet_geaccepteerd', looptijd_status: 'lopend' }), false)
  assert.ok(redenNietOpGetekend('niet_geaccepteerd'))
  // Geen "tekenlink verlopen"-alarm meer voor een contract dat niet doorging.
  assert.equal(followUp({ status: 'niet_geaccepteerd', expires_at: '2026-01-01' }).needs, false)
})

test('7. Terug openzetten: de status van vóór het annuleren, anders verzonden of klaar voor verzenden', () => {
  assert.equal(statusNaOngedaan('viewed', '2026-10-01T00:00:00Z'), 'viewed')
  assert.equal(statusNaOngedaan('niet_geaccepteerd', '2026-10-01T00:00:00Z'), 'sent')
  assert.equal(statusNaOngedaan(null, null), 'draft')
})

console.log(`\n${n} tests geslaagd\n`)
