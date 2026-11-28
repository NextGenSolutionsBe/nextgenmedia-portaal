// Financieel (verbeterplan fase 7).
//   npx tsx tests/financieel-fase7.test.ts
import assert from 'node:assert/strict'
import {
  leesDoelen, STANDAARD_DOELEN, maandVoortgang, klantWaarde, margePerProject, minimumCheck, doorgerekend, controleerReden,
  verlengingNodig, verlengingDeadline, naarCsv, kostTotaal, FICHE_NAAR_CATALOGUS,
} from '../lib/financieel/fase7'
import { bouwFeiten, filter, groepeer, periodeVan, vorigePeriode } from '../lib/omzet/analyse'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }

test('maanddoelen: standaard het doel van nu en de ambitie van € 100.000', () => {
  assert.deepEqual(leesDoelen(null), STANDAARD_DOELEN)
  assert.equal(STANDAARD_DOELEN.totaal, 30000)
  assert.equal(STANDAARD_DOELEN.ambitie, 100000)
  assert.deepEqual(leesDoelen({ totaal: '45000', ambitie: 0, nextgenmedia: '30.000', nextgensolutions: 'veel' }), { totaal: 45000, ambitie: 100000, nextgenmedia: 30000, nextgensolutions: null })
})

test('maandvoortgang per bedrijf: gefactureerd, gepland en nog te gaan', () => {
  const v = maandVoortgang([
    { bedrijf: 'nextgenmedia', bedrag: 10000, gefactureerd: true }, { bedrijf: 'nextgenmedia', bedrag: 5000, gefactureerd: false },
    { bedrijf: 'nextgensolutions', bedrag: 2000, gefactureerd: true }, { bedrijf: null, bedrag: 1000, gefactureerd: true },
  ], { totaal: 30000, ambitie: 100000, nextgenmedia: 20000, nextgensolutions: null })
  assert.deepEqual(v[0], { sleutel: 'totaal', doel: 30000, gefactureerd: 13000, gepland: 5000, pct: 43, nogTeGaan: 12000 })
  assert.deepEqual(v[1], { sleutel: 'nextgenmedia', doel: 20000, gefactureerd: 10000, gepland: 5000, pct: 50, nogTeGaan: 5000 })
  assert.equal(v[2].pct, null, 'zonder doel geen percentage')
})

test('klantwaarde: per bedrijf, marge met uren enkel met uurtarief', () => {
  const w = klantWaarde({
    facturen: [{ bedrijf: 'nextgenmedia', bedrag: 1000, datum: '2026-03-01' }, { bedrijf: 'nextgensolutions', bedrag: 500, datum: '2025-12-01' }],
    gepland: [{ bedrijf: 'nextgenmedia', bedrag: 300, datum: null }],
    kosten: [{ bedrijf: 'nextgenmedia', bedrag: 200, datum: null }], uren: 2.1, uurtarief: 50,
  })
  assert.equal(w.gefactureerd, 1500); assert.equal(w.teFactureren, 300); assert.equal(w.kosten, 200)
  assert.equal(w.uren, 2); assert.equal(w.urenKost, 100); assert.equal(w.marge, 1200); assert.equal(w.margePct, 80)
  assert.equal(w.sinds, '2025-12-01')
  assert.deepEqual(w.perBedrijf[0], { bedrijf: 'nextgenmedia', gefactureerd: 1000, kosten: 200, marge: 800 })
  assert.equal(klantWaarde({ facturen: [], gepland: [], kosten: [], uren: 5, uurtarief: null }).urenKost, 0)
})

test('marge per project', () => {
  const p = margePerProject([{ bedrijf: null, bedrag: 1000, datum: null, project: 'a' }, { bedrijf: null, bedrag: 50, datum: null }], [{ bedrijf: null, bedrag: 250, datum: null, project: 'a' }])
  assert.deepEqual(p, [{ project: 'a', gefactureerd: 1000, kosten: 250, marge: 750, margePct: 75 }])
})

test('kosten tot vandaag: eenmalig en terugkerend', () => {
  assert.equal(kostTotaal({ type: 'one_time', amount_excl: 100, cost_date: '2026-11-01' }, '2026-11-27'), 100)
  assert.equal(kostTotaal({ type: 'one_time', amount_excl: 100, cost_date: '2026-12-01' }, '2026-11-27'), 0)
  assert.equal(kostTotaal({ type: 'recurring', amount_excl: 50, start_date: '2026-09-15', billing_frequency: 'monthly' }, '2026-11-27'), 150)
  assert.equal(kostTotaal({ type: 'recurring', amount_excl: 50, start_date: '2026-01-01', end_date: '2026-02-28', billing_frequency: 'monthly' }, '2026-11-27'), 100)
  assert.equal(kostTotaal({ type: 'recurring', amount_excl: 300, start_date: '2026-01-01', billing_frequency: 'quarterly' }, '2026-11-27'), 1200)
  assert.equal(kostTotaal({ type: 'recurring', amount_excl: 300, start_date: '2027-01-01' }, '2026-11-27'), 0)
})

