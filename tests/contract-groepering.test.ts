// Tests voor de klantmappen van de contractenmodule (pure logica).
// Uitvoeren: npx tsx tests/contract-groepering.test.ts
import assert from 'node:assert/strict'
import {
  ZONDER_KLANT, ZONDER_KLANT_LABEL,
  bouwKlantmappen, sorteerMappen, totalen, typeOpties,
  contractDatum, isActief, isBeeindigd, matchtZoek, voldoetAanFilters,
  type OverzichtContract,
} from '../lib/contracten/overzicht'
import { NIET_TOEGEWEZEN } from '../lib/contracten/types'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }

const VANDAAG = '2026-09-23'

const klantA = { id: 'aaaa', company_name: 'Alfa Bouw' }
const klantB = { id: 'bbbb', company_name: 'Bakkerij Zoet' }
// Twee klanten met exact dezelfde bedrijfsnaam: groeperen mag NOOIT op naam.
const klantC = { id: 'cccc', company_name: 'Alfa Bouw' }

const maak = (p: Partial<OverzichtContract> & { id: string }): OverzichtContract => ({
  title: 'Contract ' + p.id,
  status: 'signed',
  contract_type: 'Klantcontract',
  client_id: null,
  client: null,
  created_at: '2026-01-01T10:00:00.000Z',
  ...p,
})

const contracten: OverzichtContract[] = [
  maak({ id: '1', client_id: klantA.id, client: klantA, title: 'Website Alfa', contract_type: 'Websitecontract', status: 'signed', signed_at: '2026-03-01T10:00:00.000Z', end_date: '2027-03-01' }),
  maak({ id: '2', client_id: klantA.id, client: klantA, title: 'Social Alfa', contract_type: 'Socialmediamanagement', status: 'sent', sent_at: '2026-05-10T10:00:00.000Z' }),
  maak({ id: '3', client_id: klantA.id, client: klantA, title: 'Oud contract Alfa', contract_type: 'Klantcontract', status: 'signed', signed_at: '2025-01-05T10:00:00.000Z', end_date: '2026-01-05' }),
  maak({ id: '4', client_id: klantB.id, client: klantB, title: 'Branding Bakkerij', contract_type: 'Brandingcontract', status: 'expired', created_at: '2026-06-01T10:00:00.000Z' }),
  maak({ id: '5', client_id: klantC.id, client: klantC, title: 'Onderhoud Alfa Bouw (andere klant)', contract_type: 'Onderhoud', status: 'signed', signed_at: '2026-08-20T10:00:00.000Z' }),
  maak({ id: '6', client_id: null, client: null, title: 'Intern NDA', contract_type: null, status: 'draft', created_at: '2026-02-02T10:00:00.000Z' }),
  maak({ id: '7', client_id: null, client: null, title: 'Los partnercontract', contract_type: 'Partnercontract', status: 'signed', signed_at: '2026-09-01T10:00:00.000Z' }),
]

console.log('Klantmappen contractoverzicht')

test('1. Groeperen gebeurt op client_id, nooit op klantnaam', () => {
  const mappen = bouwKlantmappen(contracten, { vandaag: VANDAAG })
  // Twee klanten heten "Alfa Bouw" — dat moeten twee aparte mappen blijven.
  const alfa = mappen.filter((m) => m.klantNaam === 'Alfa Bouw')
  assert.equal(alfa.length, 2)
  assert.deepEqual(alfa.map((m) => m.sleutel).sort(), ['aaaa', 'cccc'])
  assert.equal(mappen.length, 4, 'Alfa, Alfa (2), Bakkerij, Zonder klant')
})

test('2. Contracten zonder klant zitten samen in één map "Zonder klant"', () => {
  const mappen = bouwKlantmappen(contracten, { vandaag: VANDAAG })
  const los = mappen.find((m) => m.sleutel === ZONDER_KLANT)
  assert.ok(los)
  assert.equal(los!.klantNaam, ZONDER_KLANT_LABEL)
  assert.equal(los!.klantId, null)
  assert.deepEqual(los!.contracten.map((c) => c.id).sort(), ['6', '7'])
})

