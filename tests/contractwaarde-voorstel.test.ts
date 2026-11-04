import assert from 'node:assert/strict'
import { waardeUitTekst, waardeUitGegevens, waardeUitOnderdelen, looptijdMaanden, leesEuro } from '../lib/contracten/waarde-voorstel'

// Het voorbeeld uit de vraag: 3 maanden contract van 500 per maand = 1500.
const a = waardeUitTekst('3 maand contract van 500 per maand')
assert.equal(a?.waarde, 1500)
assert.match(a!.berekening, /3 maanden × € 500 per maand/)
assert.equal(waardeUitTekst('Looptijd: 6 maanden. Prijs: € 979 excl. btw per maand')?.waarde, 5874)
assert.equal(waardeUitTekst('€ 1.250,50/maand gedurende 12 maanden')?.waarde, 15006)
assert.equal(waardeUitTekst('Per kwartaal € 900, looptijd 12 maanden')?.waarde, undefined) // bedrag vóór "per" ontbreekt
assert.equal(waardeUitTekst('€ 900 per kwartaal, looptijd 12 maanden')?.waarde, 3600)
assert.equal(waardeUitTekst('1 jaar aan 2400 per jaar')?.waarde, 2400)
assert.equal(waardeUitTekst('Totaalprijs: € 4.950 excl. btw')?.waarde, 4950)
// Enkel incl. btw of geen looptijd: geen gok.
assert.equal(waardeUitTekst('€ 605 per maand incl. btw, 3 maanden'), null)
assert.equal(waardeUitTekst('500 per maand'), null)

// Uit de gegevens in de app.
assert.equal(waardeUitGegevens({ expected_invoice_count: 6, expected_invoice_amount_excl: 979 })?.waarde, 5874)
assert.equal(waardeUitGegevens({ duration_type: '3m', expected_invoice_amount_excl: 500 })?.waarde, 1500)
assert.equal(waardeUitGegevens({ duration_type: '12m', invoice_frequency: 'kwartaal', expected_invoice_amount_excl: 900 })?.waarde, 3600)
assert.equal(waardeUitGegevens({ duration_type: 'eenmalig', expected_invoice_amount_excl: 2500 })?.waarde, 2500)
assert.equal(waardeUitGegevens({ duration_type: '3m', field_values: { 'Prijs per maand': '€ 500 per maand' } })?.waarde, 1500)
assert.equal(waardeUitGegevens({ duration_type: 'onbepaald' }), null)
assert.equal(looptijdMaanden(null, '2026-01-01', '2026-12-31'), 12)
assert.equal(leesEuro('5.874,00'), 5874)

// AI-onderdelen: de som rekenen we zelf na.
const o = waardeUitOnderdelen([{ omschrijving: 'Social media', bedrag_excl: 500, aantal: 3, eenheid: 'maand' }, { omschrijving: 'Opstart', bedrag_excl: 750, aantal: 1 }])
assert.equal(o?.waarde, 2250)
assert.match(o!.berekening, /3 maanden × € 500 per maand \(Social media\) \+ € 750 \(Opstart\)/)
assert.equal(waardeUitOnderdelen([{ omschrijving: 'x', bedrag_excl: -5, aantal: 1 }]), null)
console.log('contractwaarde-voorstel: ok')
