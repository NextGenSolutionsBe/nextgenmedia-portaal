// Facturen als interne facturatieplanner: artikelen, kilometers, totalen,
// kopieertekst voor Bram, ontbrekende gegevens, tabbladen en de facturatieronde.
//
//   npx tsx tests/facturatie-item.test.ts

import assert from 'node:assert/strict'
import { berekenRegel, berekenTotalen, kmRegel, nieuweRegel, normaliseerRegels, type FactuurRegel } from '../lib/facturen/regels'
import { kopieerTekst, ontbrekendeGegevens, aandachtspunten, regelKopie, type ItemDetail, type KlantInfo } from '../lib/facturatie/item-model'
import { tabVan, inTermijn, sorteerWerklijst, tabTellingen, rondeItems, STATUS_INFO, type Moment } from '../lib/facturatie/planner-model'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }

console.log('\nFacturatie-items\n')

const r = (deel: Partial<FactuurRegel>): FactuurRegel => nieuweRegel(deel, 21)

test('Regeltotaal: aantal × prijs, korting in procent of in euro, nooit negatief', () => {
  assert.deepEqual(berekenRegel(r({ aantal: 3, prijs_excl: 65 })), { excl: 195, btw: 40.95, incl: 235.95 })
  assert.equal(berekenRegel(r({ aantal: 2, prijs_excl: 100, korting_pct: 10 })).excl, 180)
  assert.equal(berekenRegel(r({ aantal: 2, prijs_excl: 100, korting_eur: 25 })).excl, 175)
  assert.equal(berekenRegel(r({ aantal: 1, prijs_excl: 10, korting_eur: 50 })).excl, 0)
})

test('Totalen: subtotaal, btw per tarief en totaal, afgerond op twee decimalen', () => {
  const t = berekenTotalen([r({ aantal: 1, prijs_excl: 0.1 }), r({ aantal: 1, prijs_excl: 0.2 }), r({ aantal: 3, prijs_excl: 33.333, btw_pct: 6 })])
  assert.equal(t.excl, 100.3)
  assert.deepEqual(t.perBtw.map((p) => [p.pct, p.btw]), [[6, 6], [21, 0.06]])
  assert.equal(t.incl, 106.36)
})

test('Kilometers: totaal km × tarief, nooit verdubbeld, met kopieerbare omschrijving', () => {
  const k = kmRegel({ datum: '2026-10-07', traject: 'shoot bij klant', km: 80, tarief: 0.4, btw: 21 })
  assert.equal(k.aantal, 80); assert.equal(k.eenheid, 'km'); assert.equal(k.prijs_excl, 0.4); assert.equal(k.is_extra, true)
  assert.equal(berekenRegel(k).excl, 32)
  assert.equal(k.omschrijving, 'Kilometervergoeding — shoot bij klant — 07/10/2026 — 80 km × €0,40/km')
})

test('Korting in euro blijft bewaard bij het normaliseren', () => {
  const [x] = normaliseerRegels([{ artikel: 'Shoot', aantal: 1, prijs_excl: 500, korting_eur: '50,5' }])
  assert.equal(x.korting_eur, 50.5)
})

const klant: KlantInfo = { id: 'k', naam: 'Bistro Box', contact: 'Jan', email: 'jan@bistro.be', facturatie_email: 'boekhouding@bistro.be', telefoon: null, btw: 'BE0123456749', straat: 'Markt 1', postcode: '3500', gemeente: 'Hasselt', land: null }
const detail = (deel: Partial<ItemDetail> = {}): ItemDetail => ({
  klant, project: 'Social media', titel: 'Shoot oktober', type: 'eenmalig', datum: '2026-10-07', prestatie_van: '2026-10-01', prestatie_tot: '2026-10-31', periode: null,
  betaaltermijn: 30, klant_referentie: 'PO-15', mededeling: 'Gelieve te betalen met referentie PO-15.', notitie: 'GEHEIM: klant betaalt traag',
  extern_factuurnummer: null, regels: [r({ artikel: 'Shoot', omschrijving: 'Productshoot op locatie', aantal: 1, prijs_excl: 650 }), kmRegel({ traject: 'Hasselt – Genk', km: 40, tarief: 0.4, btw: 21 })], ...deel,
})