test('3. Lege mappen bestaan niet', () => {
  assert.deepEqual(bouwKlantmappen([], { vandaag: VANDAAG }), [])
  const enkel = bouwKlantmappen(contracten, { type: 'Brandingcontract', vandaag: VANDAAG })
  assert.equal(enkel.length, 1)
  assert.equal(enkel[0].sleutel, klantB.id)
})

test('4. Cijfers per map: totaal, actief en beëindigd', () => {
  const mappen = bouwKlantmappen(contracten, { vandaag: VANDAAG })
  const alfa = mappen.find((m) => m.sleutel === klantA.id)!
  assert.equal(alfa.aantal, 3)
  assert.equal(alfa.actief, 1, 'enkel #1 is getekend en nog niet op einddatum')
  assert.equal(alfa.beeindigd, 1, '#3 is over zijn einddatum')

  const bakkerij = mappen.find((m) => m.sleutel === klantB.id)!
  assert.equal(bakkerij.actief, 0)
  assert.equal(bakkerij.beeindigd, 1, 'status "expired" telt als beëindigd')

  // De losse bouwstenen apart.
  assert.equal(isActief(contracten[0], VANDAAG), true)
  assert.equal(isBeeindigd(contracten[2], VANDAAG), true)
  assert.equal(isBeeindigd(contracten[3], VANDAAG), true)
  assert.equal(isActief(contracten[1], VANDAAG), false, 'verzonden is nog niet actief')
})

test('5. De datum van een map is de meest recente contractdatum', () => {
  assert.equal(contractDatum(contracten[0]), '2026-03-01T10:00:00.000Z', 'getekend gaat voor verstuurd/aangemaakt')
  assert.equal(contractDatum(contracten[5]), '2026-02-02T10:00:00.000Z', 'anders de aanmaakdatum')
  const mappen = bouwKlantmappen(contracten, { vandaag: VANDAAG })
  assert.equal(mappen.find((m) => m.sleutel === klantA.id)!.laatsteDatum, '2026-05-10T10:00:00.000Z')
  assert.equal(mappen.find((m) => m.sleutel === ZONDER_KLANT)!.laatsteDatum, '2026-09-01T10:00:00.000Z')
  // Binnen een map staat het nieuwste contract bovenaan.
  assert.deepEqual(mappen.find((m) => m.sleutel === klantA.id)!.contracten.map((c) => c.id), ['2', '1', '3'])
})

test('6. Type- en statusfilter zijn hard: de cijfers volgen de gefilterde set', () => {
  const mappen = bouwKlantmappen(contracten, { status: 'getekend', vandaag: VANDAAG })
  const alfa = mappen.find((m) => m.sleutel === klantA.id)!
  assert.deepEqual(alfa.contracten.map((c) => c.id), ['1', '3'])
  assert.equal(alfa.aantal, 2)
  assert.ok(!mappen.some((m) => m.sleutel === klantB.id), 'Bakkerij heeft geen getekend contract meer')

  // Contracttype matcht hoofdletterongevoelig; leeg type valt onder "Niet toegewezen".
  assert.equal(bouwKlantmappen(contracten, { type: 'websitecontract', vandaag: VANDAAG }).length, 1)
  const zonderType = bouwKlantmappen(contracten, { type: NIET_TOEGEWEZEN, vandaag: VANDAAG })
  assert.equal(zonderType.length, 1)
  assert.deepEqual(zonderType[0].contracten.map((c) => c.id), ['6'])

  assert.equal(voldoetAanFilters(contracten[0], { type: 'Websitecontract' }), true)
  assert.equal(voldoetAanFilters(contracten[0], { status: 'verzonden' }), false)
})

