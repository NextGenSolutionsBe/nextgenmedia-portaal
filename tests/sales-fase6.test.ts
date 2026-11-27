// Levering Media en sales (verbeterplan fase 6).
//   npx tsx tests/sales-fase6.test.ts
import assert from 'node:assert/strict'
import { BRONNEN_LIJST, isBronKey, bronNaam, isOudeBron, bronRichting, verliesGroep, VERLIES_REDENEN } from '../lib/sales/bronnen'
import { bereikteStap, mediaTrechter, solutionsTrechter, perBron, verliesRedenen, salesActiviteit, urenVan, salesUren, type KaartKort } from '../lib/sales/verkoopcijfers'
import { minuten, controleerTijd, totaalMin, urenTekst, shootRapport, afspraakLabel } from '../lib/shoots/tijd'
import { wachtPerKlant, wachtTekst } from '../lib/klant-wacht'
import { revisiesPerKlant } from '../lib/opleveringen'
import { leesDeliverable, leesDeliverables, deliverablesTekst, netteDeliverables, contentTypeVan, maandStand } from '../lib/bedrijven/deliverables'
import { leesCp, leesRol } from '../lib/contentplanning/model'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }
const kaart = (x: Partial<KaartKort>): KaartKort => ({ status: 'open', bron: null, stop_reden: null, offerte_op: null, offerte_via: null, contract_id: null, created_at: '2026-11-01', bedrijf: null, ...x })

test('bronnen: één lijst, oude waarden blijven geldig en leesbaar', () => {
  assert.equal(BRONNEN_LIJST.length, 7)
  assert.ok(isBronKey('inbound_website') && isBronKey('bestaande_klant'))
  assert.ok(isBronKey('inbound') && isBronKey('doorverwijzing') && isBronKey('andere'), 'oude waarden')
  assert.equal(isBronKey('facebook'), false)
  assert.equal(bronNaam('doorverwijzing'), 'Doorverwezen')
  assert.equal(bronNaam('netwerk'), 'Netwerk')
  assert.equal(bronNaam(null), 'Onbekend')
  assert.ok(isOudeBron('inbound') && !isOudeBron('outbound'))
})

test('bronnen: inbound of outbound enkel als het zeker is', () => {
  assert.equal(bronRichting('outbound'), 'outbound')
  assert.equal(bronRichting('inbound'), 'inbound')
  assert.equal(bronRichting('inbound_website'), 'inbound')
  assert.equal(bronRichting('netwerk'), null)
  assert.equal(bronRichting(null), null)
})

test('verlies: vaste redenen, de rest is Andere', () => {
  assert.equal(VERLIES_REDENEN.length, 5)
  assert.equal(verliesGroep('Te duur: koos goedkoper'), 'Te duur')
  assert.equal(verliesGroep('koos een andere partij'), 'Koos een andere partij')
  assert.equal(verliesGroep('ging failliet'), 'Andere')
  assert.equal(verliesGroep(''), 'Geen reden')
  assert.deepEqual(verliesRedenen(['Te duur', 'Te duur, echt', null, 'iets']), [{ reden: 'Te duur', aantal: 2 }, { reden: 'Geen reden', aantal: 1 }, { reden: 'Andere', aantal: 1 }])
})

test('trechter Media: stap uit de kolom, verloren telt tot offerte of contract', () => {
  assert.equal(bereikteStap(kaart({ status: 'open' })), 0)
  assert.equal(bereikteStap(kaart({ status: 'voorstel_voorgelegd' })), 1)
  assert.equal(bereikteStap(kaart({ status: 'interesse' })), 1, 'offerte geaccepteerd = nog geen contract')
  assert.equal(bereikteStap(kaart({ status: 'contract_verstuurd' })), 2)
  assert.equal(bereikteStap(kaart({ status: 'bezig' })), 3)
  assert.equal(bereikteStap(kaart({ status: 'afgerond' })), 4)
  assert.equal(bereikteStap(kaart({ status: 'geen_interesse' })), 0)
  assert.equal(bereikteStap(kaart({ status: 'geen_interesse', offerte_op: '2026-11-02' })), 1)
  assert.equal(bereikteStap(kaart({ status: 'geannuleerd', contract_id: 'c' })), 2)
  const t = mediaTrechter([kaart({}), kaart({ status: 'voorstel_voorgelegd' }), kaart({ status: 'getekend' }), kaart({ status: 'geen_interesse', offerte_op: 'x' })])
  assert.deepEqual(t.stappen.map((s) => s.aantal), [4, 3, 1, 1, 0])
  assert.deepEqual(t.stappen.map((s) => s.conversie), [null, 75, 33, 100, 0])
  assert.equal(t.verloren, 1)
  assert.equal(t.open, 2)
})

