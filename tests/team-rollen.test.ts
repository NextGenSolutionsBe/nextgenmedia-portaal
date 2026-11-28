// Rollen, rechten en plug-and-play (verbeterplan fase 4).
//   npx tsx tests/team-rollen.test.ts
import assert from 'node:assert/strict'
import {
  START_SJABLONEN, netteModules, netteBedrijven, vastBedrijf, bedrijvenLabel, netteStartpagina, controleerSjabloon,
  naarSjabloon, sjabloonToepassen, foutInStap, voortgang, stappenErbij, controleerProfiel, profielLeeg,
  studentStand, inJaar, offboardingPunten, MEDIA, SOLUTIONS,
} from '../lib/team/rollen'
import { ADMIN_MODULES, STAFF_PRESETS } from '../lib/staff'
import { controleerInstructie, nieuweVersieNodig, geldtVoor, leesStand } from '../lib/team/werkinstructies'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }
const alleModules = ADMIN_MODULES.map((m) => m.key)

test('zeven startsjablonen met enkel gekende modules en een onboarding', () => {
  assert.equal(START_SJABLONEN.length, 7)
  assert.deepEqual(START_SJABLONEN.map((s) => s.key), ['zaakvoerder', 'operations', 'uitvoerder_solutions', 'uitvoerder_media', 'appointment_setter', 'lead_onderzoeker', 'stagiair'])
  for (const s of START_SJABLONEN) {
    assert.equal(netteModules(s.modules).length, s.modules.length, s.key)
    assert.ok(s.onboarding.length >= 7, s.key)
    assert.ok(!s.startpagina || netteStartpagina(s.startpagina), s.key)
  }
})

test('de bestaande snelle sets blijven bestaan', () => {
  assert.ok(STAFF_PRESETS.some((p) => p.key === 'setter'))
  assert.ok(STAFF_PRESETS.length >= 6)
})

test('uitvoerders horen bij één bedrijf, uitvoerders zien nooit financieel', () => {
  assert.deepEqual(START_SJABLONEN.find((s) => s.key === 'uitvoerder_media')!.bedrijven, [MEDIA])
  assert.deepEqual(START_SJABLONEN.find((s) => s.key === 'uitvoerder_solutions')!.bedrijven, [SOLUTIONS])
  for (const k of ['uitvoerder_media', 'uitvoerder_solutions', 'stagiair', 'appointment_setter', 'lead_onderzoeker']) {
    const m = START_SJABLONEN.find((s) => s.key === k)!.modules
    for (const geld of ['finance', 'invoices', 'vesting', 'vennoten', 'personeel', 'purchases']) assert.ok(!m.includes(geld), `${k} ${geld}`)
  }
})

test('modules: onbekend weg, dubbel weg, vaste volgorde', () => {
  assert.deepEqual(netteModules(['info', 'bestaat_niet', 'agenda', 'info', 3]), ['agenda', 'info'])
  assert.deepEqual(netteModules(null), [])
})

test('bedrijven: leeg of beide = alle, één = vast', () => {
  assert.deepEqual(netteBedrijven([MEDIA, SOLUTIONS]), [])
  assert.deepEqual(netteBedrijven(['x', SOLUTIONS]), [SOLUTIONS])
  assert.equal(vastBedrijf([SOLUTIONS]), SOLUTIONS)
  assert.equal(vastBedrijf([]), null)
  assert.equal(vastBedrijf(null), null)
  assert.equal(vastBedrijf([MEDIA, SOLUTIONS]), null)
  assert.equal(bedrijvenLabel([]), 'Alle bedrijven')
  assert.equal(bedrijvenLabel([MEDIA]), 'NextGenMedia')
})

test('startpagina: enkel een pad in de admin', () => {
  assert.equal(netteStartpagina('/admin/agenda'), '/admin/agenda')
  assert.equal(netteStartpagina('https://evil.example'), null)
  assert.equal(netteStartpagina('//evil.example'), null)
  assert.equal(netteStartpagina('/portal'), null)
})

