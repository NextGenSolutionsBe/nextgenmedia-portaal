// Agenda: dag afsluiten.
// Uitvoeren: npx tsx tests/agenda-dag-afsluiten.test.ts
import assert from 'node:assert/strict'
import { zoneNaarIso, plaatsVan, type Item } from '../lib/agenda/model'
import { volgendeWerkdag, naarDag, afTeSluiten, vanMij, notitieErbij, hoeLangOpen, vanVorigeDagen, verplaatsingen, zoalsHetWas } from '../lib/agenda/dag-afsluiten'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nAgenda: dag afsluiten\n')
const iso = (d: string, u: string) => zoneNaarIso(d, u)

const it = (x: Partial<Item>): Item => ({
  id: x.id ?? Math.random().toString(36).slice(2), bron: 'ag', soort: 'taak', titel: 'x', beschrijving: null, status: 'open', clickup_status: null, clickup_status_kleur: null,
  urgent: false, prioriteit: null, start_op: null, eind_op: null, heel_dag: true, deadline_op: null, lijst_id: null, parent_id: null, client_id: null, labels: [], kleur: null,
  locatie: null, meet_url: null, prive: false, eigenaar_id: null, toegewezen: ['ik'], afgerond_op: null, afgerond_door: null, clickup_url: null, velden: null, ...x,
} as Item)

test('volgende werkdag slaat het weekend over', () => {
  assert.equal(volgendeWerkdag('2026-11-25'), '2026-11-26') // wo → do
  assert.equal(volgendeWerkdag('2026-11-27'), '2026-11-30') // vr → ma
  assert.equal(volgendeWerkdag('2026-11-28'), '2026-11-30') // za → ma
})

test('naar een andere dag: hele dag, met uur, enkel deadline, meerdere dagen', () => {
  const heel = naarDag({ start_op: null, eind_op: iso('2026-11-25', '00:00'), heel_dag: true, deadline_op: null }, '2026-11-26')!
  assert.deepEqual(plaatsVan(heel), { soort: 'dag', van: '2026-11-26', tot: '2026-11-26' })
  const uur = naarDag({ start_op: iso('2026-11-25', '14:00'), eind_op: iso('2026-11-25', '15:30'), heel_dag: false, deadline_op: null }, '2026-11-26')!
  assert.deepEqual(plaatsVan(uur), { soort: 'rooster', dag: '2026-11-26', vanMin: 840, totMin: 930 })
  const dl = naarDag({ start_op: null, eind_op: null, heel_dag: false, deadline_op: iso('2026-11-24', '17:00') }, '2026-11-26')!
  assert.equal(dl.deadline_op, iso('2026-11-26', '17:00'))
  assert.deepEqual(plaatsVan(dl), { soort: 'dag', van: '2026-11-26', tot: '2026-11-26' })
  const lang = naarDag({ start_op: iso('2026-11-23', '00:00'), eind_op: iso('2026-11-25', '00:00'), heel_dag: true, deadline_op: null }, '2026-11-26')!
  assert.deepEqual(plaatsVan(lang), { soort: 'dag', van: '2026-11-26', tot: '2026-11-26' })
  assert.equal(naarDag({ start_op: null, eind_op: null, heel_dag: true, deadline_op: null }, '2026-11-26'), null)
})

test('een latere deadline blijft staan, een gemiste schuift mee', () => {
  const later = naarDag({ start_op: null, eind_op: iso('2026-11-25', '00:00'), heel_dag: true, deadline_op: iso('2026-11-27', '17:00') }, '2026-11-26')!
  assert.equal(later.deadline_op, iso('2026-11-27', '17:00'))
  const gemist = naarDag({ start_op: iso('2026-11-25', '09:00'), eind_op: iso('2026-11-25', '10:00'), heel_dag: false, deadline_op: iso('2026-11-25', '12:00') }, '2026-11-26')!
  assert.equal(gemist.deadline_op, iso('2026-11-26', '12:00'))
})

