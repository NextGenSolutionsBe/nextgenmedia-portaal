// Verbeterplan fase 1: bedrijf en dienstencatalogus.
// Uitvoeren: npx tsx tests/bedrijven.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  STANDAARD_CATALOGUS, STANDAARD_DIENSTEN, SERVICE_SLUG_NAAR_DIENST, OPDRACHT_DIENST_NAAR_CATALOGUS,
  controleerDienst, controleerKeuze, pastBijFilter, klantBedrijven, klantBedrijfLabel, boom, hoofdDienst,
  bedrijfVanDienst, dienstenLijst, slugVan, opdrachtSleutelVoor, isBedrijfFilter, KLASSIFICATIE_TABELLEN, MEDIA, SOLUTIONS, ALGEMEEN,
} from '../lib/bedrijven/model'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nBedrijf en dienstencatalogus\n')

const cat = STANDAARD_CATALOGUS

test('startcatalogus: zes Media-diensten en drie Solutions-diensten als hoofddienst', () => {
  const hoofd = (b: string) => dienstenLijst(cat, { bedrijf: b }).filter((x) => !x.parent_slug).map((x) => x.naam)
  assert.deepEqual(hoofd(MEDIA), ['Branding', 'Social media', 'Marketingstrategie & consultancy', 'Websites', 'Google & Meta Ads', 'Foto & video'])
  assert.deepEqual(hoofd(SOLUTIONS), ['AI-automatisatie', 'Software op maat', 'Care'])
})

test('subdiensten tellen bij hun hoofddienst en hun bedrijf', () => {
  assert.equal(hoofdDienst(cat, 'seo')?.slug, 'websites')
  assert.equal(hoofdDienst(cat, 'website_onderhoud')?.slug, 'websites')
  assert.equal(hoofdDienst(cat, 'emailmarketing')?.slug, 'marketingstrategie')
  assert.equal(hoofdDienst(cat, 'grafisch_ontwerp')?.slug, 'branding')
  assert.equal(hoofdDienst(cat, 'care')?.slug, 'care')
  assert.equal(bedrijfVanDienst(cat, 'care'), SOLUTIONS)
  assert.equal(bedrijfVanDienst(cat, 'seo'), MEDIA)
  assert.equal(bedrijfVanDienst(cat, 'bestaat_niet'), null)
})

test('boom per bedrijf met subdiensten onder hun hoofddienst', () => {
  const b = boom(cat)
  assert.deepEqual(b.map((g) => g.bedrijf.slug), [MEDIA, SOLUTIONS])
  const websites = b[0].diensten.find((x) => x.dienst.slug === 'websites')!
  assert.deepEqual(websites.sub.map((x) => x.slug), ['seo', 'website_onderhoud'])
})

test('mapping van oude waarden wijst enkel naar bestaande diensten', () => {
  for (const v of [...Object.values(SERVICE_SLUG_NAAR_DIENST), ...Object.values(OPDRACHT_DIENST_NAAR_CATALOGUS)]) {
    assert.ok(STANDAARD_DIENSTEN.some((x) => x.slug === v), `onbekende dienst ${v}`)
  }
  assert.equal(SERVICE_SLUG_NAAR_DIENST['marketing-consultancy'], 'marketingstrategie')
  // Consultancy op een projectkaart is dubbelzinnig: niet in de zekere mapping.
  assert.equal(OPDRACHT_DIENST_NAAR_CATALOGUS['consultancy'], undefined)
  assert.equal(OPDRACHT_DIENST_NAAR_CATALOGUS['ngs'], undefined)
})

test('zelfde zekere mapping in de databank (migratie) als in de code', () => {
  const sql = readFileSync(new URL('../supabase/migrations/99999999_SYNC_ALL.sql', import.meta.url), 'utf8')
  for (const [oud, nieuw] of Object.entries(SERVICE_SLUG_NAAR_DIENST)) {
    assert.ok(sql.includes(`('service_slug', '${oud}', '${nieuw}', true,`), `service_slug ${oud} → ${nieuw} ontbreekt in de migratie`)
  }
  for (const [oud, nieuw] of Object.entries(OPDRACHT_DIENST_NAAR_CATALOGUS)) {
    assert.ok(sql.includes(`('opdracht', '${oud}', '${nieuw}', true,`), `opdracht ${oud} → ${nieuw} ontbreekt in de migratie`)
  }
  for (const d of STANDAARD_DIENSTEN) assert.ok(sql.includes(`('${d.slug}', '${d.naam.replace(/'/g, "''")}', '${d.bedrijf}'`), `dienst ${d.slug} ontbreekt in de migratie`)
})

