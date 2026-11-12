// Vesting: soort lead (Google Ads 100%, website 50%, Bram closet 25%) en enkel getekende contracten.
// Uitvoeren: npx tsx tests/vesting-lead.test.ts
import assert from 'node:assert/strict'
import { toerekeningsfactor, leadSoortVan, LEAD_SOORTEN } from '../lib/vesting'
import { contractAkkoord, inhoudTekst, wijzigingen } from '../lib/vesting-akkoord'
import { teBeoordelen } from '../lib/vesting-snel'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nVesting: soort lead\n')

const basis = { klant: 'Klant', nr: 'V-1', totaal: 5000, kostenAftrek: 2000, netto: 3000, appointment_door_marco: true, closed_door_marco: false, status: 'actief' as const, betaald_bij_stop: null, opBetaaldBedrag: false }

test('Percentages per soort lead; outbound blijft 50% + 50%', () => {
  assert.equal(toerekeningsfactor({ appointment_door_marco: true, closed_door_marco: true }), 1)
  assert.equal(toerekeningsfactor({ appointment_door_marco: true, closed_door_marco: false }), 0.5)
  assert.equal(toerekeningsfactor({ appointment_door_marco: false, closed_door_marco: false, lead_soort: 'google_ads' }), 1)
  assert.equal(toerekeningsfactor({ appointment_door_marco: false, closed_door_marco: false, lead_soort: 'website' }), 0.5)
  assert.equal(toerekeningsfactor({ appointment_door_marco: true, closed_door_marco: true, lead_soort: 'inbound_bram' }), 0.25)
  // Een eigen percentage gaat voor.
  assert.equal(toerekeningsfactor({ appointment_door_marco: false, closed_door_marco: false, lead_soort: 'google_ads', toerekening_pct: 10 }), 0.1)
  assert.equal(leadSoortVan('iets'), null)
  assert.deepEqual(LEAD_SOORTEN.map((l) => l.pct), [100, 50, 25])
})

test('Zonder soort lead blijft de getekende tekst exact dezelfde (oude handtekeningen geldig)', () => {
  const zonder = contractAkkoord({ ...basis, factor: 0.5 } as never, [], 'Contract')
  assert.equal('lead' in zonder, false)
  assert.doesNotMatch(inhoudTekst(zonder), /lead/)
})

test('Met soort lead: in de getekende cijfers en in wat er veranderde', () => {
  const oud = contractAkkoord({ ...basis, factor: 0.5 } as never, [], 'Contract')
  const nieuw = contractAkkoord({ ...basis, factor: 1, lead_soort: 'google_ads' } as never, [], 'Contract')
  assert.equal(nieuw.lead, 'google_ads')
  assert.equal(nieuw.telt_mee, 3000)
  assert.notEqual(inhoudTekst(oud), inhoudTekst(nieuw))
  assert.match(wijzigingen(inhoudTekst(oud), nieuw).join(' | '), /Soort lead: outbound door Marco → Inbound via Google Ads/)
})

test('Te beoordelen: enkel getekende contracten', () => {
  const k = (id: string, status: string) => ({ id, status, klant: 'K', titel: 't', client_id: null, signed_at: status === 'signed' ? '2026-11-01' : null, start_date: null, waarde: null }) as never
  const lijst = teBeoordelen([k('a', 'signed'), k('b', 'sent'), k('c', 'viewed')], new Set(), new Set())
  assert.deepEqual(lijst.map((x: { id: string }) => x.id), ['a'])
})

console.log(`\n${n} tests geslaagd\n`)
