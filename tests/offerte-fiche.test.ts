// Offertes opmaken in de app: fiches, prijsblok, nummer, voorwaarden, afzender.
//
//   npx tsx tests/offerte-fiche.test.ts

import assert from 'node:assert/strict'
import {
  leesInhoud, berekenPrijs, volgendOffertenummer, ficheWeergave, controleerOpmaak, bedragVan, getekendOp, DIENST_FICHES, FICHE_NAAR_DIENST,
} from '../lib/offerte-fiche'
import { offerteVoorwaarden } from '../lib/offerte-voorwaarden'
import { leesOfferteInstellingen, controleerOfferteInstellingen, offerteBedrijf, contactUitPersoneel } from '../lib/offerte-afzender'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nOffertes opmaken\n')

test('1. Inhoud: lege velden weg, onbekende diensten weg, ja/nee-detail enkel bij ja', () => {
  const i = leesInhoud({
    algemeen: { projectnaam: '  Social media 2027 ', doel: '', onbekend: 'x' },
    diensten: ['social_media', 'iets', 'social_media'],
    fiches: { social_media: { posts: '12', kanalen: ['Instagram', 'Instagram', 'Facebook'], kanalen_andere: 'Pinterest', community: 'nee', community_detail: 'mag weg', rapportering: 'ja', rapportering_freq: 'maandelijks' } },
    prijs: { maandelijks: '1.250', maanden: '12', btw: '21' },
    extra: [{ omschrijving: 'Fotoshoot', bedrag: '450' }, { omschrijving: '', bedrag: '' }],
  })
  assert.deepEqual(i.algemeen, { projectnaam: 'Social media 2027' })
  assert.deepEqual(i.diensten, ['social_media'])
  assert.deepEqual(i.fiches.social_media, { kanalen: ['Instagram', 'Facebook'], kanalen_andere: 'Pinterest', posts: '12', community: 'nee', rapportering: 'ja', rapportering_freq: 'maandelijks' })
  assert.equal(i.extra.length, 1)
})

test('2. Prijs: opstart + maand × maanden + kosten, btw en totaal; budget apart tenzij via ons', () => {
  const p = berekenPrijs({ setup: '500', maandelijks: '1.250', maanden: '12', advertentiebudget: '300', verplaatsing: '45,50', btw: '21' }, [{ omschrijving: 'Fotoshoot', bedrag: '450' }])
  assert.equal(p.looptijd, 15500)
  assert.equal(p.excl, 15995.5)
  assert.equal(p.btw, 3359.06)
  assert.equal(p.incl, 19354.56)
  assert.equal(p.budgetApart, 300)
  assert.equal(p.lijnen[1].detail?.replace(/\u00a0/g, ' '), '12 maanden × € 1.250')
  const viaOns = berekenPrijs({ maandelijks: '500', advertentiebudget: '300', budget_via_ons: 'ja' })
  assert.equal(viaOns.excl, 800)
  assert.equal(viaOns.budgetApart, 0)
  assert.equal(bedragVan('€ 1 250,00'), 1250)
  assert.equal(bedragVan('4950'), 4950)
})

test('3. Offertenummer loopt per jaar door', () => {
  assert.equal(volgendOffertenummer(['OF-2026-007', 'OF-2026-012', 'OF-2025-099', null, 'iets'], 2026), 'OF-2026-013')
  assert.equal(volgendOffertenummer(['OF-2026-012'], 2027), 'OF-2027-001')
  assert.equal(volgendOffertenummer([], 2026), 'OF-2026-001')
})

test('4. Pdf-weergave: feiten, inbegrepen, niet inbegrepen en blokken', () => {
  const w = ficheWeergave('social_media', { pakket: 'Groei', looptijd: '12', kanalen: ['Instagram'], kanalen_andere: 'Pinterest', community: 'ja', community_detail: 'elke werkdag', planning: 'nee', ads_budget: 'ja', ads_budget_bedrag: '300', aanleveren: 'Logo', niet_inbegrepen: 'Drukwerk\n- Extra draaidagen' })
  assert.deepEqual(w.feiten, [['Gekozen pakket', 'Groei'], ['Looptijd', '12 maanden'], ['Kanalen', 'Instagram, Pinterest']])
  assert.deepEqual(w.inbegrepen.map((x) => x.replace(/\u00a0/g, ' ')), ['Community management: elke werkdag', 'Advertentiebudget: € 300 per maand'])
  assert.deepEqual(w.niet, ['Contentplanning', 'Drukwerk', 'Extra draaidagen'])
  assert.deepEqual(w.blokken, [['Wat de klant aanlevert', 'Logo']])
  const v = ficheWeergave('video_foto', { verplaatsing: 'ja', presentator: 'ja', presentator_wie: 'de klant' })
  assert.deepEqual(v.feiten, [['Presentator, acteur of voice-over nodig', 'Ja · de klant'], ['Verplaatsingskosten van toepassing', 'Ja']])
  for (const f of DIENST_FICHES) assert.ok(FICHE_NAAR_DIENST[f.key], f.key)
})

