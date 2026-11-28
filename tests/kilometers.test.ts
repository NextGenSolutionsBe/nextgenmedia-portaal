// Kilometervergoeding: ritten, totaal, omschrijving en de factuurregel.
// Uitvoeren: npx tsx tests/kilometers.test.ts
import assert from 'node:assert/strict'
import {
  nieuweRit, ritTotaal, totaalKm, kmBedrag, plaatsUitAdres, kmTitel, kmOmschrijving, kmRegelVan, isKmRegel, zetKmRegel, zonderKmRegel,
  leesVerplaatsing, controleerVerplaatsing, KANTOOR_PLEK, STANDAARD_KM_TARIEF, type Verplaatsing,
} from '../lib/facturen/kilometers'
import { berekenRegel, nieuweRegel } from '../lib/facturen/regels'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nKilometervergoeding\n')

const antwerpen = { adres: 'Groenplaats 1, 2000 Antwerpen', kort: 'Antwerpen' }
const gent = { adres: 'Korenmarkt 5, 9000 Gent' }

test('heen en terug telt dubbel, en vaker rijden telt mee', () => {
  assert.equal(ritTotaal({ km: 80.4, heenEnTerug: true, keer: 1 }), 160.8)
  assert.equal(ritTotaal({ km: 80, heenEnTerug: false, keer: 1 }), 80)
  assert.equal(ritTotaal({ km: 80, heenEnTerug: true, keer: 2 }), 320)
  assert.equal(ritTotaal({ km: null, heenEnTerug: true, keer: 1 }), 0)
})

test('totaal en bedrag over meerdere ritten', () => {
  const ritten = [
    nieuweRit({ van: KANTOOR_PLEK, naar: antwerpen, km: 80, heenEnTerug: false }),
    nieuweRit({ van: antwerpen, naar: gent, km: 60, heenEnTerug: false }),
    nieuweRit({ van: gent, naar: KANTOOR_PLEK, km: 120, heenEnTerug: false }),
  ]
  assert.equal(totaalKm(ritten), 260)
  assert.equal(kmBedrag({ ritten, tarief: 0.43 }), 111.8)
})

test('korte plaatsnaam uit een adres', () => {
  assert.equal(plaatsUitAdres('Kempische Steenweg 293, 3500 Hasselt'), 'Hasselt')
  assert.equal(plaatsUitAdres('Groenplaats 1, 2000 Antwerpen'), 'Antwerpen')
  assert.equal(plaatsUitAdres('Corda Campus, gebouw 6A, 3500 Hasselt'), 'Corda Campus')
  assert.equal(plaatsUitAdres('Stationsstraat 12, 3600 Genk, België'), 'Genk')
  assert.equal(plaatsUitAdres('Durbuy'), 'Durbuy')
})

test('titel met waarvoor', () => {
  assert.equal(kmTitel({ waarvoor: null }), 'Kilometervergoeding')
  assert.equal(kmTitel({ waarvoor: 'Contentshoot' }), 'Kilometervergoeding contentshoot')
})

test('omschrijving van één rit en van meerdere', () => {
  const een: Verplaatsing = { ritten: [nieuweRit({ van: KANTOOR_PLEK, naar: antwerpen, km: 80, datum: '2026-11-13' })], tarief: 0.43, btw: 21, waarvoor: null }
  assert.equal(kmOmschrijving(een), 'Verplaatsing Corda Campus → Antwerpen en terug op 13/11: 160 km × € 0,43/km')
  const twee: Verplaatsing = { ritten: [
    nieuweRit({ van: KANTOOR_PLEK, naar: antwerpen, km: 80, keer: 2 }),
    nieuweRit({ van: KANTOOR_PLEK, naar: gent, km: 100, heenEnTerug: false, datum: '2026-11-20' }),
  ], tarief: 0.43, btw: 21, waarvoor: null }
  assert.equal(kmOmschrijving(twee), 'Verplaatsingen: Corda Campus → Antwerpen en terug, 2 keer (320 km); Corda Campus → Gent (20/11, 100 km). Totaal 420 km × € 0,43/km')
})

test('de factuurregel: km × tarief, extra kost, btw', () => {
  const v: Verplaatsing = { ritten: [nieuweRit({ van: KANTOOR_PLEK, naar: antwerpen, km: 80 })], tarief: 0.43, btw: 21, waarvoor: 'contentshoot' }
  const r = kmRegelVan(v)
  assert.equal(r.artikel, 'Kilometervergoeding contentshoot')
  assert.equal(r.aantal, 160)
  assert.equal(r.eenheid, 'km')
  assert.equal(r.prijs_excl, 0.43)
  assert.equal(r.is_extra, true)
  assert.equal(r.classificatie, 'doorgerekende_kost')
  assert.equal(berekenRegel(r).excl, 68.8)
  assert.ok(isKmRegel(r))
  assert.ok(!isKmRegel(nieuweRegel({ artikel: 'Social media', eenheid: 'maand' })))
})

test('vervangen houdt id en plaats, erbij zet een extra regel', () => {
  const dienst = nieuweRegel({ id: 'a', volgnr: 1, artikel: 'Shoot', eenheid: 'forfait', prijs_excl: 500 })
  const oud = nieuweRegel({ id: 'b', volgnr: 2, artikel: 'Kilometervergoeding', eenheid: 'km', aantal: 50, prijs_excl: 0.43 })
  const nieuw = kmRegelVan({ ritten: [nieuweRit({ van: KANTOOR_PLEK, naar: antwerpen, km: 80 })], tarief: 0.43, btw: 21, waarvoor: null })
  const v = zetKmRegel([dienst, oud], nieuw)
  assert.equal(v.length, 2)
  assert.equal(v[1].id, 'b')
  assert.equal(v[1].aantal, 160)
  const e = zetKmRegel([dienst, oud], nieuw, 'erbij')
  assert.equal(e.length, 3)
  assert.equal(e[2].id, null)
  assert.equal(e[2].volgnr, 3)
  const zonder = zetKmRegel([dienst], nieuw)
  assert.equal(zonder.length, 2)
  assert.deepEqual(zonderKmRegel([dienst, oud]).map((r) => r.id), ['a'])
})

test('bewaarde verplaatsing inlezen en nakijken', () => {
  const v = leesVerplaatsing({ ritten: [{ van: { adres: 'A', lat: 'x' }, naar: { adres: 'B' }, km: '12,5', keer: 0, heenEnTerug: false, datum: 'morgen' }], tarief: null, waarvoor: '  shoot ' })!
  assert.equal(v.ritten[0].km, 12.5)
  assert.equal(v.ritten[0].keer, 1)
  assert.equal(v.ritten[0].datum, null)
  assert.equal(v.ritten[0].van.lat, null)
  assert.equal(v.tarief, STANDAARD_KM_TARIEF)
  assert.equal(v.waarvoor, 'shoot')
  assert.equal(controleerVerplaatsing(v), null)
  assert.match(controleerVerplaatsing({ ...v, ritten: [] })!, /minstens één rit/)
  assert.match(controleerVerplaatsing({ ...v, ritten: [{ ...v.ritten[0], km: null }] })!, /afstand/)
  assert.match(controleerVerplaatsing({ ...v, tarief: 0 })!, /tarief/)
  assert.equal(leesVerplaatsing(null), null)
})

console.log(`\n${n} tests geslaagd\n`)
