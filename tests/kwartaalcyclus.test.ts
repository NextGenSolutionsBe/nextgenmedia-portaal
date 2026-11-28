import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kwartalen, cyclusVoorMaand, shootsTeLaat, startMaand, goedkeuringDeadline, deadlineZin, magStilGoedkeuren, rondeStand } from '../lib/contentplanning/kwartaal'
import { STANDAARD_WERKING, leesWerking } from '../lib/werking/instellingen'

test('start 1 juni: shoot in mei en de volgende in augustus', () => {
  const q = kwartalen('2027-06-01', '2027-12-31')
  assert.deepEqual(q.slice(0, 3).map((x) => [x.van, x.tot, x.shootMaand]), [['2027-06', '2027-08', '2027-05'], ['2027-09', '2027-11', '2027-08'], ['2027-12', '2028-02', '2027-11']])
  assert.equal(startMaand('2027-06-15'), '2027-07')
})

test('wat er in een maand te doen is', () => {
  const mei = cyclusVoorMaand('2027-06-01', '2027-05')
  assert.deepEqual(mei.map((t) => t.soort).sort(), ['goedkeuring', 'montage', 'shoot', 'strategie', 'vastleggen'].sort())
  assert.equal(mei.find((t) => t.soort === 'strategie')?.wie, 'management')
  assert.equal(mei.find((t) => t.soort === 'montage')?.wie, 'uitvoering')
  const juli = cyclusVoorMaand('2027-06-01', '2027-07')
  assert.deepEqual(juli.map((t) => t.soort), ['goedkeuring'])
  assert.match(juli[0].titel, /augustus/)
  const aug = cyclusVoorMaand('2027-06-01', '2027-08')
  assert.ok(aug.some((t) => t.soort === 'vastleggen' && t.kwartaal === 2))
})

test('shoot vastleggen: op de eerste van de maand niet vast = Op te volgen', () => {
  assert.deepEqual(shootsTeLaat('2027-06-01', '2027-07-31', new Set()).map((q) => q.nr), [])
  assert.deepEqual(shootsTeLaat('2027-06-01', '2027-08-01', new Set()).map((q) => q.nr), [2])
  assert.deepEqual(shootsTeLaat('2027-06-01', '2027-08-01', new Set(['2027-08'])), [])
  assert.deepEqual(shootsTeLaat('2027-06-01', '2027-09-02', new Set()).map((q) => q.nr), [])
})

test('goedkeuring: 7 dagen, stil akkoord enkel na de deadline en enkel als het aan staat', () => {
  assert.equal(STANDAARD_WERKING.media.goedkeuring_dagen, 7)
  assert.equal(goedkeuringDeadline('2026-11-19T10:00:00Z', 7), '2026-11-26')
  assert.equal(deadlineZin('2026-11-26', true), 'Keur goed voor do 26 nov. Daarna plannen we in zoals voorgesteld.')
  assert.equal(deadlineZin('2026-11-26', false), 'Keur goed voor do 26 nov.')
  const p = { status: 'bij_klant', goedkeuring_deadline: '2026-11-26' }
  assert.equal(magStilGoedkeuren(p, true, '2026-11-27', 'bij_klant'), true)
  assert.equal(magStilGoedkeuren(p, true, '2026-11-26', 'bij_klant'), false)
  assert.equal(magStilGoedkeuren(p, false, '2026-12-27', 'bij_klant'), false)
  assert.equal(magStilGoedkeuren({ status: 'bij_klant', goedkeuring_deadline: null }, true, '2026-12-27', 'bij_klant'), false)
  assert.deepEqual(rondeStand(1, 2), { volgende: 2, teamMoetBevestigen: false })
  assert.deepEqual(rondeStand(2, 2), { volgende: 3, teamMoetBevestigen: true })
})

test('media-instellingen: de bedragen uit de opdracht, aan te passen', () => {
  const M = STANDAARD_WERKING.media
  assert.deepEqual(M.pakketten.map((p) => [p.naam, p.prijs, p.posts, p.reels, p.stories]), [['Klein', 595, 4, 0, 0], ['Middel', 1195, 6, 2, 2], ['Groot', 1495, 10, 4, 4]])
  assert.equal(M.community_management.prijs, 195)
  assert.deepEqual(M.losse_items.map((x) => [x.key, x.prijs, x.bevestigd]), [['video_uur', 300, true], ['foto_uur', 195, false], ['video_halve_dag', 1200, false], ['foto_halve_dag', 780, false]])
  assert.equal(leesWerking({ media: { pakketten: [{ key: 'middel', prijs: 1250 }], rondes: 3 } }).media.pakketten[1].prijs, 1250)
})
