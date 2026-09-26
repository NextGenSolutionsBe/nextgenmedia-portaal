// Tests voor het formulierenmodel (pure logica).
// Uitvoeren: npx tsx tests/formulieren.test.ts
import assert from 'node:assert/strict'
import {
  normaliseerVelden, valideerAntwoorden, isZichtbaar, nieuwVeld, voegVeldenSamen, SJABLONEN, VELD_TYPES,
  linkStatusVan, bestandExtensie, padHoortBij, bouwBestandPad, haalContactUit, alsTekst, normaliseerInstellingen,
  MAX_VELDEN, type Veld,
} from '../lib/formulieren/model'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }

console.log('Formulieren — normaliseren')

test('onbekende types en rommel vallen weg', () => {
  const v = normaliseerVelden([{ type: 'kort', label: 'Naam' }, { type: 'bestaatniet', label: 'x' }, null, 'tekst', 42, { label: 'geen type' }])
  assert.equal(v.length, 1)
  assert.equal(v[0].id, 'naam')
})

test('aliassen van AI worden vertaald', () => {
  const v = normaliseerVelden([{ type: 'textarea', label: 'Omschrijving' }, { type: 'select', label: 'Budget', options: ['A', 'B'] }, { type: 'color', label: 'Kleur' }, { type: 'file', label: 'Logo' }])
  assert.deepEqual(v.map((x) => x.type), ['lang', 'dropdown', 'kleur', 'bestand'])
  assert.deepEqual(v[1].opties, ['A', 'B'])
})

test('ids zijn uniek en stabiel', () => {
  const v = normaliseerVelden([{ type: 'kort', label: 'Naam' }, { type: 'kort', label: 'Naam' }, { type: 'kort', id: 'naam', label: 'Iets' }])
  assert.deepEqual(v.map((x) => x.id), ['naam', 'naam_2', 'naam_3'])
  const opnieuw = normaliseerVelden(v)
  assert.deepEqual(opnieuw.map((x) => x.id), ['naam', 'naam_2', 'naam_3'], 'tweede keer normaliseren wijzigt niets')
})

test('lengtes worden ingekort en max 80 velden', () => {
  const lang = 'x'.repeat(5000)
  const v = normaliseerVelden(Array.from({ length: 120 }, (_, i) => ({ type: 'kort', label: `${lang}${i}` })))
  assert.equal(v.length, MAX_VELDEN)
  assert.ok(v[0].label.length <= 200)
  assert.ok(v[0].id.length <= 60)
})

test('keuzevelden krijgen altijd opties, zonder dubbels', () => {
  const v = normaliseerVelden([{ type: 'keuze', label: 'K' }, { type: 'meerkeuze', label: 'M', opties: ['a', 'A', ' b ', '', 'c'] }])
  assert.deepEqual(v[0].opties, ['Optie 1', 'Optie 2'])
  assert.deepEqual(v[1].opties, ['a', 'b', 'c'])
})

test('sectie en uitleg zijn nooit verplicht', () => {
  const v = normaliseerVelden([{ type: 'sectie', label: 'Kop', verplicht: true }, { type: 'uitleg', hulptekst: 'Tekst', verplicht: true }])
  assert.equal(v[0].verplicht, false)
  assert.equal(v[1].verplicht, false)
  assert.equal(v[1].hulptekst, 'Tekst')
})

test('schaal, bestand en getal worden begrensd', () => {
  const v = normaliseerVelden([{ type: 'schaal', label: 'S', max: 99 }, { type: 'bestand', label: 'B', max: 50 }, { type: 'getal', label: 'G', min: 10, max: 1 }])
  assert.equal(v[0].max, 10); assert.equal(v[0].min, 1)
  assert.equal(v[1].max, 5)
  assert.equal(v[2].min, 1); assert.equal(v[2].max, 10)
})

test('voorwaarden enkel naar een eerder, geschikt veld', () => {
  const v = normaliseerVelden([
    { id: 'a', type: 'jaNee', label: 'A' },
    { id: 'b', type: 'kort', label: 'B', voorwaarde: { veld: 'a', waarde: 'ja' } },
    { id: 'c', type: 'kort', label: 'C', voorwaarde: { veld: 'd', waarde: 'x' } },   // naar later veld
    { id: 'd', type: 'kort', label: 'D', voorwaarde: { veld: 'd', waarde: 'x' } },   // naar zichzelf
    { id: 'e', type: 'sectie', label: 'E' },
    { id: 'f', type: 'kort', label: 'F', voorwaarde: { veld: 'e', waarde: 'x' } },   // sectie kan geen bron zijn
    { id: 'g', type: 'kort', label: 'G', voorwaarde: { veld: 'zzz', waarde: 'x' } }, // onbestaand
  ])
  assert.deepEqual(v[1].voorwaarde, { veld: 'a', waarde: 'ja' })
  assert.equal(v[2].voorwaarde, undefined)
  assert.equal(v[3].voorwaarde, undefined)
  assert.equal(v[5].voorwaarde, undefined)
  assert.equal(v[6].voorwaarde, undefined)
})

