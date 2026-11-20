// Opdrachten als kanbanbord: kolommen uit de bestaande statussen, slepen,
// dienstkleuren, en de automatische stappen (contract, getekend, afgerond
// pas als de volledige contractwaarde gefactureerd is).
//
//   npx tsx tests/opdrachten-kanban.test.ts

import assert from 'node:assert/strict'
import { STATUSSEN, magAutomatischNaar, type OpdrachtStatus, type Koppelingen } from '../lib/opdrachten'
import {
  KOLOMMEN, kolomVan, statusVoorKolom, stapLabel, kaartKleur, dienstInfo, normaliseerDiensten, raadDiensten,
  bronUitLead, normaliseerVia, offerteViaLabel, facturatieVan, automatischeStatus, verplaatsTekst, dagenSinds,
  ontbreektVoorFase, normaliseerBtw, projectNaam, projectOnderwerp, bedrijfVan, inPeriode, inWaardeSchijf, statusUitContract,
} from '../lib/opdrachten-kanban'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nOpdrachten als kanban\n')

test('1. Acht fasen in de gevraagde volgorde (2 nov 2026; Offerte geaccepteerd erbij op 6 nov); elke bestaande status valt in precies één fase', () => {
  assert.deepEqual(KOLOMMEN.map((k) => k.label), ['Opvolging', 'Offerte gestuurd', 'Offerte geaccepteerd', 'Contract verstuurd', 'Contract getekend', 'In uitvoering', 'Afgerond', 'Verloren'])
  for (const s of STATUSSEN) assert.equal(KOLOMMEN.filter((k) => k.stappen.includes(s.key)).length, 1, s.key)
  for (const k of KOLOMMEN) assert.equal(kolomVan(k.standaard), k.key)
})

test('2. De bestaande opdrachten komen op de juiste plek (projectvoorstel = offerte gestuurd)', () => {
  const verwacht: Record<string, string> = {
    open: 'potentieel', voorstel_gevraagd: 'potentieel', voorstel_bezig: 'potentieel',
    voorstel_klaar: 'offerte', voorstel_voorgelegd: 'offerte', interesse: 'geaccepteerd',
    contract_verstuurd: 'contract', getekend: 'getekend',
    bezig: 'uitvoering', wacht: 'uitvoering', opgeleverd: 'uitvoering', te_factureren: 'uitvoering', factuur_verstuurd: 'uitvoering',
    afgerond: 'afgerond', betaald: 'afgerond', geen_interesse: 'stopgezet', geannuleerd: 'stopgezet',
  }
  for (const [s, k] of Object.entries(verwacht)) assert.equal(kolomVan(s), k, s)
  assert.equal(kolomVan('iets-onbekends'), 'potentieel')
})

test('3. Slepen: standaardstatus per kolom, binnen dezelfde kolom verandert niets, stoppen hangt af van waar je vandaan komt', () => {
  assert.equal(statusVoorKolom('open', 'offerte'), 'voorstel_voorgelegd')
  assert.equal(statusVoorKolom('voorstel_voorgelegd', 'contract'), 'contract_verstuurd')
  assert.equal(statusVoorKolom('getekend', 'uitvoering'), 'bezig')
  assert.equal(statusVoorKolom('wacht', 'uitvoering'), 'wacht', 'de fijnere stap blijft')
  assert.equal(statusVoorKolom('interesse', 'stopgezet'), 'geen_interesse')
  assert.equal(statusVoorKolom('voorstel_voorgelegd', 'geaccepteerd'), 'interesse')
  assert.equal(stapLabel('interesse'), 'Offerte geaccepteerd')
  assert.equal(statusVoorKolom('contract_verstuurd', 'stopgezet'), 'geen_interesse', 'contract nooit getekend = geen akkoord')
  assert.equal(statusVoorKolom('bezig', 'stopgezet'), 'geannuleerd', 'al bezig = vroegtijdig stopgezet')
  assert.equal(statusVoorKolom('geannuleerd', 'potentieel'), 'open')
  assert.equal(stapLabel('geannuleerd'), 'Vroegtijdig stopgezet')
  assert.equal(stapLabel('geen_interesse'), 'Geen akkoord')
  assert.equal(stapLabel('wacht'), 'Wacht op klant')
})

