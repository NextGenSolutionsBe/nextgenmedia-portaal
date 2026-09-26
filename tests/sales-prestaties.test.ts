// Salesprestaties: scenario's uit de opdracht.
//
//   npx tsx tests/sales-prestaties.test.ts

import assert from 'node:assert/strict'
import { berekenPrestaties, gemetenDuur, isGehouden, uitkomstUitOudeTekst, type PActiviteit, type PAfspraak, type PLead, type PInvoer } from '../lib/sales/prestaties'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }

const VAN = '2026-09-01T00:00:00.000Z', TOT = '2026-10-01T00:00:00.000Z', NU = '2026-09-26T12:00:00.000Z'
const A = 'setter-a', B = 'closer-b', C = 'closer-c'
let id = 0
const act = (p: Partial<PActiviteit>): PActiviteit => ({ id: `a${++id}`, lead_id: 'L1', medewerker_id: A, type: 'telefoongesprek', created_at: '2026-09-10T10:00:00.000Z', ...p })
const afs = (p: Partial<PAfspraak>): PAfspraak => ({ id: `f${++id}`, lead_id: 'L1', setter_id: A, verantwoordelijke_id: B, starts_at: '2026-09-15T10:00:00.000Z', status: 'scheduled', aanwezigheid: null, outcome: null, created_at: '2026-09-10T10:05:00.000Z', ...p })
const lead = (p: Partial<PLead>): PLead => ({ id: 'L1', stage_key: 'afspraak', assigned_to: B, ...p })
const run = (p: Partial<PInvoer>) => berekenPrestaties({ activiteiten: [], afspraken: [], leads: [], van: VAN, tot: TOT, nu: NU, ...p })
const van = (r: ReturnType<typeof run>, wie: string) => r.perMedewerker.find((x) => x.sleutel === wie)

console.log('\nSalesprestaties\n')

test('1. Cold calls = één totaal (met en zonder bron), bereikt uniek, duur enkel gemeten', () => {
  const r = run({ activiteiten: [
    act({ bron: 'focus', uitkomst: 'niet_opgenomen' }),
    act({ bron: 'focus', uitkomst: 'contact_gehad', gesprek_start: '2026-09-10T10:00:00Z', gesprek_eind: '2026-09-10T10:03:20Z' }),
    act({ bron: 'focus', uitkomst: 'afspraak_gepland', lead_id: 'L1' }), // zelfde lead: 1 unieke bereikte lead
    act({ bron: null, uitkomst: null }), // oude registratie zonder bron: telt gewoon mee
    act({ bron: 'pipeline', uitkomst: 'contact_gehad', lead_id: 'L2' }),
  ] })
  const a = van(r, A)!
  assert.equal(a.coldCalls, 5)
  assert.equal(a.bereikteLeads, 2)
  assert.equal(a.gesprekkenMetDuur, 1)
  assert.equal(a.gespreksduurSec, 200)
  assert.equal(a.gesprekkenZonderDuur, 4) // niets geschat
  assert.equal(gemetenDuur({ gesprek_start: '2026-09-10T10:05:00Z', gesprek_eind: '2026-09-10T10:00:00Z' }), null)
})

test('2. Oude belregistraties: uitkomst uit de tijdlijntekst (voor "bereikt")', () => {
  assert.equal(uitkomstUitOudeTekst('Geen antwoord'), 'niet_opgenomen')
  assert.equal(uitkomstUitOudeTekst('Geen interesse — Geen behoefte'), 'geen_interesse')
  assert.equal(uitkomstUitOudeTekst('Terugbelafspraak (Morgen 9u)'), 'contact_gehad')
  assert.equal(uitkomstUitOudeTekst('Gebeld · Niet opgenomen'), 'niet_opgenomen')
  assert.equal(uitkomstUitOudeTekst('Leadlijst 16/09/2026 – Terugbellen: Mail gestuurd'), null)
})

test('3. Pipelinecijfers tellen voor de verantwoordelijke op de lead', () => {
  const r = run({ leads: [
    lead({ id: 'L1', stage_key: 'gewonnen', assigned_to: B }),
    lead({ id: 'L2', stage_key: 'geen_interesse', assigned_to: C }),
    lead({ id: 'L3', stage_key: 'verloren', assigned_to: B }),
    lead({ id: 'L4', stage_key: 'afspraak', assigned_to: C }),
    lead({ id: 'L5', stage_key: 'voorstel', assigned_to: C }),
    lead({ id: 'L6', stage_key: 'gebeld', assigned_to: B }), // telt nergens
  ] })
  const b = van(r, B)!, c = van(r, C)!
  assert.deepEqual([b.gewonnen, b.verloren, b.geenInteresse, b.afsprakenIngepland, b.afsprakenGehouden], [1, 1, 0, 2, 2])
  assert.deepEqual([c.gewonnen, c.verloren, c.geenInteresse, c.afsprakenIngepland, c.afsprakenGehouden], [0, 0, 1, 2, 1])
  assert.equal(b.closingRate, 50)
  assert.equal(c.closingRate, null)
})