test('5. Bewaren: klant, verantwoordelijke, projectnaam, geldigheid en een dienst nodig', () => {
  const leeg = controleerOpmaak(leesInhoud({}), { klant: false, verantwoordelijke: null, vandaag: '2026-11-09' }).map((f) => f.veld)
  assert.deepEqual(leeg, ['klant', 'verantwoordelijke', 'projectnaam', 'geldig_tot', 'diensten'])
  const ok = leesInhoud({ algemeen: { projectnaam: 'Website', geldig_tot: '2026-12-09' }, diensten: ['website'], prijs: { setup: '2.500' } })
  assert.deepEqual(controleerOpmaak(ok, { klant: true, verantwoordelijke: 'bram', vandaag: '2026-11-09' }), [])
  const fout = leesInhoud({ algemeen: { projectnaam: 'Website', geldig_tot: '2026-11-01' }, diensten: ['website'], prijs: { setup: 'veel' } })
  assert.deepEqual(controleerOpmaak(fout, { klant: true, verantwoordelijke: 'marco', vandaag: '2026-11-09' }).map((f) => f.veld), ['geldig_tot', 'prijs.setup'])
})

test('6. Voorwaarden: 18 artikels, gegevens ingevuld, geen placeholders meer', () => {
  const a = offerteVoorwaarden({ vennootschap: 'NextGen Agency BV', adres: 'Corda Campus, Kempische Steenweg 293/16 B, 3500 Hasselt', ondernemingsnummer: '1044.961.303', betalingstermijn: 14 })
  assert.equal(a.length, 18)
  assert.equal(a[0].titel, '1. IDENTITEIT EN TOEPASSING')
  assert.match(a[0].alineas[0], /opgesteld door NextGen Agency BV, met maatschappelijke zetel te Corda Campus, Kempische Steenweg 293\/16 B, 3500 Hasselt, ingeschreven .* onder nummer 1044\.961\.303/)
  assert.match(a[7].alineas[0], /binnen 14 kalenderdagen/)
  assert.ok(!/\{[a-z]+\}/.test(JSON.stringify(a)))
})

test('7. Afzender: vaste bedrijfsgegevens, contactpersoon uit Personeel met terugval', () => {
  const b = offerteBedrijf({ naam: 'NextGenMedia', website: 'nextgenmedia.be' })
  assert.equal(b.vennootschap, 'NextGen Agency BV')
  assert.equal(b.ondernemingsnummer, '1044.961.303')
  assert.equal(b.btw, 'BE1044.961.303')
  assert.equal(b.adres, 'Corda Campus, Kempische Steenweg 293/16 B, 3500 Hasselt')
  assert.equal(b.email, 'legal@nextgenmedia.be')
  const bram = contactUitPersoneel('bram', { voornaam: 'Bram', achternaam: 'Reinquin', email: 'bram@nextgenmedia.be', telefoon: '+32 470 12 34 56', functie: null, profielfoto_pad: 'x/foto/y.jpeg' })
  assert.deepEqual(bram, { naam: 'Bram Reinquin', functie: 'Zaakvoerder', telefoon: '+32 470 12 34 56', email: 'bram@nextgenmedia.be', heeftFoto: true })
  const marco = contactUitPersoneel('marco', { voornaam: 'Marco', achternaam: 'Castermans', email: null })
  assert.equal(marco.email, 'info@nextgenmedia.be')
  assert.equal(contactUitPersoneel('marco', null).naam, 'Marco Castermans')
  assert.equal(leesOfferteInstellingen({ betalingstermijn: 30 }).betalingstermijn, 30)
  assert.equal(controleerOfferteInstellingen({ betalingstermijn: 'veel' }).ok, false)
  assert.match(getekendOp('2026-11-09T13:32:00Z'), /^9 november 2026 om 14:32$/)
})

console.log(`\n${n} tests geslaagd\n`)
