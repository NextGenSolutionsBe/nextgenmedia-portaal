// Projectkaart verwijderen: wat eraan hangt verhuist of wordt losgekoppeld.
//   npx tsx tests/opdrachten-verwijderen.test.ts
import assert from 'node:assert/strict'
import { verwijderPlan, VERWIJZINGEN, type KaartKort } from '../lib/opdrachten-verwijderen'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }

const kaart = (id: string, extra: Partial<KaartKort> = {}): KaartKort => ({ id, titel: id, client_id: 'klant', contract_id: null, ...extra })

test('kaart zonder contract of offerte: gewoon weg, mails en meetings losgekoppeld', () => {
  const p = verwijderPlan(kaart('a'), [kaart('b', { contract_id: 'c1' })], [])
  assert.deepEqual(p, { ok: true, contractNaar: null, restNaar: null })
})

test('kaart met contract en een dubbele kaart zonder contract: het contract verhuist', () => {
  const p = verwijderPlan(kaart('a', { contract_id: 'c1' }), [kaart('b', { contract_id: 'c2' }), kaart('c')], [])
  assert.deepEqual(p, { ok: true, contractNaar: 'c', restNaar: 'c' })
})

test('kaart met contract en geen andere kaart: niet verwijderen, wel zeggen waarom', () => {
  const p = verwijderPlan(kaart('a', { contract_id: 'c1' }), [], [])
  assert.equal(p.ok, false)
  if (!p.ok) assert.match(p.reden, /Verloren/)
})

test('lopende offerte verhuist naar de recentste andere kaart van de klant', () => {
  const p = verwijderPlan(kaart('a'), [kaart('b'), kaart('c')], [{ id: 'o', titel: 'Website', status: 'verstuurd' }])
  assert.deepEqual(p, { ok: true, contractNaar: null, restNaar: 'b' })
})

test('lopende offerte zonder andere kaart: niet verwijderen', () => {
  const p = verwijderPlan(kaart('a'), [], [{ id: 'o', titel: 'Website', status: 'concept' }])
  assert.equal(p.ok, false)
  if (!p.ok) assert.match(p.reden, /"Website"/)
})

test('afgewezen offerte houdt het verwijderen niet tegen', () => {
  assert.equal(verwijderPlan(kaart('a'), [], [{ id: 'o', titel: null, status: 'afgewezen' }]).ok, true)
})

test('kaart van een andere klant neemt nooit iets over', () => {
  const p = verwijderPlan(kaart('a', { contract_id: 'c1' }), [kaart('x', { client_id: 'ander' })], [])
  assert.equal(p.ok, false)
})

test('alle verwijzingen zonder "bij verwijderen" staan in de lijst', () => {
  const sleutels = VERWIJZINGEN.map((v) => `${v.tabel}.${v.kolom}`)
  for (const s of ['mail_projecten.opdracht_id', 'mail_berichten.opdracht_id', 'offertes.opdracht_id', 'klant_meetings.project_id', 'opleveringen.opdracht_id']) assert.ok(sleutels.includes(s), s)
})

console.log(`\n${n} tests geslaagd\n`)
