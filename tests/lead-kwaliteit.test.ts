// Kwaliteit van outbound leads: telefoon, website, bewijs op de website, oordeel.
//
//   npx tsx tests/lead-kwaliteit.test.ts

import assert from 'node:assert/strict'
import { telefoonBE, websiteNorm, telefoonsInHtml, naamOpSite, contactLink, beoordeel, besteVanGroep, poortNieuweLead } from '../lib/sales/lead-kwaliteit'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
const tel = (v: string) => { const t = telefoonBE(v); return t.geldig ? t.weergave : `✗ ${t.reden}` }

console.log('\nLead-kwaliteit\n')

test('1. Belgische nummers in één notatie (vast, mobiel, landcode, Excel zonder nul)', () => {
  assert.equal(tel('011 26 96 00'), '+32 11 26 96 00')
  assert.equal(tel('09/220.62.00'), '+32 9 220 62 00')
  assert.equal(tel('03/330.17.77'), '+32 3 330 17 77')
  assert.equal(tel('0471/038.855'), '+32 471 03 88 55')
  assert.equal(tel('003216300400'), '+32 16 30 04 00')
  assert.equal(tel('+32 (0)11 26 96 00'), '+32 11 26 96 00')
  assert.equal(tel('479641277'), '+32 479 64 12 77')
  assert.equal(tel('0484 16 12 54'), '+32 484 16 12 54')
})

test('2. Onbruikbaar: leeg, placeholder, te kort/lang, betaalnummer', () => {
  assert.equal(tel(''), '✗ geen telefoonnummer')
  assert.match(tel('0000000000'), /placeholder/)
  assert.match(tel('12345678'), /placeholder/)
  assert.match(tel('011 26 96'), /kort|onherkenbaar/)
  assert.match(tel('0903 12 34 56'), /betaalnummer/)
  assert.match(tel('34'), /onherkenbaar|kort/)
  assert.match(tel('+32 54 31 94 91 09'), /lang/)
  assert.equal(tel('31626762192'), '+31 626762192')
})

test('3. Twee nummers in één cel: het eerste bruikbare telt', () => {
  assert.equal(tel('011 22 33 44 / 0470 12 34 56'), '+32 11 22 33 44')
})

test('4. Website: volledige URL, domein; sociale media en gidsen zijn geen eigen site', () => {
  assert.deepEqual(websiteNorm('www.bedrijf.be/contact'), { geldig: true, url: 'https://www.bedrijf.be', domein: 'bedrijf.be' })
  assert.deepEqual(websiteNorm('http://bedrijf.be'), { geldig: true, url: 'https://bedrijf.be', domein: 'bedrijf.be' })
  assert.equal(websiteNorm('https://www.facebook.com/bedrijf').geldig, false)
  assert.equal(websiteNorm('goudengids.be/bedrijf').geldig, false)
  assert.equal(websiteNorm('info@bedrijf.be').geldig, false)
  assert.equal(websiteNorm('').geldig, false)
})

test('5. Nummers op de website herkennen (tekst, tel:-link, JSON-LD)', () => {
  const html = '<a href="tel:+3211269600">Bel ons</a><p>Tel. 089/35.66.00</p><script type="application/ld+json">{"telephone":"+32 470 12 34 56"}</script>'
  const s = telefoonsInHtml(html)
  assert.ok(s.has('11269600')); assert.ok(s.has('89356600')); assert.ok(s.has('470123456'))
  // Een kapotte tel:-link breekt de controle niet
  assert.ok(telefoonsInHtml('<a href="tel:011%2G26 96 00">x</a> 011 26 96 00').has('11269600'))
})

test('6. Naam op de site of in het domein; contactpagina vinden', () => {
  assert.equal(naamOpSite('Houben nv', '<title>Houben - bouwpartner</title>', 'houben.be'), true)
  assert.equal(naamOpSite('Probuilt', '<title>Iets anders</title>', 'andere.be'), false)
  assert.equal(contactLink('<a href="/nl/contact">Contact</a>', 'https://www.x.be'), 'https://www.x.be/nl/contact')
  assert.equal(contactLink('<a href="https://andere.be/contact">x</a>', 'https://www.x.be'), null)
})

test('7. Oordeel: bewijs vereist, nooit iets verzinnen', () => {
  const t = telefoonBE('011 26 96 00'), w = websiteNorm('houben.be')
  assert.equal(beoordeel({ telefoon: telefoonBE(''), website: w, site: null }).status, 'geen_telefoon')
  assert.equal(beoordeel({ telefoon: t, website: w, site: null, dubbelVan: 'X' }).status, 'dubbel')
  assert.equal(beoordeel({ telefoon: t, website: websiteNorm(''), site: null, vertrouwd: true }).behouden, true)
  assert.equal(beoordeel({ telefoon: t, website: websiteNorm(''), site: null }).status, 'geen_website')
  assert.equal(beoordeel({ telefoon: t, website: w, site: { bereikbaar: false, telefoonOpSite: false, naamOpSite: false, fout: 'DNS' } }).status, 'website_onbereikbaar')
  assert.equal(beoordeel({ telefoon: t, website: w, site: { bereikbaar: true, telefoonOpSite: true, naamOpSite: true } }).status, 'geverifieerd')
  assert.equal(beoordeel({ telefoon: t, website: w, site: { bereikbaar: true, telefoonOpSite: false, naamOpSite: true } }).status, 'niet_verifieerbaar')
})

test('8. Bij duplicaten blijft de beste versie', () => {
  const g = [
    { id: 'a', stage_key: 'outbound', heeftHistoriek: false, geverifieerd: false, volledigheid: 5, created_at: '2026-01-01' },
    { id: 'b', stage_key: 'outbound', heeftHistoriek: false, geverifieerd: true, volledigheid: 3, created_at: '2026-02-01' },
    { id: 'c', stage_key: 'gebeld', heeftHistoriek: true, geverifieerd: false, volledigheid: 1, created_at: '2026-03-01' },
  ]
  assert.equal(besteVanGroep(g).id, 'c')
  assert.equal(besteVanGroep(g.slice(0, 2)).id, 'b')
})

test('9. Poort voor nieuwe leads: telefoon verplicht, website genormaliseerd of weggelaten', () => {
  assert.deepEqual(poortNieuweLead({ bedrijfTelefoon: '', contactTelefoon: '34', website: 'x.be' }), { ok: false, reden: 'onherkenbaar telefoonnummer' })
  assert.deepEqual(poortNieuweLead({}), { ok: false, reden: 'geen telefoonnummer' })
  const p = poortNieuweLead({ bedrijfTelefoon: '', contactGsm: '0470/12.34.56', website: 'www.bedrijf.be/contact' })
  assert.ok(p.ok && p.bron === 'gsm' && p.telefoon.weergave === '+32 470 12 34 56' && p.website === 'https://www.bedrijf.be' && p.websiteWeg === null)
  const f = poortNieuweLead({ bedrijfTelefoon: '011 26 96 00', website: 'facebook.com/bedrijf' })
  assert.ok(f.ok && f.website === null && /sociale media/.test(f.websiteWeg ?? ''))
})

console.log(`\n${n} tests geslaagd\n`)
