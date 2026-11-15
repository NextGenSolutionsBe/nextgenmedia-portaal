// Vesting: regels commerciële verdeling (outbound 50% + 50%; inbound NextGenSolutions
// Marco 50%, Bram 25%; inbound NextGenMedia 0%), "nog niet aangeduid", klant vroeger
// gestopt met een vastgelegd bedrag, en enkel getekende contracten.
// Uitvoeren: npx tsx tests/vesting-lead.test.ts
import assert from 'node:assert/strict'
import { STANDAARD_INSTELLINGEN, berekenVesting, toerekeningsfactor, leadSoortVan, herkomstVan, vastBedragVan, isUitgesloten, erkenningVan, LEAD_SOORTEN } from '../lib/vesting'
import { naarContract } from '../lib/vesting-rijen'
import { beschrijfAkkoord, certificaatRegels, contractAkkoord, inhoudTekst, wijzigingen } from '../lib/vesting-akkoord'
import { teBeoordelen } from '../lib/vesting-snel'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nVesting: commerciële verdeling\n')

const basis = { klant: 'Klant', nr: 'V-1', totaal: 5000, kostenAftrek: 2000, netto: 3000, appointment_door_marco: true, closed_door_marco: false, status: 'actief' as const, betaald_bij_stop: null, opBetaaldBedrag: false }

test('Percentages volgens de regels; outbound = afspraak 50% + closing 50%', () => {
  assert.equal(toerekeningsfactor({ appointment_door_marco: true, closed_door_marco: true }), 1)
  assert.equal(toerekeningsfactor({ appointment_door_marco: true, closed_door_marco: false }), 0.5)
  assert.equal(toerekeningsfactor({ appointment_door_marco: false, closed_door_marco: false, lead_soort: 'inbound_ngs_marco' }), 0.5)
  assert.equal(toerekeningsfactor({ appointment_door_marco: true, closed_door_marco: true, lead_soort: 'inbound_ngs_bram' }), 0.25)
  assert.equal(toerekeningsfactor({ appointment_door_marco: true, closed_door_marco: true, lead_soort: 'inbound_ngm' }), 0)
  // Een eigen percentage gaat voor.
  assert.equal(toerekeningsfactor({ appointment_door_marco: false, closed_door_marco: false, lead_soort: 'inbound_ngm', toerekening_pct: 100 }), 1)
  assert.deepEqual(LEAD_SOORTEN.map((l) => [l.key, l.pct]), [['inbound_ngs_marco', 50], ['inbound_ngs_bram', 25], ['inbound_ngm', 0]])
  assert.equal(leadSoortVan('iets'), null)
})

test('Outbound aangeduid of nog niet aangeduid: rekent hetzelfde, getekende tekst blijft gelijk', () => {
  assert.equal(herkomstVan('outbound'), 'outbound')
  assert.equal(herkomstVan(null), null)
  assert.equal(leadSoortVan('outbound'), null)
  const rij = { id: 'x', nr: 'C1', klant: 'K', ondertekend_op: '2026-09-01', status: 'actief', appointment_door_marco: true, closed_door_marco: true }
  const leeg = naarContract(rij)
  const out = naarContract({ ...rij, lead_soort: 'outbound' })
  assert.equal(leeg.herkomst, null)
  assert.equal(out.herkomst, 'outbound')
  assert.equal(out.lead_soort, null)
  assert.equal(toerekeningsfactor(out), toerekeningsfactor(leeg))
  const a = contractAkkoord({ ...basis, factor: 0.5, lead_soort: out.lead_soort } as never, [], 'Contract')
  const b = contractAkkoord({ ...basis, factor: 0.5 } as never, [], 'Contract')
  assert.equal(inhoudTekst(a), inhoudTekst(b))
  assert.doesNotMatch(inhoudTekst(a), /lead|vast|uitleg/)
})

test('De soort inbound komt mee uit de databank (vroeger niet)', () => {
  const c = naarContract({ id: 'x', nr: 'C1', klant: 'K', ondertekend_op: '2026-09-01', status: 'actief', lead_soort: 'inbound_ngs_bram' })
  assert.equal(c.lead_soort, 'inbound_ngs_bram')
  assert.equal(toerekeningsfactor(c), 0.25)
})

