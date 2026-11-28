import assert from 'node:assert/strict'
import { verschuifMaanden, heeftMaand, maandenTussen } from '../lib/facturatie/maanden'

assert.equal(verschuifMaanden('Sociale media management oktober', 1), 'Sociale media management november')
assert.equal(verschuifMaanden('Sociale media management oktober', 2), 'Sociale media management december')
assert.equal(verschuifMaanden('Sociale media management oktober', 3), 'Sociale media management januari')
// Met jaartal schuift het jaar mee.
assert.equal(verschuifMaanden('Beheer december 2026', 1), 'Beheer januari 2027')
assert.equal(verschuifMaanden('Beheer november 2026', 14), 'Beheer januari 2028')
// Hoofdletters blijven zoals ze waren; ook in een langere omschrijving.
assert.equal(verschuifMaanden('Oktober: 12 posts en 4 reels voor oktober', 1), 'November: 12 posts en 4 reels voor november')
assert.equal(verschuifMaanden('OKTOBER', 1), 'NOVEMBER')
// Geen maand = niets verandert.
assert.equal(verschuifMaanden('Websiteonderhoud', 3), 'Websiteonderhoud')
assert.equal(verschuifMaanden('Sociale media oktober', 0), 'Sociale media oktober')
// Woorden die op een maand lijken, blijven staan.
assert.equal(verschuifMaanden('Meiboom en juniorpakket', 1), 'Meiboom en juniorpakket')
assert.equal(heeftMaand('Content maart'), true)
assert.equal(heeftMaand('Content'), false)
assert.equal(maandenTussen('2026-10', '2027-01'), 3)
assert.equal(maandenTussen('2026-10', '2026-10'), 0)
console.log('facturatie-maanden: ok')

// Meerdere facturen plannen: de maand in titel en omschrijving schuift mee, de rest blijft.
import { maakReeks } from '../lib/facturatie/reeks'
const reeks = maakReeks({ type: 'meerdere', aantal: 3, bedrag_excl: 500, btw_pct: 21, start_datum: '2026-11-01', interval_maanden: 1, omschrijving: 'Sociale media management oktober', beschrijving: 'Beheer Instagram en Facebook, oktober: 12 posts', betalingstermijn_dagen: 30 })
assert.deepEqual(reeks.map((m) => m.omschrijving), ['Sociale media management oktober', 'Sociale media management november', 'Sociale media management december'])
assert.deepEqual(reeks.map((m) => m.beschrijving), ['Beheer Instagram en Facebook, oktober: 12 posts', 'Beheer Instagram en Facebook, november: 12 posts', 'Beheer Instagram en Facebook, december: 12 posts'])
assert.deepEqual(reeks.map((m) => m.factuurdatum), ['2026-11-01', '2026-12-01', '2027-01-01'])
// Per kwartaal schuift de maand drie verder.
const kwartaal = maakReeks({ type: 'meerdere', aantal: 2, bedrag_excl: 900, btw_pct: 21, start_datum: '2026-10-01', interval_maanden: 3, omschrijving: 'Advertising oktober', betalingstermijn_dagen: 30 })
assert.deepEqual(kwartaal.map((m) => m.omschrijving), ['Advertising oktober', 'Advertising januari'])
// Zonder maand in de titel: zoals vroeger "termijn i/n".
const zonder = maakReeks({ type: 'meerdere', aantal: 2, bedrag_excl: 900, btw_pct: 21, start_datum: '2026-10-01', interval_maanden: 1, omschrijving: 'Website', betalingstermijn_dagen: 30 })
assert.deepEqual(zonder.map((m) => m.omschrijving), ['Website · termijn 1/2', 'Website · termijn 2/2'])
console.log('reeks met maanden: ok')