test('projectkaart-sleutel terug uit een catalogusdienst', () => {
  assert.equal(opdrachtSleutelVoor('social_media'), 'social_media')
  assert.equal(opdrachtSleutelVoor('websites'), 'webdesign')
  assert.equal(opdrachtSleutelVoor('seo'), 'webdesign')
  assert.equal(opdrachtSleutelVoor('care'), 'ngs')
  assert.equal(opdrachtSleutelVoor('marketingstrategie'), 'consultancy')
})

test('dienst nakijken: naam, bedrijf, eenheid, hoofddienst', () => {
  assert.equal(controleerDienst({ naam: '', bedrijf: MEDIA }, cat).ok, false)
  assert.equal(controleerDienst({ naam: 'Podcast', bedrijf: 'onbekend' }, cat).ok, false)
  assert.equal(controleerDienst({ naam: 'Podcast', bedrijf: MEDIA, eenheid: 'week' as never }, cat).ok, false)
  assert.equal(controleerDienst({ naam: 'Social media', bedrijf: MEDIA }, cat).ok, false, 'dubbele naam')
  const sub = controleerDienst({ naam: 'Landingspagina', bedrijf: MEDIA, parent_slug: 'websites', inbegrepen: 'Eén pagina\n\nContactformulier ' }, cat)
  assert.ok(sub.ok)
  if (sub.ok) {
    assert.equal(sub.waarde.slug, 'landingspagina')
    assert.deepEqual(sub.waarde.inbegrepen, ['Eén pagina', 'Contactformulier'])
    assert.equal(sub.waarde.terugkerend, false)
  }
  assert.equal(controleerDienst({ naam: 'X-sub', bedrijf: SOLUTIONS, parent_slug: 'websites' }, cat).ok, false, 'subdienst van een ander bedrijf')
  assert.equal(controleerDienst({ naam: 'Te diep', bedrijf: MEDIA, parent_slug: 'seo' }, cat).ok, false, 'twee niveaus diep')
  assert.equal(controleerDienst({ naam: 'Websites', bedrijf: MEDIA, parent_slug: 'branding' }, cat, 'websites').ok, false, 'heeft zelf subdiensten')
  const maand = controleerDienst({ naam: 'Hosting', bedrijf: SOLUTIONS, eenheid: 'maand', min_prijs: '49,5', min_marge_pct: 30 }, cat)
  assert.ok(maand.ok && maand.waarde.terugkerend && maand.waarde.min_prijs === 49.5 && maand.waarde.min_marge_pct === 30)
  assert.equal(controleerDienst({ naam: 'Hosting', bedrijf: SOLUTIONS, min_marge_pct: 120 }, cat).ok, false)
})

test('slug uit een naam', () => {
  assert.equal(slugVan('Google & Meta Ads'), 'google_en_meta_ads')
  assert.equal(slugVan('  Éénmalige  shoot '), 'eenmalige_shoot')
})

test('keuze in de wachtrij nakijken', () => {
  assert.equal(controleerKeuze(cat, 'bedrijf', MEDIA), null)
  assert.equal(controleerKeuze(cat, 'bedrijf', ALGEMEEN), null)
  assert.notEqual(controleerKeuze(cat, 'bedrijf', 'iets'), null)
  assert.equal(controleerKeuze(cat, 'dienst', 'care'), null)
  assert.notEqual(controleerKeuze(cat, 'dienst', 'nextgenmedia'), null)
  assert.ok(KLASSIFICATIE_TABELLEN.contracts.metDienst)
  assert.equal(KLASSIFICATIE_TABELLEN.purchases.metDienst, false)
})

test('weergave Alles / Media / Solutions: niets verdwijnt stil', () => {
  assert.equal(pastBijFilter('alles', SOLUTIONS), true)
  assert.equal(pastBijFilter(MEDIA, MEDIA), true)
  assert.equal(pastBijFilter(MEDIA, SOLUTIONS), false)
  assert.equal(pastBijFilter(SOLUTIONS, MEDIA), false)
  assert.equal(pastBijFilter(MEDIA, ALGEMEEN), true, 'algemeen staat in beide')
  assert.equal(pastBijFilter(SOLUTIONS, null), true, 'nog niet geclassificeerd staat in beide')
  assert.equal(isBedrijfFilter('nextgenmedia'), true)
  assert.equal(isBedrijfFilter('algemeen'), false)
})

test('klant bij Media, Solutions of beide', () => {
  assert.deepEqual(klantBedrijven([MEDIA, MEDIA, null, ALGEMEEN]), [MEDIA])
  assert.deepEqual(klantBedrijven([SOLUTIONS, MEDIA]), [MEDIA, SOLUTIONS])
  assert.equal(klantBedrijfLabel([MEDIA, SOLUTIONS]), 'Beide')
  assert.equal(klantBedrijfLabel([SOLUTIONS]), 'Solutions')
  assert.equal(klantBedrijfLabel([]), '')
})

console.log(`\n${n} tests geslaagd\n`)
