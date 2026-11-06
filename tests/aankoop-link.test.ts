// Aankopen: optionele link naar de bestelpagina.
// Uitvoeren: npx tsx tests/aankoop-link.test.ts
import assert from 'node:assert/strict'
import { leesBestelLink, linkDomein } from '../lib/aankoop-link'

assert.deepEqual(leesBestelLink(''), { ok: true, link: null })
assert.deepEqual(leesBestelLink('   '), { ok: true, link: null })
assert.deepEqual(leesBestelLink(null), { ok: true, link: null })
assert.deepEqual(leesBestelLink('https://www.apple.com/be-nl/shop/buy-mac'), { ok: true, link: 'https://www.apple.com/be-nl/shop/buy-mac' })
assert.deepEqual(leesBestelLink('coolblue.be/nl/product/123'), { ok: true, link: 'https://coolblue.be/nl/product/123' })
assert.equal(leesBestelLink('javascript:alert(1)').ok, false)
assert.equal(leesBestelLink('ftp://bestand.be/x').ok, false)
assert.equal(leesBestelLink('geen link').ok, false)
assert.equal(leesBestelLink('localhost').ok, false)
assert.equal(leesBestelLink(`https://x.be/${'a'.repeat(600)}`).ok, false)
assert.equal(linkDomein('https://www.coolblue.be/nl/product/1'), 'coolblue.be')
console.log('aankoop-link: alle tests geslaagd')