test('Inbound in de getekende cijfers en in wat er veranderde', () => {
  const oud = contractAkkoord({ ...basis, factor: 0.5 } as never, [], 'Contract')
  const nieuw = contractAkkoord({ ...basis, factor: 0.25, lead_soort: 'inbound_ngs_bram' } as never, [], 'Contract')
  assert.equal(nieuw.lead, 'inbound_ngs_bram')
  assert.equal(nieuw.telt_mee, 750)
  assert.match(wijzigingen(inhoudTekst(oud), nieuw).join(' | '), /Soort lead: outbound → Inbound NextGenSolutions, Bram closet/)
})

test('Klant vroeger gestopt: het vastgelegde bedrag telt zo, met beschrijving, en wordt getekend', () => {
  assert.equal(vastBedragVan({ status: 'stopgezet', meetellend_vast: 1800 }), 1800)
  assert.equal(vastBedragVan({ status: 'actief', meetellend_vast: 1800 }), null)
  const sv = { status: 'stopgezet' as const, betalingen_op_schema: false, meetellend_vast: 1800 }
  assert.equal(isUitgesloten(sv, 'jaar1'), false)
  assert.equal(isUitgesloten(sv, 'buiten'), true)
  assert.equal(erkenningVan(sv, 'jaar1'), 'definitief')
  const zonder = contractAkkoord({ ...basis, status: 'stopgezet', factor: 0.5 } as never, [], 'Contract')
  const met = contractAkkoord({ ...basis, status: 'stopgezet', factor: 0.5, opVastBedrag: true, meetellend_vast: 1800, meetellend_uitleg: 'Stopte na 3 maanden.' } as never, [], 'Contract')
  assert.equal(met.telt_mee, 1800)
  assert.equal(met.vast, 1800)
  assert.equal(met.uitleg, 'Stopte na 3 maanden.')
  assert.equal('vast' in zonder, false)
  assert.match(wijzigingen(inhoudTekst(zonder), met).join(' | '), /Effectief meetellend bedrag/)
  const ander = contractAkkoord({ ...basis, status: 'stopgezet', factor: 0.5, opVastBedrag: true, meetellend_vast: 1800, meetellend_uitleg: 'Stopte na 4 maanden.' } as never, [], 'Contract')
  assert.notEqual(inhoudTekst(met), inhoudTekst(ander))
  assert.deepEqual(wijzigingen(inhoudTekst(met), ander), ['Beschrijving aangepast'])
  assert.match(beschrijfAkkoord(met), /vroeger gestopt, vastgelegd bedrag €1\.800 telt mee \(Stopte na 3 maanden\.\)/)
  const regels = certificaatRegels({ nummer: 'V-1', inhoud: met, inhoud_sha256: 'x', handtekeningen: [], aandeel: null, stand: null, volledig_op: '2026-11-15T10:00:00Z' })
  assert.ok(regels.some(([l, w]) => l === 'Beschrijving' && w === 'Stopte na 3 maanden.'))
})

test('Berekening: vastgelegd bedrag telt zo (geen rekensom), weghalen = terug zoals vroeger', () => {
  const rij = { id: 'g', nr: 'C9', klant: 'Gestopt BV', ondertekend_op: '2026-05-01', status: 'stopgezet', facturatiemodel: 'eenmalig', handmatige_totaalwaarde: 6000, betaald_bij_stop: 2000, appointment_door_marco: true, closed_door_marco: false }
  const met = berekenVesting([naarContract({ ...rij, meetellend_vast: 1500, meetellend_uitleg: 'x' })], [], [], STANDAARD_INSTELLINGEN).contracten[0]
  assert.equal(met.opVastBedrag, true)
  assert.equal(met.opBetaaldBedrag, false)
  assert.equal(met.meetellend, 1500)
  assert.equal(met.erkenning, 'definitief')
  const zonder = berekenVesting([naarContract(rij)], [], [], STANDAARD_INSTELLINGEN).contracten[0]
  assert.equal(zonder.opVastBedrag, false)
  assert.equal(zonder.meetellend, 1000) // € 2.000 betaald × 50%, zoals vroeger
})

test('Te beoordelen: enkel getekende contracten', () => {
  const k = (id: string, status: string) => ({ id, status, klant: 'K', titel: 't', client_id: null, signed_at: status === 'signed' ? '2026-11-01' : null, start_date: null, waarde: null }) as never
  const lijst = teBeoordelen([k('a', 'signed'), k('b', 'sent'), k('c', 'viewed')], new Set(), new Set())
  assert.deepEqual(lijst.map((x: { id: string }) => x.id), ['a'])
})

console.log(`\n${n} tests geslaagd\n`)
