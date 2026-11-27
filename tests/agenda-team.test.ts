// Teamagenda: beschikbaarheid, capaciteit, iCal en verschillen met ClickUp.
//   npx tsx tests/agenda-team.test.ts
import assert from 'node:assert/strict'
import { beschikbaarMinuten, geplandMinuten, capaciteit, controleerBeschikbaarheid, urenTekst } from '../lib/agenda/team'
import { icalFeed } from '../lib/agenda/ical-feed'
import { clickupVerschil, zoneNaarIso, type Item } from '../lib/agenda/model'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }
const P = 'p1', Q = 'p2'
const item = (x: Partial<Item>): Item => ({ id: 'i', bron: 'ag', soort: 'taak', titel: 'Taak', beschrijving: null, status: 'open', clickup_status: null, clickup_status_kleur: null, urgent: false, prioriteit: null, start_op: null, eind_op: null, heel_dag: false, deadline_op: null, lijst_id: null, parent_id: null, client_id: null, labels: [], kleur: null, locatie: null, meet_url: null, prive: false, eigenaar_id: P, toegewezen: [P], afgerond_op: null, afgerond_door: null, clickup_url: null, velden: null, updated_at: '', ...x })
const week = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06']

test('beschikbaar: ma tot vr 09:00–17:00 = 40 uur', () => {
  const b = [1, 2, 3, 4, 5].map((w) => ({ persoon_id: P, weekdag: w, van: '09:00', tot: '17:00' }))
  assert.equal(beschikbaarMinuten(b, P, week), 40 * 60)
  assert.equal(beschikbaarMinuten(b, Q, week), 0)
})

test('gepland: enkel met uur en waar de persoon op staat, ook bezet telt', () => {
  const items = [
    item({ start_op: zoneNaarIso('2026-11-30', '09:00'), eind_op: zoneNaarIso('2026-11-30', '11:00') }),
    item({ start_op: zoneNaarIso('2026-12-01', '09:00'), eind_op: zoneNaarIso('2026-12-01', '10:00'), toegewezen: [Q] }),
    item({ start_op: zoneNaarIso('2026-12-02', '04:00'), eind_op: zoneNaarIso('2026-12-02', '04:00'), heel_dag: true }),
  ]
  const bezet = [{ start_op: zoneNaarIso('2026-12-03', '14:00'), eind_op: zoneNaarIso('2026-12-03', '15:30'), personen: [P] }]
  assert.equal(geplandMinuten(items, P, week, bezet), 120 + 90)
})

test('capaciteit: over als er meer gepland staat dan beschikbaar, geen oordeel zonder beschikbaarheid', () => {
  assert.deepEqual(capaciteit(45 * 60, 40 * 60), { gepland: 2700, beschikbaar: 2400, vol: 113, over: true })
  assert.equal(capaciteit(600, 0).vol, null)
  assert.equal(urenTekst(90), '1u30')
  assert.equal(urenTekst(120), '2u')
})

test('beschikbaarheid nakijken', () => {
  assert.equal(controleerBeschikbaarheid([{ weekdag: 1, van: '17:00', tot: '09:00' }]).ok, false)
  const r = controleerBeschikbaarheid([{ weekdag: 3, van: '09:00', tot: '12:00' }, { weekdag: 1, van: '', tot: '' }, { weekdag: 9, van: '09:00', tot: '10:00' }])
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual(r.dagen, [{ weekdag: 3, van: '09:00', tot: '12:00' }])
})

test('iCal: met uur, hele dag, afgevinkt niet, tekens netjes', () => {
  const ics = icalFeed([
    item({ id: 'a', titel: 'Klant, bellen; nu', start_op: zoneNaarIso('2026-11-30', '09:00'), eind_op: zoneNaarIso('2026-11-30', '10:00') }),
    item({ id: 'b', titel: 'Hele dag', start_op: zoneNaarIso('2026-12-01', '04:00'), eind_op: zoneNaarIso('2026-12-02', '04:00'), heel_dag: true }),
    item({ id: 'c', titel: 'Klaar', status: 'klaar', start_op: zoneNaarIso('2026-12-01', '09:00'), eind_op: zoneNaarIso('2026-12-01', '10:00') }),
  ], { naam: 'Test', appUrl: 'https://app.example', nu: new Date('2026-11-27T10:00:00Z') })
  assert.match(ics, /SUMMARY:Klant\\, bellen\; nu/)
  assert.match(ics, /DTSTART:20261130T080000Z/)
  assert.match(ics, /DTSTART;VALUE=DATE:20261201\r\nDTEND;VALUE=DATE:20261203/)
  assert.ok(!ics.includes('SUMMARY:Klaar'))
  assert.ok(ics.split('\r\n').every((r) => r.length <= 75))
})

test('verschil met ClickUp: enkel als ClickUp iets nieuws zegt dat de app-versie tegenhoudt', () => {
  const b = { clickup_bijgewerkt_op: '2026-11-27T08:00:00Z', in_app_gewijzigd_op: '2026-11-27T10:00:00Z', titel: 'A', status: 'open', start_op: null, eind_op: null, deadline_op: null }
  const v = { clickup_bijgewerkt_op: '2026-11-27T09:00:00Z', titel: 'B', status: 'open', start_op: null, eind_op: null, deadline_op: null }
  assert.equal(clickupVerschil(b, v)?.titel, 'B')
  assert.equal(clickupVerschil(b, { ...v, titel: 'A' }), null) // niets anders
  assert.equal(clickupVerschil(b, { ...v, clickup_bijgewerkt_op: '2026-11-27T11:00:00Z' }), null) // ClickUp nieuwer: import neemt over
  assert.equal(clickupVerschil({ ...b, clickup_verschil: { bijgewerkt: v.clickup_bijgewerkt_op } }, v), null) // al gemeld
  assert.equal(clickupVerschil({ ...b, in_app_gewijzigd_op: null }, v), null)
})

console.log(`\n${n} tests geslaagd\n`)