test('wat op tafel komt: mijn open taken van vandaag en eerder, meetings van vandaag', () => {
  const items = [
    it({ id: 'vandaag', eind_op: iso('2026-11-25', '00:00') }),
    it({ id: 'gisteren', eind_op: iso('2026-11-24', '00:00') }),
    it({ id: 'morgen', eind_op: iso('2026-11-26', '00:00') }),
    it({ id: 'klaar', eind_op: iso('2026-11-25', '00:00'), status: 'klaar' }),
    it({ id: 'collega', eind_op: iso('2026-11-25', '00:00'), toegewezen: ['bram'] }),
    it({ id: 'zelfGemaakt', eind_op: iso('2026-11-25', '00:00'), toegewezen: [], eigenaar_id: 'ik' }),
    it({ id: 'loopt', start_op: iso('2026-11-24', '00:00'), eind_op: iso('2026-11-27', '00:00') }),
    it({ id: 'oud', eind_op: iso('2026-09-01', '00:00') }),
    it({ id: 'meeting', bron: 'meeting', soort: 'meeting', heel_dag: false, start_op: iso('2026-11-25', '10:00'), eind_op: iso('2026-11-25', '11:00') }),
    it({ id: 'meetingKlaar', bron: 'meeting', soort: 'meeting', status: 'klaar', heel_dag: false, start_op: iso('2026-11-25', '14:00'), eind_op: iso('2026-11-25', '15:00') }),
    it({ id: 'meetingCollega', bron: 'meeting', soort: 'meeting', toegewezen: ['bram'], heel_dag: false, start_op: iso('2026-11-25', '16:00'), eind_op: iso('2026-11-25', '17:00') }),
    it({ id: 'meetingGisteren', bron: 'meeting', soort: 'meeting', heel_dag: false, start_op: iso('2026-11-24', '10:00'), eind_op: iso('2026-11-24', '11:00') }),
  ]
  const { taken, meetings } = afTeSluiten(items, { ik: 'ik', dag: '2026-11-25' })
  // Enkel waar jij op staat: een taak die je maakte zonder er zelf op te staan, telt niet.
  assert.deepEqual(taken.map((x) => x.id), ['gisteren', 'vandaag'])
  // Ook een afgevinkte meeting blijft zichtbaar (je kan er nog taken uit halen).
  assert.deepEqual(meetings.map((x) => x.id), ['meeting', 'meetingKlaar'])
  assert.ok(!vanMij(it({ toegewezen: [], eigenaar_id: 'ik' }), 'ik'))
  assert.ok(!vanMij(it({ toegewezen: ['bram'], eigenaar_id: 'ik' }), 'ik'))
  assert.ok(vanMij(it({ toegewezen: ['bram', 'ik'] }), 'ik'))
})

test('notitie onderaan de beschrijving en hoe lang open', () => {
  assert.match(notitieErbij('Eerste regel', 'Wacht op foto’s van de klant', '2026-11-25'), /^Eerste regel\n\n\*\*Dag afgesloten 25 nov\.?:\*\* Wacht op foto’s van de klant$/)
  assert.equal(notitieErbij(null, '  ', '2026-11-25'), '')
  const nu = new Date(iso('2026-11-25', '18:00'))
  assert.equal(hoeLangOpen('2026-11-25', nu), 'vandaag')
  assert.equal(hoeLangOpen('2026-11-24', nu), 'gisteren')
  assert.equal(hoeLangOpen('2026-11-21', nu), '4 dagen geleden')
})

test('naar vandaag: enkel jouw open taken van vorige dagen, niet die van vandaag', () => {
  const d = '2026-11-27'
  const items = [
    it({ id: 'gisteren', eind_op: iso('2026-11-26', '00:00') }),
    it({ id: 'uur', start_op: iso('2026-11-26', '14:00'), eind_op: iso('2026-11-26', '15:00'), heel_dag: false }),
    it({ id: 'vandaag', eind_op: iso('2026-11-27', '00:00') }),
    it({ id: 'klaar', eind_op: iso('2026-11-26', '00:00'), status: 'klaar' }),
    it({ id: 'collega', eind_op: iso('2026-11-26', '00:00'), toegewezen: ['ander'] }),
    it({ id: 'meeting', eind_op: iso('2026-11-26', '00:00'), soort: 'meeting' }),
    it({ id: 'shoot', eind_op: iso('2026-11-26', '00:00'), bron: 'shoot' }),
    it({ id: 'loopt', start_op: iso('2026-11-25', '00:00'), eind_op: iso('2026-11-28', '00:00') }),
    it({ id: 'oud', eind_op: iso('2026-10-01', '00:00') }),
    it({ id: 'deadline', deadline_op: iso('2026-11-24', '17:00'), heel_dag: false }),
  ]
  assert.deepEqual(vanVorigeDagen(items, { ik: 'ik', dag: d }).map((x) => x.id), ['deadline', 'gisteren', 'uur'])
})

test('naar vandaag: uren blijven, gemiste deadline schuift mee, ongedaan maken zet alles terug', () => {
  const d = '2026-11-27'
  const lijst = [
    it({ id: 'a', start_op: iso('2026-11-26', '14:00'), eind_op: iso('2026-11-26', '15:00'), heel_dag: false }),
    it({ id: 'b', deadline_op: iso('2026-11-24', '17:00'), heel_dag: false }),
    it({ id: 'c', start_op: iso('2026-11-24', '00:00'), eind_op: iso('2026-11-26', '00:00'), deadline_op: iso('2026-12-02', '12:00') }),
  ]
  const v = verplaatsingen(lijst, d)
  assert.equal(v.length, 3)
  assert.deepEqual(plaatsVan(v[0]), { soort: 'rooster', dag: d, vanMin: 840, totMin: 900 })
  assert.equal(v[1].deadline_op, iso(d, '17:00'))
  assert.deepEqual(plaatsVan(v[2]), { soort: 'dag', van: d, tot: d })
  assert.equal(v[2].deadline_op, iso('2026-12-02', '12:00'), 'een latere deadline blijft')
  const terug = zoalsHetWas(lijst)
  assert.deepEqual(terug[0], { id: 'a', start_op: iso('2026-11-26', '14:00'), eind_op: iso('2026-11-26', '15:00'), heel_dag: false, deadline_op: null })
  assert.equal(terug.length, 3)
})

console.log(`\n${n} tests geslaagd\n`)
