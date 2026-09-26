// Salesprestaties: scenario's uit de opdracht.
//
//   npx tsx tests/sales-prestaties.test.ts

import assert from 'node:assert/strict'
import { berekenPrestaties, gemetenDuur, isGehouden, type PActiviteit, type PAfspraak, type PLead, type PInvoer } from '../lib/sales/prestaties'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }

const VAN = '2026-09-01T00:00:00.000Z', TOT = '2026-10-01T00:00:00.000Z', NU = '2026-09-26T12:00:00.000Z'
const A = 'setter-a', B = 'closer-b', C = 'closer-c'
let id = 0
const act = (p: Partial<PActiviteit>): PActiviteit => ({ id: `a${++id}`, lead_id: 'L1', medewerker_id: A, type: 'telefoongesprek', created_at: '2026-09-10T10:00:00.000Z', ...p })
const afs = (p: Partial<PAfspraak>): PAfspraak => ({ id: `f${++id}`, lead_id: 'L1', setter_id: A, verantwoordelijke_id: B, starts_at: '2026-09-15T10:00:00.000Z', status: 'scheduled', aanwezigheid: null, outcome: null, created_at: '2026-09-10T10:05:00.000Z', ...p })
const lead = (p: Partial<PLead>): PLead => ({ id: 'L1', stage_key: 'afspraak', assigned_to: B, gesloten_op: null, ...p })
const run = (p: Partial<PInvoer>) => berekenPrestaties({ activiteiten: [], afspraken: [], leads: [], van: VAN, tot: TOT, nu: NU, ...p })
const van = (r: ReturnType<typeof run>, wie: string) => r.perMedewerker.find((x) => x.sleutel === wie)

console.log('\nSalesprestaties\n')

test('1. Cold calls uit Focus Mode, bereikte leads uniek, duur enkel gemeten', () => {
  const r = run({ activiteiten: [
    act({ bron: 'focus', uitkomst: 'niet_opgenomen' }),
    act({ bron: 'focus', uitkomst: 'contact_gehad', gesprek_start: '2026-09-10T10:00:00Z', gesprek_eind: '2026-09-10T10:03:20Z' }),
    act({ bron: 'focus', uitkomst: 'afspraak_gepland', lead_id: 'L1' }), // zelfde lead: 1 unieke bereikte lead
    act({ bron: null, uitkomst: null }), // oud, zonder bron
  ] })
  const a = van(r, A)!
  assert.equal(a.coldCalls, 3)
  assert.equal(a.gesprekkenZonderBron, 1)
  assert.equal(a.bereikteLeads, 1)
  assert.equal(a.gesprekkenMetDuur, 1)
  assert.equal(a.gespreksduurSec, 200)
  assert.equal(a.gesprekkenZonderDuur, 2) // niets geschat
  assert.equal(gemetenDuur({ gesprek_start: '2026-09-10T10:05:00Z', gesprek_eind: '2026-09-10T10:00:00Z' }), null)
})

test('2. Gemiste afspraak: niet gehouden, telt niet in de closing rate', () => {
  const r = run({
    afspraken: [afs({ aanwezigheid: 'niet_gehouden' })],
    leads: [lead({ stage_key: 'verloren', gesloten_op: '2026-09-20T10:00:00Z' })],
  })
  const b = van(r, B)!
  assert.equal(b.afsprakenGehouden, 0)
  assert.equal(b.afsprakenNietGehouden, 1)
  assert.equal(b.verloren, 1)            // de lead is wel verloren…
  assert.equal(b.closingAfgerond, 0)     // …maar zonder gehouden afspraak
  assert.equal(b.closingRate, null)      // geen percentage
  assert.equal(van(r, A)!.afsprakenIngepland, 1) // ingepland blijft ingepland
})

test('3. Lead wisselt meerdere keren van fase: elke echte verplaatsing = 1 actie', () => {
  const r = run({ activiteiten: [
    act({ type: 'fase_gewijzigd', van_fase: 'outbound', naar_fase: 'gebeld' }),
    act({ type: 'fase_gewijzigd', van_fase: 'gebeld', naar_fase: 'outbound' }),
    act({ type: 'fase_gewijzigd', van_fase: 'outbound', naar_fase: 'gebeld' }),
    act({ type: 'fase_gewijzigd', van_fase: 'gebeld', naar_fase: 'gebeld' }), // geen faseverschil
  ] })
  assert.equal(van(r, A)!.faseverplaatsingen, 3)
})

test('4. Collega A versleept naar Gewonnen; de deal telt voor verantwoordelijke B', () => {
  const r = run({
    activiteiten: [act({ type: 'fase_gewijzigd', medewerker_id: A, van_fase: 'afspraak', naar_fase: 'gewonnen', created_at: '2026-09-20T09:00:00Z' })],
    afspraken: [afs({ aanwezigheid: 'gehouden' })],
    leads: [lead({ stage_key: 'gewonnen', gesloten_op: '2026-09-20T09:00:00Z', assigned_to: B })],
  })
  assert.equal(van(r, A)!.faseverplaatsingen, 1)
  assert.equal(van(r, A)!.gewonnen, 0)
  assert.equal(van(r, B)!.gewonnen, 1)
  assert.equal(van(r, B)!.afsprakenGehouden, 1)
  assert.equal(van(r, B)!.closingRate, 100)
  assert.equal(r.podium.closer[0].sleutel, B)
  assert.equal(r.podium.closer[0].detail, '1 / 1')
})

