// Instagram-miniatuur en -video uit de embedpagina lezen (Founders of Flanders).
//
//   npx tsx tests/instagram-media.test.ts

import assert from 'node:assert/strict'
import { leesEmbedPagina, embedPaginaUrl, isInstagramCdn } from '../lib/instagram-media'
import { ontbrekendeMedia } from '../lib/founders-media-server'
import { foundersMediaUrl } from '../lib/founders-of-flanders'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nInstagram-video in de eigen speler\n')

// Zo staat het in de echte embedpagina (een JSON-tekst in een script, dubbel ge-escaped).
const PAGINA = String.raw`<html><body><div class="Embed"><img class="EmbeddedMediaImage" alt="Reel" src="https://scontent-lhr6-1.cdninstagram.com/v/t51.82787-15/856566466_n.jpg?stp=dst-jpg_e15_tt6&amp;_nc_cat=109&amp;oe=6AED470A" /></div>
<script>window.__x = "{\"edge_liked_by\":{\"count\":39}},\"video_url\":\"https:\\\/\\\/scontent-lhr11-1.cdninstagram.com\\\/o1\\\/v\\\/t2\\\/f2\\\/m86\\\/AQOLeB.mp4?_nc_cat=110&_nc_sid=5e9851&efg=eyJ2ZW5j\\u00253D&ccb=17-1&vs=9be34e\",\"video_view_count\":10}"</script></body></html>`

test('1. Miniatuur en video uit de embedpagina, links netjes leesbaar', () => {
  const r = leesEmbedPagina(PAGINA)
  assert.equal(r.poster, 'https://scontent-lhr6-1.cdninstagram.com/v/t51.82787-15/856566466_n.jpg?stp=dst-jpg_e15_tt6&_nc_cat=109&oe=6AED470A')
  assert.equal(r.video, 'https://scontent-lhr11-1.cdninstagram.com/o1/v/t2/f2/m86/AQOLeB.mp4?_nc_cat=110&_nc_sid=5e9851&efg=eyJ2ZW5j%3D&ccb=17-1&vs=9be34e')
})

test('2. Enkel het CDN van Instagram/Meta; een foto-post zonder video geeft enkel de miniatuur', () => {
  assert.equal(isInstagramCdn('https://evil.com/x.mp4'), false)
  assert.equal(isInstagramCdn('http://scontent.cdninstagram.com/x.mp4'), false, 'enkel https')
  assert.equal(isInstagramCdn('https://video.xx.fbcdn.net/x.mp4'), true)
  const foto = leesEmbedPagina('<img src="https://scontent.cdninstagram.com/a.jpg" class="EmbeddedMediaImage">')
  assert.deepEqual(foto, { poster: 'https://scontent.cdninstagram.com/a.jpg', video: null })
  assert.deepEqual(leesEmbedPagina('<img class="EmbeddedMediaImage" src="https://evil.com/a.jpg"> "video_url":"https://evil.com/v.mp4"'), { poster: null, video: null })
  assert.deepEqual(leesEmbedPagina('<html>login</html>'), { poster: null, video: null })
})

test('3. De embedpagina van posts, reels en /reels/', () => {
  assert.equal(embedPaginaUrl('https://www.instagram.com/reel/DetXPGNkfwl/'), 'https://www.instagram.com/reel/DetXPGNkfwl/embed/captioned/')
  assert.equal(embedPaginaUrl('https://www.instagram.com/p/Delo0J4gDKt/'), 'https://www.instagram.com/p/Delo0J4gDKt/embed/captioned/')
  assert.equal(embedPaginaUrl('https://instagram.com/reels/DfCEW-9ghno/?igsh=x'), 'https://www.instagram.com/reel/DfCEW-9ghno/embed/captioned/')
  assert.equal(embedPaginaUrl('https://www.facebook.com/reel/1'), null)
})

test('4. Welke video\'s moeten nog opgehaald worden (niet dubbel, mislukt pas na een half uur opnieuw)', () => {
  const nu = new Date('2026-11-01T18:00:00Z')
  const ig = { provider: 'instagram', url: 'https://www.instagram.com/reel/A1b2C3d4E5/' }
  const ids = ontbrekendeMedia([
    { id: 'a', embed: ig },
    { id: 'b', embed: ig, media_video_pad: 'founders/x/y.mp4', media_status: 'ok' },
    { id: 'c', embed: ig, media_status: 'bezig', media_bezig_sinds: '2026-11-01T17:58:00Z' },
    { id: 'd', embed: ig, media_status: 'bezig', media_bezig_sinds: '2026-11-01T17:40:00Z' },
    { id: 'e', embed: ig, media_status: 'mislukt', media_opgehaald_op: '2026-11-01T17:50:00Z' },
    { id: 'f', embed: ig, media_status: 'mislukt', media_opgehaald_op: '2026-11-01T17:00:00Z' },
    { id: 'g', embed: null, youtube_id: 'dQw4w9WgXcQ' },
  ], nu)
  assert.deepEqual(ids, ['a', 'd', 'f'])
})

test('5. Enkel onze eigen paden worden een publieke link', () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
  const id = '98c9c73b-e71a-40ec-bf03-15326f95f1d1', f = '0f8c1e2a-1b2c-4d5e-8f90-123456789abc'
  assert.equal(foundersMediaUrl(`founders/${id}/${f}.mp4`), `https://proj.supabase.co/storage/v1/object/public/founders-media/founders/${id}/${f}.mp4`)
  assert.equal(foundersMediaUrl('../geheim.mp4'), null)
  assert.equal(foundersMediaUrl(null), null)
})

console.log(`\n${n} tests geslaagd\n`)