test('4. Collega A versleept naar Gewonnen: faseverplaatsing voor A, deal voor verantwoordelijke B', () => {
  const r = run({
    activiteiten: [act({ type: 'fase_gewijzigd', medewerker_id: A, van_fase: 'afspraak', naar_fase: 'gewonnen' })],
    leads: [lead({ stage_key: 'gewonnen', assigned_to: B })],
  })
  assert.equal(van(r, A)!.faseverplaatsingen, 1)
  assert.equal(van(r, A)!.gewonnen, 0)
  assert.equal(van(r, B)!.gewonnen, 1)
  assert.equal(van(r, B)!.faseverplaatsingen, 0)
  assert.equal(r.podium.closer[0].sleutel, B)
  assert.equal(r.podium.closer[0].detail, '1 / 1')
})

test('5. Lead wisselt meerdere keren van fase: elke echte verplaatsing = 1, telt 1× in de pipeline', () => {
  const r = run({
    activiteiten: [
      act({ type: 'fase_gewijzigd', van_fase: 'afspraak', naar_fase: 'verloren' }),
      act({ type: 'fase_gewijzigd', van_fase: 'verloren', naar_fase: 'afspraak' }),
      act({ type: 'fase_gewijzigd', van_fase: 'afspraak', naar_fase: 'gewonnen' }),
      act({ type: 'fase_gewijzigd', van_fase: 'gewonnen', naar_fase: 'gewonnen' }), // geen faseverschil
    ],
    leads: [lead({ stage_key: 'gewonnen' })],
  })
  assert.equal(van(r, A)!.faseverplaatsingen, 3)
  assert.equal(van(r, B)!.gewonnen, 1)
  assert.equal(van(r, B)!.verloren, 0) // enkel de actuele fase telt
})

test('6. Verantwoordelijke achteraf gewijzigd: de cijfers verhuizen meteen mee', () => {
  const voor = run({ leads: [lead({ stage_key: 'gewonnen', assigned_to: B })] })
  const na = run({ leads: [lead({ stage_key: 'gewonnen', assigned_to: C })] })
  assert.equal(van(voor, B)!.gewonnen, 1)
  assert.equal(van(na, B), undefined)
  assert.equal(van(na, C)!.gewonnen, 1)
})

test('7. Gemiste afspraak: ingepland maar niet gehouden; bevestiging en correctie tellen', () => {
  const basis = { leads: [lead({ stage_key: 'afspraak' })] }
  const gemist = run({ ...basis, afspraken: [afs({ aanwezigheid: 'niet_gehouden' })] })
  assert.equal(van(gemist, B)!.afsprakenIngepland, 1)
  assert.equal(van(gemist, B)!.afsprakenGehouden, 0)
  assert.equal(van(gemist, B)!.afsprakenNietGehouden, 1)
  const onbevestigd = run({ ...basis, afspraken: [afs({})] })
  assert.equal(van(onbevestigd, B)!.afsprakenOnbevestigd, 1)
  const gecorrigeerd = run({ ...basis, afspraken: [afs({ aanwezigheid: 'gehouden' })] })
  assert.equal(van(gecorrigeerd, B)!.afsprakenGehouden, 1)
  assert.equal(isGehouden({ aanwezigheid: null, outcome: 'won' }), true)
})

test('8. Afspraak in de agenda telt als ingepland (ook in een andere fase); geannuleerd niet; 2 afspraken = 1 lead', () => {
  const r = run({
    afspraken: [afs({ lead_id: 'L1' }), afs({ lead_id: 'L1', starts_at: '2026-09-18T10:00:00Z' }), afs({ lead_id: 'L2', status: 'cancelled' })],
    leads: [lead({ id: 'L1', stage_key: 'opvolgen' }), lead({ id: 'L2', stage_key: 'opvolgen' })],
  })
  assert.equal(van(r, B)!.afsprakenIngepland, 1)
})

test('9. Zonder verantwoordelijke: apart als "niet toegewezen", team telt alles', () => {
  const r = run({ leads: [lead({ id: 'L1', stage_key: 'geen_interesse', assigned_to: null }), lead({ id: 'L2', stage_key: 'gewonnen', assigned_to: B })] })
  assert.equal(van(r, 'onbekend')!.geenInteresse, 1)
  assert.equal(r.team.geenInteresse, 1)
  assert.equal(r.team.gewonnen, 1)
  assert.equal(r.podium.closer.length, 1) // 'niet toegewezen' komt nooit op het podium
})

test('10. Podium: cold caller op cold calls, gelijke stand = zelfde plaats; buiten de periode telt niet', () => {
  const r = run({ activiteiten: [
    act({ medewerker_id: A }), act({ medewerker_id: A }), act({ medewerker_id: B }), act({ medewerker_id: C }),
    act({ medewerker_id: C, created_at: '2026-08-31T23:59:00Z' }), // buiten de periode
  ] })
  assert.deepEqual(r.podium.coldCaller.map((p) => [p.plaats, p.sleutel, p.waarde]), [[1, A, 2], [2, B, 1], [2, C, 1]])
})

console.log(`\n${n} tests geslaagd\n`)