test('4. Kleuren: hele kaart in de kleur van de eerste dienst; founders bruin met witte tekst; eigen tekst zonder kleur', () => {
  assert.equal(kaartKleur(['social_media']).achtergrond, '#FFF5C2')
  assert.equal(kaartKleur(['webdesign', 'social_media']).label, 'Webdesign')
  assert.equal(kaartKleur(['Camionette', 'foto_video']).label, 'Foto & videografie', 'eigen tekst slaat de kleur over')
  assert.equal(kaartKleur([]).achtergrond, '#FFFFFF')
  const f = kaartKleur(['founders'])
  assert.equal(f.donker, true); assert.equal(f.tekst, '#FFFFFF')
  assert.equal(dienstInfo('branding').key, 'grafisch', 'branding valt onder grafisch ontwerp')
  assert.equal(dienstInfo('meta_ads').key, 'advertising', 'Meta ads = advertising')
  assert.equal(dienstInfo('google_ads').label, 'Advertising', 'Google ads = advertising')
  assert.notEqual(dienstInfo('consultancy').achtergrond, f.achtergrond, 'pastel bruin is niet hetzelfde als bruin')
  assert.equal(dienstInfo('Bestickering').key, null)
})

test('5. Diensten nakijken: labels worden sleutels, eigen tekst blijft, geen dubbels, max 6', () => {
  assert.deepEqual(normaliseerDiensten(['Social media', 'webdesign', 'social_media', '  Camionette  bestickering ', '']), ['social_media', 'webdesign', 'Camionette bestickering'])
  assert.deepEqual(normaliseerDiensten('Branding, NextGenSolutions (AI)'), ['grafisch', 'ngs'])
  assert.deepEqual(normaliseerDiensten(['meta_ads', 'google_ads', 'branding', 'grafisch']), ['advertising', 'grafisch'], 'samengevoegd zonder dubbels')
  assert.equal(normaliseerDiensten(['a', 'b', 'c', 'd', 'e', 'f', 'g']).length, 6)
  assert.deepEqual(normaliseerDiensten(null), [])
})

test('6. Voorstel van diensten uit de titel (enkel een voorstel)', () => {
  assert.deepEqual(raadDiensten('Social Media Management'), ['social_media'])
  assert.deepEqual(raadDiensten('Website + LinkedIn Beheer'), ['social_media', 'webdesign'])
  assert.deepEqual(raadDiensten('Huisstijl'), ['grafisch'])
  assert.deepEqual(raadDiensten('Bestickering Camionette Group Cé'), ['grafisch'])
  assert.deepEqual(raadDiensten("Productfoto's Powertools"), ['foto_video'])
  assert.deepEqual(raadDiensten('AI-chatbot'), ['ngs'])
  assert.deepEqual(raadDiensten('Contentshoot Eline Vantilt'), ['foto_video'])
  assert.deepEqual(raadDiensten('Founders of Flanders aflevering'), ['founders'])
  assert.deepEqual(raadDiensten('Advertising'), ['advertising'])
  assert.deepEqual(raadDiensten('Website + Google Ads'), ['advertising', 'webdesign'])
  assert.deepEqual(raadDiensten('Facebook ads campagne'), ['advertising'])
})

test('6b. Elke dienst een eigen pastelkleur; Meta en Google ads samen = Advertising; Sociale media heet zo, ook als je "Social media" typt', () => {
  const kleuren = new Set(['advertising', 'social_media', 'ngs', 'webdesign', 'foto_video', 'consultancy', 'grafisch', 'founders'].map((d) => dienstInfo(d).achtergrond))
  assert.equal(kleuren.size, 8)
  assert.equal(dienstInfo('meta_ads').label, 'Advertising')
  assert.equal(dienstInfo('Google Ads').key, 'advertising')
  assert.equal(dienstInfo('social media').label, 'Sociale media')
  assert.equal(dienstInfo('Facebook ads').key, 'advertising')
  assert.equal(dienstInfo('Branding').key, 'grafisch')
})

