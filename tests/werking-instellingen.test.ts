// Nieuwe werking (28 nov 2026): instellingen, domeinen, weekoverleg, Planning Media, rechten.
//   npx tsx tests/werking-instellingen.test.ts
import assert from 'node:assert/strict'
import { leesWerking, STANDAARD_WERKING, isEigenaar, eigenaarVanDomein, overlegLoopt, eindUur, naamOf, getalOf, uurOf } from '../lib/werking/instellingen'
import { beslisWijze, startStatus } from '../lib/ritme/model'
import { wieDoet, REEKS_SOORT, leesCp, leesKlantTaken } from '../lib/contentplanning/model'
import { pathToModule, modulesForApiPath, modulesForPagePath } from '../lib/staff'
import { START_SJABLONEN, PROFIEL_VAN_SJABLOON } from '../lib/team/rollen'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }

test('leeg of stuk = de beginwaarden', () => {
  assert.deepEqual(leesWerking(null), STANDAARD_WERKING)
  assert.deepEqual(leesWerking({ domeinen: { media: 123 }, weekoverleg: { dag: 9, van: 'later' } }), STANDAARD_WERKING)
  assert.equal(STANDAARD_WERKING.domeinen.solutions, 'Marco')
  assert.equal(STANDAARD_WERKING.domeinen.financien_legal, 'Bram')
  assert.equal(STANDAARD_WERKING.planning.uitvoering, 'Yasmine')
  assert.equal(STANDAARD_WERKING.weekoverleg.dag, 5)
})

test('waarden nakijken: namen, getallen, uren', () => {
  assert.equal(naamOf('  Chiara ', 'x'), 'Chiara')
  assert.equal(naamOf('<script>', 'x'), 'x')
  assert.equal(getalOf('30', 1, 0, 60), 30)
  assert.equal(getalOf('99', 1, 0, 60), 1)
  assert.equal(uurOf('9u30', '16:00'), '09:30')
  assert.equal(uurOf('25:00', '16:00'), '16:00')
  const w = leesWerking({ weekoverleg: { dag: 4, van: '15.30', duur_min: 45, reeks_id: 'geen-uuid' }, domeinen: { media: 'Bram' } })
  assert.equal(w.weekoverleg.dag, 4); assert.equal(w.weekoverleg.van, '15:30'); assert.equal(w.weekoverleg.reeks_id, null)
  assert.equal(w.domeinen.media, 'Bram'); assert.equal(w.domeinen.solutions, 'Marco')
})

test('domein: eigenaar beslist, meerdere = stemming', () => {
  const w = STANDAARD_WERKING
  assert.equal(eigenaarVanDomein(w, 'solutions'), 'Marco')
  assert.equal(eigenaarVanDomein(w, 'meerdere'), null)
  assert.equal(beslisWijze('solutions', 'Marco'), 'eigenaar')
  assert.equal(beslisWijze('meerdere', null), 'stemming')
  assert.equal(beslisWijze(null, null), 'stemming')
  assert.equal(startStatus('eigenaar', true), 'aangenomen') // zonder stemming bewaard
  assert.equal(startStatus('eigenaar', false), 'open')     // wacht op de eigenaar
  assert.equal(startStatus('stemming', true), 'open')
  assert.ok(isEigenaar('Marco', 'Marco Castermans'))
  assert.ok(isEigenaar('bram', 'Bram'))
  assert.ok(!isEigenaar('Marco', 'Bram Reinquin'))
  assert.ok(!isEigenaar(null, 'Marco'))
})

test('weekoverleg: einde en "loopt nu" enkel als het vaste blok er staat', () => {
  assert.equal(eindUur('16:00', 30), '16:30')
  assert.equal(eindUur('23:50', 30), '23:59')
  const zonder = STANDAARD_WERKING
  assert.equal(overlegLoopt(zonder, 5, '16:10'), false)
  const met = { weekoverleg: { ...STANDAARD_WERKING.weekoverleg, reeks_id: '00000000-0000-0000-0000-000000000001' } }
  assert.equal(overlegLoopt(met, 5, '16:10'), true)
  assert.equal(overlegLoopt(met, 5, '16:30'), false)
  assert.equal(overlegLoopt(met, 4, '16:10'), false)
})

test('Planning Media: wie doet de taak', () => {
  const e = STANDAARD_WERKING.planning
  assert.equal(wieDoet({}, e), 'Chiara')
  assert.equal(wieDoet({ soort: 'uitvoering' }, e), 'Yasmine')
  assert.equal(wieDoet({ soort: 'shoot' }, e), 'Bram')
  assert.equal(wieDoet({ soort: 'shoot', rol: 'Yasmine' }, e), 'Yasmine')
  assert.equal(wieDoet({}, e, REEKS_SOORT[2]), 'Yasmine')
  const cp = leesCp({})
  const brief = cp.reeks_vervolg.find((t) => t.key === 'shootbriefing')!
  assert.equal(brief.titel, 'Shootbriefing opstellen & doorsturen')
  assert.equal(wieDoet(brief, e), 'Bram')
  assert.deepEqual(leesKlantTaken([{ key: 'x', titel: 'Iets', reeks: 1, soort: 'shoot', rol: 'Yasmine' }]), [{ key: 'x', titel: 'Iets', reeks: 1, soort: 'shoot', rol: 'Yasmine' }])
  assert.deepEqual(leesKlantTaken([{ key: 'x', titel: 'Iets', reeks: 1, soort: 'raar' }]), [{ key: 'x', titel: 'Iets', reeks: 1 }])
})

test('rechten: Levering van Solutions apart, de pipeline niet', () => {
  assert.equal(pathToModule('/admin/nextgensolutions/levering'), 'ngs_levering')
  assert.equal(pathToModule('/admin/nextgensolutions'), 'nextgensolutions')
  assert.equal(pathToModule('/admin/nextgensolutions/cijfers'), 'nextgensolutions')
  assert.deepEqual(modulesForApiPath('/api/admin/nextgensolutions/levering?klant=1'), ['ngs_levering', 'nextgensolutions'])
  assert.deepEqual(modulesForApiPath('/api/admin/nextgensolutions'), ['nextgensolutions'])
  assert.deepEqual(modulesForPagePath('/admin/nextgensolutions/levering'), ['ngs_levering', 'nextgensolutions'])
  const sol = START_SJABLONEN.find((s) => s.key === 'uitvoerder_solutions')!
  assert.ok(sol.modules.includes('ngs_levering'))
  for (const verboden of ['nextgensolutions', 'opdrachten', 'finance', 'invoices', 'vesting', 'vennoten', 'personeel', 'purchases']) assert.ok(!sol.modules.includes(verboden), verboden)
  const med = START_SJABLONEN.find((s) => s.key === 'uitvoerder_media')!
  for (const verboden of ['finance', 'invoices', 'vesting', 'vennoten', 'personeel', 'purchases']) assert.ok(!med.modules.includes(verboden), verboden)
  assert.ok(PROFIEL_VAN_SJABLOON.uitvoerder_media.taken.length > 0)
  assert.ok(PROFIEL_VAN_SJABLOON.uitvoerder_solutions.taken.includes('Workflows bouwen'))
})

console.log(`\n${n} tests geslaagd`)