test('trechter Solutions: afspraak tot won, lost telt als afspraak', () => {
  const t = solutionsTrechter([{ fase: 'afspraak', bron: null, verloren_reden: null, created_at: 'x' }, { fase: 'won', bron: null, verloren_reden: null, created_at: 'x' }, { fase: 'lost', bron: null, verloren_reden: 'Te duur', created_at: 'x' }, { fase: 'opvolgen', bron: null, verloren_reden: null, created_at: 'x' }])
  assert.deepEqual(t.stappen.map((s) => s.aantal), [4, 2, 2, 1])
  assert.equal(t.verloren, 1)
  assert.equal(t.open, 2)
  assert.equal(solutionsTrechter([]).stappen[1].conversie, null, 'niets gedeeld door nul')
})

test('per bron: totaal, gewonnen en verloren', () => {
  const r = perBron([{ bron: 'outbound', gewonnen: true, verloren: false }, { bron: 'outbound', gewonnen: false, verloren: true }, { bron: 'inbound', gewonnen: false, verloren: false }])
  assert.deepEqual(r, [{ bron: 'Outbound', totaal: 2, gewonnen: 1, verloren: 1 }, { bron: 'Inbound', totaal: 1, gewonnen: 0, verloren: 0 }])
})

test('salesactiviteit uit ABM: per persoon, enkel notities met een uitkomst', () => {
  const a = salesActiviteit([
    { door: 'Bram', uitkomst: 'Niet opgenomen', soort: null, created_at: 'x' },
    { door: 'Bram', uitkomst: 'Interesse', soort: null, created_at: 'x' },
    { door: 'Bram', uitkomst: 'Terugbellen', soort: null, created_at: 'x' },
    { door: 'Marco', uitkomst: 'Gesproken', soort: null, created_at: 'x' },
    { door: 'Marco', uitkomst: null, soort: 'notitie', created_at: 'x' },
  ])
  assert.deepEqual(a[0], { wie: 'Bram', gesprekken: 3, gesproken: 2, interesse: 1, terugbellen: 1, nietOpgenomen: 1 })
  assert.equal(a[1].gesprekken, 1)
})

test('salesuren: gepland tegenover gedaan, op een kwartier', () => {
  assert.equal(urenVan([{ start: 0, end: 90 * 60_000 }, { start: 0, end: 10 * 60_000 }]), 1.75)
  assert.deepEqual(salesUren(8, 6), { gepland: 8, gedaan: 6, pct: 75 })
  assert.equal(salesUren(0, 2).pct, null)
})

test('shoottijd: lezen zoals mensen typen', () => {
  assert.equal(minuten('1u30'), 90)
  assert.equal(minuten('1:30'), 90)
  assert.equal(minuten('2u'), 120)
  assert.equal(minuten('1,5u'), 90)
  assert.equal(minuten('45'), 45)
  assert.equal(minuten('45 min'), 45)
  assert.equal(minuten(''), null)
  assert.equal(minuten('lang'), null)
  assert.equal(minuten(-5), null)
  const t = controleerTijd({ rijden_min: '1u', shoot_min: 180, nabewerking_min: '2u30', afspraak: 'retainer' })
  assert.deepEqual(t, { rijden_min: 60, shoot_min: 180, nabewerking_min: 150, afspraak: 'retainer' })
  assert.equal(controleerTijd({ afspraak: 'gratis' }).afspraak, null)
  assert.equal(totaalMin(t), 390)
  assert.equal(urenTekst(390), '6 u 30')
  assert.equal(urenTekst(120), '2 u')
  assert.equal(afspraakLabel(null), 'Niet aangeduid')
})

test('shootrapport: per klant, geannuleerd telt niet', () => {
  const r = shootRapport([
    { client_id: 'a', klant: 'A', datum: '2026-11-03', status: 'gepland', rijden_min: 60, shoot_min: 120, nabewerking_min: 60, afspraak: 'retainer' },
    { client_id: 'a', klant: 'A', datum: '2026-11-10', status: 'afgerond', rijden_min: null, shoot_min: null, nabewerking_min: null, afspraak: null },
    { client_id: 'b', klant: 'B', datum: '2026-11-12', status: 'geannuleerd', rijden_min: 600, shoot_min: 0, nabewerking_min: 0, afspraak: 'eenmalig' },
  ])
  assert.equal(r.length, 1)
  assert.deepEqual({ shoots: r[0].shoots, totaal: r[0].totaal, zonderTijd: r[0].zonderTijd, perAfspraak: r[0].perAfspraak }, { shoots: 2, totaal: 240, zonderTijd: 1, perAfspraak: { retainer: 1, onbekend: 1 } })
})

