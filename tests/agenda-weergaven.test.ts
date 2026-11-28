// Agenda: werkweek, planning en wat er per dag staat.
// Uitvoeren: npx tsx tests/agenda-weergaven.test.ts
import assert from 'node:assert/strict'
import { dagenVan, verschuif, bereikVan, perDagVan, isWeergave, zoneNaarIso, herkomstVan, type Map as AgMap, type Lijst } from '../lib/agenda/model'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nAgenda: weergaven\n')
const iso = (d: string, u: string) => zoneNaarIso(d, u)

test('werkweek = maandag tot vrijdag, planning = de hele week', () => {
  assert.deepEqual(dagenVan('werkweek', '2026-11-29'), ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27'])
  assert.equal(dagenVan('planning', '2026-11-25').length, 7)
  assert.equal(dagenVan('planning', '2026-11-25')[6], '2026-11-29')
  assert.equal(verschuif('werkweek', '2026-11-25', 1), '2026-12-02')
  assert.equal(verschuif('planning', '2026-11-25', -1), '2026-11-18')
  assert.equal(bereikVan('werkweek', '2026-11-25').tot, iso('2026-11-28', '00:00'))
  assert.ok(isWeergave('planning') && isWeergave('werkweek') && !isWeergave('lijst'))
})

test('per dag: zonder uur eerst, dan op uur, afgevinkt onderaan, meerdere dagen overal', () => {
  const it = (id: string, x: { start_op?: string | null; eind_op?: string | null; heel_dag?: boolean; deadline_op?: string | null; status?: string }) =>
    ({ id, titel: id, start_op: null, eind_op: null, heel_dag: false, deadline_op: null, status: 'open', ...x })
  const items = [
    it('middag', { start_op: iso('2026-11-25', '14:00'), eind_op: iso('2026-11-25', '15:00') }),
    it('ochtend', { start_op: iso('2026-11-25', '09:00'), eind_op: iso('2026-11-25', '10:00') }),
    it('heledag', { eind_op: iso('2026-11-25', '00:00'), heel_dag: true }),
    it('klaar', { eind_op: iso('2026-11-25', '00:00'), heel_dag: true, status: 'klaar' }),
    it('deadline', { deadline_op: iso('2026-11-25', '17:00') }),
    it('loopt', { start_op: iso('2026-11-24', '00:00'), eind_op: iso('2026-11-26', '00:00'), heel_dag: true }),
    it('buiten', { eind_op: iso('2026-12-10', '00:00'), heel_dag: true }),
  ]
  const m = perDagVan(items, dagenVan('week', '2026-11-25'))
  assert.deepEqual(m.get('2026-11-25')!.map((x) => x.id), ['deadline', 'heledag', 'loopt', 'ochtend', 'middag', 'klaar'])
  assert.deepEqual(m.get('2026-11-24')!.map((x) => x.id), ['loopt'])
  assert.equal(m.get('2026-11-27'), undefined)
})

test('label per blok: de klant, anders de bovenste map, niets in iemands eigen privémap', () => {
  const map = (id: string, naam: string, x: Partial<AgMap> = {}): AgMap => ({ id, space_id: 's', parent_id: null, naam, kleur: null, client_id: null, prive: false, volgorde: 0, clickup_id: null, ...x })
  const lijst = (id: string, naam: string, x: Partial<Lijst> = {}): Lijst => ({ id, space_id: 's', map_id: null, naam, kleur: null, client_id: null, prive: false, volgorde: 0, clickup_id: null, ...x })
  const mappen = Object.fromEntries([
    map('tm', 'TM Technics', { client_id: 'k-tm' }), map('shoots', 'Shoots', { parent_id: 'tm' }),
    map('era', 'ERA Nobis '), map('bram', 'Bram Privé'),
  ].map((m) => [m.id, m]))
  const lijsten = Object.fromEntries([
    lijst('l-tm', 'List', { map_id: 'shoots' }), lijst('l-era', 'List', { map_id: 'era' }), lijst('l-sport', 'Sport', { map_id: 'bram' }),
    lijst('l-aanvragen', 'Aanvragen'), lijst('l-leeg', 'List'),
  ].map((l) => [l.id, l]))
  const c = { mappen, lijsten, klanten: { 'k-tm': 'TM Technics', 'k-ap': 'Apex Fuel' }, leden: { 'map:bram': ['bram'] } }
  assert.deepEqual(herkomstVan({ client_id: null, lijst_id: 'l-tm' }, c), { naam: 'TM Technics', mapId: 'tm' })
  assert.deepEqual(herkomstVan({ client_id: null, lijst_id: 'l-era' }, c), { naam: 'ERA Nobis', mapId: 'era' })
  assert.equal(herkomstVan({ client_id: null, lijst_id: 'l-sport' }, c), null)
  assert.deepEqual(herkomstVan({ client_id: 'k-ap', lijst_id: 'l-sport' }, c), { naam: 'Apex Fuel', mapId: 'bram' })
  assert.deepEqual(herkomstVan({ client_id: null, lijst_id: 'l-aanvragen' }, c), { naam: 'Aanvragen', mapId: null })
  assert.equal(herkomstVan({ client_id: null, lijst_id: 'l-leeg' }, c), null)
  assert.deepEqual(herkomstVan({ client_id: 'k-tm', lijst_id: null }, c), { naam: 'TM Technics', mapId: null })
  assert.equal(herkomstVan({ client_id: null, lijst_id: null }, c), null)
})

console.log(`\n${n} tests geslaagd\n`)
