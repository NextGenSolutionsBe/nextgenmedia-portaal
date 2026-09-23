// Tests voor de contracttypes (pure logica).
// Uitvoeren: npx tsx tests/contract-types.test.ts
import assert from 'node:assert/strict'
import {
  NIET_TOEGEWEZEN, MAX_TYPE_LENGTE, SEED_CONTRACTTYPES,
  normaliseerType, typeSleutel, gelijkType, typeVanContract, isNietToegewezen,
  ontdubbelTypes, seedLijst, isOverig, maakOverigType, splitsOverig,
  telGebruik, hernoemInContracten, keurNaamGoed,
} from '../lib/contracten/types'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }

console.log('Contracttypes')

test('1. Normaliseren: trimmen, spaties samentrekken, afkappen op 60 tekens', () => {
  assert.equal(normaliseerType('  Klantcontract  '), 'Klantcontract')
  assert.equal(normaliseerType('Social   Media\tcontract'), 'Social Media contract')
  assert.equal(normaliseerType(null), '')
  assert.equal(normaliseerType(undefined), '')
  assert.equal(normaliseerType('   '), '')
  const lang = 'A'.repeat(80)
  assert.equal(normaliseerType(lang).length, MAX_TYPE_LENGTE)
  // Afkappen mag geen spatie op het einde laten staan.
  assert.equal(normaliseerType('B'.repeat(59) + ' staart'), 'B'.repeat(59))
})

test('2. Vergelijken gebeurt hoofdletterongevoelig, leeg matcht nooit', () => {
  assert.equal(typeSleutel(' Websitecontract '), 'websitecontract')
  assert.ok(gelijkType('Overige', 'overige'))
  assert.ok(gelijkType('NDA / geheimhouding', ' nda / geheimhouding'))
  assert.equal(gelijkType('', ''), false)
  assert.equal(gelijkType(null, 'Overige'), false)
  assert.equal(gelijkType('Overige', 'Overig'), false)
})

test('3. Terugval: een contract zonder type is "Niet toegewezen"', () => {
  assert.equal(typeVanContract(null), NIET_TOEGEWEZEN)
  assert.equal(typeVanContract(''), NIET_TOEGEWEZEN)
  assert.equal(typeVanContract('   '), NIET_TOEGEWEZEN)
  assert.equal(typeVanContract('Klantcontract'), 'Klantcontract')
  assert.ok(isNietToegewezen(null))
  assert.ok(isNietToegewezen('niet toegewezen'))
  assert.equal(isNietToegewezen('Klantcontract'), false)
})

test('4. Ontdubbelen is hoofdletterongevoelig en voegt bijna-dubbels samen', () => {
  assert.deepEqual(ontdubbelTypes(['Overige', 'overige', 'OVERIGE']), ['Overige'])
  assert.deepEqual(ontdubbelTypes(['Klantcontract', '', null, '  ', 'Marketing']), ['Klantcontract', 'Marketing'])
  // 'Overig' hoort bij het bestaande 'Overige'; 'Freelancer' bij 'Freelancecontract'.
  assert.deepEqual(ontdubbelTypes(['Overige', 'Overig']), ['Overige'])
  assert.deepEqual(ontdubbelTypes(['Freelancer']), ['Freelancecontract'])
  assert.deepEqual(ontdubbelTypes(['Geheimhouding/NDA']), ['NDA / geheimhouding'])
  assert.deepEqual(ontdubbelTypes(['Samenwerking']), ['Samenwerkingsovereenkomst'])
})

test('5. De startlijst bevat de gevraagde types, de types in gebruik en "Niet toegewezen"', () => {
  const lijst = seedLijst(['Brandingcontract', 'Sponsordeal', 'brandingcontract'])
  for (const verwacht of ['Klantcontract', 'Dienstverlening', 'Socialmediamanagement', 'Marketing', 'Software of ontwikkeling', 'Onderhoud', 'Verhuur', 'Algemene voorwaarden']) {
    assert.ok(lijst.includes(verwacht), `ontbreekt: ${verwacht}`)
  }
  assert.ok(lijst.includes('Sponsordeal'), 'een type dat al op een contract staat gaat nooit verloren')
  assert.equal(lijst.at(-1), NIET_TOEGEWEZEN, '"Niet toegewezen" staat achteraan')
  assert.equal(new Set(lijst.map((t) => t.toLowerCase())).size, lijst.length, 'geen dubbels')
  assert.ok(SEED_CONTRACTTYPES.length >= 18)
})

