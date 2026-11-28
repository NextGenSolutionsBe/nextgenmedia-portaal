// Dicteren (inspreken van notities) en snelle taken: tekst toevoegen en vervangen,
// de opkuis van de AI nakijken, en de snelle datums voor een taak.
// Uitvoeren: npx tsx tests/dicteren.test.ts
import assert from 'node:assert/strict'
import { naarOpgekuist, opkuisPrompt, ruwNetjes, vervangLaatste, voegToe } from '../lib/dicteren'
import { SNELLE_TAKEN, leadTaakNaam, snelleDatums } from '../lib/sales/lead-taken'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nDicteren en snelle taken\n')

test('Ruwe tekst: spaties, hoofdletter, punt', () => {
  assert.equal(ruwNetjes('  klant   wil starten in januari '), 'Klant wil starten in januari.')
  assert.equal(ruwNetjes('bellen morgen?'), 'Bellen morgen?')
  assert.equal(ruwNetjes(''), '')
})

test('Toevoegen: op een nieuwe regel als er al tekst staat', () => {
  assert.equal(voegToe('', 'Eerste notitie.'), 'Eerste notitie.')
  assert.equal(voegToe('Al iets.  ', 'Nog iets.'), 'Al iets.\nNog iets.')
  assert.equal(voegToe('Blijft.', '   '), 'Blijft.')
})

test('Vervangen: enkel het laatste stuk, en niets als het er niet meer staat', () => {
  assert.equal(vervangLaatste('A. Ruw. B. Ruw.', 'Ruw.', 'Netjes.'), 'A. Ruw. B. Netjes.')
  assert.equal(vervangLaatste('Zelf aangepast.', 'Ruw.', 'Netjes.'), 'Zelf aangepast.')
})

test('Opkuis nakijken: samengevat of aangevuld = de ruwe tekst houden', () => {
  const ruw = 'euh de klant van kilowot wil euh een nieuwe website en ook sociale media vanaf januari budget ongeveer vijftienhonderd euro per maand'
  const ok = naarOpgekuist('De klant van Kilowot wil een nieuwe website en ook sociale media vanaf januari. Budget: ongeveer € 1.500 per maand.', ruw)
  assert.equal(ok.opgekuist, true)
  assert.ok(ok.tekst.includes('€ 1.500'))
  const kort = naarOpgekuist('Kilowot: website.', ruw)
  assert.equal(kort.opgekuist, false, 'te kort = samengevat')
  assert.equal(kort.tekst, ruwNetjes(ruw))
  const lang = naarOpgekuist(`${'Extra uitleg die niet gezegd werd. '.repeat(10)}${ruw}`, ruw)
  assert.equal(lang.opgekuist, false, 'te lang = iets toegevoegd')
  assert.equal(naarOpgekuist('"Netjes."', 'netjes').tekst, 'Netjes.', 'aanhalingstekens weg')
  assert.equal(naarOpgekuist('', 'iets').opgekuist, false)
})

test('Prompt: met context, zonder te veel tekst', () => {
  const p = opkuisPrompt('klant wil starten', 'Kilowot · sociale media')
  assert.ok(p.includes('Kilowot · sociale media'))
  assert.ok(p.includes('niets toevoegen, niets samenvatten'))
  assert.ok(!opkuisPrompt('x', null).includes('hoort bij'))
})

test('Snelle datums: nooit in het weekend, geen dubbels', () => {
  // Donderdag 19 november 2026: overmorgen is zaterdag en valt weg
  const d = snelleDatums('2026-11-19')
  assert.deepEqual(d, [
    { label: 'Morgen', dag: '2026-11-20' },
    { label: 'Volgende maandag', dag: '2026-11-23' },
    { label: 'Over een week', dag: '2026-11-26' },
    { label: 'Over twee weken', dag: '2026-12-03' },
  ])
  // Vrijdag: morgen en overmorgen vallen in het weekend
  assert.deepEqual(snelleDatums('2026-11-20').map((x) => x.label), ['Volgende maandag', 'Over een week', 'Over twee weken'])
  // Maandag: alles, en volgende maandag is over een week (één keer)
  assert.deepEqual(snelleDatums('2026-11-16').map((x) => x.label), ['Morgen', 'Overmorgen', 'Volgende maandag', 'Over twee weken'])
  for (const v of ['2026-11-16', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']) {
    for (const x of snelleDatums(v)) assert.ok(![0, 6].includes(new Date(`${x.dag}T12:00:00Z`).getUTCDay()), `${v}: ${x.label} valt in het weekend`)
  }
})

test('Taaknaam in ClickUp: Opvolgen met de klant erbij', () => {
  assert.equal(SNELLE_TAKEN[0], 'Opvolgen')
  assert.equal(leadTaakNaam('Opvolgen', 'Kilowot'), 'Opvolgen (Kilowot)')
})

console.log(`\n${n} tests geslaagd\n`)
