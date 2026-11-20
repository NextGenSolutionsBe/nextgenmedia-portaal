// Omzetrapportage — de controlescenario's uit de opdracht.
//
//   npx tsx tests/omzet-analyse.test.ts

import assert from 'node:assert/strict'
import { bouwFeiten, totalen, groepeer, evolutie, facturen, filter, periodeVan, vorigePeriode, verdeel, verwachteMrr, type RuweFactuur, type RuweRegel } from '../lib/omzet/analyse'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nOmzetrapportage\n')

const F = (deel: Partial<RuweFactuur>): RuweFactuur => ({ id: Math.random().toString(36).slice(2), client_id: 'k1', invoice_date: '2026-09-10', description: 'Factuur', status: 'verstuurd', amount_excl: 0, amount_incl: 0, service_slug: null, kind: 'client', ...deel })
const R = (factuur: string, prijs: number, deel: Partial<RuweRegel> = {}): RuweRegel => ({ id: Math.random().toString(36).slice(2), invoice_id: factuur, recurring_id: null, aantal: 1, prijs_excl: prijs, btw_pct: 21, korting_pct: 0, korting_eur: 0, is_extra: false, service_slug: null, ...deel })
const sep = periodeVan('maand:2026-09', '2026-10-12'), okt = periodeVan('maand:2026-10', '2026-10-12')

test('Eén dienst, meerdere diensten op één factuur, km apart — som diensten = totaal', () => {
  const a = F({ service_slug: 'social-media', amount_excl: 900, amount_incl: 1089 })
  const b = F({ amount_excl: 1586, amount_incl: 1919.06 })
  const regels = [R(b.id, 900, { service_slug: 'social-media' }), R(b.id, 400, { service_slug: 'foto-video' }), R(b.id, 200, { service_slug: 'grafisch-ontwerp' }), R(b.id, 86, { is_extra: true })]
  const feiten = bouwFeiten([a, b], regels, [], [])
  const g = groepeer(feiten, sep, vorigePeriode(sep), 'dienst')
  const per = Object.fromEntries(g.map((x) => [x.sleutel, x.gefactureerd]))
  assert.equal(per['social-media'], 180000); assert.equal(per['foto-video'], 40000); assert.equal(per['grafisch-ontwerp'], 20000); assert.equal(per.doorgerekend, 8600)
  assert.equal(g.reduce((t, x) => t + x.gefactureerd, 0), totalen(feiten, sep).gefactureerd)
  assert.equal(totalen(feiten, sep).aantal, 2)
})

test('Onbetaald, gedeeltelijk en volledig betaald; ontvangen + open = gefactureerd', () => {
  const open = F({ amount_excl: 1000, amount_incl: 1210 })
  const deels = F({ amount_excl: 1000, amount_incl: 1210, betaalstatus: 'gedeeltelijk_betaald', betaald_bedrag: 605, betaald_op: '2026-09-20' })
  const vol = F({ amount_excl: 1000, amount_incl: 1210, betaalstatus: 'betaald', betaald_bedrag: 1210, betaald_op: '2026-09-25' })
  const regels = [R(open.id, 1000), R(deels.id, 600, { service_slug: 'social-media' }), R(deels.id, 400, { service_slug: 'foto-video' }), R(vol.id, 1000)]
  const feiten = bouwFeiten([open, deels, vol], regels, [], [])
  const t = totalen(feiten, sep)
  assert.equal(t.gefactureerd, 300000); assert.equal(t.ontvangen, 150000); assert.equal(t.open, 150000)
  assert.equal(t.ontvangen + t.open, t.gefactureerd)
  // De gedeeltelijke betaling is proportioneel verdeeld over de diensten.
  const g = Object.fromEntries(groepeer(feiten, sep, vorigePeriode(sep), 'dienst').map((x) => [x.sleutel, x]))
  assert.equal(g['social-media'].ontvangen, 30000); assert.equal(g['foto-video'].ontvangen, 20000)
  assert.equal(filter(feiten, { status: 'gedeeltelijk' }).length, 2)
})

