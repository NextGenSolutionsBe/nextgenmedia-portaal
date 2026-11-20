// Social posts insluiten: herkennen, veilige iframe-links, staand/liggend, en
// de nieuwsbrief met eigen categorie, staande video en ingesloten post.
//
//   npx tsx tests/embeds.test.ts

import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
import { herkenEmbed, embedSrc, valideerEmbed } from '../lib/embeds'
import { valideerNieuwsbrief, categorieLabel } from '../lib/nieuwsbrieven'
import { valideerFoundersVideo, valideerKanaal } from '../lib/founders-of-flanders'
import { bouwNieuwsbriefMail } from '../lib/nieuwsbrief-mail'

let n = 0
const test = (naam: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nSocial posts en staande video\'s\n')
const ok = (v: ReturnType<typeof herkenEmbed>) => { assert.ok(v.ok, JSON.stringify(v)); return (v as { embed: NonNullable<ReturnType<typeof valideerEmbed>> }).embed }

test('1. Instagram: reel-link, post-link en de officiële embedcode; reel staand, post vierkant', () => {
  const reel = ok(herkenEmbed('https://www.instagram.com/reel/C9xYzAbCdEf/?igsh=abc'))
  assert.deepEqual(reel, { provider: 'instagram', url: 'https://www.instagram.com/reel/C9xYzAbCdEf/', formaat: 'staand' })
  assert.equal(embedSrc(reel), 'https://www.instagram.com/reel/C9xYzAbCdEf/embed/')
  const code = '<blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/p/Cabc123XYZ/?utm_source=ig_embed&amp;utm_campaign=loading" data-instgrm-version="14"><a href="https://www.instagram.com/p/Cabc123XYZ/">x</a></blockquote><script async src="//www.instagram.com/embed.js"></script>'
  const post = ok(herkenEmbed(code))
  assert.equal(post.url, 'https://www.instagram.com/p/Cabc123XYZ/')
  assert.equal(post.formaat, 'vierkant')
  assert.equal(embedSrc(post), 'https://www.instagram.com/p/Cabc123XYZ/embed/captioned/')
  assert.equal(ok(herkenEmbed('instagram.com/nextgenmedia/reel/C9xYzAbCdEf')).formaat, 'staand')
})

test('2. Facebook: post, video en reel, ook via de plugin-embedcode; nooit een ander domein', () => {
  const r = ok(herkenEmbed('https://www.facebook.com/nextgenmedia/reel/1234567890'))
  assert.equal(r.formaat, 'staand')
  assert.match(embedSrc(r)!, /^https:\/\/www\.facebook\.com\/plugins\/video\.php\?href=https%3A%2F%2Fwww\.facebook\.com%2Fnextgenmedia%2Freel%2F1234567890/)
  const code = '<iframe src="https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2Fngm%2Fposts%2Fpfbid0abc&show_text=true&width=500" width="500" height="580"></iframe>'
  const p = ok(herkenEmbed(code))
  assert.equal(p.url, 'https://www.facebook.com/ngm/posts/pfbid0abc')
  assert.equal(p.hoogte, 580)
  assert.match(embedSrc(p)!, /plugins\/post\.php/)
  assert.equal(herkenEmbed('<iframe src="https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fevil.com%2Fx"></iframe>').ok, false)
})

test('3. LinkedIn: embedcode en postlink worden dezelfde veilige embed', () => {
  const code = '<iframe src="https://www.linkedin.com/embed/feed/update/urn:li:share:7254123456789012345" height="667" width="504" frameborder="0" allowfullscreen="" title="Ingesloten bericht"></iframe>'
  const e = ok(herkenEmbed(code))
  assert.equal(e.url, 'https://www.linkedin.com/feed/update/urn:li:share:7254123456789012345/')
  assert.equal(e.hoogte, 667)
  assert.equal(embedSrc(e), 'https://www.linkedin.com/embed/feed/update/urn:li:share:7254123456789012345?collapsed=1')
  const link = ok(herkenEmbed('https://www.linkedin.com/posts/nextgenmedia_reels-activity-7254123456789012345-AbCd?utm_source=share'))
  assert.equal(embedSrc(link), 'https://www.linkedin.com/embed/feed/update/urn:li:activity:7254123456789012345?collapsed=1')
})

