// Tests voor de salesstatistieken (pure rekenlogica).
// Uitvoeren: npx tsx tests/sales-statistieken.test.ts
import assert from 'node:assert/strict'
import {
  bereken, percentage, gemiddelde, toonPercentage, legacyGesprekken, trendSleutel, kiesTrendPer,
  type StatActiviteit, type StatLead,
} from '../lib/sales/statistieken'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ok ${naam}`) }

let teller = 0
const act = (deel: Partial<StatActiviteit> & Pick<StatActiviteit, 'type' | 'lead_id'>): StatActiviteit => ({
  id: `a${++teller}`, medewerker_id: 'marco', duur_seconden: null, uitkomst: null, afspraak_id: null,
  created_at: `2026-09-${String(10 + (teller % 10)).padStart(2, '0')}T09:00:00Z`, verwijderd_op: null, ...deel,
})
const lead = (id: string, deel: Partial<StatLead> = {}): StatLead => ({ id, leadbron: 'outbound', dienst: null, deal_waarde_cents: null, ...deel })
const medewerkers = [{ id: 'marco', naam: 'Marco' }, { id: 'bram', naam: 'Bram' }]

console.log('Sales — statistieken')

test('1. Percentage en gemiddelde: geen noemer → null, nooit NaN', () => {
  assert.equal(percentage(0, 0), null)
  assert.equal(percentage(1, 0), null)
  assert.equal(percentage(NaN, 4), null)
  assert.equal(percentage(1, 4), 25)
  assert.equal(gemiddelde(0, 0), null)
  assert.equal(gemiddelde(300, 2), 150)
  assert.equal(toonPercentage(null), '—')
  assert.equal(toonPercentage(NaN), '—')
  assert.equal(toonPercentage(33.333), '33,3%')
})

test('2. Lege periode: alle ratio’s null, alle tellers 0', () => {
  const s = bereken({ activiteiten: [], leads: [], medewerkers })
  assert.equal(s.team.telefoongesprekken, 0)
  assert.equal(s.team.closingRate, null)
  assert.equal(s.team.appointmentRate, null)
  assert.equal(s.team.contactRate, null)
  assert.equal(s.team.gemiddeldeDuurSeconden, null)
  assert.deepEqual(s.perMedewerker, [])
  assert.deepEqual(s.vergelijking, [])
})

test('3. Drie keer dezelfde lead bellen = 3 gesprekken, 1 unieke lead; gemiddelde enkel over gesprekken met duur', () => {
  const s = bereken({
    activiteiten: [
      act({ type: 'telefoongesprek', lead_id: 'L1', uitkomst: 'niet_opgenomen', duur_seconden: 30 }),
      act({ type: 'telefoongesprek', lead_id: 'L1', uitkomst: 'voicemail' }),
      act({ type: 'telefoongesprek', lead_id: 'L1', uitkomst: 'contact_gehad', duur_seconden: 270 }),
    ],
    leads: [lead('L1')], medewerkers,
  })
  assert.equal(s.team.telefoongesprekken, 3)
  assert.equal(s.team.uniekeLeads, 1)
  assert.equal(s.team.beltijdSeconden, 300)
  assert.equal(s.team.gesprekkenMetDuur, 2)
  assert.equal(s.team.gemiddeldeDuurSeconden, 150)
  assert.equal(s.team.leadsMetContact, 1)
  assert.equal(s.team.contactRate, 100)
})

test('4. Een verplaatste afspraak telt één keer; een geannuleerde niet', () => {
  const s = bereken({
    activiteiten: [
      act({ type: 'afspraak_gepland', lead_id: 'L1', afspraak_id: 'AP1' }),
      act({ type: 'afspraak_gepland', lead_id: 'L1', afspraak_id: 'AP1' }), // verplaatst → zelfde afspraak
      act({ type: 'afspraak_gepland', lead_id: 'L2', afspraak_id: 'AP2' }), // geannuleerd
      act({ type: 'telefoongesprek', lead_id: 'L2', uitkomst: 'contact_gehad' }),
    ],
    leads: [lead('L1'), lead('L2')], medewerkers, geannuleerdeAfspraken: ['AP2'],
  })
  assert.equal(s.team.afspraken, 1)
  assert.equal(s.team.leadsMetAfspraak, 1)
  // L1 (afspraak = contact) en L2 (gesprek met contact) → 1 van 2
  assert.equal(s.team.leadsMetContact, 2)
  assert.equal(s.team.appointmentRate, 50)
})

test('5. Zacht verwijderde activiteiten tellen niet', () => {
  const s = bereken({
    activiteiten: [
      act({ type: 'telefoongesprek', lead_id: 'L1', duur_seconden: 60 }),
      act({ type: 'telefoongesprek', lead_id: 'L2', duur_seconden: 600, verwijderd_op: '2026-09-15T10:00:00Z' }),
      act({ type: 'email_verstuurd', lead_id: 'L3', verwijderd_op: '2026-09-15T10:00:00Z' }),
    ],
    leads: [lead('L1'), lead('L2'), lead('L3')], medewerkers,
  })
  assert.equal(s.team.telefoongesprekken, 1)
  assert.equal(s.team.beltijdSeconden, 60)
  assert.equal(s.team.emails, 0)
  assert.equal(s.team.uniekeLeads, 1)
})

test('6. Een gewonnen deal telt hoogstens één keer per lead; de laatste sluiting is de uitkomst', () => {
  const s = bereken({
    activiteiten: [
      act({ type: 'deal_gewonnen', lead_id: 'L1', created_at: '2026-09-02T10:00:00Z' }),
      act({ type: 'deal_gewonnen', lead_id: 'L1', created_at: '2026-09-03T10:00:00Z' }),
      act({ type: 'deal_verloren', lead_id: 'L2', created_at: '2026-09-02T10:00:00Z' }),
      act({ type: 'deal_gewonnen', lead_id: 'L2', created_at: '2026-09-05T10:00:00Z', medewerker_id: 'bram' }),
      act({ type: 'deal_verloren', lead_id: 'L3', created_at: '2026-09-04T10:00:00Z' }),
    ],
    leads: [lead('L1', { deal_waarde_cents: 100_000 }), lead('L2', { deal_waarde_cents: 50_000 }), lead('L3')],
    medewerkers,
  })
  assert.equal(s.team.gewonnen, 2)
  assert.equal(s.team.verloren, 1)
  assert.equal(s.team.waardeGewonnenCent, 150_000)
  assert.equal(Math.round(s.team.closingRate! * 10) / 10, 66.7)
  const marco = s.perMedewerker.find((r) => r.sleutel === 'marco')!
  const bram = s.perMedewerker.find((r) => r.sleutel === 'bram')!
  assert.equal(marco.gewonnen + bram.gewonnen, s.team.gewonnen, 'som per medewerker = team')
  assert.equal(bram.gewonnen, 1)
})

test('7. Een fasewissel is geen behandeling; e-mail telt als geslaagd contact; geen interesse ook', () => {
  const s = bereken({
    activiteiten: [
      act({ type: 'fase_gewijzigd', lead_id: 'L1' }),
      act({ type: 'email_verstuurd', lead_id: 'L2' }),
      act({ type: 'telefoongesprek', lead_id: 'L3', uitkomst: 'geen_interesse' }),
      act({ type: 'telefoongesprek', lead_id: 'L4', uitkomst: 'niet_opgenomen' }),
    ],
    leads: ['L1', 'L2', 'L3', 'L4'].map((id) => lead(id)), medewerkers,
  })
  assert.equal(s.team.uniekeLeads, 3)
  assert.equal(s.team.leadsMetContact, 2)
  assert.equal(s.team.appointmentRate, 0)
  assert.equal(Math.round(s.team.contactRate! * 10) / 10, 66.7)
})

test('8. Filters: medewerker, inbound/outbound, leadbron en dienst', () => {
  const acts = [
    act({ type: 'telefoongesprek', lead_id: 'W', medewerker_id: 'marco' }),
    act({ type: 'telefoongesprek', lead_id: 'O', medewerker_id: 'bram' }),
    act({ type: 'telefoongesprek', lead_id: 'H', medewerker_id: 'bram' }),
  ]
  const leads = [lead('W', { leadbron: 'website', dienst: 'Website' }), lead('O'), lead('H', { leadbron: 'harrie', dienst: 'Social media' })]
  assert.equal(bereken({ activiteiten: acts, leads, medewerkers }, { medewerkerId: 'bram' }).team.telefoongesprekken, 2)
  assert.equal(bereken({ activiteiten: acts, leads, medewerkers }, { richting: 'inbound' }).team.telefoongesprekken, 1)
  assert.equal(bereken({ activiteiten: acts, leads, medewerkers }, { richting: 'outbound' }).team.telefoongesprekken, 2)
  assert.equal(bereken({ activiteiten: acts, leads, medewerkers }, { leadbron: 'harrie' }).team.telefoongesprekken, 1)
  assert.equal(bereken({ activiteiten: acts, leads, medewerkers }, { dienst: 'website' }).team.telefoongesprekken, 1)
  const perBron = bereken({ activiteiten: acts, leads, medewerkers }).perLeadbron.map((r) => r.sleutel).sort()
  assert.deepEqual(perBron, ['harrie', 'outbound', 'website'])
})

test('9. Oude belregistraties tellen enkel vóór de eerste activiteit, zonder duur of uitkomst', () => {
  const events = [
    { id: 'e1', lead_id: 'L1', actor_id: 'marco', created_at: '2026-08-01T10:00:00Z' },
    { id: 'e2', lead_id: 'L1', actor_id: 'marco', created_at: '2026-09-10T10:00:00Z' },
  ]
  const oud = legacyGesprekken(events, '2026-09-01T00:00:00Z')
  assert.equal(oud.length, 1)
  assert.equal(oud[0].type, 'telefoongesprek')
  assert.equal(oud[0].duur_seconden, null)
  assert.equal(oud[0].uitkomst, null)
  assert.equal(legacyGesprekken(events, null).length, 2, 'zonder activiteiten tellen ze allemaal')
  const s = bereken({ activiteiten: oud, leads: [lead('L1')], medewerkers })
  assert.equal(s.team.telefoongesprekken, 1)
  assert.equal(s.team.gemiddeldeDuurSeconden, null)
  assert.equal(s.team.leadsMetContact, 0)
})

test('10. Trend in Brusselse tijd; week begint op maandag; vergelijking kiest de juiste mensen', () => {
  assert.equal(trendSleutel('2026-09-20T22:30:00Z', 'dag'), '2026-09-21') // 00u30 in Brussel
  assert.equal(trendSleutel('2026-09-24T10:00:00Z', 'week'), '2026-09-21')
  assert.equal(trendSleutel('2026-09-24T10:00:00Z', 'maand'), '2026-09')
  assert.equal(kiesTrendPer(1), 'dag')
  assert.equal(kiesTrendPer(60), 'week')
  assert.equal(kiesTrendPer(365), 'maand')
  const s = bereken({
    activiteiten: [
      act({ type: 'telefoongesprek', lead_id: 'L1', medewerker_id: 'marco', duur_seconden: 100 }),
      act({ type: 'telefoongesprek', lead_id: 'L2', medewerker_id: 'marco', duur_seconden: 100 }),
      act({ type: 'telefoongesprek', lead_id: 'L3', medewerker_id: 'bram', duur_seconden: 500 }),
      act({ type: 'deal_gewonnen', lead_id: 'L3', medewerker_id: 'bram' }),
    ],
    leads: ['L1', 'L2', 'L3'].map((id) => lead(id)), medewerkers, trendPer: 'maand',
  })
  const wie = Object.fromEntries(s.vergelijking.map((v) => [v.titel, v.naam]))
  assert.equal(wie['Meeste telefoongesprekken'], 'Marco')
  assert.equal(wie['Meeste beltijd'], 'Bram')
  assert.equal(wie['Meeste deals'], 'Bram')
  assert.equal(wie['Beste closing rate'], 'Bram')
  assert.equal(wie['Meeste afspraken'], undefined, 'niemand heeft afspraken → geen winnaar')
  assert.equal(s.trend.length, 1)
  assert.equal(s.trend[0].telefoongesprekken, 3)
})

console.log(`\n${n} tests geslaagd.`)
