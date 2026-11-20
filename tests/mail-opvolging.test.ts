// Mail-opvolging: adressen, het nieuwe deel van een antwoord, werkdagen en de opvolgregels per project.
// Uitvoeren: npx tsx tests/mail-opvolging.test.ts
import assert from 'node:assert/strict'
import { bepaalOpvolging, domeinUitWebsite, isEigen, koppel, moetOpvolgen, nieuwDeel, normEmail, werkdagenTussen, type Gebeurtenis } from '../lib/mail-opvolging/regels'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nMail-opvolging\n')

test('Adressen: netjes, eigen domeinen, website naar domein', () => {
  assert.equal(normEmail('Jan Peeters <Jan@Peeters.BE>'), 'jan@peeters.be')
  assert.equal(normEmail('geen adres'), null)
  assert.ok(isEigen('bram@nextgenmedia.be')); assert.ok(isEigen('info@nextgensolutions.be'))
  assert.ok(!isEigen('jan@peeters.be')); assert.ok(isEigen('privé@gmail.com', new Set(['privé@gmail.com'])))
  assert.equal(domeinUitWebsite('https://www.peeters.be/contact'), 'peeters.be')
})

test('Koppelen: eerst het volledige adres, dan het domein, nooit op gmail.com', () => {
  const boek = { adressen: new Map([['jan@peeters.be', { client_id: 'k1', opdracht_id: null }], ['lead@gmail.com', { client_id: null, opdracht_id: 'o9' }]]), domeinen: new Map([['peeters.be', 'k1'], ['gmail.com', 'kX']]) }
  assert.deepEqual(koppel(['Jan@peeters.be'], boek), { client_id: 'k1', opdracht_id: null, tegenpartij: 'jan@peeters.be' })
  assert.deepEqual(koppel(['an@peeters.be'], boek), { client_id: 'k1', opdracht_id: null, tegenpartij: 'an@peeters.be' })
  assert.deepEqual(koppel(['lead@gmail.com'], boek), { client_id: null, opdracht_id: 'o9', tegenpartij: 'lead@gmail.com' })
  assert.equal(koppel(['iemand@gmail.com'], boek), null)
  assert.equal(koppel(['x@onbekend.be'], boek), null)
})

test('Nieuw deel van een antwoord: zonder citaat en zonder doorgestuurde koppen', () => {
  const t = 'Dag Bram,\n\nPrima, we gaan akkoord.\n\nGroeten\nJan\n\nOp ma 10 nov 2026 om 10:00 schreef Bram <bram@nextgenmedia.be>:\n> Hierbij de offerte\n> Groeten'
  assert.equal(nieuwDeel(t), 'Dag Bram,\n\nPrima, we gaan akkoord.\n\nGroeten\nJan')
  assert.equal(nieuwDeel('Ok!\n-----Original Message-----\nFrom: x'), 'Ok!')
  assert.equal(nieuwDeel('Top\n\nVan: Bram\nVerzonden: maandag'), 'Top')
})

test('Werkdagen: weekend telt niet', () => {
  assert.equal(werkdagenTussen('2026-11-13T10:00:00Z', '2026-11-16T09:00:00Z'), 1, 'vr → ma')
  assert.equal(werkdagenTussen('2026-11-10T10:00:00Z', '2026-11-17T10:00:00Z'), 5)
  assert.equal(werkdagenTussen('2026-11-17T10:00:00Z', '2026-11-10T10:00:00Z'), 0)
})

const g = (soort: Gebeurtenis['soort'], op: string, extra: Partial<Gebeurtenis> = {}): Gebeurtenis => ({ sleutel: `${soort}:${op}`, soort, op, titel: 'Voorstel', ...extra })
const nu = new Date('2026-11-17T12:00:00Z') // dinsdag

test('Zonder meeting, offerte of contract: niets opvolgen (gewone communicatie)', () => {
  assert.equal(bepaalOpvolging({ kolom: 'potentieel', gebeurtenissen: [g('uit', '2026-11-03T10:00:00Z'), g('in', '2026-11-04T10:00:00Z')], nu }), null)
})