test('sjabloon nakijken: naam verplicht, sleutel netjes, rol standaard medewerker', () => {
  assert.equal(controleerSjabloon({ key: 'x_y', naam: '' }).ok, false)
  assert.equal(controleerSjabloon({ key: 'Fout Sleutel', naam: 'A' }).ok, false)
  const r = controleerSjabloon({ key: 'editor', naam: 'Editor', rol: 'baas', modules: ['content', 'nope'], bedrijven: [MEDIA], onboarding: ['A', 'A', ' ', 'B'], startpagina: 'http://x' })
  assert.ok(r.ok)
  if (r.ok) {
    assert.equal(r.sjabloon.rol, 'medewerker')
    assert.deepEqual(r.sjabloon.modules, ['content'])
    assert.deepEqual(r.sjabloon.onboarding, ['A', 'B'])
    assert.equal(r.sjabloon.startpagina, null)
    assert.equal(r.sjabloon.standaard, false)
  }
  // Een bestaand sjabloon houdt zijn sleutel en zijn "standaard".
  const z = controleerSjabloon({ key: 'iets_anders', naam: 'Zaakvoerder' }, START_SJABLONEN[0])
  assert.ok(z.ok && z.sjabloon.key === 'zaakvoerder' && z.sjabloon.standaard)
})

test('rij uit de databank: ontbrekende velden worden leeg', () => {
  const s = naarSjabloon({ key: 'k', naam: 'K', modules: null, bedrijven: null, onboarding: null })
  assert.deepEqual([s.modules, s.bedrijven, s.onboarding, s.rol, s.actief], [[], [], [], 'medewerker', true])
})

test('toepassen: zaakvoerder zonder modules = alle zichtbare modules', () => {
  const z = sjabloonToepassen(START_SJABLONEN[0], alleModules)
  assert.equal(z.permissions.length, alleModules.length)
  assert.equal(z.rol, 'beheerder')
  const m = sjabloonToepassen(START_SJABLONEN.find((s) => s.key === 'uitvoerder_media')!, alleModules)
  assert.deepEqual(m.bedrijven, [MEDIA])
  assert.equal(m.rol_sjabloon, 'uitvoerder_media')
})

test('nieuw account: elke stap zegt wat ontbreekt', () => {
  assert.equal(foutInStap(0, { voornaam: '', email: 'a@b.be' }), 'Voornaam is verplicht.')
  assert.equal(foutInStap(0, { voornaam: 'An', email: 'geen' }), 'Vul een geldig e-mailadres in.')
  assert.equal(foutInStap(0, { voornaam: 'An', email: 'an@nextgen.be' }), null)
  assert.ok(foutInStap(1, { permissions: [] }))
  assert.equal(foutInStap(1, { permissions: ['agenda'] }), null)
  assert.ok(foutInStap(2, { start_datum: '2026-12-01', eind_datum: '2026-11-01' }))
  assert.equal(foutInStap(2, { start_datum: '2026-12-01', eind_datum: null }), null)
  assert.equal(foutInStap(3, {}), null)
})

test('onboarding: voortgang en geen dubbele stappen', () => {
  assert.deepEqual(voortgang([]), { gedaan: 0, totaal: 0, pct: 0, klaar: false })
  assert.deepEqual(voortgang([{ gedaan_op: 'x' }, { gedaan_op: null }, { gedaan_op: 'y' }]), { gedaan: 2, totaal: 3, pct: 67, klaar: false })
  assert.equal(voortgang([{ gedaan_op: 'x' }]).klaar, true)
  assert.deepEqual(stappenErbij([{ titel: 'Inloggen' }], ['inloggen', 'Nieuw']), ['Nieuw'])
})

test('functieprofiel: regels uit tekst of lijst, leeg herkend', () => {
  const p = controleerProfiel({ doel: '  Content maken ', taken: 'Posts plannen\n\nReels monteren', verantwoordelijkheden: ['Kalender', ''], rapporteert_aan: 'Bram' })
  assert.equal(p.doel, 'Content maken')
  assert.deepEqual(p.taken, ['Posts plannen', 'Reels monteren'])
  assert.deepEqual(p.verantwoordelijkheden, ['Kalender'])
  assert.equal(profielLeeg(p), false)
  assert.equal(profielLeeg(controleerProfiel(null)), true)
})

