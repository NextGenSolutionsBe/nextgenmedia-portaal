// Content voor klanten: YouTube, nieuwsbrieven (blokken, opmaak, mail), partners,
// Founders of Flanders en de founders-soort in Aanvragen.
//
//   npx tsx tests/content-modules.test.ts

import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
import { youtubeId, youtubeEmbedUrl } from '../lib/youtube'
import { valideerNieuwsbrief, valideerBlokken, leesTekst, leesInline, maakSlug, leestijd, klaarVoorPublicatie } from '../lib/nieuwsbrieven'
import { bouwNieuwsbriefMail } from '../lib/nieuwsbrief-mail'
import { normaliseerLink, valideerPartner } from '../lib/partners'
import { valideerFoundersVideo } from '../lib/founders-of-flanders'
import { geldigPad, nieuwPad, publiekeUrl } from '../lib/marketing-media'
import { catalogus, valideerAanvraag, clickupNaam, isSoort } from '../lib/aanvragen/model'
import { moduleVoor, soortUit } from '../lib/aanvragen/portaal'
import { PORTAL_MODULES, STANDAARD_AAN, MODULE_IMPLEMENTED } from '../lib/portal-permissions'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nContent voor klanten\n')
const pad = nieuwPad('nieuws', 'image/jpeg', '11111111-1111-4111-8111-111111111111', new Date('2026-10-31'))

