// Ritme (verbeterplan fase 7).
//   npx tsx tests/ritme-fase7.test.ts
import assert from 'node:assert/strict'
import {
  CIJFERS, leesScorecard, weken, weekNummer, maandagVan, perWeek, kleurVan, controleerActie, leesActies, leesNotities,
  kwartaalVan, volgendKwartaal, controleerDoel, uitslag, isStem, beloftesPerPersoon, magEenOpEenZien, werkvoorraad,
} from '../lib/ritme/model'
import { sorteerInstructies, controleerInstructie } from '../lib/team/werkinstructies'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }

test('scorecard: tien cijfers, instellingen netjes', () => {
  assert.equal(CIJFERS.length, 10)
  const s = leesScorecard({ gefactureerd: { eigenaar: ' Marco ', doel: '25000' }, aanvragen: { aan: false } })
  assert.deepEqual(s.gefactureerd, { eigenaar: 'Marco', doel: 25000, aan: true })
  assert.equal(s.aanvragen.aan, false)
  assert.deepEqual(s.klantmeetings, { eigenaar: null, doel: null, aan: true })
})

test('weken: 13 weken van maandag tot zondag, de huidige als laatste', () => {
  assert.equal(maandagVan('2026-11-27'), '2026-11-23')
  assert.equal(maandagVan('2026-11-23'), '2026-11-23')
  assert.equal(weekNummer('2026-11-27'), 48)
  assert.equal(weekNummer('2027-01-01'), 53)
  const w = weken('2026-11-27')
  assert.equal(w.length, 13)
  assert.deepEqual(w[12], { van: '2026-11-23', tot: '2026-11-29', label: 'w48' })
  assert.equal(w[0].van, '2026-08-31')
})

test('per week optellen en kleuren', () => {
  const w = weken('2026-11-27', 2)
  assert.deepEqual(perWeek([{ datum: '2026-11-17' }, { datum: '2026-11-23', waarde: 2.5 }, { datum: '2026-11-29' }, { datum: '2026-10-01' }, { datum: null }], w), [1, 3.5])
  assert.equal(kleurVan(5, 4), 'groen')
  assert.equal(kleurVan(3, 4), 'rood')
  assert.equal(kleurVan(3, 4, true), null, 'lopende week nog niet rood')
  assert.equal(kleurVan(3, null), null)
})

test('weekoverleg: actiepunten en notities', () => {
  assert.equal(controleerActie({ tekst: 'x', wie: 'Bram' }).ok, false)
  assert.equal(controleerActie({ tekst: 'Offerte sturen', wie: '' }).ok, false)
  const c = controleerActie({ tekst: 'Offerte sturen', wie: 'Bram', aan_wie: 'Peeters', tegen: '2026-12-01' })
  assert.ok(c.ok && c.actie.aan_wie === 'Peeters' && c.actie.tegen === '2026-12-01')
  assert.equal(leesActies([{ id: 'a', tekst: 'Bellen klant', wie: 'Marco' }, { tekst: 'zonder id', wie: 'x' }, 'x']).length, 1)
  assert.deepEqual(leesNotities({ goed_nieuws: 'Nieuwe klant', onbekend: 'x', problemen: '   ' }), { goed_nieuws: 'Nieuwe klant' })
})

test('kwartaaldoelen', () => {
  assert.equal(kwartaalVan('2026-11-27'), '2026-Q4')
  assert.equal(volgendKwartaal('2026-Q4'), '2027-Q1')
  assert.equal(volgendKwartaal('2026-Q2'), '2026-Q3')
  assert.equal(controleerDoel({ kwartaal: '2026-Q5', titel: 'Doel', eigenaar: 'Bram' }).ok, false)
  assert.equal(controleerDoel({ kwartaal: '2026-Q4', titel: 'Doel', eigenaar: '' }).ok, false)
  const d = controleerDoel({ kwartaal: '2026-Q4', titel: '5 retainers', eigenaar: 'Bram', bedrijf: 'nextgenmedia', status: 'raar' })
  assert.ok(d.ok && d.doel.status === 'op_schema' && d.doel.bedrijf === 'nextgenmedia')
})

test('beslissingen: twee van de drie', () => {
  assert.equal(uitslag([{ stem: 'voor' }]), 'open')
  assert.equal(uitslag([{ stem: 'voor' }, { stem: 'voor' }]), 'aangenomen')
  assert.equal(uitslag([{ stem: 'tegen' }, { stem: 'voor' }, { stem: 'tegen' }]), 'verworpen')
  assert.equal(uitslag([{ stem: 'voor' }, { stem: 'onthouding' }, { stem: 'tegen' }]), 'open')
  assert.ok(isStem('onthouding') && !isStem('misschien'))
})

test('beloftes per persoon: te laat eerst', () => {
  const g = beloftesPerPersoon([
    { id: '1', wat: 'A', wie: 'Bram', aan_wie: 'Klant', tegen: '2026-11-30', klaar: false },
    { id: '2', wat: 'B', wie: 'Bram', aan_wie: 'Klant', tegen: '2026-11-20', klaar: false },
    { id: '3', wat: 'C', wie: 'Marco', aan_wie: 'Chiara', tegen: null, klaar: false },
    { id: '4', wat: 'D', wie: 'Marco', aan_wie: 'Chiara', tegen: null, klaar: true },
  ], '2026-11-27')
  assert.equal(g[0].wie, 'Bram'); assert.equal(g[0].teLaat, 1); assert.equal(g[0].lijst[0].id, '2')
  assert.equal(g[1].open, 1)
})

test('1-op-1: zaakvoerders, de medewerker en wie het gesprek voerde', () => {
  const r = { medewerker_user_id: 'm', met_user_id: 'z' }
  assert.ok(magEenOpEenZien({ isAdmin: true, userId: 'x' }, r))
  assert.ok(magEenOpEenZien({ isAdmin: false, userId: 'm' }, r))
  assert.ok(magEenOpEenZien({ isAdmin: false, userId: 'z' }, r))
  assert.equal(magEenOpEenZien({ isAdmin: false, userId: 'y' }, r), false)
  assert.equal(magEenOpEenZien({ isAdmin: false, userId: '' }, { medewerker_user_id: null, met_user_id: null }), false)
})

test('werkvoorraad in weken', () => {
  assert.deepEqual(werkvoorraad(13000, 130000), { weken: 1.3, band: 'kort' })
  assert.deepEqual(werkvoorraad(30000, 130000), { weken: 3, band: 'goed' })
  assert.deepEqual(werkvoorraad(100000, 130000), { weken: 10, band: 'lang' })
  assert.deepEqual(werkvoorraad(5000, 0), { weken: null, band: null })
})

test('gedragsafspraken: vaste pagina bovenaan', () => {
  const c = controleerInstructie({ titel: 'Gedragsafspraken', inhoud: 'We komen op tijd.', soort: 'afspraken' })
  assert.ok(c.ok && c.invoer.soort === 'afspraken')
  const d = controleerInstructie({ titel: 'X', inhoud: 'Y', soort: 'raar' })
  assert.ok(d.ok && d.invoer.soort === 'instructie')
  assert.deepEqual(sorteerInstructies([{ titel: 'B', soort: 'instructie' }, { titel: 'Z', soort: 'afspraken' }, { titel: 'A' }]).map((x) => x.titel), ['Z', 'A', 'B'])
})

console.log(`\n${n} tests geslaagd`)