test('Meeting gehad, daarna niets gestuurd: na 2 werkdagen opvolgen, dringend na 5', () => {
  assert.equal(bepaalOpvolging({ kolom: 'potentieel', gebeurtenissen: [g('meeting', '2026-11-16T10:00:00Z')], nu }), null)
  const o = bepaalOpvolging({ kolom: 'potentieel', gebeurtenissen: [g('meeting', '2026-11-12T10:00:00Z', { titel: 'Kennismaking' })], nu })
  assert.equal(o?.status, 'na_meeting'); assert.equal(o?.dringend, false); assert.match(o?.tekst ?? '', /Kennismaking/)
  assert.equal(bepaalOpvolging({ kolom: 'potentieel', gebeurtenissen: [g('meeting', '2026-11-05T10:00:00Z')], nu })?.dringend, true)
})

test('Wij mailden na de meeting, geen reactie: wachten, na 3 werkdagen opvolgen', () => {
  const wacht = bepaalOpvolging({ kolom: 'offerte', gebeurtenissen: [g('meeting', '2026-11-10T10:00:00Z'), g('uit', '2026-11-16T10:00:00Z')], nu })
  assert.equal(wacht?.status, 'wacht_op_klant'); assert.equal(moetOpvolgen(wacht), false)
  const o = bepaalOpvolging({ kolom: 'offerte', gebeurtenissen: [g('meeting', '2026-11-05T10:00:00Z'), g('uit', '2026-11-11T10:00:00Z')], nu })
  assert.equal(o?.status, 'geen_reactie'); assert.equal(o?.werkdagen, 4); assert.ok(moetOpvolgen(o))
})

test('De klant mailde en wij nog niet: wacht op ons', () => {
  const o = bepaalOpvolging({ kolom: 'offerte', gebeurtenissen: [g('meeting', '2026-11-05T10:00:00Z'), g('uit', '2026-11-06T10:00:00Z'), g('in', '2026-11-16T10:00:00Z', { wie: 'Bakkerij Peeters', ai: 'vraag' })], nu })
  assert.equal(o?.status, 'wacht_op_ons'); assert.match(o?.tekst ?? '', /^Bakkerij Peeters mailde .* en stelt een vraag/); assert.equal(o?.dringend, true)
})

test('AI-inschatting: akkoord stelt Offerte geaccepteerd voor, weigering Verloren', () => {
  const ok = bepaalOpvolging({ kolom: 'offerte', gebeurtenissen: [g('offerte', '2026-11-05T10:00:00Z'), g('in', '2026-11-16T10:00:00Z', { ai: 'akkoord', samenvatting: 'Gaat akkoord met de offerte' })], nu })
  assert.equal(ok?.status, 'akkoord'); assert.equal(ok?.actie, 'naar_geaccepteerd')
  const nee = bepaalOpvolging({ kolom: 'offerte', gebeurtenissen: [g('offerte', '2026-11-05T10:00:00Z'), g('in', '2026-11-16T10:00:00Z', { ai: 'weigering' })], nu })
  assert.equal(nee?.actie, 'naar_verloren')
})

test('Offerte of contract als laatste: staat al in een ander blok (niet dubbel)', () => {
  const o = bepaalOpvolging({ kolom: 'offerte', gebeurtenissen: [g('offerte', '2026-11-05T10:00:00Z')], nu })
  assert.equal(o?.elders, true); assert.equal(moetOpvolgen(o), false)
})

test('Opgevolgd: weg tot er iets nieuws gebeurt; getekend of verloren: nooit', () => {
  const lijst = [g('meeting', '2026-11-05T10:00:00Z'), g('uit', '2026-11-06T10:00:00Z')]
  assert.equal(bepaalOpvolging({ kolom: 'offerte', gebeurtenissen: lijst, afgehandeld: new Set(['uit:2026-11-06T10:00:00Z']), nu }), null)
  assert.ok(bepaalOpvolging({ kolom: 'offerte', gebeurtenissen: [...lijst, g('uit', '2026-11-10T10:00:00Z')], afgehandeld: new Set(['uit:2026-11-06T10:00:00Z']), nu }))
  assert.equal(bepaalOpvolging({ kolom: 'getekend', gebeurtenissen: lijst, nu }), null)
  assert.equal(bepaalOpvolging({ kolom: 'stopgezet', gebeurtenissen: lijst, nu }), null)
})

test('Toekomstige meetings tellen niet mee', () => {
  assert.equal(bepaalOpvolging({ kolom: 'potentieel', gebeurtenissen: [g('meeting', '2026-11-20T10:00:00Z')], nu }), null)
})

console.log(`\n${n} tests geslaagd\n`)
