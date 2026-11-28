import assert from 'node:assert/strict'
import { teBeoordelen, raadVestingDienst, controleerSnel, snelTotaal, snelNaarRij, type KandidaatContract } from '../lib/vesting-snel'
import { totaalwaarde, contractSchema } from '../lib/vesting'

const k = (id: string, status: string, signed: string | null, klant = 'Klant'): KandidaatContract => ({ id, titel: 'T', status, client_id: null, klant, signed_at: signed, start_date: null, waarde: 100 })

// Enkel getekend, niet gekoppeld, niet afgewezen, geen testklant; nieuwste eerst.
const lijst = teBeoordelen([
  k('a', 'signed', '2026-10-01'), k('b', 'draft', null), k('c', 'signed', '2026-10-20'), k('d', 'signed', '2026-09-01'),
  k('e', 'getekend', '2026-08-01'), k('f', 'signed', '2026-10-30', 'test'), k('g', 'sent', null),
], new Set(['d']), new Set(['e']))
assert.deepEqual(lijst.map((x) => x.id), ['c', 'a'])

// Dienst raden.
assert.equal(raadVestingDienst('Social Media Samenwerkingsovereenkomst'), 'Social media management')
assert.equal(raadVestingDienst('WEBSITE APEX FUEL'), 'Webdesign')
assert.equal(raadVestingDienst('Samenwerkingsovereenkomst Website + Hosting'), 'Websiteverhuur')
assert.equal(raadVestingDienst('Drukwerk Rollup Banners'), 'Grafisch ontwerp')
assert.equal(raadVestingDienst('Contract e-mail marketing'), 'E-mailmarketing')
assert.equal(raadVestingDienst('Videoproductie & campagneopzet'), 'Andere')

// Controle.
const ok = { klant: 'Apex', client_id: null, contract_id: null, ondertekend_op: '2026-10-09', soort: 'eenmalig' as const, prijs: 7990, maanden: null, afspraak: true, closing: false }
assert.equal(controleerSnel(ok), null)
assert.match(String(controleerSnel({ ...ok, klant: ' ' })), /klant/)
assert.match(String(controleerSnel({ ...ok, prijs: null })), /prijs/)
assert.match(String(controleerSnel({ ...ok, prijs: 0 })), /prijs/)
assert.match(String(controleerSnel({ ...ok, soort: 'maand', maanden: null })), /maanden/)
assert.match(String(controleerSnel({ ...ok, ondertekend_op: '' })), /datum/)

// Totaal en rij: dezelfde waarde als het bestaande rekenmodel.
assert.equal(snelTotaal(ok), 7990)
assert.equal(snelTotaal({ soort: 'maand', prijs: 979, maanden: 6 }), 5874)
const r1 = snelNaarRij({ ...ok, titel: 'WEBSITE APEX FUEL' })
assert.equal(r1.facturatiemodel, 'eenmalig')
assert.equal(r1.dienst, 'Webdesign')
assert.equal(totaalwaarde(r1 as never), 7990)
assert.equal(contractSchema(r1 as never).length, 1, 'eenmalig = één factuur')
const r2 = snelNaarRij({ ...ok, soort: 'maand', prijs: 979, maanden: 6, titel: 'Social media' })
assert.equal(r2.facturatiemodel, 'maandcontract')
assert.equal(r2.start_dienst, '2026-10-09')
assert.equal(totaalwaarde(r2 as never), 5874)
assert.equal(contractSchema(r2 as never).length, 6, 'zes maandfacturen')
assert.equal(r2.appointment_door_marco, true)
assert.equal(r2.closed_door_marco, false)

console.log('vesting-snel: ok')
