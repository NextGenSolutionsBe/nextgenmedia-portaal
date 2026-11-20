// Materiaalbeheer — status, datums en mailteksten.
//
//   npx tsx tests/materiaal.test.ts

import assert from 'node:assert/strict'
import { itemStatus, isActief, datumLang, datumKort, mailUitgeleend, mailTeruggebracht, typeUitPersoneel, vandaagBE } from '../lib/materiaal/model'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nMateriaalbeheer\n')

test('Status volgt uit de actieve uitlening: beschikbaar, uitgeleend, te laat, gearchiveerd', () => {
  assert.equal(itemStatus({ gearchiveerd_op: null }, null, '2026-10-09'), 'beschikbaar')
  assert.equal(itemStatus({ gearchiveerd_op: null }, { verwacht_terug: null }, '2026-10-09'), 'uitgeleend')
  assert.equal(itemStatus({ gearchiveerd_op: null }, { verwacht_terug: '2026-10-12' }, '2026-10-09'), 'uitgeleend')
  assert.equal(itemStatus({ gearchiveerd_op: null }, { verwacht_terug: '2026-10-08' }, '2026-10-09'), 'te_laat')
  assert.equal(itemStatus({ gearchiveerd_op: '2026-10-01' }, null, '2026-10-09'), 'gearchiveerd')
})

test('Actief = niet teruggebracht en niet geannuleerd (historie blijft)', () => {
  assert.equal(isActief({ teruggebracht_op: null, geannuleerd_op: null }), true)
  assert.equal(isActief({ teruggebracht_op: '2026-10-12T09:00:00Z', geannuleerd_op: null }), false)
  assert.equal(isActief({ teruggebracht_op: null, geannuleerd_op: '2026-10-09T10:00:00Z' }), false)
})

test('Datums in de Belgische tijdzone (23:30 UTC = volgende dag in België)', () => {
  assert.equal(datumLang('2026-10-09'), '9 oktober 2026')
  assert.equal(datumLang('2026-10-09T23:30:00Z'), '10 oktober 2026')
  assert.equal(datumKort('2026-10-09T10:30:00Z'), '09/10/2026')
  assert.equal(vandaagBE(new Date('2026-12-31T23:30:00Z')), '2027-01-01')
})

test('Mails: gegevens uit de registratie, niets vast ingevuld', () => {
  const u = mailUitgeleend('Kara', [{ naam: 'Sony A7 IV', uitgeleend_op: '2026-10-09T08:30:00Z', verwacht_terug: '2026-10-12' }])
  assert.equal(u.onderwerp, 'Bevestiging uitlening materiaal — NextGenMedia')
  assert.ok(u.tekst.startsWith('Dag Kara,')); assert.ok(u.tekst.includes('Materiaal: Sony A7 IV')); assert.ok(u.tekst.includes('Uitleendatum: 9 oktober 2026')); assert.ok(u.tekst.includes('Verwachte retourdatum: 12 oktober 2026'))
  const zonder = mailUitgeleend('Arthur', [{ naam: 'DJI Mic 2', uitgeleend_op: '2026-10-09T08:30:00Z' }, { naam: 'Sony A7C', uitgeleend_op: '2026-10-09T08:30:00Z' }])
  assert.ok(!zonder.tekst.includes('Verwachte retourdatum')); assert.ok(zonder.tekst.includes('onderstaande materialen')); assert.ok(zonder.tekst.includes('Sony A7C'))
  const t = mailTeruggebracht('Kara', { naam: 'Sony A7 IV', uitgeleend_op: '2026-10-09T08:30:00Z', teruggebracht_op: '2026-10-12T07:00:00Z' })
  assert.equal(t.onderwerp, 'Bevestiging teruggave materiaal — NextGenMedia'); assert.ok(t.tekst.includes('Teruggebracht op: 12 oktober 2026'))
})

test('Personeel blijft de bron: type wordt overgenomen', () => {
  assert.equal(typeUitPersoneel('student'), 'jobstudent'); assert.equal(typeUitPersoneel('freelancer'), 'freelancer'); assert.equal(typeUitPersoneel('andere'), null)
})

console.log(`\n${n} tests geslaagd\n`)