test('voorwaarde volgt een hernoemde id', () => {
  const v = normaliseerVelden([{ id: 'Heeft logo?', type: 'jaNee', label: 'Logo' }, { type: 'bestand', label: 'Upload', voorwaarde: { veld: 'Heeft logo?', waarde: 'ja' } }])
  assert.equal(v[0].id, 'heeft_logo')
  assert.deepEqual(v[1].voorwaarde, { veld: 'heeft_logo', waarde: 'ja' })
})

test('accepteert ook { velden: [...] }', () => {
  assert.equal(normaliseerVelden({ velden: [{ type: 'email', label: 'Mail' }] }).length, 1)
  assert.equal(normaliseerVelden('onzin').length, 0)
})

test('nieuwVeld: elk type geeft een geldig veld met unieke id', () => {
  const ids: string[] = []
  for (const t of VELD_TYPES) {
    const v = nieuwVeld(t, ids)
    assert.ok(!ids.includes(v.id)); ids.push(v.id)
    assert.equal(normaliseerVelden([v])[0].type, t)
  }
})

test('voegVeldenSamen hernoemt botsende ids incl. eigen voorwaarden', () => {
  const bestaand = normaliseerVelden([{ id: 'logo', type: 'jaNee', label: 'Logo?' }])
  const extra = normaliseerVelden([{ id: 'logo', type: 'jaNee', label: 'Logo nieuw?' }, { id: 'upload', type: 'bestand', label: 'Upload', voorwaarde: { veld: 'logo', waarde: 'ja' } }])
  const samen = voegVeldenSamen(bestaand, extra)
  assert.deepEqual(samen.map((x) => x.id), ['logo', 'logo_2', 'upload'])
  assert.deepEqual(samen[2].voorwaarde, { veld: 'logo_2', waarde: 'ja' })
})

console.log('Formulieren — valideren')

const velden: Veld[] = normaliseerVelden([
  { id: 'naam', type: 'kort', label: 'Naam', verplicht: true },
  { id: 'mail', type: 'email', label: 'E-mail', verplicht: true },
  { id: 'tel', type: 'telefoon', label: 'Tel' },
  { id: 'site', type: 'url', label: 'Site' },
  { id: 'aantal', type: 'getal', label: 'Aantal', min: 1, max: 10 },
  { id: 'dag', type: 'datum', label: 'Dag' },
  { id: 'kies', type: 'keuze', label: 'Kies', opties: ['A', 'B'] },
  { id: 'meer', type: 'meerkeuze', label: 'Meer', opties: ['X', 'Y', 'Z'] },
  { id: 'logo', type: 'jaNee', label: 'Logo?', verplicht: true },
  { id: 'upload', type: 'bestand', label: 'Upload', verplicht: true, max: 2, voorwaarde: { veld: 'logo', waarde: 'ja' } },
  { id: 'score', type: 'schaal', label: 'Score', max: 5 },
  { id: 'kleur', type: 'kleur', label: 'Kleur', max: 2 },
  { id: 'kop', type: 'sectie', label: 'Kop' },
])

test('verplichte velden', () => {
  const r = valideerAntwoorden(velden, {})
  assert.equal(r.ok, false)
  assert.ok(r.fouten.naam && r.fouten.mail && r.fouten.logo)
  assert.equal(r.fouten.upload, undefined, 'verborgen veld is niet verplicht')
})