test('1. YouTube: link, korte link, Shorts, embedcode en kale id; al het andere niet', () => {
  for (const v of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?t=3', 'youtube.com/shorts/dQw4w9WgXcQ', '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" allowfullscreen></iframe>', 'dQw4w9WgXcQ', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share'])
    assert.equal(youtubeId(v), 'dQw4w9WgXcQ', v)
  for (const v of ['', 'https://vimeo.com/123', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'te-kort']) assert.equal(youtubeId(v), null, v)
  assert.match(youtubeEmbedUrl('dQw4w9WgXcQ'), /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/)
})

test('2. Afbeeldingen: enkel paden die wij uitgaven, in de juiste map, met een publieke URL', () => {
  assert.equal(pad, 'nieuws/2026-10/11111111-1111-4111-8111-111111111111.jpg')
  assert.equal(geldigPad(pad, 'nieuws'), true)
  assert.equal(geldigPad(pad, 'partners'), false)
  assert.equal(geldigPad('../geheim.pdf', 'nieuws'), false)
  assert.equal(publiekeUrl(pad), 'https://proj.supabase.co/storage/v1/object/public/marketing/nieuws/2026-10/11111111-1111-4111-8111-111111111111.jpg')
})

test('3. Nieuwsbrief: titel en categorie verplicht; lege blokken vallen weg; video via YouTube-link', () => {
  assert.equal(valideerNieuwsbrief({ titel: 'x', categorie: 'tips' }).ok, false)
  assert.equal(valideerNieuwsbrief({ titel: 'Goede titel', categorie: 'bestaat-niet' }).ok, false)
  const v = valideerNieuwsbrief({ titel: 'Zo kreeg Bakkerij Peeters meer bereik', categorie: 'projecten', blokken: [
    { id: 'aaaa1', type: 'tekst', tekst: '  ' }, { id: 'aaaa2', type: 'kop', tekst: 'Het resultaat' }, { id: 'aaaa3', type: 'video', youtube_id: 'https://youtu.be/dQw4w9WgXcQ', onderschrift: '' },
    { id: 'aaaa4', type: 'afbeelding', pad, onderschrift: 'De nieuwe etalage' }, { id: 'aaaa5', type: 'knop', tekst: '', url: '' },
  ] })
  assert.ok(v.ok)
  if (v.ok) {
    assert.deepEqual(v.waarde.blokken.map((b) => b.type), ['kop', 'video', 'afbeelding'])
    assert.equal((v.waarde.blokken[1] as { youtube_id: string }).youtube_id, 'dQw4w9WgXcQ')
  }
  assert.match((valideerBlokken([{ type: 'video', youtube_id: 'https://vimeo.com/1' }]) as { fout: string }).fout, /YouTube/)
  assert.match((valideerBlokken([{ type: 'afbeelding', pad: 'partners/2026-10/11111111-1111-4111-8111-111111111111.jpg' }]) as { fout: string }).fout, /opnieuw/)
  assert.match((valideerBlokken([{ type: 'knop', tekst: 'Klik', url: 'javascript:alert(1)' }]) as { fout: string }).fout, /geldige link/)
  assert.equal(klaarVoorPublicatie({ titel: 'Leeg', blokken: [], samenvatting: null }) !== null, true, 'leeg verhaal niet publiceren')
})

test('4. Tekstopmaak: vet, cursief, links (enkel http/https) en lijstjes', () => {
  assert.deepEqual(leesInline('Dit is **vet** en *schuin* met [een link](https://nextgenmedia.be).'), [
    { t: 'tekst', s: 'Dit is ' }, { t: 'vet', s: 'vet' }, { t: 'tekst', s: ' en ' }, { t: 'cursief', s: 'schuin' }, { t: 'tekst', s: ' met ' }, { t: 'link', s: 'een link', url: 'https://nextgenmedia.be' }, { t: 'tekst', s: '.' },
  ])
  assert.deepEqual(leesInline('[x](javascript:alert(1))'), [{ t: 'tekst', s: '[x](javascript:alert(1))' }], 'geen javascript-links')
  const a = leesTekst('Eerste alinea.\n\n- punt een\n- punt twee\n\nLaatste')
  assert.deepEqual(a.map((x) => x.soort), ['p', 'lijst', 'p'])
})

test('5. Slug en leestijd', () => {
  assert.equal(maakSlug('Café “De Kroon” & 3x meer bereik!'), 'cafe-de-kroon-3x-meer-bereik')
  assert.equal(leestijd({ samenvatting: null, blokken: [{ id: 'a', type: 'tekst', tekst: 'woord '.repeat(600) }, { id: 'b', type: 'video', youtube_id: 'dQw4w9WgXcQ', onderschrift: '' }] }), 5)
})

test('6. Mail: alles geëscapet, video als link naar YouTube, lezen in de klantapp en afmelden', () => {
  const m = bouwNieuwsbriefMail({ titel: 'Nieuw <b>project</b>', categorie: 'projecten', samenvatting: 'Kort & krachtig', cover_pad: pad, cover_youtube_id: null, blokken: [
    { id: 'a', type: 'tekst', tekst: 'Hallo <script>x</script> **vet**' }, { id: 'b', type: 'video', youtube_id: 'dQw4w9WgXcQ', onderschrift: 'Aftermovie' },
  ] }, { appLink: 'https://app.nextgenmedia.be/portal/nieuws/nieuw-project', afmeldLink: 'https://app.nextgenmedia.be/nieuwsbrief/afmelden?e=a%40b.be&t=x' })
  assert.equal(m.html.includes('<script>'), false)
  assert.match(m.html, /Nieuw &lt;b&gt;project&lt;\/b&gt;/)
  assert.match(m.html, /<strong>vet<\/strong>/)
  assert.match(m.html, /https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ/)
  assert.match(m.html, /Lees verder in je klantapp/)
  assert.match(m.html, /nieuwsbrief\/afmelden\?e=a%40b\.be&amp;t=x/)
  assert.match(m.tekst, /Afmelden: https:\/\/app\.nextgenmedia\.be\/nieuwsbrief\/afmelden/)
})

test('7. Partnerlinks: @naam wordt een profiel, socials enkel op hun eigen domein, http wordt https', () => {
  assert.deepEqual(normaliseerLink('instagram', '@nextgenmedia'), { ok: true, waarde: 'https://www.instagram.com/nextgenmedia' })
  assert.deepEqual(normaliseerLink('tiktok', 'nextgenmedia'), { ok: true, waarde: 'https://www.tiktok.com/@nextgenmedia' })
  assert.deepEqual(normaliseerLink('website', 'nextgenmedia.be'), { ok: true, waarde: 'https://nextgenmedia.be/' })
  assert.deepEqual(normaliseerLink('facebook', 'http://facebook.com/ngm'), { ok: true, waarde: 'https://facebook.com/ngm' })
  assert.equal(normaliseerLink('linkedin', 'https://evil.com/linkedin').ok, false)
  assert.deepEqual(normaliseerLink('youtube', ''), { ok: true, waarde: null })
  assert.equal(valideerPartner({ naam: '' }).ok, false)
  assert.equal(valideerPartner({ naam: 'NextGen Solutions', logo_pad: '../x.png' }).ok, false)
  assert.ok(valideerPartner({ naam: 'NextGen Solutions', instagram: '@ngs' }).ok)
})

test('8. Founders of Flanders: YouTube-link en titel verplicht', () => {
  assert.equal(valideerFoundersVideo({ titel: 'Test', youtube: 'https://vimeo.com/1' }).ok, false)
  assert.equal(valideerFoundersVideo({ titel: '', youtube: 'https://youtu.be/dQw4w9WgXcQ' }).ok, false)
  const v = valideerFoundersVideo({ titel: 'Van garage tot 20 man', youtube: 'https://youtu.be/dQw4w9WgXcQ', ondernemer: 'Jan' })
  assert.ok(v.ok && v.waarde.youtube_id === 'dQw4w9WgXcQ')
})

test('9. Founders-aanvraag: eigen soort, module en ClickUp-naam; datum verplicht zoals elke aanvraag', () => {
  assert.equal(isSoort('founders'), true)
  assert.equal(soortUit('founders'), 'founders')
  assert.equal(moduleVoor('founders'), 'founders')
  assert.deepEqual(catalogus('founders').map((t) => t.key), ['founder_video'])
  assert.equal(clickupNaam('founders', 'Bakkerij Peeters', 'Founder video'), 'Founders aanvraag – Bakkerij Peeters – Founder video')
  const vandaag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
  assert.equal(valideerAanvraag({ soort: 'founders', type: 'founder_video', wat: 'Mijn verhaal als ondernemer' }, vandaag).ok, false)
  assert.ok(valideerAanvraag({ soort: 'founders', type: 'founder_video', wat: 'Mijn verhaal als ondernemer', periode_van: vandaag, antwoorden: { wie: 'ik' } }, vandaag).ok)
})

test('10. Klantapp-modules Founders en Onze partners werken en staan standaard aan; Nieuws bestaat maar is verborgen (2 nov 2026)', () => {
  for (const m of ['founders', 'nieuws', 'partners'] as const) {
    assert.ok((PORTAL_MODULES as readonly string[]).includes(m), m)
    assert.ok(STANDAARD_AAN.includes(m), m)
  }
  assert.equal(MODULE_IMPLEMENTED.founders, true)
  assert.equal(MODULE_IMPLEMENTED.partners, true)
  assert.equal(MODULE_IMPLEMENTED.nieuws, false, 'op vraag verborgen: geen marketing in de app')
})

console.log(`\n${n} tests geslaagd\n`)
