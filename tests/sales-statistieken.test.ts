// Tests voor de salesstatistieken (pure rekenlogica).
// Uitvoeren: npx tsx tests/sales-statistieken.test.ts
import assert from 'node:assert/strict'
import {
  bereken, percentage, gemiddelde, toonPercentage, legacyGesprekken, trendSleutel, kiesTrendPer,
  bouwAccounts, type StatActiviteit, type StatLead,
} from '../lib/sales/statistieken'
import {
  beltijdSeconden, beltijdPerMedewerker, sessieSeconden, lopendeSessie, brusselNaarUtc, toonUren, type BeltijdSessie,
} from '../lib/sales/beltijd'

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
  assert.equal(wie['Meeste gespreksduur'], 'Bram')
  assert.equal(wie['Meeste gelogde beltijd'], undefined, 'geen belsessies → geen winnaar')
  assert.equal(wie['Meeste deals'], 'Bram')
  assert.equal(wie['Beste closing rate'], 'Bram')
  assert.equal(wie['Meeste afspraken'], undefined, 'niemand heeft afspraken → geen winnaar')
  assert.equal(s.trend.length, 1)
  assert.equal(s.trend[0].telefoongesprekken, 3)
})

// ── Gelogde beltijd (sales_beltijd) ──────────────────────────────────────────
const NU = Date.parse('2026-09-22T10:00:00Z')
const sessie = (deel: Partial<BeltijdSessie> & Pick<BeltijdSessie, 'id' | 'start_op'>): BeltijdSessie => ({
  medewerker_id: 'marco', einde_op: null, duur_seconden: null, verwijderd_op: null, ...deel,
})
const sessies: BeltijdSessie[] = [
  // afgesloten: 30 min
  sessie({ id: 's1', start_op: '2026-09-22T07:00:00Z', einde_op: '2026-09-22T07:30:00Z', duur_seconden: 1800 }),
  // lopend sinds 09:15 UTC → telt tot NU = 45 min
  sessie({ id: 's2', start_op: '2026-09-22T09:15:00Z' }),
  // zacht verwijderd: telt niet
  sessie({ id: 's3', start_op: '2026-09-22T06:00:00Z', einde_op: '2026-09-22T08:00:00Z', duur_seconden: 7200, verwijderd_op: '2026-09-22T08:05:00Z' }),
  // van Bram: 20 min, duur leeg → uit start/einde
  sessie({ id: 's4', medewerker_id: 'bram', start_op: '2026-09-22T08:00:00Z', einde_op: '2026-09-22T08:20:00Z' }),
  // buiten de periode (vorige maand)
  sessie({ id: 's5', start_op: '2026-08-30T08:00:00Z', einde_op: '2026-08-30T09:00:00Z', duur_seconden: 3600 }),
]

test('11. Gelogde beltijd: afgesloten + lopende sessie tot nu; verwijderd en buiten de periode tellen niet', () => {
  const periode = { van: '2026-09-01T00:00:00Z', tot: '2026-10-01T00:00:00Z', nu: NU }
  assert.equal(sessieSeconden(sessies[1], NU), 45 * 60)
  assert.equal(sessieSeconden(sessies[2], NU), 0, 'verwijderd = 0')
  assert.equal(sessieSeconden(sessie({ id: 'x', start_op: '2026-09-22T11:00:00Z' }), NU), 0, 'start in de toekomst → nooit negatief')
  assert.equal(beltijdSeconden(sessies, { ...periode, medewerkerId: 'marco' }), 30 * 60 + 45 * 60)
  assert.equal(beltijdSeconden(sessies, periode), 30 * 60 + 45 * 60 + 20 * 60)
  const per = beltijdPerMedewerker(sessies, periode)
  assert.equal(per.get('marco'), 75 * 60)
  assert.equal(per.get('bram'), 20 * 60)
  assert.equal(lopendeSessie(sessies, 'marco')?.id, 's2')
  assert.equal(lopendeSessie(sessies, 'bram'), null)
  assert.equal(toonUren(75 * 60), '1 u 15 min')
  assert.equal(toonUren(null), '—')
})

test('12. Beltijd in de statistieken: apart van de gespreksduur, nooit opgeteld; medewerkerfilter geldt', () => {
  const periodeSessies = sessies.filter((s) => s.start_op >= '2026-09-01')
  const bron = {
    activiteiten: [act({ type: 'telefoongesprek', lead_id: 'L1', medewerker_id: 'marco', duur_seconden: 120, uitkomst: 'contact_gehad' })],
    leads: [lead('L1')], medewerkers, beltijd: periodeSessies, nu: NU,
  }
  const s = bereken(bron)
  assert.equal(s.team.beltijdSeconden, 120, 'gespreksduur blijft de som per gesprek')
  assert.equal(s.team.gelogdeBeltijdSeconden, 95 * 60)
  const bram = s.perMedewerker.find((r) => r.sleutel === 'bram')
  assert.ok(bram, 'wie enkel beltijd logde staat ook in de lijst')
  assert.equal(bram!.telefoongesprekken, 0)
  assert.equal(bram!.gelogdeBeltijdSeconden, 20 * 60)
  assert.equal(s.perLeadbron[0].gelogdeBeltijdSeconden, null, 'beltijd hangt niet aan een leadbron')
  const enkelMarco = bereken(bron, { medewerkerId: 'marco' })
  assert.equal(enkelMarco.team.gelogdeBeltijdSeconden, 75 * 60)
  assert.equal(bereken({ activiteiten: [], leads: [], medewerkers }).team.gelogdeBeltijdSeconden, null, 'zonder beltijdbron: niet beschikbaar')
  const wie = Object.fromEntries(s.vergelijking.map((v) => [v.titel, v.naam]))
  assert.equal(wie['Meeste gelogde beltijd'], 'Marco')
})

test('13. Accounts: elk account een kaart (ook zonder activiteit), onbekend valt weg, lopende sessie gemarkeerd', () => {
  const s = bereken({
    activiteiten: [
      act({ type: 'telefoongesprek', lead_id: 'L1', medewerker_id: 'marco' }),
      act({ type: 'telefoongesprek', lead_id: 'L2', medewerker_id: null }),
    ],
    leads: [lead('L1'), lead('L2')], medewerkers,
  })
  const acc = bouwAccounts(s.perMedewerker, [...medewerkers, { id: 'lisa', naam: 'Lisa' }], ['lisa'], true)
  assert.deepEqual(acc.map((a) => a.label), ['Marco', 'Bram', 'Lisa'])
  assert.equal(acc.find((a) => a.sleutel === 'lisa')!.beltijdLoopt, true)
  assert.equal(acc.find((a) => a.sleutel === 'lisa')!.gelogdeBeltijdSeconden, 0)
  assert.equal(acc.find((a) => a.sleutel === 'bram')!.closingRate, null)
  assert.ok(!acc.some((a) => a.sleutel === 'onbekend'))
})

test('14. Handmatige beltijd: Brusselse tijd → UTC, in zomer- en wintertijd', () => {
  assert.equal(brusselNaarUtc('2026-09-22', '09:30')!.toISOString(), '2026-09-22T07:30:00.000Z')
  assert.equal(brusselNaarUtc('2026-01-15', '09:30')!.toISOString(), '2026-01-15T08:30:00.000Z')
  assert.equal(brusselNaarUtc('2026-13-01', '09:00'), null)
  assert.equal(brusselNaarUtc('gisteren', '09:00'), null)
})

console.log(`\n${n} tests geslaagd.`)