test('4. YouTube: Shorts staand, gewone video liggend; de lichte speler, geen iframe-link', () => {
  const s = ok(herkenEmbed('https://youtube.com/shorts/dQw4w9WgXcQ?si=x'))
  assert.deepEqual(s, { provider: 'youtube', url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ', formaat: 'staand' })
  assert.equal(embedSrc(s), null)
  assert.equal(ok(herkenEmbed('https://youtu.be/dQw4w9WgXcQ')).formaat, 'liggend')
  assert.equal(ok(herkenEmbed('https://youtu.be/dQw4w9WgXcQ', 'staand')).formaat, 'staand', 'eigen keuze gaat voor')
})

test('5. Al het andere wordt geweigerd: andere sites, javascript, scripts zonder link', () => {
  for (const x of ['https://evil.com/reel/abc', 'javascript:alert(1)', '<script>alert(1)</script>', 'https://www.tiktok.com/@ngm/video/1', 'https://www.instagram.com/nextgenmedia/']) {
    assert.equal(herkenEmbed(x).ok, false, x)
  }
  assert.equal(valideerEmbed({ provider: 'instagram', url: 'https://evil.com/p/abc' }), null, 'opgeslagen rommel valt weg')
})

test('6. Nieuwsbrief: eigen categorie, Shorts als staande cover, Instagram-reel als uitgelichte post en als blok', () => {
  assert.match((valideerNieuwsbrief({ titel: 'Achter de schermen', categorie: 'andere', categorie_label: '' }) as { fout: string }).fout, /eigen categorie/)
  const v = valideerNieuwsbrief({
    titel: 'Achter de schermen bij ERA NOBIS', categorie: 'andere', categorie_label: 'Behind the scenes',
    cover_youtube_id: 'https://youtube.com/shorts/dQw4w9WgXcQ', cover_embed: { url: 'https://www.instagram.com/reel/C9xYzAbCdEf/' },
    blokken: [{ id: 'aaaa1', type: 'embed', embed: { url: 'https://www.linkedin.com/posts/x-activity-7254123456789012345-AbCd' } }, { id: 'aaaa2', type: 'video', youtube_id: 'https://youtube.com/shorts/dQw4w9WgXcQ' }],
  })
  assert.ok(v.ok, JSON.stringify(v))
  if (!v.ok) return
  assert.equal(v.waarde.categorie_label, 'Behind the scenes')
  assert.equal(categorieLabel('andere', 'Behind the scenes'), 'Behind the scenes')
  assert.equal(v.waarde.cover_formaat, 'staand')
  assert.equal(v.waarde.cover_embed?.provider, 'instagram')
  assert.equal(v.waarde.blokken[0].type === 'embed' && v.waarde.blokken[0].embed?.provider, 'linkedin')
  assert.equal(v.waarde.blokken[1].type === 'video' && v.waarde.blokken[1].formaat, 'staand')
  assert.match((valideerNieuwsbrief({ titel: 'Goede titel', categorie: 'tips', blokken: [{ id: 'aaaa1', type: 'embed', embed: { url: 'https://evil.com/x' } }] }) as { fout: string }).fout, /Social post/)
})

test('7. Mail: een ingesloten post wordt een link (mails kunnen geen posts insluiten), eigen categorie bovenaan', () => {
  const m = bouwNieuwsbriefMail({ titel: 'Test', categorie: 'andere', categorie_label: 'Behind the scenes', samenvatting: null, cover_pad: null, cover_youtube_id: null,
    blokken: [{ id: 'a', type: 'embed', embed: { provider: 'instagram', url: 'https://www.instagram.com/reel/C9xYzAbCdEf/', formaat: 'staand' }, onderschrift: 'Onze nieuwste reel' }] },
  { appLink: 'https://app.nextgenmedia.be/portal/nieuws/test', afmeldLink: 'https://app.nextgenmedia.be/nieuwsbrief/afmelden?e=x&t=y' })
  assert.match(m.html, /Behind the scenes/)
  assert.match(m.html, /href="https:\/\/www\.instagram\.com\/reel\/C9xYzAbCdEf\/"/)
  assert.doesNotMatch(m.html, /<iframe/)
  assert.match(m.tekst, /Onze nieuwste reel: https:\/\/www\.instagram\.com\/reel\/C9xYzAbCdEf\//)
})

test('8. Founders: Shorts-link is staand; kanaal-link enkel van YouTube', () => {
  const v = valideerFoundersVideo({ titel: 'Van garage tot 20 man', youtube: 'https://youtube.com/shorts/dQw4w9WgXcQ' })
  assert.ok(v.ok && v.waarde.formaat === 'staand')
  const l = valideerFoundersVideo({ titel: 'Liggend', youtube: 'https://youtu.be/dQw4w9WgXcQ' })
  assert.ok(l.ok && l.waarde.formaat === 'liggend')
  assert.deepEqual(valideerKanaal('youtube.com/@foundersofflanders/videos'), { ok: true, url: 'https://www.youtube.com/@foundersofflanders/videos' })
  assert.deepEqual(valideerKanaal('https://www.youtube.com/playlist?list=PLabcdefghijk'), { ok: true, url: 'https://www.youtube.com/playlist?list=PLabcdefghijk' })
  assert.deepEqual(valideerKanaal(''), { ok: true, url: null })
  assert.equal(valideerKanaal('https://vimeo.com/foundersofflanders').ok, false)
  assert.equal(valideerKanaal('https://www.youtube.com/watch?v=dQw4w9WgXcQ').ok, false)
})

test('9. Founders: een Instagram-reel, Facebook- of LinkedIn-post mag ook; YouTube blijft gewoon werken', () => {
  const reel = valideerFoundersVideo({ titel: 'Founder in 60 seconden', youtube: '<blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/reel/C9xYzAbCdEf/?igsh=x"></blockquote><script async src="//www.instagram.com/embed.js"></script>' })
  assert.ok(reel.ok, JSON.stringify(reel))
  if (!reel.ok) return
  assert.equal(reel.waarde.youtube_id, null)
  assert.equal(reel.waarde.embed?.provider, 'instagram')
  assert.equal(reel.waarde.embed?.url, 'https://www.instagram.com/reel/C9xYzAbCdEf/')
  assert.equal(reel.waarde.formaat, 'staand')
  const li = valideerFoundersVideo({ titel: 'Post', youtube: 'https://www.linkedin.com/posts/ngm_founder-activity-7254123456789012345-AbCd', formaat: 'liggend' })
  assert.ok(li.ok && li.waarde.embed?.provider === 'linkedin' && li.waarde.formaat === 'staand', 'een post staat in het staande raster')
  const yt = valideerFoundersVideo({ titel: 'YouTube', youtube: 'https://youtu.be/dQw4w9WgXcQ' })
  assert.ok(yt.ok && yt.waarde.youtube_id === 'dQw4w9WgXcQ' && yt.waarde.embed === null)
  assert.equal(valideerFoundersVideo({ titel: 'Fout', youtube: 'https://evil.com/reel/abc' }).ok, false)
  assert.equal(valideerFoundersVideo({ titel: 'Leeg', youtube: '' }).ok, false)
})

console.log(`\n${n} tests geslaagd\n`)
