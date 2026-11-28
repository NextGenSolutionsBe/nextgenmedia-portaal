// Agenda: labelvoorstel uit de titel en de map (lib/agenda/label-voorstel.ts).
// Uitvoeren: npx tsx tests/agenda-labels.test.ts
import assert from 'node:assert/strict'
import { stelLabelVoor, labelInvoerVoor, klantNamenVoorLabels, CATEGORIEEN } from '../lib/agenda/label-voorstel'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nAgenda: labels\n')

const ctx = { klanten: klantNamenVoorLabels(['Garage Vantilt', 'YES!talents', 'Era Nobis', 'NextGenMedia', 'A&M']), team: ['Bram', 'Marco', 'Chiara', 'Senne', 'Thor'] }
const l = (titel: string, extra = {}) => stelLabelVoor({ titel, ...extra }, ctx)

test('boekhouding, juridisch, event, personeel', () => {
  assert.equal(l('Factuur printdeal opvragen'), 'boekhouding')
  assert.equal(l('Dringend btw aangifte opnieuw indienen'), 'boekhouding')
  assert.equal(l('NDA INN/SLL tekenen'), 'juridisch')
  assert.equal(l('Contract fmobile aanpassen'), 'juridisch')
  assert.equal(l('BNI Netwerkontbijt'), 'netwerkevent')
  assert.equal(l('Inschrijven VOKA EVENT?'), 'netwerkevent')
  assert.equal(l('Stagiar vacature opzetten'), 'Personeel')
  assert.equal(l('DIMONA AANGIFTE DOEN'), 'Personeel')
})

test('meetings: klant, team of lead', () => {
  assert.equal(l('Meeting Garage Vantilt'), 'Klantmeeting')
  assert.equal(l("Kwartaalmeeting YES!talents + 'Menukaart' bespreken"), 'Klantmeeting')
  assert.equal(l('Meeting Senne'), 'Teamvergadering')
  assert.equal(l('Teamvergadering'), 'Teamvergadering')
  assert.equal(l('Meeting Phil Martens'), 'Lead')
  assert.equal(l('Meeting NextGenMedia intern'), 'Teamvergadering')
  assert.equal(l('Algemene vergadering'), 'Algemene vergadering')
})

test('werk: content, shoot, website, ads, app, opvolging', () => {
  assert.equal(l('Offerte Bright Bird maken'), 'Lead')
  assert.equal(l('Contentshoot in Brugge'), 'contentshoot')
  assert.equal(l('Posts juli maken & inplannen'), 'Content')
  assert.equal(l('Website larolo fiksen (zie mail)'), 'Website')
  assert.equal(l('Campagne opzetten Artlux'), 'Advertenties')
  assert.equal(l('Batches toevoegen app'), 'App & AI')
  assert.equal(l('Michel bellen'), 'Opvolging')
  assert.equal(l('Sportmonkey golf contacteren'), 'Opvolging')
  assert.equal(l('Microfoon bestellen'), 'Kantoor')
})

test('persoonlijk en de terugval volgens de map', () => {
  assert.equal(l('Grasmaaien'), 'Persoonlijk')
  assert.equal(l('Iets', { priveLijst: true }), 'Persoonlijk')
  assert.equal(l('Meeting Anneke Demo', { priveLijst: true }), 'Lead')
  assert.equal(l('REEL Recap Pitch day (META)'), 'Content')
  assert.equal(l('STORY nieuwkomers race sport [META]'), 'Content')
  assert.equal(l('Statistieken nakijken', { soort: 'meeting', bijKlant: true }), 'Klantwerk')
  assert.equal(l('Plannen november'), 'Intern')
  assert.equal(l('Plannen november', { bijKlant: true }), 'Klantwerk')
  // Elk voorstel is een van de categorieën.
  for (const t of ['x', 'Meeting', 'Factuur', 'Shoot']) assert.ok(CATEGORIEEN.some((c) => c.naam === l(t)))
})

test('map en space: klant, eigen bedrijf, freelancer, privé', () => {
  const boom = {
    spaces: [{ id: 's1', naam: 'NextGen Agency BV' }, { id: 's2', naam: 'Freelance & stagiaires' }, { id: 's3', naam: 'Zaakvoerders' }],
    mappen: [{ id: 'm1', naam: 'Group Cé', client_id: null }, { id: 'm2', naam: 'NextGenMedia', client_id: 'k-ngm' }, { id: 'm3', naam: 'Thor (fotografie)', client_id: null }, { id: 'm4', naam: 'Bram Privé', client_id: null }],
    lijsten: [{ id: 'l1', naam: 'Group Cé', map_id: 'm1', client_id: null, space_id: 's1' }, { id: 'l2', naam: 'NextGenMedia', map_id: 'm2', client_id: null, space_id: 's1' }, { id: 'l3', naam: 'List', map_id: 'm3', client_id: null, space_id: 's2' }, { id: 'l4', naam: 'Sport', map_id: 'm4', client_id: null, space_id: 's3' }],
  }
  assert.equal(labelInvoerVoor({ titel: 'x', lijst_id: 'l1' }, boom).bijKlant, true)
  assert.equal(labelInvoerVoor({ titel: 'x', lijst_id: 'l2' }, boom).bijKlant, false)
  assert.equal(labelInvoerVoor({ titel: 'x', lijst_id: 'l3' }, boom).bijKlant, false)
  assert.equal(labelInvoerVoor({ titel: 'x', lijst_id: 'l4' }, boom).priveLijst, true)
})

console.log(`\n${n} tests geslaagd\n`)