test('Betaling in een andere maand dan de factuurdatum; ontbrekende betaaldatum = onbekend', () => {
  const f = F({ invoice_date: '2026-09-28', amount_excl: 500, amount_incl: 605, betaalstatus: 'betaald', betaald_bedrag: 605, betaald_op: '2026-10-03' })
  const g = F({ invoice_date: '2026-09-05', amount_excl: 200, amount_incl: 242, betaalstatus: 'betaald', betaald_bedrag: 242, betaald_op: null })
  const feiten = bouwFeiten([f, g], [], [], [])
  assert.equal(totalen(feiten, sep).gefactureerd, 70000); assert.equal(totalen(feiten, sep).ontvangen, 0); assert.equal(totalen(feiten, sep).ontvangenOnbekend, 20000)
  assert.equal(totalen(feiten, okt).ontvangen, 50000); assert.equal(totalen(feiten, okt).gefactureerd, 0)
})

test('Creditnota vermindert de omzet van de oorspronkelijke dienst op de creditdatum; concept en geannuleerd tellen niet', () => {
  const cr = F({ status: 'gecrediteerd', service_slug: 'webdesign', amount_excl: 2500, amount_incl: 3025, credited_at: '2026-10-02T10:00:00Z' })
  const concept = F({ status: 'te_versturen', amount_excl: 999, amount_incl: 1208.79 })
  const weg = F({ status: 'geannuleerd', amount_excl: 999, amount_incl: 1208.79 })
  const negatief = F({ invoice_date: '2026-10-05', amount_excl: -300, amount_incl: -363, service_slug: 'ads' })
  const feiten = bouwFeiten([cr, concept, weg, negatief], [], [], [])
  assert.equal(totalen(feiten, sep).gefactureerd, 250000); assert.equal(totalen(feiten, sep).open, 0)
  assert.equal(totalen(feiten, okt).gefactureerd, -280000)
  const web = groepeer(feiten, okt, sep, 'dienst').find((x) => x.sleutel === 'webdesign')!
  assert.equal(web.gefactureerd, -250000)
  assert.equal(filter(feiten, {}).filter((x) => x.factuur === `inv:${concept.id}`).length, 0)
})

test('Niet gecategoriseerd, WAM uitgesloten, vorig boekjaar apart', () => {
  const zonder = F({ amount_excl: 100, amount_incl: 121 })
  const wam = F({ kind: 'wam', amount_excl: 5000, amount_incl: 6050 })
  const oud = F({ invoice_date: '2025-09-10', service_slug: 'social-media', amount_excl: 700, amount_incl: 847 })
  const feiten = bouwFeiten([zonder, wam, oud], [], [], [])
  assert.equal(groepeer(feiten, sep, vorigePeriode(sep), 'dienst')[0].sleutel, 'niet_gecategoriseerd')
  assert.equal(totalen(feiten, periodeVan('jaar:2026', '2026-10-12')).gefactureerd, 10000)
  assert.equal(totalen(feiten, periodeVan('jaar:2025', '2026-10-12')).gefactureerd, 70000)
})

