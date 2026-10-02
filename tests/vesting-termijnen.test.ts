// Tests voor het gelijktrekken van WAM-termijnen met het schema (pure logica).
// Uitvoeren: npx tsx tests/vesting-termijnen.test.ts
import assert from 'node:assert/strict'
import { wamSchema, planTermijnSync, type BestaandeTermijn } from '../lib/vesting'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }

const schema = (maanden: number, bedrag = 500) =>
  wamSchema({ start_datum: '2026-01-15', contract_maanden: maanden, bedrag_per_factuur: bedrag, frequentie: 'maandelijks', btw_pct: 21 })

/** Termijnen zoals de sync ze voor een schema aanmaakt. */
const uitSchema = (s: ReturnType<typeof schema>): BestaandeTermijn[] =>
  s.map((x) => ({ id: `s${x.volgnr}`, ...x, status: 'gepland', invoice_id: null, notitie: null }))

const extra = (volgnr: number, over: Partial<BestaandeTermijn> = {}): BestaandeTermijn => ({
  id: `x${volgnr}`, volgnr, periode: '2026-03', factuurdatum: '2026-03-20', bedrag_excl: 250, btw_pct: 21, status: 'gepland', invoice_id: null, notitie: "extra pagina's", ...over,
})

console.log('Vesting — termijnen en schema')

test('1. Ongewijzigd schema: niets te doen', () => {
  const s = schema(6)
  const p = planTermijnSync(s, s, uitSchema(s))
  assert.deepEqual(p, { hernummeren: [], verwijderen: [], bijwerken: [], invoegen: [] })
})

test('2. Nieuwe WAM-klant: alle termijnen invoegen', () => {
  const p = planTermijnSync([], schema(3), [])
  assert.equal(p.invoegen.length, 3)
  assert.deepEqual(p.invoegen.map((t) => t.volgnr), [1, 2, 3])
})

test('3. Schema korter: extra termijn voorbij het schema blijft bestaan', () => {
  const oud = schema(6)
  const bestaand = [...uitSchema(oud), extra(7)]
  const p = planTermijnSync(oud, schema(4), bestaand)
  assert.deepEqual(p.verwijderen.sort(), ['s5', 's6'])
  assert.ok(!p.verwijderen.includes('x7'))
  assert.equal(p.invoegen.length, 0)
})

test('4. Schema langer: extra termijn schuift naar achteren i.p.v. overschreven te worden', () => {
  const oud = schema(6)
  const bestaand = [...uitSchema(oud), extra(7)]
  const p = planTermijnSync(oud, schema(8), bestaand)
  assert.deepEqual(p.hernummeren, [{ id: 'x7', volgnr: 9 }])
  assert.deepEqual(p.invoegen.map((t) => t.volgnr), [7, 8])
  assert.ok(!p.bijwerken.some((b) => b.id === 'x7'))
})

test('5. Nieuw bedrag: enkel geplande schematermijnen volgen, gefactureerde niet', () => {
  const oud = schema(3)
  const bestaand = uitSchema(oud)
  bestaand[0] = { ...bestaand[0], status: 'gefactureerd', invoice_id: 'inv1' }
  const p = planTermijnSync(oud, schema(3, 600), bestaand)
  assert.deepEqual(p.bijwerken.map((b) => b.id), ['s2', 's3'])
  assert.ok(p.bijwerken.every((b) => b.bedrag_excl === 600))
})

test('6. Met de hand aangepaste geplande termijn blijft zoals hij is', () => {
  const oud = schema(3)
  const bestaand = uitSchema(oud)
  bestaand[1] = { ...bestaand[1], bedrag_excl: 999 }
  const p = planTermijnSync(oud, schema(3, 600), bestaand)
  assert.ok(!p.bijwerken.some((b) => b.id === 's2'))
  const korter = planTermijnSync(oud, schema(1), bestaand)
  assert.ok(!korter.verwijderen.includes('s2'))
  assert.ok(korter.verwijderen.includes('s3'))
})

test('7. Schematermijn met notitie wordt niet gewist bij inkorten', () => {
  const oud = schema(3)
  const bestaand = uitSchema(oud)
  bestaand[2] = { ...bestaand[2], notitie: 'klant vroeg uitstel' }
  const p = planTermijnSync(oud, schema(2), bestaand)
  assert.deepEqual(p.verwijderen, [])
})

test('8. Eerst losse termijnen, daarna pas een schema: losse termijnen blijven en schuiven op', () => {
  const bestaand = [extra(1), extra(2, { id: 'x2b' })]
  const p = planTermijnSync([], schema(3), bestaand)
  assert.deepEqual(p.hernummeren, [{ id: 'x1', volgnr: 4 }, { id: 'x2b', volgnr: 5 }])
  assert.deepEqual(p.invoegen.map((t) => t.volgnr), [1, 2, 3])
  assert.deepEqual(p.verwijderen, [])
})

test('9. Schema gewist: geplande schematermijnen weg, extra en gefactureerde blijven', () => {
  const oud = schema(3)
  const bestaand = [...uitSchema(oud), extra(4)]
  bestaand[0] = { ...bestaand[0], status: 'betaald', invoice_id: null }
  const p = planTermijnSync(oud, [], bestaand)
  assert.deepEqual(p.verwijderen.sort(), ['s2', 's3'])
})

console.log(`\n${n} tests geslaagd`)
