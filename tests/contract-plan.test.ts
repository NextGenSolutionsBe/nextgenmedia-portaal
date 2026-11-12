// Facturen plannen uit een getekend contract: titels, omschrijvingen, periodes, posten.
// Uitvoeren: npx tsx tests/contract-plan.test.ts
import assert from 'node:assert/strict'
import { maakPlan, periodeNaam, factuurTitel, planSamenvatting, postenVoorContract, duurMaanden, frequentieVan, dienstNaam, type PlanPost } from '../lib/facturatie/contract-plan'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nFacturen uit het contract\n')

const post = (x: Partial<PlanPost>): PlanPost => ({ naam: 'Sociale media management', soort: 'terugkerend', frequentie: 'maandelijks', bedrag: 979, perioden: 6, start: '2026-07-01', inbegrepen: [], ...x })
const plan = (posten: PlanPost[], extra: Partial<Parameters<typeof maakPlan>[0]> = {}) =>
  maakPlan({ contractTitel: 'Social Media Samenwerkingsovereenkomst 2026', getekendOp: '2026-05-28', posten, btwPct: 21, moment: 'eerste', ...extra })

test('Periodenamen: maand, kwartaal, halfjaar, jaar en een bereik', () => {
  assert.equal(periodeNaam('2026-11', 1), 'november 2026')
  assert.equal(periodeNaam('2027-01', 3), 'Q1 2027')
  assert.equal(periodeNaam('2027-10', 3), 'Q4 2027')
  assert.equal(periodeNaam('2027-02', 3), 'februari – april 2027')
  assert.equal(periodeNaam('2027-07', 6), 'H2 2027')
  assert.equal(periodeNaam('2027-01', 12), '2027')
  assert.equal(periodeNaam('2026-11', 12), 'november 2026 – oktober 2027')
})

test('Titels zoals op de factuur', () => {
  assert.equal(factuurTitel('Sociale media management', '2026-11', 1), 'Sociale media management (november 2026)')
  assert.equal(factuurTitel('Hosting', '2027-01', 3), 'Hosting Q1 2027')
  assert.equal(factuurTitel('Hosting', '2027-01', 12), 'Hosting 2027')
  assert.equal(factuurTitel('Hosting', '2027-02', 3), 'Hosting (februari – april 2027)')
})

test('Maandelijks: 6 facturen juli – december, eerste dag van de maand, € 5.874', () => {
  const p = plan([post({ inbegrepen: ['12 posts per maand', 'Community management'] })])
  assert.deepEqual(p.ontbreekt, [])
  assert.equal(p.facturen.length, 6)
  assert.equal(p.totaal, 5874)
  assert.equal(p.facturen[0].titel, 'Sociale media management (juli 2026)')
  assert.equal(p.facturen[5].titel, 'Sociale media management (december 2026)')
  assert.equal(p.facturen[0].datum, '2026-07-01')
  assert.equal(p.facturen[0].tot, '2026-07-31')
  assert.equal(p.facturen[0].sleutel, '2026-07')
  assert.equal(p.facturen[0].eenheid, 'maand')
  const o = p.facturen[2].omschrijving
  assert.match(o, /^Sociale media management voor september 2026 \(1 – 30 september 2026\)\./)
  assert.match(o, /Inbegrepen:\n- 12 posts per maand\n- Community management/)
  assert.match(o, /Factuur 3 van 6\. Volgens de overeenkomst "Social Media Samenwerkingsovereenkomst 2026", getekend op 28 mei 2026\./)
  assert.equal(planSamenvatting(p).replace(/ /g, ' '), '6 facturen, juli – december 2026, € 5.874 excl. btw')
})

test('Laatste dag als factuurmoment', () => {
  const p = plan([post({ perioden: 2 })], { moment: 'laatste' })
  assert.equal(p.facturen[0].datum, '2026-07-31')
  assert.equal(p.facturen[1].datum, '2026-08-31')
})

test('Kwartaal: hosting Q1 – Q4 2027', () => {
  const p = plan([post({ naam: 'Hosting', frequentie: 'kwartaal', bedrag: 60, perioden: 4, start: '2027-01-01' })])
  assert.deepEqual(p.facturen.map((f) => f.titel), ['Hosting Q1 2027', 'Hosting Q2 2027', 'Hosting Q3 2027', 'Hosting Q4 2027'])
  assert.equal(p.facturen[1].van, '2027-04-01'); assert.equal(p.facturen[1].tot, '2027-06-30')
  assert.equal(p.facturen[0].eenheid, 'forfait')
})

test('Eenmalig: één factuur met de naam als titel', () => {
  const p = plan([post({ naam: 'Website', soort: 'eenmalig', frequentie: 'eenmalig', bedrag: 2500, perioden: 1, start: '2026-11-15', inbegrepen: ['5 pagina\'s'] })])
  assert.equal(p.facturen.length, 1)
  assert.equal(p.facturen[0].titel, 'Website')
  assert.equal(p.facturen[0].sleutel, 'eenmalig:2026-11-15')
  assert.equal(p.facturen[0].datum, '2026-11-15')
  assert.doesNotMatch(p.facturen[0].omschrijving, /Factuur 1 van/)
})