test('student: 650 uur, let op vanaf 80%, over vanaf 100%', () => {
  assert.equal(studentStand(500 * 60).niveau, 'ok')
  assert.equal(studentStand(520 * 60).niveau, 'let_op')
  assert.equal(studentStand(520 * 60).pct, 80)
  assert.equal(studentStand(650 * 60).niveau, 'over')
  assert.equal(studentStand(600 * 60).over, 50)
})

test('student: het jaar volgt de Brusselse datum', () => {
  assert.equal(inJaar('2026-12-31T23:30:00Z', 2027), true)  // 00:30 op 1 januari in Brussel
  assert.equal(inJaar('2026-12-31T20:00:00Z', 2026), true)
  assert.equal(inJaar('kapot', 2026), false)
})

test('offboarding: zegt wat nog openstaat, verwijdert niets', () => {
  const p = offboardingPunten({ login: true, openTaken: 3, openOnboarding: 0, icalLinks: 1, lopendeSessie: false, eindDatum: null })
  assert.deepEqual(p.filter((x) => x.open).map((x) => x.tekst), ['Kan nog inloggen', '3 open taken in de agenda (blijven staan, geef ze door)', '1 agenda-abonnement actief', 'Nog geen einddatum'])
  const klaar = offboardingPunten({ login: false, openTaken: 0, openOnboarding: 0, icalLinks: 0, lopendeSessie: false, eindDatum: '2026-12-31' })
  assert.equal(klaar.filter((x) => x.open).length, 0)
})

test('werkinstructie: titel en inhoud verplicht, labels netjes', () => {
  assert.equal(controleerInstructie({ titel: '', inhoud: 'x' }).ok, false)
  assert.equal(controleerInstructie({ titel: 'x', inhoud: ' ' }).ok, false)
  const r = controleerInstructie({ titel: 'Reels opleveren', inhoud: 'Stap 1\r\nStap 2', bedrijf: MEDIA, dienst_slug: 'social-media', rol_sjabloon: 'Fout!' })
  assert.ok(r.ok && r.invoer.inhoud === 'Stap 1\nStap 2' && r.invoer.bedrijf === MEDIA && r.invoer.rol_sjabloon === null)
  assert.ok(controleerInstructie({ titel: 'x', inhoud: 'y', bedrijf: 'iets' }).ok)
})

test('werkinstructie: nieuwe versie enkel als titel of inhoud verandert', () => {
  assert.equal(nieuweVersieNodig({ titel: 'A', inhoud: 'B' }, { titel: 'A ', inhoud: 'B' }), false)
  assert.equal(nieuweVersieNodig({ titel: 'A', inhoud: 'B' }, { titel: 'A', inhoud: 'C' }), true)
})

test('werkinstructie: voor wie ze geldt', () => {
  const ik = { isAdmin: false, bedrijven: [MEDIA], sjabloon: 'uitvoerder_media' }
  assert.equal(geldtVoor({ bedrijf: null, rol_sjabloon: null }, ik), true)
  assert.equal(geldtVoor({ bedrijf: SOLUTIONS, rol_sjabloon: null }, ik), false)
  assert.equal(geldtVoor({ bedrijf: SOLUTIONS, rol_sjabloon: null }, { ...ik, bedrijven: [] }), true)
  assert.equal(geldtVoor({ bedrijf: null, rol_sjabloon: 'stagiair' }, ik), false)
  assert.equal(geldtVoor({ bedrijf: SOLUTIONS, rol_sjabloon: 'stagiair' }, { isAdmin: true, bedrijven: [], sjabloon: null }), true)
})

test('werkinstructie: gelezen, nieuwe versie of nog niet', () => {
  assert.equal(leesStand(2, [1, 2]), 'gelezen')
  assert.equal(leesStand(3, [1, 2]), 'nieuwe_versie')
  assert.equal(leesStand(1, []), 'ongelezen')
})

console.log(`\n${n} tests geslaagd`)