test('formaten e-mail, url, telefoon, getal, datum', () => {
  const r = valideerAntwoorden(velden, { naam: 'Jan', mail: 'geen-mail', tel: 'abc', site: 'niet een url', aantal: '50', dag: '2026-02-30', logo: 'nee' })
  assert.ok(r.fouten.mail); assert.ok(r.fouten.tel); assert.ok(r.fouten.site); assert.ok(r.fouten.aantal); assert.ok(r.fouten.dag)
  const ok = valideerAntwoorden(velden, { naam: ' Jan ', mail: 'Jan@Bedrijf.BE', tel: '+32 470 12 34 56', site: 'www.bedrijf.be', aantal: '3,5', dag: '2026-09-22', logo: 'nee' })
  assert.equal(ok.ok, true, JSON.stringify(ok.fouten))
  assert.equal(ok.schoon.naam, 'Jan')
  assert.equal(ok.schoon.mail, 'jan@bedrijf.be')
  assert.equal(ok.schoon.site, 'https://www.bedrijf.be')
  assert.equal(ok.schoon.aantal, 3.5)
})

test('opties moeten toegestaan zijn', () => {
  const r = valideerAntwoorden(velden, { naam: 'J', mail: 'j@b.be', logo: 'nee', kies: 'C', meer: ['X', 'Q'] })
  assert.ok(r.fouten.kies); assert.ok(r.fouten.meer)
  const ok = valideerAntwoorden(velden, { naam: 'J', mail: 'j@b.be', logo: 'nee', kies: 'B', meer: ['Z', 'X'] })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.schoon.meer, ['X', 'Z'], 'volgorde van de opties')
})

test('voorwaarde: verborgen antwoorden worden weggelaten', () => {
  const r = valideerAntwoorden(velden, { naam: 'J', mail: 'j@b.be', logo: 'nee', upload: [{ pad: 'f/l/x.png', naam: 'x.png', grootte: 10 }] })
  assert.equal(r.ok, true)
  assert.equal(r.schoon.upload, undefined)
})

test('voorwaarde: zichtbaar veld wordt verplicht', () => {
  const r = valideerAntwoorden(velden, { naam: 'J', mail: 'j@b.be', logo: 'ja' })
  assert.ok(r.fouten.upload)
})

test('bestanden: prefix, aantal en type', () => {
  const basis = { naam: 'J', mail: 'j@b.be', logo: 'ja' }
  const vreemd = valideerAntwoorden(velden, { ...basis, upload: [{ pad: 'ander/l/x.png', naam: 'x.png', grootte: 1 }] }, { padPrefix: 'f1/l1/' })
  assert.ok(vreemd.fouten.upload)
  const teveel = valideerAntwoorden(velden, { ...basis, upload: [1, 2, 3].map((i) => ({ pad: `f1/l1/${i}.png`, naam: 'x', grootte: 1 })) }, { padPrefix: 'f1/l1/' })
  assert.ok(teveel.fouten.upload)
  const exe = valideerAntwoorden(velden, { ...basis, upload: [{ pad: 'f1/l1/x.exe', naam: 'x.exe', grootte: 1 }] }, { padPrefix: 'f1/l1/' })
  assert.ok(exe.fouten.upload)
  const ok = valideerAntwoorden(velden, { ...basis, upload: [{ pad: 'f1/l1/a.pdf', naam: 'brief.pdf', grootte: 1000, type: 'application/pdf' }] }, { padPrefix: 'f1/l1/' })
  assert.equal(ok.ok, true, JSON.stringify(ok.fouten))
})

test('schaal en kleur', () => {
  const basis = { naam: 'J', mail: 'j@b.be', logo: 'nee' }
  assert.ok(valideerAntwoorden(velden, { ...basis, score: 6 }).fouten.score)
  assert.ok(valideerAntwoorden(velden, { ...basis, kleur: ['#zzzzzz'] }).fouten.kleur)
  assert.ok(valideerAntwoorden(velden, { ...basis, kleur: ['#000000', '#111111', '#222222'] }).fouten.kleur)
  const ok = valideerAntwoorden(velden, { ...basis, score: '4', kleur: ['#FFF848'] })
  assert.equal(ok.ok, true)
  assert.equal(ok.schoon.score, 4)
  assert.deepEqual(ok.schoon.kleur, ['#fff848'])
})

test('isZichtbaar: keten van voorwaarden', () => {
  const k = normaliseerVelden([
    { id: 'a', type: 'jaNee', label: 'A' },
    { id: 'b', type: 'keuze', label: 'B', opties: ['x', 'y'], voorwaarde: { veld: 'a', waarde: 'ja' } },
    { id: 'c', type: 'kort', label: 'C', voorwaarde: { veld: 'b', waarde: 'x' } },
  ])
  assert.equal(isZichtbaar(k[2], k, { a: 'ja', b: 'x' }), true)
  assert.equal(isZichtbaar(k[2], k, { a: 'nee', b: 'x' }), false, 'bron verborgen → ook afhankelijke verborgen')
})