test('wacht op klant: wie het langst wacht bovenaan', () => {
  const w = wachtPerKlant([
    { client_id: 'a', klant: 'Alfa', soort: 'contract', titel: 'C', sinds: '2026-11-25', href: '/x' },
    { client_id: 'b', klant: 'Beta', soort: 'content', titel: 'P', sinds: '2026-11-10T08:00:00Z', href: '/y', aantal: 3 },
    { client_id: 'a', klant: 'Alfa', soort: 'offerte', titel: 'O', sinds: '2026-11-20', href: '/z' },
  ], '2026-11-27')
  assert.deepEqual(w.map((k) => [k.klant, k.dagen]), [['Beta', 17], ['Alfa', 7]])
  assert.deepEqual(w[1].rijen.map((r) => r.soort), ['offerte', 'contract'])
  assert.equal(wachtTekst(0), 'sinds vandaag')
  assert.equal(wachtTekst(1), 'sinds gisteren')
  assert.equal(wachtTekst(5), 'al 5 dagen')
})

test('revisierondes per klant', () => {
  const r = revisiesPerKlant([
    { client_id: 'a', klant_naam: 'A', revisies: { gebruikt: 2, max: 2 } },
    { client_id: 'a', klant_naam: 'A', revisies: { gebruikt: 1, max: 2 } },
    { client_id: 'b', klant_naam: 'B', revisies: { gebruikt: 0, max: 2 } },
  ])
  assert.deepEqual(r[0], { client_id: 'a', klant: 'A', opleveringen: 2, rondes: 3, opgebruikt: 1, gemiddeld: 1.5 })
  assert.equal(r[1].rondes, 0)
})

test('deliverables: lezen uit een regel', () => {
  assert.deepEqual(leesDeliverable('12 posts per maand'), { aantal: 12, wat: 'posts', per: 'maand' })
  assert.deepEqual(leesDeliverable('- 4 reels / maand'), { aantal: 4, wat: 'reels', per: 'maand' })
  assert.deepEqual(leesDeliverable('1 shoot per kwartaal'), { aantal: 1, wat: 'shoot', per: 'kwartaal' })
  assert.deepEqual(leesDeliverable('3 ontwerpen'), { aantal: 3, wat: 'ontwerpen', per: 'project' })
  assert.equal(leesDeliverable('posts per maand'), null)
  assert.equal(leesDeliverable('0 posts'), null)
  const l = leesDeliverables('12 posts per maand\n\nveel liefde\n4 reels per maand')
  assert.equal(l.length, 2)
  assert.equal(deliverablesTekst(l), '12 posts per maand\n4 reels per maand')
  assert.deepEqual(netteDeliverables([{ aantal: '2', wat: ' stories ', per: 'maand' }, { aantal: 0, wat: 'x' }, 'x', { aantal: 1, wat: 'y', per: 'week' }]), [{ aantal: 2, wat: 'stories', per: 'maand' }, { aantal: 1, wat: 'y', per: 'project' }])
  assert.deepEqual(netteDeliverables(null), [])
})

test('deliverables: afgesproken tegenover gepland in de contentkalender', () => {
  assert.equal(contentTypeVan('reels'), 'reel')
  assert.equal(contentTypeVan('carrousels'), 'carousel')
  assert.equal(contentTypeVan('posts'), 'post')
  assert.equal(contentTypeVan('blogartikels'), null)
  const items = [
    { content_type: 'post', planned_date: '2026-11-03' }, { content_type: 'post', planned_date: '2026-11-20' },
    { content_type: 'reel', planned_date: '2026-11-04' }, { content_type: 'post', planned_date: '2026-12-01' },
  ]
  const s = maandStand([{ aantal: 12, wat: 'posts', per: 'maand' }, { aantal: 4, wat: 'reels', per: 'maand' }, { aantal: 6, wat: 'items', per: 'maand' }, { aantal: 1, wat: 'shoot', per: 'kwartaal' }], items, '2026-11')
  assert.deepEqual(s.map((x) => [x.wat, x.gepland, x.afgesproken]), [['posts', 2, 12], ['reels', 1, 4], ['items', 3, 6]])
})

test('contentplanning: rol per vaste taak en per reeks, oude instellingen blijven werken', () => {
  assert.equal(leesRol('  Uitvoerder Media '), 'Uitvoerder Media')
  assert.equal(leesRol(''), undefined)
  assert.equal(leesRol(5), undefined)
  const cp = leesCp({ vaste_taken: [{ key: 'a', titel: 'A', detail: '', rol: 'Stagiair' }, { key: 'b', titel: 'B', detail: '' }], reeks_rol: { 1: 'Chiara', 2: '', 9: 'x' } })
  assert.equal(cp.vaste_taken[0].rol, 'Stagiair')
  assert.equal('rol' in cp.vaste_taken[1], false)
  assert.deepEqual(cp.reeks_rol, { 1: 'Chiara' })
  assert.deepEqual(leesCp({}).reeks_rol, {})
})

console.log(`\n${n} tests geslaagd`)
