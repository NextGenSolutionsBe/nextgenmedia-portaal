// Materiaalbeheer: het voorstel uit een aankoopfactuur nakijken.
// Uitvoeren: npx tsx tests/materiaal-factuur.test.ts
import assert from 'node:assert/strict'
import { leesFactuurVoorstel, perStuk, plusMaanden, regelsUit } from '../lib/materiaal/factuur'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nMateriaal: factuur lezen\n')

const CAT = ["Camera's", 'Lenzen', 'Audio', 'Batterijen & laders', 'Overige']

test('Een camera met wat erbij zit, kenmerken, leverancier en garantie', () => {
  const v = leesFactuurVoorstel(`Hier is het: ${JSON.stringify({
    is_factuur: true, leverancier: 'Kamera Express', factuurnummer: 'F-2026-1188', datum: '2026-11-14', garantie_maanden: 24, btw: 21, zekerheid: 0.9,
    toestellen: [{ naam: 'Sony A7 IV', merk: 'Sony', model: 'ILCE-7M4', serienummers: ['5123456'], categorie: "camera's", aantal: 1, prijs_excl: '2.149,59', prijs_incl: 2601,
      omschrijving: 'Full-frame systeemcamera voor foto en video', inhoud: ['Batterij NP-FZ100', '  Lader BC-QZ1 ', ''], kenmerken: ['33 MP', '4K 60p'] }],
  })}`, CAT, '2026-11-22')
  assert.equal(v.leverancier, 'Kamera Express')
  assert.equal(v.datum, '2026-11-14')
  assert.equal(v.garantie_tot, '2028-11-14')
  assert.equal(v.toestellen.length, 1)
  const t = v.toestellen[0]
  assert.equal(t.categorie, "Camera's", 'categorie zoals ze bestaat')
  assert.equal(t.prijs_excl, 2149.59)
  assert.deepEqual(t.inhoud, ['Batterij NP-FZ100', 'Lader BC-QZ1'])
  assert.deepEqual(t.serienummers, ['5123456'])
})

test('Geen datum in de toekomst, geen onbestaande categorie, excl. btw zelf terugrekenen', () => {
  const v = leesFactuurVoorstel(JSON.stringify({ is_factuur: true, datum: '2026-12-01', btw: 21, toestellen: [{ naam: 'Rode Wireless GO II', categorie: 'Microfoons', prijs_incl: 302.5 }] }), CAT, '2026-11-22')
  assert.equal(v.datum, null)
  assert.equal(v.garantie_tot, null, 'geen garantie zonder datum')
  assert.equal(v.toestellen[0].categorie, null)
  assert.equal(v.toestellen[0].prijs_excl, 250)
  assert.equal(v.toestellen[0].aantal, 1)
})

test('Twee identieke lenzen = twee stuks, elk met hun eigen serienummer', () => {
  const v = leesFactuurVoorstel(JSON.stringify({ is_factuur: true, toestellen: [{ naam: 'Sigma 24-70mm F2.8', aantal: 2, serienummers: ['A1', 'A2'] }, { naam: 'Rode VideoMic' }] }), CAT, '2026-11-22')
  const stuks = perStuk(v.toestellen)
  assert.deepEqual(stuks.map((s) => `${s.naam}|${s.serienummer}|${s.volgnummer}`), ['Sigma 24-70mm F2.8|A1|1', 'Sigma 24-70mm F2.8|A2|2', 'Rode VideoMic|null|1'])
})

test('Geen factuur of onleesbaar: lege lijst met uitleg', () => {
  assert.equal(leesFactuurVoorstel('{"is_factuur": false}', CAT, '2026-11-22').toestellen.length, 0)
  assert.ok(leesFactuurVoorstel('niets', CAT, '2026-11-22').opmerking)
  assert.ok(leesFactuurVoorstel('{"is_factuur": true, "toestellen": []}', CAT, '2026-11-22').opmerking?.includes('Geen toestel'))
})

test('Hulpjes: maanden optellen en lijstjes uit een tekstvak', () => {
  assert.equal(plusMaanden('2026-01-31', 1), '2026-02-28')
  assert.equal(plusMaanden('2026-11-14', 24), '2028-11-14')
  assert.deepEqual(regelsUit('• Batterij\n- Lader\n\n  Riem  '), ['Batterij', 'Lader', 'Riem'])
  assert.deepEqual(regelsUit(['a', ' ', 'b']), ['a', 'b'])
})

console.log(`\n${n} tests geslaagd\n`)