test('7. Bron en offertekanaal', () => {
  assert.equal(bronUitLead('website'), 'inbound')
  assert.equal(bronUitLead('outbound'), 'outbound')
  assert.equal(bronUitLead('manueel'), null, 'manueel weten we niet')
  assert.equal(normaliseerVia('Per mail'), 'mail')
  assert.equal(normaliseerVia('telefonisch'), 'telefonisch')
  assert.equal(normaliseerVia('  Op de beurs  '), 'Op de beurs')
  assert.equal(normaliseerVia(''), null)
  assert.equal(offerteViaLabel('meeting'), 'In een meeting')
  assert.equal(offerteViaLabel('Op de beurs'), 'Op de beurs')
})

const fac = (status: string, amount_excl: number, id = Math.random().toString(36)) => ({ id, status, invoice_date: '2026-10-01', amount_incl: amount_excl * 1.21, amount_excl, description: null })

test('8. Met contract: pas volledig als de contractwaarde gefactureerd is (voorschot alleen is niet genoeg)', () => {
  const voorschot = facturatieVan({ contractId: 'c', aflettering: { effectiefCent: 347400, gefactureerdCent: 104200 } })
  assert.deepEqual(voorschot, { gefactureerd: 1042, totaal: 3474, volledig: false, bron: 'contract' })
  assert.equal(facturatieVan({ contractId: 'c', aflettering: { effectiefCent: 347400, gefactureerdCent: 347400 } }).volledig, true)
  assert.equal(facturatieVan({ contractId: 'c', aflettering: { effectiefCent: null, gefactureerdCent: 50000 } }).volledig, false, 'zonder contractwaarde nooit vanzelf afgerond')
  assert.equal(facturatieVan({ contractId: 'c', aflettering: null }).volledig, false)
  assert.equal(facturatieVan({ contractId: 'c', aflettering: { effectiefCent: 0, gefactureerdCent: 0 } }).volledig, false)
})

test('9. Zonder contract: verstuurde facturen tegenover het bedrag van de opdracht', () => {
  assert.equal(facturatieVan({ facturen: [fac('verstuurd', 600)], bedragExcl: 1200 }).volledig, false)
  assert.equal(facturatieVan({ facturen: [fac('verstuurd', 600), fac('betaald', 600)], bedragExcl: 1200 }).volledig, true)
  assert.equal(facturatieVan({ facturen: [fac('te_versturen', 1200)], bedragExcl: 1200 }).volledig, false, 'nog niet verstuurd')
  assert.equal(facturatieVan({ facturen: [fac('verstuurd', 500)] }).volledig, true, 'zonder bedrag: alles verstuurd')
  assert.equal(facturatieVan({ facturen: [fac('verstuurd', 500), fac('te_versturen', 500)] }).volledig, false)
  assert.equal(facturatieVan({ facturen: [fac('geannuleerd', 500)] }).volledig, false)
  assert.equal(facturatieVan({ facturen: [], bedragExcl: 900 }).totaal, 900)
})

const k = (o: Partial<Koppelingen>): Koppelingen => ({ contract: null, facturen: [], facturatieOpen: false, ...o })

test('10. Automatisch enkel naar Contract, Getekend en Afgerond; nooit vanzelf In uitvoering', () => {
  const geen = { gefactureerd: 0, totaal: null, volledig: false, bron: null } as const
  assert.equal(automatischeStatus(k({ contract: { id: 'c', title: 'x', status: 'verzonden' } }), geen), 'contract_verstuurd')
  assert.equal(automatischeStatus(k({ contract: { id: 'c', title: 'x', status: 'getekend' }, facturatieOpen: true, facturen: [fac('verstuurd', 100)] }), geen), 'getekend', 'een voorschotfactuur zet niets in uitvoering')
  assert.equal(automatischeStatus(k({ contract: { id: 'c', title: 'x', status: 'getekend' } }), { ...geen, volledig: true }), 'afgerond')
  assert.equal(automatischeStatus(k({ contract: { id: 'c', title: 'x', status: 'concept' } }), geen), null)
  assert.equal(automatischeStatus(null, null), null)
})

