import assert from 'node:assert/strict'
import { valideerOfferte, leesBedrag, veiligePdfNaam, geldigOffertePad, geldigSjabloonPad, offerteWeergave, moetOpvolgen, isVerlopen, offerteMail, offerteLink, verwijderVraag } from '../lib/offertes'

const U = '11111111-2222-4333-8444-555555555555'
const vandaag = '2026-11-04'

// Bedragen.
assert.equal(leesBedrag('1.250,50'), 1250.5)
assert.equal(leesBedrag('4950'), 4950)
assert.equal(leesBedrag('2.100'), 2100)
assert.equal(leesBedrag('€ 790'), 790)
assert.equal(leesBedrag(''), null)
assert.equal(leesBedrag('abc'), undefined)
assert.equal(leesBedrag(-5), undefined)

// Paden: enkel wat de server zelf uitdeelt.
assert.equal(geldigOffertePad(`offertes/${U}/offerte-reel.pdf`), true)
assert.equal(geldigOffertePad(`offertes/${U}/../x.pdf`), false)
assert.equal(geldigOffertePad(`sjablonen/${U}/x.pdf`), false)
assert.equal(geldigSjabloonPad(`sjablonen/${U}/website.pdf`), true)
assert.equal(veiligePdfNaam('Offerte Website (2026).PDF'), 'Offerte-Website-2026.pdf')
assert.equal(veiligePdfNaam('...'), 'offerte.pdf')

// Validatie.
const basis = { titel: 'Website Apex', sjabloon_id: U, client_id: U }
const v = valideerOfferte(basis, vandaag)
assert.ok(v.ok)
if (v.ok) { assert.equal(v.waarde.geldig_tot, '2026-12-04', '30 dagen geldig'); assert.equal(v.waarde.merk, 'nextgenmedia') }
assert.equal(valideerOfferte({ ...basis, titel: '' }, vandaag).ok, false)
assert.equal(valideerOfferte({ titel: 'X y', client_id: U }, vandaag).ok, false, 'sjabloon of pdf verplicht')
assert.equal(valideerOfferte({ ...basis, eigen_pad: `offertes/${U}/a.pdf` }, vandaag).ok, false, 'niet allebei')
assert.equal(valideerOfferte({ ...basis, client_id: null }, vandaag).ok, false, 'klant verplicht')
assert.ok(valideerOfferte({ ...basis, client_id: null, klant_naam: 'Prospect BV' }, vandaag).ok, 'vrije klantnaam mag')
assert.equal(valideerOfferte({ ...basis, geldig_tot: '2026-11-01' }, vandaag).ok, false)
assert.equal(valideerOfferte({ ...basis, bedrag_excl: 'veel' }, vandaag).ok, false)
const ngs = valideerOfferte({ ...basis, merk: 'nextgensolutions', bedrag_excl: '1.200' }, vandaag)
assert.ok(ngs.ok && ngs.waarde.merk === 'nextgensolutions' && ngs.waarde.bedrag_excl === 1200)

// Weergave en opvolgen.
const nu = new Date('2026-11-10T10:00:00Z')
const o = { status: 'verstuurd' as const, geldig_tot: '2026-12-01', verstuurd_op: '2026-11-04T09:00:00Z', klant_geopend_op: null, geaccepteerd_op: null, geaccepteerd_door: null }
assert.equal(offerteWeergave(o, nu).label, 'Verstuurd')
assert.match(String(offerteWeergave(o, nu).sub), /Nog niet geopend door de klant/)
assert.equal(offerteWeergave({ ...o, klant_geopend_op: '2026-11-06T08:00:00Z' }, nu).label, 'Geopend')
assert.match(String(offerteWeergave({ ...o, klant_geopend_op: '2026-11-06T08:00:00Z' }, nu).sub), /Door klant geopend op 6 nov/)
assert.equal(offerteWeergave({ ...o, status: 'geaccepteerd', geaccepteerd_op: '2026-11-07T08:00:00Z', geaccepteerd_door: 'Jan' }, nu).label, 'Geaccepteerd')
assert.equal(offerteWeergave({ ...o, geldig_tot: '2026-11-08' }, nu).label, 'Verlopen')
assert.equal(isVerlopen({ status: 'geaccepteerd', geldig_tot: '2026-11-01' }, vandaag), false, 'geaccepteerd verloopt niet')
assert.equal(moetOpvolgen(o, nu), true, '6 dagen stil')
assert.equal(moetOpvolgen({ ...o, verstuurd_op: '2026-11-09T09:00:00Z' }, nu), false, 'nog maar een dag')
assert.equal(moetOpvolgen({ ...o, status: 'geaccepteerd' }, nu), false)

// Mail.
const m = offerteMail({ contact: 'Jan Peeters', klant: 'Apex Fuel', titel: 'Website', geldigTot: '2026-12-04', merk: 'nextgensolutions' })
assert.equal(m.onderwerp, 'Offerte: Website')
assert.match(m.tekst, /^Beste Jan,/)
assert.match(m.tekst, /geldig tot 4 december 2026/)
assert.match(m.tekst, /NextGenSolutions$/)
assert.equal(offerteLink('https://app.nextgenmedia.be/', 'abc'), 'https://app.nextgenmedia.be/offerte/abc')
// Volledig verwijderen: een concept kort, anders met wat er weggaat (en of de klant al aanvaardde).
assert.equal(verwijderVraag({ titel: 'Reel', status: 'concept', klant_naam: 'Apex' }), 'Concept "Reel" verwijderen?')
assert.match(verwijderVraag({ titel: 'Website', status: 'verstuurd', klant_naam: 'Apex' }), /^"Website" van Apex volledig verwijderen\? De pdf, de link voor de klant/)
assert.match(verwijderVraag({ titel: 'Website', status: 'geaccepteerd', klant_naam: null }), /aanvaardde deze offerte al/)
console.log('offertes: ok')
