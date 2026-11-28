// Reeksen in de agenda: vaste blokken, herhalende afspraken en taken.
//   npx tsx tests/agenda-reeksen.test.ts
import assert from 'node:assert/strict'
import { keren, reeksItems, controleerReeks, reeksTekst, blokkenOpMoment, leesReeksItemId, reeksItemId, weekdagVan, type Reeks } from '../lib/agenda/reeksen'
import { zoneNaarIso } from '../lib/agenda/model'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }
const P = '11111111-1111-4111-8111-111111111111', Q = '22222222-2222-4222-8222-222222222222'
const reeks = (x: Partial<Reeks> = {}): Reeks => ({ id: '33333333-3333-4333-8333-333333333333', soort: 'blok', blok_type: 'sales', titel: 'Sales', kleur: null, personen: [P], lijst_id: null, prive: false, dagen: [1, 3], interval_weken: 1, van: '09:00', tot: '11:00', start_datum: '2026-11-30', eind_datum: null, uitzonderingen: [], eigenaar_id: P, ...x })

test('weekdag: 30 nov 2026 is een maandag', () => { assert.equal(weekdagVan('2026-11-30'), 1); assert.equal(weekdagVan('2026-12-06'), 7) })

test('elke maandag en woensdag, vanaf de start', () => {
  assert.deepEqual(keren(reeks(), '2026-11-23', '2026-12-13'), ['2026-11-30', '2026-12-02', '2026-12-07', '2026-12-09'])
})

test('om de twee weken, met een einde en een uitzondering', () => {
  const r = reeks({ interval_weken: 2, eind_datum: '2027-01-15', uitzonderingen: ['2026-12-14'] })
  assert.deepEqual(keren(r, '2026-11-30', '2027-01-31'), ['2026-11-30', '2026-12-02', '2026-12-16', '2026-12-28', '2026-12-30', '2027-01-11', '2027-01-13'])
})

test('items voor de kalender: met uur in Brusselse tijd, en dagen met een eigen item vallen weg', () => {
  const it = reeksItems(reeks(), '2026-11-30', '2026-12-02', new Set(['2026-12-02']))
  assert.equal(it.length, 1)
  assert.equal(it[0].start_op, zoneNaarIso('2026-11-30', '09:00'))
  assert.equal(it[0].bron, 'reeks')
  assert.equal(it[0].kleur, '#f59e0b')
  assert.deepEqual(leesReeksItemId(it[0].id), { reeksId: reeks().id, datum: '2026-11-30' })
  assert.equal(leesReeksItemId(reeksItemId('x', '2026-01-01')), null)
})

test('herhalende taak zonder uur staat bovenaan de dag', () => {
  const [t] = reeksItems(reeks({ soort: 'taak', van: null, tot: null, lijst_id: Q }), '2026-11-30', '2026-11-30')
  assert.equal(t.heel_dag, true)
  assert.equal(t.soort, 'taak')
})

test('invoer nakijken', () => {
  assert.equal(controleerReeks({ soort: 'blok', dagen: [], start_datum: '2026-11-30', personen: [P], van: '09:00', tot: '10:00' }).ok, false)
  assert.equal(controleerReeks({ soort: 'blok', dagen: [1], start_datum: '2026-11-30', personen: [P], van: '10:00', tot: '09:00' }).ok, false)
  assert.equal(controleerReeks({ soort: 'taak', dagen: [1], start_datum: '2026-11-30', personen: [P] }).ok, false) // map ontbreekt
  const r = controleerReeks({ soort: 'blok', blok_type: 'focus', dagen: [5, 1, 1], start_datum: '2026-11-30', personen: [P, 'nee'], van: '13:00', tot: '17:00' })
  assert.ok(r.ok)
  if (r.ok) { assert.deepEqual(r.reeks.dagen, [1, 5]); assert.equal(r.reeks.titel, 'Focuswerk'); assert.deepEqual(r.reeks.personen, [P]) }
})

test('leesbare tekst', () => {
  assert.equal(reeksTekst(reeks()), 'Elke ma, wo, 09:00–11:00')
  assert.equal(reeksTekst(reeks({ dagen: [1, 2, 3, 4, 5], interval_weken: 2, van: null, tot: null })), 'Om de 2 weken op werkdag')
})

test('vaste blokken op een moment: enkel van die persoon en als het overlapt', () => {
  const r = [reeks()]
  assert.equal(blokkenOpMoment(r, P, zoneNaarIso('2026-11-30', '10:30'), zoneNaarIso('2026-11-30', '11:00')).length, 1)
  assert.equal(blokkenOpMoment(r, P, zoneNaarIso('2026-11-30', '11:00'), zoneNaarIso('2026-11-30', '11:30')).length, 0)
  assert.equal(blokkenOpMoment(r, Q, zoneNaarIso('2026-11-30', '10:30'), zoneNaarIso('2026-11-30', '11:00')).length, 0)
  assert.equal(blokkenOpMoment([reeks({ soort: 'afspraak' })], P, zoneNaarIso('2026-11-30', '10:30'), zoneNaarIso('2026-11-30', '11:00')).length, 0)
})

console.log(`\n${n} tests geslaagd\n`)