test('10b. Offerte bevestigd → Offerte geaccepteerd; een contract of volledige facturatie gaat voor', () => {
  const geen = { gefactureerd: 0, totaal: null, volledig: false, bron: null } as const
  assert.equal(automatischeStatus(null, null, 'geaccepteerd'), 'interesse')
  assert.equal(automatischeStatus(k({}), geen, 'verstuurd'), null)
  assert.equal(automatischeStatus(k({ contract: { id: 'c', title: 'x', status: 'verzonden' } }), geen, 'geaccepteerd'), 'contract_verstuurd')
  assert.equal(automatischeStatus(k({ contract: { id: 'c', title: 'x', status: 'getekend' } }), geen, 'geaccepteerd'), 'getekend')
  assert.equal(automatischeStatus(k({ contract: { id: 'c', title: 'x', status: 'concept' } }), geen, 'geaccepteerd'), 'interesse', 'contract nog in opmaak: blijft bij Offerte geaccepteerd')
  // Enkel vooruit: vanuit Opvolging en Offerte gestuurd wel, vanuit Contract of In uitvoering niet.
  assert.equal(magAutomatischNaar('open', 'interesse'), true)
  assert.equal(magAutomatischNaar('voorstel_voorgelegd', 'interesse'), true)
  assert.equal(magAutomatischNaar('contract_verstuurd', 'interesse'), false)
  assert.equal(magAutomatischNaar('bezig', 'interesse'), false)
  assert.equal(magAutomatischNaar('voorstel_voorgelegd', 'interesse', 'interesse'), false, 'bewust teruggezet: niet nog eens')
  assert.equal(verplaatsTekst('voorstel_voorgelegd', 'interesse', { automatisch: 'offerte bevestigd door de klant' }), 'Automatisch naar Offerte geaccepteerd: offerte bevestigd door de klant')
})

test('11. Enkel vooruit: een kaart die we zelf in uitvoering zetten, valt niet terug naar Getekend; stopgezet blijft stopgezet', () => {
  const toepassen = (huidig: OpdrachtStatus, auto: OpdrachtStatus | null, al?: string | null) => magAutomatischNaar(huidig, auto, al)
  assert.equal(toepassen('voorstel_voorgelegd', 'contract_verstuurd'), true)
  assert.equal(toepassen('contract_verstuurd', 'getekend'), true)
  assert.equal(toepassen('bezig', 'getekend'), false)
  assert.equal(toepassen('bezig', 'afgerond'), true, 'volledig gefactureerd → afgerond')
  assert.equal(toepassen('factuur_verstuurd', 'afgerond'), true)
  assert.equal(toepassen('geannuleerd', 'afgerond'), false)
  assert.equal(toepassen('contract_verstuurd', 'getekend', 'getekend'), false, 'bewust teruggezet: niet nog eens')
})

test('12. Tijdlijn: korte systeemnotities bij verplaatsen', () => {
  assert.equal(verplaatsTekst('open', 'voorstel_voorgelegd', { via: 'mail' }), 'Naar Offerte gestuurd (per mail)')
  assert.equal(verplaatsTekst('contract_verstuurd', 'getekend', { automatisch: 'contract ondertekend' }), 'Automatisch naar Contract getekend: contract ondertekend')
  assert.equal(verplaatsTekst('bezig', 'geannuleerd', { reden: 'budget weg' }), 'Vroegtijdig stopgezet: budget weg')
  assert.equal(verplaatsTekst('bezig', 'wacht'), 'Stap: In uitvoering → Wacht op klant')
  assert.equal(verplaatsTekst('bezig', 'bezig'), null)
  assert.equal(dagenSinds('2026-10-20T10:00:00Z', new Date('2026-11-01T09:00:00Z')), 11)
  assert.equal(dagenSinds(null), null)
})

test('Projecten: vanaf Offerte gestuurd zijn naam, btw-nummer en dienst verplicht; Opvolging en Verloren niet', () => {
  const leeg = { naam: '', btw: null, diensten: [] }
  assert.deepEqual(ontbreektVoorFase('potentieel', leeg), [])
  assert.deepEqual(ontbreektVoorFase('stopgezet', leeg), [])
  assert.deepEqual(ontbreektVoorFase('offerte', leeg), ['naam', 'btw-nummer', 'dienst'])
  assert.deepEqual(ontbreektVoorFase('uitvoering', { naam: 'Group Cé', btw: 'be 0123.456.789', diensten: ['webdesign'] }), [])
  assert.deepEqual(ontbreektVoorFase('contract', { naam: 'Group Cé', btw: '12', diensten: ['webdesign'] }), ['btw-nummer'])
  assert.equal(normaliseerBtw('be 0123.456.789'), 'BE0123456789')
  assert.equal(normaliseerBtw('abc'), null)
})