test('minimumprijs en minimale marge in de offerte', () => {
  const cat = [{ slug: 'social_media', naam: 'Social media', min_prijs: 1500, min_marge_pct: 40 }, { slug: 'websites', naam: 'Websites', min_prijs: null, min_marge_pct: null }]
  assert.equal(FICHE_NAAR_CATALOGUS.website, 'websites')
  assert.equal(doorgerekend({ advertentiebudget: '500', budget_via_ons: 'ja', verplaatsing: '100' }), 600)
  assert.equal(doorgerekend({ advertentiebudget: '500', budget_via_ons: 'nee' }), 0)
  const ok = minimumCheck(['social_media'], { excl: 2000 }, {}, cat)
  assert.equal(ok.onder, false)
  const laag = minimumCheck(['social_media', 'website'], { excl: 1000 }, {}, cat)
  assert.ok(laag.onder && laag.minimum === 1500 && laag.redenen[0].startsWith('Onder de minimumprijs'))
  const marge = minimumCheck(['social_media'], { excl: 2000 }, { verplaatsing: '1400' }, cat)
  assert.ok(marge.onder && marge.margePct === 30 && marge.redenen.some((r) => r.includes('Marge 30%')))
  assert.equal(minimumCheck(['website'], { excl: 10 }, {}, cat).onder, false, 'zonder minimum geen waarschuwing')
  assert.equal(controleerReden('kort'), null)
  assert.equal(controleerReden('  Instapprijs voor een vaste klant  '), 'Instapprijs voor een vaste klant')
})

test('verlengingsgesprek: getekend, lopend, binnen 60 dagen', () => {
  assert.equal(verlengingNodig({ status: 'signed', end_date: '2027-01-15', looptijd_status: 'lopend' }, '2026-11-27'), 49)
  assert.equal(verlengingNodig({ status: 'signed', end_date: '2027-03-15', looptijd_status: 'lopend' }, '2026-11-27'), null)
  assert.equal(verlengingNodig({ status: 'sent', end_date: '2027-01-15' }, '2026-11-27'), null)
  assert.equal(verlengingNodig({ status: 'signed', end_date: '2027-01-15', looptijd_status: 'stopgezet' }, '2026-11-27'), null)
  assert.equal(verlengingNodig({ status: 'signed', end_date: '2026-11-01' }, '2026-11-27'), null, 'al voorbij')
  assert.equal(verlengingDeadline('2027-01-15', '2026-11-27'), '2026-12-01')
  assert.equal(verlengingDeadline('2026-12-20', '2026-11-27'), '2026-11-27')
})

test('export: puntkomma, komma als decimaal, veilige cellen', () => {
  const csv = naarCsv([{ factuurnummer: '2026-101', datum: '2026-11-03', klant: 'Bakkerij "De Zon"; Hasselt', btw_nummer: 'BE0123456789', handelsnaam: 'NextGenMedia', bedrijf: 'NextGen Media', dienst: 'Social media', omschrijving: '=SUM(A1)', aantal: 1, eenheidsprijs: 1234.5, btw_pct: 21, excl: 1234.5, btw: 259.25, incl: 1493.75, referentie: '' }])
  const [kop, rij] = csv.split('\r\n')
  assert.ok(kop.startsWith('Factuurnummer;Factuurdatum;Klant;Btw-nummer klant;Handelsnaam;Bedrijf;Dienst'))
  assert.ok(rij.includes('"Bakkerij ""De Zon""; Hasselt"'))
  assert.ok(rij.includes(";'=SUM(A1);"))
  assert.ok(rij.includes(';1234,5;21;1234,5;259,25;1493,75;'))
})

test('omzetrapportage: per bedrijf groeperen en filteren', () => {
  const feiten = bouwFeiten([
    { id: 'f1', client_id: 'k', invoice_date: '2026-11-03', description: 'A', status: 'verstuurd', amount_excl: 100, amount_incl: 121, service_slug: 'social-media', bedrijf: 'nextgenmedia' },
    { id: 'f2', client_id: 'k', invoice_date: '2026-11-04', description: 'B', status: 'verstuurd', amount_excl: 50, amount_incl: 60.5, service_slug: null, bedrijf: 'nextgensolutions' },
    { id: 'f3', client_id: 'k', invoice_date: '2026-11-05', description: 'C', status: 'verstuurd', amount_excl: 25, amount_incl: 30.25, service_slug: null },
  ], [], [], [])
  const P = periodeVan('deze_maand', '2026-11-27'), V = vorigePeriode(P)
  const g = groepeer(feiten, P, V, 'bedrijf')
  assert.deepEqual(g.map((x) => [x.sleutel, x.gefactureerd]).sort(), [['nextgenmedia', 10000], ['nextgensolutions', 5000], ['—', 2500]].sort())
  assert.equal(filter(feiten, { bedrijf: 'nextgensolutions' }).length, 1)
  assert.equal(filter(feiten, { bedrijf: 'geen' }).length, 1)
})

console.log(`\n${n} tests geslaagd`)