console.log('Formulieren — sjablonen, links, bestanden')

test('sjablonen zijn geldig en overleven normaliseren ongewijzigd', () => {
  assert.equal(SJABLONEN.length, 3)
  for (const s of SJABLONEN) {
    const norm = normaliseerVelden(s.velden)
    assert.equal(norm.length, s.velden.length, s.key)
    assert.deepEqual(norm.map((x) => x.id), s.velden.map((x) => x.id), s.key)
    assert.deepEqual(norm.map((x) => x.voorwaarde ?? null), s.velden.map((x) => x.voorwaarde ?? null), `${s.key}: voorwaarden blijven`)
    const leeg = valideerAntwoorden(norm, {})
    assert.equal(leeg.ok, false, `${s.key} heeft verplichte velden`)
  }
  assert.ok(SJABLONEN[0].velden.some((x) => x.type === 'kleur'))
  assert.ok(SJABLONEN[0].velden.some((x) => x.type === 'bestand'))
})

test('linkStatusVan', () => {
  const nu = new Date('2026-09-22T12:00:00Z')
  const f = { status: 'actief', gearchiveerd_op: null, instellingen: {} }
  assert.equal(linkStatusVan(null, f, 0, nu), 'onbekend')
  assert.equal(linkStatusVan({ ingetrokken_op: '2026-09-01' }, f, 0, nu), 'ingetrokken')
  assert.equal(linkStatusVan({ verloopt_op: '2026-09-21T00:00:00Z' }, f, 0, nu), 'verlopen')
  assert.equal(linkStatusVan({}, { ...f, status: 'concept' }, 0, nu), 'gesloten')
  assert.equal(linkStatusVan({}, { ...f, gearchiveerd_op: '2026-09-01' }, 0, nu), 'gesloten')
  assert.equal(linkStatusVan({ eenmalig: true }, f, 1, nu), 'gebruikt')
  assert.equal(linkStatusVan({}, { ...f, instellingen: { meerdere_inzendingen: false } }, 1, nu), 'gebruikt')
  assert.equal(linkStatusVan({ eenmalig: false, verloopt_op: '2026-10-01T00:00:00Z' }, f, 5, nu), 'ok')
})

test('bestandExtensie en paden', () => {
  assert.equal(bestandExtensie('logo.AI', ''), 'ai')
  assert.equal(bestandExtensie('logo.eps', 'application/octet-stream'), 'eps')
  assert.equal(bestandExtensie('foto.jpg', 'image/jpeg'), 'jpg')
  assert.equal(bestandExtensie('foto.jpg', 'application/x-msdownload'), null)
  assert.equal(bestandExtensie('virus.exe', ''), null)
  assert.equal(bestandExtensie('geen-extensie', 'image/png'), null)
  const pad = bouwBestandPad('f1', 'l1', 'u1', 'png')
  assert.equal(pad, 'f1/l1/u1.png')
  assert.equal(padHoortBij(pad, 'f1', 'l1'), true)
  assert.equal(padHoortBij(pad, 'f1', 'l2'), false)
  assert.equal(padHoortBij('f1/l1/../x.png', 'f1', 'l1'), false)
})

test('contact, tekst en instellingen', () => {
  const s = SJABLONEN[0]
  const c = haalContactUit(s.velden, { bedrijfsnaam: 'Bakkerij Jan', contactpersoon: 'Jan Peeters', email: 'jan@bakkerij.be' })
  assert.deepEqual(c, { naam: 'Jan Peeters', email: 'jan@bakkerij.be' })
  const c2 = haalContactUit(s.velden, { bedrijfsnaam: 'Bakkerij Jan' })
  assert.deepEqual(c2, { naam: 'Bakkerij Jan', email: null })
  const t = alsTekst(s.velden, { bedrijfsnaam: 'Bakkerij Jan', uitstraling: ['Modern', 'Luxe'], heeft_logo: 'nee' })
  assert.ok(t.includes('Bedrijfsnaam: Bakkerij Jan'))
  assert.ok(t.includes('Modern, Luxe'))
  assert.ok(t.includes('Heb je al een logo?: Nee'))
  const i = normaliseerInstellingen({ knop_tekst: '  ', meerdere_inzendingen: false, bedankt_tekst: 'Top!' })
  assert.deepEqual(i, { knop_tekst: 'Versturen', meerdere_inzendingen: false, bedankt_tekst: 'Top!' })
})

console.log(`\n${n} tests geslaagd`)
