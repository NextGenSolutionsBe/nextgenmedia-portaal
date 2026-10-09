// Tests voor het shootdocument (pure logica: regels splitsen, bestandsnaam, sanitizer).
// Uitvoeren: npx tsx tests/shoot-document.test.ts
import assert from 'node:assert/strict'
import { splitsInRegels, veilig, bestandsnaamShootDocument, asciiNaamdeel, heeftInhoud } from '../lib/shoot-document-model'
import { geldigeMetricoolFeedbackUrl } from '../lib/metricool-feedback'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }

console.log('Shootdocument')

test('1. Handmatige regeleinden blijven behouden', () => {
  assert.deepEqual(splitsInRegels('Intro shot voor de deur\nClose-up van het logo\r\nAfsluiter met glimlach'),
    ['Intro shot voor de deur', 'Close-up van het logo', 'Afsluiter met glimlach'])
})

test('2. Zinnen worden gesplitst op . ! ? zonder de bewoording te wijzigen', () => {
  assert.deepEqual(splitsInRegels('Hallo allemaal! Vandaag tonen we de nieuwe collectie. Klaar? Kom binnen.'),
    ['Hallo allemaal!', 'Vandaag tonen we de nieuwe collectie.', 'Klaar?', 'Kom binnen.'])
  assert.equal(splitsInRegels('Hallo allemaal! Vandaag tonen we de nieuwe collectie.').join(' '),
    'Hallo allemaal! Vandaag tonen we de nieuwe collectie.')
})

test('3. Eerst regeleinden, dan zinnen — gecombineerd', () => {
  assert.deepEqual(splitsInRegels('Scene 1: buiten. Camera laag.\n\nScene 2: binnen! Licht aan.'),
    ['Scene 1: buiten.', 'Camera laag.', 'Scene 2: binnen!', 'Licht aan.'])
})

test('4. Geen lege regels, ook niet bij extra witruimte of enkel vinkvakjes', () => {
  assert.deepEqual(splitsInRegels('  \n\n   Eén regel.   \n\t\n☐ Tweede regel\n☐\n- Derde regel'),
    ['Eén regel.', 'Tweede regel', 'Derde regel'])
  assert.deepEqual(splitsInRegels('Statief meenemen. ☐ Extra batterijen'), ['Statief meenemen.', 'Extra batterijen'])
  assert.deepEqual(splitsInRegels('-5 graden buiten. Warm aankleden!'), ['-5 graden buiten.', 'Warm aankleden!'])
  assert.deepEqual(splitsInRegels(''), [])
  assert.deepEqual(splitsInRegels(null), [])
  assert.deepEqual(splitsInRegels(undefined), [])
})

test('5. Sluitende aanhalingstekens en haakjes horen bij de zin', () => {
  assert.deepEqual(splitsInRegels('Zeg "Welkom bij ons!" Daarna lachen (echt.) En stop.'),
    ['Zeg "Welkom bij ons!"', 'Daarna lachen (echt.)', 'En stop.'])
  assert.deepEqual(splitsInRegels('Even wachten… Dan verder.'), ['Even wachten…', 'Dan verder.'])
})

test('6. Sanitizer: emoji weg, slimme aanhalingstekens en € blijven, vinkvakjes worden tekst', () => {
  assert.equal(veilig('Lach 😀 naar de camera'), 'Lach naar de camera')
  assert.equal(veilig('‘Hallo’ – “dag” € 5 …'), '‘Hallo’ – “dag” € 5 …')
  assert.equal(veilig('☐ nog doen ☑ klaar'), '[ ] nog doen [x] klaar')
  assert.equal(veilig('Café Éclair — ok'), 'Café Éclair — ok')
})

test('7. Bestandsnaam is ASCII en bevat klant, project en datum', () => {
  assert.equal(bestandsnaamShootDocument('Bakkerij Éclair & Zo', 'Social media', '2026-10-12'),
    'Shootvoorbereiding_Bakkerij-Eclair-Zo_Social-media_2026-10-12.pdf')
  assert.equal(asciiNaamdeel('   ', 'Klant'), 'Klant')
  assert.match(bestandsnaamShootDocument('X', 'Y', 'geen datum'), /^Shootvoorbereiding_X_Y_\d{4}-\d{2}-\d{2}\.pdf$/)
})

test('8. heeftInhoud: enkel scripts of medianotities tellen', () => {
  assert.equal(heeftInhoud([{ title: 'A', script: null, media_notes: null }]), false)
  assert.equal(heeftInhoud([{ title: 'A', script: '  \n ', media_notes: '' }]), false)
  assert.equal(heeftInhoud([{ title: 'A', script: null, media_notes: 'Statief meenemen.' }]), true)
  assert.equal(heeftInhoud([{ title: 'A', script: 'Hoi.', media_notes: null }]), true)
})

test('9. Metricool-feedbacklink: enkel https naar metricool.com', () => {
  assert.equal(geldigeMetricoolFeedbackUrl('https://app.metricool.com/planner?blogId=1'), 'https://app.metricool.com/planner?blogId=1')
  assert.equal(geldigeMetricoolFeedbackUrl(' https://metricool.com/x '), 'https://metricool.com/x')
  assert.equal(geldigeMetricoolFeedbackUrl('http://app.metricool.com/x'), null)
  assert.equal(geldigeMetricoolFeedbackUrl('https://evilmetricool.com/x'), null)
  assert.equal(geldigeMetricoolFeedbackUrl('https://metricool.com.evil.be/x'), null)
  assert.equal(geldigeMetricoolFeedbackUrl('https://user:pw@app.metricool.com/x'), null)
  assert.equal(geldigeMetricoolFeedbackUrl(''), null)
  assert.equal(geldigeMetricoolFeedbackUrl(null), null)
})

console.log(`\n${n} tests geslaagd.`)
