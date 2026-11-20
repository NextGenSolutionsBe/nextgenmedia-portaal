// Snel een klant aanmaken vanuit een contract: invoer, naamvergelijking en dubbels.
//
//   npx tsx tests/klant-snel.test.ts

import assert from 'node:assert/strict'
import { valideerSnelleKlant, naamSleutel, zoekDubbel, magTochNieuw, vulOndertekenaar } from '../lib/clients/snel'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nKlant snel aanmaken\n')

test('1. Enkel de bedrijfsnaam is verplicht; lege velden worden null', () => {
  const v = valideerSnelleKlant({ company_name: '  Bakkerij   Peeters ' })
  assert.ok(v.ok)
  if (v.ok) {
    assert.equal(v.waarde.company_name, 'Bakkerij Peeters')
    assert.equal(v.waarde.contact_name, null)
    assert.equal(v.waarde.email, null)
    assert.equal(v.waarde.btw_nummer, null)
  }
  assert.equal(valideerSnelleKlant({ company_name: '' }).ok, false)
  assert.equal(valideerSnelleKlant({ company_name: 'A' }).ok, false)
})

test('2. E-mail, telefoon en btw worden gecontroleerd en genormaliseerd', () => {
  const v = valideerSnelleKlant({ company_name: 'Garage Janssens', email: 'Info@Janssens.BE', telefoon: '+32 11 22 33 44', btw_nummer: 'be 0123.456.749' })
  assert.ok(v.ok, JSON.stringify(v))
  if (v.ok) { assert.equal(v.waarde.email, 'info@janssens.be'); assert.equal(v.waarde.btw_nummer, 'BE0123456749'); assert.equal(v.waarde.telefoon, '+32 11 22 33 44') }
  assert.match((valideerSnelleKlant({ company_name: 'X Y', email: 'geen-mail' }) as { fout: string }).fout, /e-mailadres/)
  assert.match((valideerSnelleKlant({ company_name: 'X Y', telefoon: 'bel me' }) as { fout: string }).fout, /telefoon/)
  assert.match((valideerSnelleKlant({ company_name: 'X Y', btw_nummer: 'BE0123456789' }) as { fout: string }).fout, /BTW/i)
})

test('3. Naam vergelijken zonder rechtsvorm, leestekens of accenten', () => {
  assert.equal(naamSleutel('Bakkerij Peeters BV'), 'bakkerij peeters')
  assert.equal(naamSleutel('bakkerij peeters'), 'bakkerij peeters')
  assert.equal(naamSleutel('Café De Kroon b.v.'), 'cafe de kroon')
  assert.equal(naamSleutel('T&M Technics NV'), 't m technics')
  assert.notEqual(naamSleutel('Peeters Bouw'), naamSleutel('Peeters Bakkerij'))
})

const lijst = [
  { id: 'a', company_name: 'Bakkerij Peeters BV', email: 'ann@peeters.be', btw_nummer: 'BE0123456749', archived_at: null },
  { id: 'b', company_name: 'Garage Janssens', email: 'info@janssens.be', btw_nummer: null, archived_at: null },
  { id: 'c', company_name: 'Oude Klant', email: null, btw_nummer: 'BE0999999999', archived_at: '2025-01-01' },
]

test('4. Dubbel herkennen: btw, dan naam, dan e-mail', () => {
  assert.deepEqual(zoekDubbel({ company_name: 'Iets Anders', email: null, btw_nummer: 'BE0123456749' }, lijst), { id: 'a', company_name: 'Bakkerij Peeters BV', reden: 'btw', gearchiveerd: false })
  assert.equal(zoekDubbel({ company_name: 'bakkerij peeters', email: null, btw_nummer: null }, lijst)?.reden, 'naam')
  assert.equal(zoekDubbel({ company_name: 'Nieuwe Zaak', email: 'info@janssens.be', btw_nummer: null }, lijst)?.id, 'b')
  assert.equal(zoekDubbel({ company_name: 'Nieuwe Zaak', email: 'nieuw@zaak.be', btw_nummer: 'BE0111111111' }, lijst), null)
})

test('5. "Toch nieuw": wel bij dezelfde naam of e-mail of een gearchiveerde klant, nooit bij een actieve klant met hetzelfde btw-nummer', () => {
  assert.equal(magTochNieuw(zoekDubbel({ company_name: 'Bakkerij Peeters', email: null, btw_nummer: null }, lijst)!), true)
  assert.equal(magTochNieuw(zoekDubbel({ company_name: 'X Y', email: null, btw_nummer: 'BE0123456749' }, lijst)!), false)
  const oud = zoekDubbel({ company_name: 'X Y', email: null, btw_nummer: 'BE0999999999' }, lijst)!
  assert.equal(oud.gearchiveerd, true)
  assert.equal(magTochNieuw(oud), true)
})

test('6. Actieve klant gaat voor een gearchiveerde met dezelfde naam', () => {
  const twee = [{ id: 'oud', company_name: 'Fietsen Maes', archived_at: '2024-01-01' }, { id: 'nu', company_name: 'Fietsen Maes BV', archived_at: null }]
  assert.equal(zoekDubbel({ company_name: 'Fietsen Maes', email: null, btw_nummer: null }, twee)?.id, 'nu')
})

test('7. Ondertekenaar volgt de klant, behalve wat je zelf typte', () => {
  const garage = { contact_name: 'Tom Janssens', email: 'tom@janssens.be' }, maes = { contact_name: 'Lien Maes', email: 'lien@maes.be' }
  assert.deepEqual(vulOndertekenaar({ naam: '', email: '' }, null, garage), { naam: 'Tom Janssens', email: 'tom@janssens.be' })
  assert.deepEqual(vulOndertekenaar({ naam: 'Tom Janssens', email: 'tom@janssens.be' }, garage, maes), { naam: 'Lien Maes', email: 'lien@maes.be' }, 'automatisch ingevuld = schuift mee')
  assert.deepEqual(vulOndertekenaar({ naam: 'Jef Zaakvoerder', email: 'tom@janssens.be' }, garage, maes), { naam: 'Jef Zaakvoerder', email: 'lien@maes.be' }, 'zelf getypt = blijft')
  assert.deepEqual(vulOndertekenaar({ naam: 'Jef', email: 'jef@x.be' }, garage, null), { naam: 'Jef', email: 'jef@x.be' }, 'geen klant: niets wissen')
  assert.deepEqual(vulOndertekenaar({ naam: 'Tom Janssens', email: '' }, garage, { contact_name: null, email: null }), { naam: '', email: '' }, 'nieuwe klant zonder contact: automatisch ingevulde naam weg')
})

console.log(`\n${n} tests geslaagd\n`)