test('5. Correctie achteraf: gehouden → niet gehouden haalt de lead uit de closing rate', () => {
  const basis = { leads: [lead({ stage_key: 'gewonnen', gesloten_op: '2026-09-20T09:00:00Z' })] }
  const voor = run({ ...basis, afspraken: [afs({ aanwezigheid: 'gehouden' })] })
  const na = run({ ...basis, afspraken: [afs({ aanwezigheid: 'niet_gehouden' })] })
  assert.equal(van(voor, B)!.closingRate, 100)
  assert.equal(van(na, B)!.closingRate, null)
  assert.equal(van(na, B)!.afsprakenNietGehouden, 1)
})

test('6. Ingepland: unieke leads, geannuleerd telt niet; voorbij en onbevestigd apart', () => {
  const r = run({ afspraken: [
    afs({ lead_id: 'L1' }), afs({ lead_id: 'L1', starts_at: '2026-09-18T10:00:00Z' }), // 2× dezelfde lead
    afs({ lead_id: 'L2', status: 'cancelled' }),
    afs({ lead_id: 'L3', starts_at: '2026-09-28T10:00:00Z' }), // nog niet voorbij
  ] })
  assert.equal(van(r, A)!.afsprakenIngepland, 2) // L1 + L3
  assert.equal(van(r, B)!.afsprakenOnbevestigd, 2) // de twee voorbije L1-afspraken
  assert.equal(van(r, B)!.afsprakenGehouden, 0)
})

test('7. Closing rate en podium: gelijke stand = zelfde plaats; uitkomst impliceert gehouden', () => {
  assert.equal(isGehouden({ aanwezigheid: null, outcome: 'won' }), true)
  const r = run({
    afspraken: [
      afs({ lead_id: 'L1', verantwoordelijke_id: B, aanwezigheid: 'gehouden' }),
      afs({ lead_id: 'L2', verantwoordelijke_id: C, aanwezigheid: 'gehouden' }),
      afs({ lead_id: 'L3', verantwoordelijke_id: C, aanwezigheid: 'gehouden' }),
      afs({ lead_id: 'L4', verantwoordelijke_id: C, aanwezigheid: 'gehouden', setter_id: B }),
    ],
    leads: [
      lead({ id: 'L1', stage_key: 'gewonnen', gesloten_op: '2026-09-20T00:00:00Z' }),
      lead({ id: 'L2', stage_key: 'gewonnen', gesloten_op: '2026-09-20T00:00:00Z' }),
      lead({ id: 'L3', stage_key: 'gewonnen', gesloten_op: '2026-09-21T00:00:00Z' }),
      lead({ id: 'L4', stage_key: 'afspraak' }), // nog niet afgerond
    ],
  })
  assert.deepEqual(r.podium.closer.map((p) => [p.plaats, p.sleutel]), [[1, B], [1, C]])
  assert.equal(r.team.closingRate, 100)
  assert.deepEqual(r.podium.coldCaller.map((p) => [p.plaats, p.sleutel, p.waarde]), [[1, A, 3], [2, B, 1]])
})

test('8. Geen interesse: unieke leads, telt voor wie het deed (laatste keer)', () => {
  const r = run({ activiteiten: [
    act({ type: 'fase_gewijzigd', medewerker_id: A, van_fase: 'gebeld', naar_fase: 'geen_interesse', created_at: '2026-09-11T10:00:00Z' }),
    act({ type: 'fase_gewijzigd', medewerker_id: B, van_fase: 'geen_interesse', naar_fase: 'gebeld', created_at: '2026-09-12T10:00:00Z' }),
    act({ type: 'fase_gewijzigd', medewerker_id: B, van_fase: 'gebeld', naar_fase: 'geen_interesse', created_at: '2026-09-13T10:00:00Z' }),
  ] })
  assert.equal(van(r, A)!.geenInteresse, 0)
  assert.equal(van(r, B)!.geenInteresse, 1)
  assert.equal(r.team.geenInteresse, 1)
  assert.equal(van(r, B)!.faseverplaatsingen, 2)
})

test('9. Buiten de periode telt niets; sluiting zonder datum apart', () => {
  const r = run({
    activiteiten: [act({ bron: 'focus', created_at: '2026-08-31T23:59:00Z' })],
    leads: [lead({ stage_key: 'gewonnen', gesloten_op: null })],
  })
  assert.equal(r.team.coldCalls, 0)
  assert.equal(r.geslotenZonderDatum, 1)
  assert.equal(r.team.closingRate, null)
})

console.log(`\n${n} tests geslaagd\n`)
