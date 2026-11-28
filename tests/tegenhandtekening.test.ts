// Tegenhandtekening: zone, voorwaarden, handtekening, taak.
// Uitvoeren: npx tsx tests/tegenhandtekening.test.ts
import assert from 'node:assert/strict'
import {
  standaardOnsZone, onsZoneVan, controleerZone, moetTegentekenen, redenNietTegentekenen, bedrijfVoorMerk,
  controleerNaam, leesHandtekening, annotatie, tegentekenTaak, handtekeningStand, zoneKolommen, datumRegel, volgendeInLijst,
} from '../lib/contracten/tegenhandtekening'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nTegenhandtekening\n')

test('Standaardplek: zelfde pagina en hoogte als de klant, gespiegeld en binnen de pagina', () => {
  assert.deepEqual(standaardOnsZone({ sig_page: 3, sig_x_pct: 5, sig_y_pct: 70, sig_width: 200, sig_height: 60 }), { page: 3, x: 55, y: 70, w: 200, h: 60 })
  assert.deepEqual(standaardOnsZone({ sig_page: 2, sig_x_pct: 60, sig_y_pct: 80, sig_width: 180, sig_height: 50 }), { page: 2, x: 10, y: 80, w: 180, h: 50 })
  const breed = standaardOnsZone({ sig_page: 1, sig_x_pct: 30, sig_y_pct: 50, sig_width: 380, sig_height: 60 })
  assert.ok(breed.x + (380 / 595.28) * 100 <= 98.1, 'een brede zone valt niet van de pagina')
  assert.deepEqual(standaardOnsZone({}), { page: 1, x: 55, y: 75, w: 200, h: 60 })
})

test('Ingestelde zone gaat voor; anders de standaard', () => {
  assert.deepEqual(onsZoneVan({ sig_page: 1, sig_x_pct: 5, ons_sig_page: 4, ons_sig_x_pct: 12, ons_sig_y_pct: 33, ons_sig_width: 150, ons_sig_height: 40 }), { page: 4, x: 12, y: 33, w: 150, h: 40 })
  assert.deepEqual(onsZoneVan({ sig_page: 2, sig_x_pct: 5, sig_y_pct: 60, ons_sig_page: null }), { page: 2, x: 55, y: 60, w: 200, h: 60 })
  assert.deepEqual(zoneKolommen({ page: 2, x: 1, y: 2, w: 3, h: 4 }), { ons_sig_page: 2, ons_sig_x_pct: 1, ons_sig_y_pct: 2, ons_sig_width: 3, ons_sig_height: 4 })
})

test('Zone uit een verzoek wordt begrensd', () => {
  assert.deepEqual(controleerZone({ page: 9, x: -5, y: 120, w: 5000, h: 1 }, 3), { page: 3, x: 0, y: 98, w: 400, h: 24 })
  assert.deepEqual(controleerZone('rommel'), { page: 1, x: 55, y: 75, w: 200, h: 60 })
  assert.deepEqual(controleerZone({ page: '2', x: '40.26', y: 10, w: 210.4, h: 55.6 }), { page: 2, x: 40.3, y: 10, w: 210, h: 56 })
})

test('Enkel na de klant en maar één keer', () => {
  assert.equal(moetTegentekenen({ status: 'signed' }), true)
  assert.equal(moetTegentekenen({ status: 'getekend', tegengetekend_op: '2026-11-09T10:00:00Z' }), false)
  assert.equal(moetTegentekenen({ status: 'sent' }), false)
  assert.equal(redenNietTegentekenen({ status: 'viewed', pdf_path: 'x.pdf' }), 'De klant moet het contract eerst ondertekenen.')
  assert.equal(redenNietTegentekenen({ status: 'signed', tegengetekend_op: '2026-11-09' }), 'Dit contract is al door ons ondertekend.')
  assert.equal(redenNietTegentekenen({ status: 'signed' }), 'Dit contract heeft geen PDF om te ondertekenen.')
  assert.equal(redenNietTegentekenen({ status: 'signed', pdf_path: 'a.pdf' }), null, 'ook een manueel getekend contract (enkel origineel)')
  assert.equal(handtekeningStand({ status: 'signed' }), 'wacht_op_ons')
  assert.equal(handtekeningStand({ status: 'signed', tegengetekend_op: 'x' }), 'beide')
  assert.equal(handtekeningStand({ status: 'sent' }), null)
})

test('Naam, bedrijf en handtekening', () => {
  assert.equal(controleerNaam('  Bram   Reinquin '), 'Bram Reinquin')
  assert.equal(controleerNaam('B'), null)
  assert.equal(bedrijfVoorMerk('nextgensolutions'), 'NextGenSolutions')
  assert.equal(bedrijfVoorMerk(null), 'NextGenMedia')
  assert.equal(leesHandtekening('data:image/jpeg;base64,AAAA').ok, false)
  assert.equal(leesHandtekening('data:image/png;base64,AAAA').ok, false, 'te klein = niets getekend')
  assert.equal(leesHandtekening(`data:image/png;base64,${'A'.repeat(800)}`).ok, true)
  assert.equal(leesHandtekening(`data:image/png;base64,${'A'.repeat(2_100_000)}`).ok, false)
  assert.equal(leesHandtekening('data:image/png;base64,<script>').ok, false)
})

test('Regel onder de handtekening en de taak', () => {
  assert.equal(annotatie({ naam: 'Bram Reinquin', bedrijf: 'NextGenMedia', op: '2026-11-09T10:00:00Z' }), 'Ondertekend namens NextGenMedia door Bram Reinquin · 9 november 2026')
  const t = tegentekenTaak({ klant: 'Era Nobis', titel: 'Social media 2027', ondertekenaar: 'Jan', op: '2026-11-09T10:00:00Z', url: 'https://app/x' })
  assert.equal(t.omschrijving, 'Contract tegentekenen – Era Nobis')
  assert.match(t.notitie, /Social media 2027/)
  assert.match(t.notitie, /https:\/\/app\/x/)
})

test('Datum en uur onder de handtekening: het moment van tekenen, in Belgische tijd', () => {
  assert.equal(datumRegel('2026-11-09T13:32:00Z'), '9 november 2026, 14:32')
  assert.equal(datumRegel('2026-07-01T22:05:00Z'), '2 juli 2026, 00:05', 'zomertijd en over middernacht')
})

test('Volgende contract: in de volgorde van de lijst, daarna terug naar wat overgeslagen werd', () => {
  const open = ['a', 'b', 'c']
  assert.equal(volgendeInLijst(open, 'a'), 'b')
  assert.equal(volgendeInLijst(open, 'c'), 'a', 'na het laatste: het eerste dat nog open staat')
  assert.equal(volgendeInLijst(['a'], 'a'), null, 'enkel dit contract: geen volgende')
  assert.equal(volgendeInLijst(['b', 'c'], 'x'), 'b', 'dit contract staat er niet (meer) in: het eerste')
  assert.equal(volgendeInLijst([], 'x'), null)
})

console.log(`\n${n} tests geslaagd\n`)