test('7. Zoeken markeert treffers en verbergt mappen zonder treffer', () => {
  // Zoeken op klantnaam.
  const opKlant = bouwKlantmappen(contracten, { zoek: 'bakkerij', vandaag: VANDAAG })
  assert.equal(opKlant.length, 1)
  assert.deepEqual(opKlant[0].treffers, ['4'])

  // Zoeken op contractnaam: de map blijft volledig zichtbaar, enkel de treffer is gemarkeerd.
  const opContract = bouwKlantmappen(contracten, { zoek: 'Social Alfa', vandaag: VANDAAG })
  assert.equal(opContract.length, 1)
  assert.equal(opContract[0].aantal, 3, 'de andere contracten van de klant blijven in de map staan')
  assert.deepEqual(opContract[0].treffers, ['2'])

  // Zoeken op contracttype.
  const opType = bouwKlantmappen(contracten, { zoek: 'onderhoud', vandaag: VANDAAG })
  assert.deepEqual(opType.map((m) => m.sleutel), [klantC.id])

  // Niets gevonden.
  assert.deepEqual(bouwKlantmappen(contracten, { zoek: 'bestaat niet', vandaag: VANDAAG }), [])

  // Extra zoekvelden (ondertekenaar, dienst) blijven werken via zoekExtra.
  const extra = bouwKlantmappen(
    [maak({ id: '9', client_id: klantA.id, client: klantA, zoekExtra: 'jan@voorbeeld.be' })],
    { zoek: 'jan@voorbeeld', vandaag: VANDAAG },
  )
  assert.deepEqual(extra[0].treffers, ['9'])

  assert.equal(matchtZoek(contracten[0], '  '), true, 'lege zoekterm matcht alles')
})

test('8. Zoeken en filteren werken samen', () => {
  const mappen = bouwKlantmappen(contracten, { zoek: 'alfa', status: 'getekend', vandaag: VANDAAG })
  // 'Alfa' zit in de klantnaam van zowel klant A als klant C.
  assert.deepEqual(mappen.map((m) => m.sleutel).sort(), ['aaaa', 'cccc'])
  assert.deepEqual(mappen.find((m) => m.sleutel === 'aaaa')!.contracten.map((c) => c.id), ['1', '3'])
})

test('9. Sorteren op klantnaam, aantal en meest recente contract', () => {
  const opNaam = bouwKlantmappen(contracten, { sorteer: 'klant', vandaag: VANDAAG })
  assert.deepEqual(opNaam.map((m) => m.klantNaam), ['Alfa Bouw', 'Alfa Bouw', 'Bakkerij Zoet', ZONDER_KLANT_LABEL])

  const opAantal = bouwKlantmappen(contracten, { sorteer: 'aantal', vandaag: VANDAAG })
  assert.deepEqual(opAantal.map((m) => m.aantal), [3, 2, 1, 1])
  assert.equal(opAantal[0].sleutel, klantA.id)

  const opRecent = bouwKlantmappen(contracten, { sorteer: 'recent', vandaag: VANDAAG })
  assert.deepEqual(opRecent.map((m) => m.sleutel), [ZONDER_KLANT, klantC.id, klantB.id, klantA.id])

  // Mappen zonder datum komen achteraan.
  const zonderDatum = sorteerMappen([
    { sleutel: 'x', klantId: 'x', klantNaam: 'Xerox', contracten: [], treffers: [], aantal: 1, actief: 0, beeindigd: 0, laatsteDatum: null },
    { sleutel: 'y', klantId: 'y', klantNaam: 'Yuma', contracten: [], treffers: [], aantal: 1, actief: 0, beeindigd: 0, laatsteDatum: '2026-01-01' },
  ], 'recent')
  assert.deepEqual(zonderDatum.map((m) => m.sleutel), ['y', 'x'])
})

test('10. Totalen en typekeuzes', () => {
  const mappen = bouwKlantmappen(contracten, { vandaag: VANDAAG })
  // #1 (Alfa), #5 (Alfa Bouw 2) en #7 (los) zijn getekend en niet beëindigd.
  assert.deepEqual(totalen(mappen), { mappen: 4, contracten: 7, actief: 3, beeindigd: 2 })

  const opties = typeOpties(contracten, ['Marketing', 'Klantcontract'])
  assert.ok(opties.includes('Marketing'), 'beheerde types horen er ook bij als niemand ze gebruikt')
  assert.ok(opties.includes(NIET_TOEGEWEZEN), 'contracten zonder type krijgen de terugval')
  assert.equal(new Set(opties.map((t) => t.toLowerCase())).size, opties.length, 'geen dubbels')
  assert.deepEqual(opties, [...opties].sort((a, b) => a.localeCompare(b, 'nl')), 'alfabetisch')
})

console.log(`\n${n} tests geslaagd`)
