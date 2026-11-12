// Account-based marketing: kolommen herkennen, csv lezen, rijen netjes, dubbels.
// Uitvoeren: npx tsx tests/abm.test.ts
import assert from 'node:assert/strict'
import { koppelKoppen, leesCsv, rijenUitTabel, normaliseerRij, dubbelSleutel, voorbeeldCsv, website } from '../lib/abm'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nAccount-based marketing\n')

test('Koppen herkennen, ook met andere namen', () => {
  assert.deepEqual(koppelKoppen(['Firma', 'BTW nr', 'GSM', 'E-mailadres', 'URL', 'Iets anders']), ['naam', 'btw_nummer', 'telefoon', 'email', 'website', null])
  assert.deepEqual(koppelKoppen(['Bedrijfsnaam', 'Naam']), ['naam', null], 'tweede "naam" wordt geen tweede bedrijfsnaam')
})

test('Csv: puntkomma of komma, aanhalingstekens en regels in een veld', () => {
  assert.deepEqual(leesCsv('﻿Bedrijfsnaam;Notitie\r\nA BV;"Lijn 1\nLijn 2"\r\n;\r\n"B ""C"" NV";x\n'), [['Bedrijfsnaam', 'Notitie'], ['A BV', 'Lijn 1\nLijn 2'], ['B "C" NV', 'x']])
  assert.deepEqual(leesCsv('naam,telefoon\nX,011 22 33 44'), [['naam', 'telefoon'], ['X', '011 22 33 44']])
})

test('Rijen: zonder naam overgeslagen; btw, mail en website netjes', () => {
  const r = rijenUitTabel([['Bedrijf', 'Btw', 'Mail', 'Website'], ['Bakkerij Peeters BV', 'be 0123.456.789', 'INFO@peeters.BE', 'peeters.be'], ['', 'BE0999999999', '', ''], ['X', '', 'geen-mail', 'niet een site']])
  assert.equal(r.rijen.length, 1); assert.equal(r.overgeslagen, 2)
  assert.equal(r.rijen[0].btw_nummer, 'BE0123456789')
  assert.equal(r.rijen[0].email, 'info@peeters.be')
  assert.equal(r.rijen[0].website, 'https://peeters.be')
  assert.equal(normaliseerRij({ naam: 'Yy', email: 'geen-mail', website: 'niet een site' })?.email, null)
  assert.equal(website('niet een site'), null)
})

test('Dubbels: zelfde btw, of zelfde naam zonder rechtsvorm', () => {
  assert.equal(dubbelSleutel({ naam: 'A', btw_nummer: 'BE0123456789' }), dubbelSleutel({ naam: 'B', btw_nummer: 'BE 0123.456.789' }))
  assert.equal(dubbelSleutel({ naam: 'Bakkerij Peeters BV', btw_nummer: null }), dubbelSleutel({ naam: 'bakkerij peeters', btw_nummer: null }))
})

test('Voorbeeldbestand: koppen en een voorbeeldrij, opent in Excel', () => {
  const t = voorbeeldCsv()
  assert.ok(t.startsWith('﻿Bedrijfsnaam;Btw-nummer;Telefoon;E-mail;Website;Contactpersoon'))
  const r = rijenUitTabel(leesCsv(t))
  assert.equal(r.rijen.length, 1); assert.equal(r.rijen[0].naam, 'Bakkerij Peeters BV')
})

console.log(`\n${n} tests geslaagd\n`)
