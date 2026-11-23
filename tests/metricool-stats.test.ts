// Statistieken uit Metricool: reeksen lezen, periodes, samenvatting, grafiek en beste posts.
// Uitvoeren: npx tsx tests/metricool-stats.test.ts
import assert from 'node:assert/strict'
import { bestePosts, grafiekReeks, kortGetal, netwerkenMetData, periodeVan, postCijfers, reeksUit, samenvatting, type Rij } from '../lib/metricool-stats'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nMetricool-statistieken\n')

test('een tijdreeks van Metricool lezen', () => {
  const raw = { data: [{ metric: 'followers', values: [
    { dateTime: '2026-11-20T00:00:00+01:00', value: 1096 },
    { dateTime: '2026-11-21T00:00:00+01:00', value: '1095' },
    { dateTime: 'onzin', value: 3 },
    { dateTime: '2026-11-22', value: null },
  ] }] }
  assert.deepEqual(reeksUit(raw), [{ datum: '2026-11-20', waarde: 1096 }, { datum: '2026-11-21', waarde: 1095 }])
  assert.deepEqual(reeksUit({ data: [] }), [])
  assert.deepEqual(reeksUit(null), [])
})

test('periodes: laatste 30 dagen eindigt gisteren, vorige maand en de periode ervoor', () => {
  const p = periodeVan('30d', '2026-11-23')
  assert.equal(p.tot, '2026-11-22')
  assert.equal(p.van, '2026-10-24')
  assert.equal(p.vorigeTot, '2026-10-23')
  assert.equal(p.vorigeVan, '2026-09-24')
  const m = periodeVan('maand', '2026-01-10')
  assert.deepEqual([m.van, m.tot, m.vorigeVan, m.vorigeTot, m.label], ['2025-12-01', '2025-12-31', '2025-11-01', '2025-11-30', 'december 2025'])
})

const rijen: Rij[] = [
  // Instagram-volgers: 1.090 bij de start, 1.098 op het einde.
  { netwerk: 'instagram', kpi: 'volgers', datum: '2026-10-23', waarde: 1090 },
  { netwerk: 'instagram', kpi: 'volgers', datum: '2026-11-22', waarde: 1098 },
  { netwerk: 'instagram', kpi: 'volgers', datum: '2026-09-30', waarde: 1080 },
  { netwerk: 'facebook', kpi: 'volgers', datum: '2026-11-20', waarde: 500 },
  { netwerk: 'instagram', kpi: 'bereik', datum: '2026-10-30', waarde: 1294 },
  { netwerk: 'instagram', kpi: 'bereik', datum: '2026-11-12', waarde: 567 },
  { netwerk: 'instagram', kpi: 'bereik', datum: '2026-10-01', waarde: 900 },
  { netwerk: 'facebook', kpi: 'bereik', datum: '2026-11-01', waarde: 100 },
]

test('samenvatting: volgers als stand (laatste), bereik als som, vergelijking met de vorige periode', () => {
  const p = periodeVan('30d', '2026-11-23')
  const ig = samenvatting(rijen, p, 'instagram')
  const volgers = ig.find((k) => k.kpi === 'volgers')!
  assert.equal(volgers.waarde, 1098)
  assert.equal(volgers.groei, 8)
  assert.equal(volgers.vorige, 1090)
  const bereik = ig.find((k) => k.kpi === 'bereik')!
  assert.equal(bereik.waarde, 1861)
  assert.equal(bereik.vorige, 900)
  assert.equal(bereik.procent, 106.8)
  assert.equal(ig.find((k) => k.kpi === 'posts')!.waarde, null)
  // Alle kanalen samen: volgers per netwerk opgeteld, bereik over alles.
  const alle = samenvatting(rijen, p, 'alle')
  assert.equal(alle.find((k) => k.kpi === 'volgers')!.waarde, 1598)
  assert.equal(alle.find((k) => k.kpi === 'bereik')!.waarde, 1961)
})

test('grafiek: elke dag van de periode, volgers als laatst gekende stand', () => {
  const p = periodeVan('30d', '2026-11-23')
  const v = grafiekReeks(rijen, p, 'instagram', 'volgers')
  assert.equal(v.length, 30)
  assert.equal(v[0].waarde, 1090)
  assert.equal(v[29].waarde, 1098)
  const b = grafiekReeks(rijen, p, 'instagram', 'bereik')
  assert.equal(b.find((x) => x.datum === '2026-10-30')!.waarde, 1294)
  assert.equal(b.find((x) => x.datum === '2026-10-31')!.waarde, 0)
  assert.deepEqual(netwerkenMetData(rijen), ['instagram', 'facebook'])
})

test('post-cijfers uit verschillende veldnamen en de beste posts', () => {
  assert.deepEqual(postCijfers({ likes: 10, comments: '2', saved: 3, shares: 1, reach: 400, impressions: 600 }),
    { interacties: 16, bereik: 400, weergaven: 600, likes: 10, reacties: 2, delen: 1, opgeslagen: 3 })
  assert.equal(postCijfers({ Interactions: 50, likeCount: 7 }).interacties, 50)
  assert.equal(postCijfers({}).interacties, null)
  const posts = [
    { netwerk: 'instagram', post_id: 'a', gepubliceerd_op: '2026-11-01T10:00:00', soort: null, tekst: 'A', link: null, beeld: null, metrics: { likes: 5 } },
    { netwerk: 'facebook', post_id: 'b', gepubliceerd_op: '2026-11-02T10:00:00', soort: null, tekst: 'B', link: null, beeld: null, metrics: { interactions: 40 } },
    { netwerk: 'instagram', post_id: 'c', gepubliceerd_op: '2026-09-01T10:00:00', soort: null, tekst: 'C', link: null, beeld: null, metrics: { likes: 99 } },
  ]
  const p = periodeVan('30d', '2026-11-23')
  assert.deepEqual(bestePosts(posts, p, 'alle').map((x) => x.post_id), ['b', 'a'])
  assert.deepEqual(bestePosts(posts, p, 'instagram').map((x) => x.post_id), ['a'])
})

test('korte getallen', () => {
  assert.equal(kortGetal(1234), '1.234')
  assert.equal(kortGetal(12345), '12,3K')
  assert.equal(kortGetal(2_500_000), '2,5M')
  assert.equal(kortGetal(null), '—')
})

console.log(`\n${n} tests geslaagd\n`)