test('Terugkerend: reeksmaanden (zonder eigen factuur) en gemarkeerde facturen; verwachte MRR apart', () => {
  const reeks = { id: 'r1', client_id: 'k2', description: 'Social media', amount_excl: 979, service_slug: 'social-media', start_month: '2026-09', end_month: null }
  const maanden = [{ recurring_id: 'r1', month: '2026-09', status: 'verstuurd', billing_date: '2026-09-01', betaald_op: '2026-09-15' }, { recurring_id: 'r1', month: '2026-10', status: 'verstuurd', billing_date: '2026-10-01' }, { recurring_id: 'r1', month: '2026-11', status: 'te_versturen' }]
  const eenmalig = F({ invoice_date: '2026-10-07', amount_excl: 1500, amount_incl: 1815, service_slug: 'foto-video' })
  const feiten = bouwFeiten([eenmalig], [], [reeks], maanden)
  const t = totalen(feiten, periodeVan('dit_kwartaal', '2026-10-12'))
  assert.equal(t.gefactureerd, 97900 + 150000); assert.equal(t.recurring, 97900)
  assert.equal(totalen(feiten, sep).recurringOntvangen, 97900)
  assert.equal(filter(feiten, { type: 'terugkerend' }).length, 2); assert.equal(filter(feiten, { type: 'eenmalig' }).length, 1)
  assert.equal(verwachteMrr([reeks, { ...reeks, id: 'r2', amount_excl: 120, deleted_at: '2026-09-30' }], '2026-10'), 97900)
})

test('Periodes en vergelijkingen: kwartalen en jaren', () => {
  assert.deepEqual([periodeVan('kwartaal:2026-Q3', '2026-10-12').van, periodeVan('kwartaal:2026-Q3', '2026-10-12').tot], ['2026-07-01', '2026-09-30'])
  assert.equal(vorigePeriode(periodeVan('kwartaal:2026-Q3', '2026-10-12')).van, '2026-04-01')
  assert.deepEqual([vorigePeriode(periodeVan('jaar:2026', '2026-10-12')).van, vorigePeriode(periodeVan('jaar:2026', '2026-10-12')).tot], ['2025-01-01', '2025-12-31'])
  assert.equal(periodeVan('vorige_maand', '2026-01-15').van, '2025-12-01')
  assert.equal(periodeVan('laatste_12', '2026-10-12').van, '2025-11-01')
  const a = periodeVan('aangepast:2026-09-10:2026-09-19', '2026-10-12'); assert.deepEqual([vorigePeriode(a).van, vorigePeriode(a).tot], ['2026-08-31', '2026-09-09'])
})

test('Gecombineerde filters, evolutie per maand en doorklik naar facturen', () => {
  const a = F({ invoice_date: '2026-07-15', service_slug: 'foto-video', amount_excl: 400, amount_incl: 484, betaalstatus: 'betaald', betaald_bedrag: 484, betaald_op: '2026-07-30' })
  const b = F({ invoice_date: '2026-08-15', service_slug: 'foto-video', amount_excl: 600, amount_incl: 726, client_id: 'k2' })
  const s = F({ invoice_date: '2026-09-01', service_slug: 'social-media', amount_excl: 979, amount_incl: 1184.59, betaalstatus: 'betaald', betaald_bedrag: 1184.59, betaald_op: '2026-09-10' })
  const feiten = bouwFeiten([a, b, s], [], [], [])
  const q3 = periodeVan('kwartaal:2026-Q3', '2026-10-12')
  assert.equal(totalen(filter(feiten, { dienst: 'foto-video' }), q3).gefactureerd, 100000)
  assert.equal(totalen(filter(feiten, { dienst: 'social-media', status: 'betaald' }), sep).gefactureerd, 97900)
  const ev = evolutie(feiten, q3, 'maand', ['foto-video'])
  assert.deepEqual(ev.map((x) => [x.bucket, x.totaal, x['foto-video']]), [['2026-07', 40000, 40000], ['2026-08', 60000, 60000], ['2026-09', 97900, 0]])
  assert.equal(evolutie(feiten, periodeVan('jaar:2026', '2026-10-12'), 'maand', []).length, 12)
  const fs = facturen(filter(feiten, { klant: 'k2' }), q3); assert.equal(fs.length, 1); assert.equal(fs[0].invoice_id, b.id)
})

test('Verdelen zonder afrondingsverlies', () => {
  assert.deepEqual(verdeel(100, [1, 1, 1]), [34, 33, 33]); assert.equal(verdeel(99999, [3, 7, 11]).reduce((t, x) => t + x, 0), 99999)
})

console.log(`\n${n} tests geslaagd\n`)