test('Kopieertekst: alles wat op de factuur hoort — en NOOIT de interne notitie', () => {
  const t = kopieerTekst(detail())
  for (const stuk of ['Klant: Bistro Box', 'Btw-nummer: BE0123456749', 'Markt 1, 3500 Hasselt', 'boekhouding@bistro.be', 'Uw referentie / bestelbon: PO-15', 'Prestatieperiode: 01/10/2026 – 31/10/2026', 'Betaaltermijn: 30 dagen', '1. Shoot', 'Productshoot op locatie', 'Subtotaal excl. btw: €666,00', 'Totaal incl. btw: €805,86', 'Mededeling:\nGelieve te betalen met referentie PO-15.'])
    assert.ok(t.includes(stuk), `ontbreekt: ${stuk}`)
  assert.ok(!t.includes('GEHEIM'), 'interne notitie lekt in de kopieertekst')
  assert.ok(regelKopie(detail().regels[1]).includes('40 km × €0,40'))
})

test('Gegevens ontbreken: concreet per punt; adres/btw zijn enkel aandachtspunten', () => {
  assert.deepEqual(ontbrekendeGegevens(detail()), [])
  const o = ontbrekendeGegevens(detail({ klant: null, regels: [r({ artikel: 'Montage', aantal: 2, prijs_excl: 0 })] }))
  assert.ok(o.includes('Er is geen klant gekoppeld.'))
  assert.ok(o.some((x) => x.includes('Regel 1 (Montage) heeft nog geen eenheidsprijs')))
  assert.ok(o.includes('Het totaal is € 0,00.'))
  assert.equal(aandachtspunten({ klant: { ...klant, btw: null, straat: null, postcode: null, gemeente: null } }).length, 2)
})

const mom = (id: string, status: Moment['status'], datum: string, deel: Partial<Moment> = {}) => ({ id, status, datum, bron: 'invoice', klant: id, bedrag_excl: 10, ...deel }) as Moment
const VANDAAG = '2026-10-07' // woensdag

test('Tabbladen: verstuurd = Gefactureerd (ook betaald); geannuleerd hoort in geen actieve tab', () => {
  assert.equal(tabVan({ status: 'achterstallig' }), 'te_factureren')
  assert.equal(tabVan({ status: 'controle_vereist' }), 'te_factureren')
  assert.equal(tabVan({ status: 'verstuurd' }), 'gefactureerd')
  assert.equal(tabVan({ status: 'betaald' }), 'gefactureerd')
  assert.equal(tabVan({ status: 'geannuleerd' }), null)
  assert.equal(STATUS_INFO.verstuurd.label, 'Gefactureerd')
  assert.deepEqual(tabTellingen([mom('a', 'gepland', VANDAAG), mom('b', 'verstuurd', VANDAAG), mom('c', 'betaald', VANDAAG), mom('d', 'geannuleerd', VANDAAG)]), { te_factureren: 1, open_alle: 1, gefactureerd: 2, alles: 4 })
})

test('Snelfilters: tot en met vandaag, deze week (achterstallig blijft zichtbaar), later', () => {
  const oud = mom('oud', 'achterstallig', '2026-08-15'), vd = mom('vd', 'te_versturen', VANDAAG), vr = mom('vr', 'gepland', '2026-10-09'), lt = mom('lt', 'gepland', '2026-10-20')
  assert.deepEqual([oud, vd, vr, lt].filter((m) => inTermijn(m, 'tot_vandaag', VANDAAG)).map((m) => m.id), ['oud', 'vd'])
  assert.deepEqual([oud, vd, vr, lt].filter((m) => inTermijn(m, 'week', VANDAAG)).map((m) => m.id), ['oud', 'vd', 'vr'])
  assert.deepEqual([oud, vd, vr, lt].filter((m) => inTermijn(m, 'later', VANDAAG)).map((m) => m.id), ['lt'])
})

test('Werklijst: achterstallig bovenaan; ronde = alles t.e.m. vandaag (geen WAM, geen gefactureerde)', () => {
  const l = [mom('later', 'gepland', '2026-10-20'), mom('vandaag', 'te_versturen', VANDAAG), mom('oud2', 'achterstallig', '2026-09-30'), mom('oud1', 'achterstallig', '2026-09-01')]
  assert.deepEqual(sorteerWerklijst(l).map((m) => m.id), ['oud1', 'oud2', 'vandaag', 'later'])
  const ronde = rondeItems([...l, mom('wam', 'achterstallig', '2026-09-02', { bron: 'wam' }), mom('klaar', 'verstuurd', '2026-09-03')], VANDAAG)
  assert.deepEqual(ronde.map((m) => m.id), ['oud1', 'oud2', 'vandaag'])
})

console.log(`\n${n} tests geslaagd\n`)