test('6. "Overige" met eigen omschrijving is één typewaarde', () => {
  assert.ok(isOverig('Overige'))
  assert.ok(isOverig('overig'))
  assert.ok(isOverig('Overige — Sponsoring'))
  assert.equal(isOverig('Klantcontract'), false)
  assert.equal(maakOverigType('Overige', 'Sponsoring'), 'Overige — Sponsoring')
  assert.equal(maakOverigType('Overige', '   '), 'Overige')
  assert.deepEqual(splitsOverig('Overige — Sponsoring'), { basis: 'Overige', omschrijving: 'Sponsoring' })
  assert.deepEqual(splitsOverig('Klantcontract'), { basis: 'Klantcontract', omschrijving: '' })
  // Blijft binnen de maximale lengte.
  assert.ok(maakOverigType('Overige', 'x'.repeat(100)).length <= MAX_TYPE_LENGTE)
})

test('7. Gebruikstelling groepeert hoofdletterongevoelig en telt lege types als "Niet toegewezen"', () => {
  const contracten = [
    { contract_type: 'Klantcontract' },
    { contract_type: 'klantcontract' },
    { contract_type: null },
    { contract_type: '' },
    { contract_type: 'Websitecontract' },
  ]
  const gebruik = telGebruik(contracten, ['Klantcontract', 'Websitecontract', 'Marketing', NIET_TOEGEWEZEN])
  const kaart = new Map(gebruik.map((g) => [g.naam, g.aantal]))
  assert.equal(kaart.get('Klantcontract'), 2)
  assert.equal(kaart.get('Websitecontract'), 1)
  assert.equal(kaart.get(NIET_TOEGEWEZEN), 2)
  assert.equal(kaart.get('Marketing'), 0, 'een ongebruikt type staat op 0')
})

test('8. Hernoemen neemt alle contracten met die typewaarde mee', () => {
  const contracten = [
    { id: 'a', contract_type: 'Websitecontract' },
    { id: 'b', contract_type: 'websitecontract' },   // andere schrijfwijze
    { id: 'c', contract_type: 'Klantcontract' },
    { id: 'd', contract_type: null },                 // Niet toegewezen
  ]
  const { contracten: na, gewijzigd } = hernoemInContracten(contracten, 'Websitecontract', 'Webdesigncontract')
  assert.equal(gewijzigd, 2)
  assert.deepEqual(na.map((c) => c.contract_type), ['Webdesigncontract', 'Webdesigncontract', 'Klantcontract', null])

  // "Niet toegewezen" hernoemen raakt ook de contracten zónder waarde.
  const r2 = hernoemInContracten(contracten, NIET_TOEGEWEZEN, 'Nog te bepalen')
  assert.equal(r2.gewijzigd, 1)
  assert.equal(r2.contracten[3].contract_type, 'Nog te bepalen')

  // Niets te doen: lege doelnaam of dezelfde naam.
  assert.equal(hernoemInContracten(contracten, 'Websitecontract', '   ').gewijzigd, 0)
  // Enkel de schrijfwijze rechttrekken: alleen de afwijkende rij wijzigt.
  assert.equal(hernoemInContracten(contracten, 'Websitecontract', 'websitecontract').gewijzigd, 1)
  assert.equal(hernoemInContracten(contracten, 'Bestaat niet', 'Iets').gewijzigd, 0)
})

test('9. Naamcontrole geeft een duidelijke Nederlandse melding', () => {
  const bestaande = ['Klantcontract', 'Marketing']
  assert.match(keurNaamGoed('', bestaande) ?? '', /Geef een naam/)
  assert.match(keurNaamGoed('   ', bestaande) ?? '', /Geef een naam/)
  assert.match(keurNaamGoed('x'.repeat(61), bestaande) ?? '', /maximaal 60 tekens/)
  assert.match(keurNaamGoed('klantcontract', bestaande) ?? '', /bestaat al/)
  assert.equal(keurNaamGoed('Onderhoud', bestaande), null)
  // Hernoemen naar dezelfde naam (andere schrijfwijze) mag wel.
  assert.equal(keurNaamGoed('KlantContract', bestaande, 'Klantcontract'), null)
})

console.log(`\n${n} tests geslaagd`)