test('Meerdere posten: website eenmalig + hosting per kwartaal, eigen sleutels', () => {
  const p = plan([
    post({ naam: 'Website', soort: 'eenmalig', frequentie: 'eenmalig', bedrag: 2500, perioden: 1, start: '2026-11-15' }),
    post({ naam: 'Hosting', frequentie: 'kwartaal', bedrag: 60, perioden: 4, start: '2027-01-01' }),
  ])
  assert.equal(p.facturen.length, 5)
  assert.equal(p.totaal, 2740)
  assert.equal(p.facturen[1].sleutel, 'p2:2027-01')
  assert.equal(new Set(p.facturen.map((f) => f.sleutel)).size, 5)
})

test('Geen einddatum: het eerste jaar, met een opmerking', () => {
  const p = plan([post({ perioden: null, start: '2026-11-01' })])
  assert.equal(p.facturen.length, 12)
  assert.match(p.opmerkingen.join(' '), /Geen einddatum/)
})

test('Geen start: vanaf de ondertekening, met een opmerking; geen bedrag: ontbreekt', () => {
  const p = plan([post({ start: null, perioden: 1 })])
  assert.equal(p.facturen[0].periode, '2026-05')
  assert.match(p.opmerkingen.join(' '), /vanaf de ondertekening/)
  assert.deepEqual(plan([post({ bedrag: null })]).ontbreekt, ['bedrag'])
  assert.deepEqual(plan([]).ontbreekt, ['wat er gefactureerd wordt (dienst en bedrag)'])
})

test('Contractgegevens: duur, frequentie en dienstnaam', () => {
  assert.equal(duurMaanden({ start_date: '2026-07-01', end_date: '2027-01-01' }), 6)
  assert.equal(duurMaanden({ start_date: '2026-11-01', end_date: '2027-11-01' }), 12)
  assert.equal(duurMaanden({ duration_type: '3m' }), 3)
  assert.equal(frequentieVan({ invoice_frequency: 'maandelijks' }), 'maandelijks')
  assert.equal(frequentieVan({ duration_type: 'eenmalig' }), 'eenmalig')
  assert.equal(frequentieVan({ duration_type: '12m' }), null)
  assert.equal(dienstNaam({ service_slug: 'social-media' }), 'Sociale media management')
  assert.equal(dienstNaam({ contract_type: 'Websitecontract' }), 'Website')
  assert.equal(dienstNaam({ contract_type: 'Niet toegewezen', title: 'Drukwerk Dartbord' }), 'Drukwerk Dartbord')
})

test('Zonder pdf-lezing: één post uit de contractgegevens', () => {
  const r = postenVoorContract({ service_slug: 'social-media', start_date: '2026-07-01', end_date: '2027-01-01', invoice_frequency: 'maandelijks', contract_waarde_excl: '5874' }, null)
  assert.equal(r.posten.length, 1)
  assert.equal(r.posten[0].bedrag, 979)
  assert.equal(r.posten[0].perioden, 6)
  assert.equal(r.btwPct, 21)
  assert.equal(r.moment, 'eerste')
  const een = postenVoorContract({ title: 'Drukwerk', duration_type: 'eenmalig', contract_waarde_excl: 276 }, null)
  assert.equal(een.posten[0].soort, 'eenmalig'); assert.equal(een.posten[0].bedrag, 276)
  // 12 maanden en een waarde, maar niet hoe vaak: niets raden.
  assert.equal(postenVoorContract({ duration_type: '12m', start_date: '2026-11-01', contract_waarde_excl: 1529 }, null).posten.length, 0)
})

test('Met pdf-lezing: wat het team invulde gaat voor op de hoofdpost', () => {
  const r = postenVoorContract(
    { service_slug: 'social-media', start_date: '2026-08-01', end_date: '2027-02-01', expected_invoice_amount_excl: 1000, contract_waarde_excl: 6000 },
    { posten: [post({ start: '2026-07-01', bedrag: 979, perioden: null, inbegrepen: ['12 posts'] }), post({ naam: 'Opstart', soort: 'eenmalig', frequentie: 'eenmalig', bedrag: 250, perioden: 1, start: null })], btwPct: null, moment: null, opmerking: null },
  )
  assert.equal(r.posten[0].start, '2026-08-01')
  assert.equal(r.posten[0].bedrag, 1000)
  assert.equal(r.posten[0].perioden, 6)
  assert.deepEqual(r.posten[0].inbegrepen, ['12 posts'])
  assert.equal(r.posten[1].start, '2026-08-01', 'eenmalige post zonder datum = start van het contract')
  assert.match(r.opmerkingen.join(' '), /Samen € 6250 excl\. btw, de contractwaarde is € 6000/)
})

test('Klant buiten België: 0% btw met opmerking', () => {
  const r = postenVoorContract({ duration_type: 'eenmalig', contract_waarde_excl: 500 }, null, 'NL123456789B01')
  assert.equal(r.btwPct, 0)
  assert.match(r.opmerkingen.join(' '), /buiten België/)
  assert.equal(postenVoorContract({ duration_type: 'eenmalig', contract_waarde_excl: 500 }, null, 'BE0123456789').btwPct, 21)
})

console.log(`\n${n} tests geslaagd\n`)