test('Projecten: bedrijf uit de instelling of de diensten (NGS, Founders, anders NGM)', () => {
  assert.equal(bedrijfVan(null, ['ngs']), 'nextgensolutions')
  assert.equal(bedrijfVan(null, ['founders']), 'foundersofflanders')
  assert.equal(bedrijfVan(null, ['webdesign']), 'nextgenmedia')
  assert.equal(bedrijfVan('nextgensolutions', ['webdesign']), 'nextgensolutions')
  assert.equal(bedrijfVan('onzin', []), 'nextgenmedia')
})

test('Projecten: filters op maand, kwartaal, jaar en waarde', () => {
  assert.equal(inPeriode('2026-11-02', { soort: 'alles' }), true)
  assert.equal(inPeriode('2026-11-02T10:00:00Z', { soort: 'maand', jaar: 2026, maand: 11 }), true)
  assert.equal(inPeriode('2026-11-02', { soort: 'maand', jaar: 2026, maand: 10 }), false)
  assert.equal(inPeriode('2026-11-02', { soort: 'kwartaal', jaar: 2026, kwartaal: 4 }), true)
  assert.equal(inPeriode('2026-03-31', { soort: 'kwartaal', jaar: 2026, kwartaal: 2 }), false)
  assert.equal(inPeriode('2025-12-31', { soort: 'jaar', jaar: 2026 }), false)
  assert.equal(inPeriode(null, { soort: 'jaar', jaar: 2026 }), false)
  assert.equal(inWaardeSchijf(4950, '1k5k'), true)
  assert.equal(inWaardeSchijf(5000, '1k5k'), false)
  assert.equal(inWaardeSchijf(12000, '10k'), true)
  assert.equal(inWaardeSchijf(null, 'geen'), true)
  assert.equal(inWaardeSchijf(null, 'tot1k'), false)
  assert.equal(inWaardeSchijf(null, 'alle'), true)
})

test('Projecten: een contract opmaken = Contract verstuurd; getekend = Contract getekend; niet doorgegaan of verlopen = Verloren', () => {
  assert.equal(statusUitContract({ status: 'draft' }, '2026-11-02'), 'contract_verstuurd')
  assert.equal(statusUitContract({ status: 'viewed' }, '2026-11-02'), 'contract_verstuurd')
  assert.equal(statusUitContract({ status: 'signed', expires_at: '2020-01-01' }, '2026-11-02'), 'getekend')
  assert.equal(statusUitContract({ status: 'cancelled' }, '2026-11-02'), 'geen_interesse')
  assert.equal(statusUitContract({ status: 'viewed', expires_at: '2026-10-31' }, '2026-11-02'), 'geen_interesse')
  assert.equal(kolomVan(statusUitContract({ status: 'sent' }, '2026-11-02')), 'contract')
})

test('Projecten: titel = klant met tussen haakjes waarover het gaat', () => {
  assert.equal(projectNaam('Bakkerij Peeters', ['social_media'], 'Socials 2027'), 'Bakkerij Peeters (sociale media)')
  assert.equal(projectNaam('Era Nobis', ['ngs'], null), 'Era Nobis (AI-automatisatie)')
  assert.equal(projectNaam('Era Nobis', ['webdesign', 'meta_ads'], null), 'Era Nobis (website + advertising)')
  assert.equal(projectNaam('Era Nobis', ['webdesign', 'grafisch', 'social_media'], null), 'Era Nobis (website + grafisch ontwerp +1)')
  assert.equal(projectNaam('Era Nobis', [], 'Bestickering camionette'), 'Era Nobis (Bestickering camionette)')
  assert.equal(projectNaam('Era Nobis', [], ''), 'Era Nobis')
  assert.equal(projectNaam(null, ['social_media'], 'Nieuwe lead'), 'Nieuwe lead')
  assert.equal(projectOnderwerp(['Eigen dienst']), 'eigen dienst')
  assert.equal(normaliseerBtw('Btw: BE 1016.637.895'), 'BE1016637895')
})

console.log(`\n${n} tests geslaagd\n`)

