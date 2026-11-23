import assert from 'node:assert/strict'
import { buildEmailHtml, buildEmailText } from '../lib/email-html'
import { mailMerkVan, merkStijl, MERK_STIJL } from '../lib/merk-mail'
import { bouwNieuwsbriefMail } from '../lib/nieuwsbrief-mail'
import { valideerNieuwsbrief } from '../lib/nieuwsbrieven'

// Standaard = NextGenMedia, geel (zoals voorheen).
const ngm = buildEmailHtml({ bodyText: 'Hallo', ctaText: 'Open', ctaLink: 'https://app.nextgenmedia.be' })
// Huisstijl NextGen Agency (23 nov 2026): woordmerk als afbeelding, zwart, geen geel meer.
assert.ok(ngm.includes('/merk/logo-mail.png') && ngm.includes('#0f0f0f'))
assert.ok(!ngm.includes('#fff848'))
assert.ok(ngm.includes('NextGenMedia · info@nextgenmedia.be'))
assert.ok(!ngm.includes('#3b82f6'))

// NextGenSolutions = blauw, eigen naam en adres, geen geel.
const ngs = buildEmailHtml({ bodyText: 'Hallo', ctaText: 'Open', ctaLink: 'https://x.be', merk: 'nextgensolutions' })
assert.ok(ngs.includes('#3b82f6'))
assert.ok(ngs.includes('>Solutions</span>'))
assert.ok(ngs.includes('NextGenSolutions · info@nextgensolutions.be'))
assert.ok(!ngs.includes('#fff848') && !ngs.includes('/merk/logo-mail.png'))
assert.ok(buildEmailText({ bodyText: 'x', merk: 'nextgensolutions' }).endsWith('— NextGenSolutions · info@nextgensolutions.be'))

// Onbekende waarden vallen terug op NextGenMedia.
assert.equal(mailMerkVan('iets'), 'nextgenmedia')
assert.equal(mailMerkVan(null), 'nextgenmedia')
assert.equal(mailMerkVan('nextgensolutions'), 'nextgensolutions')
assert.equal(merkStijl(undefined).naam, 'NextGenMedia')
assert.equal(MERK_STIJL.nextgensolutions.van, 'NextGenSolutions <info@nextgensolutions.be>')

// Nieuwsbrief in de huisstijl van het merk.
const basis = { titel: 'Test', categorie: 'projecten' as const, samenvatting: null, cover_pad: null, cover_youtube_id: null, blokken: [] }
const nb1 = bouwNieuwsbriefMail(basis, { appLink: 'https://app/x', afmeldLink: 'https://app/af' })
assert.ok(nb1.html.includes('/merk/logo-mail.png') && nb1.html.includes('klant bent bij NextGenMedia'))
const nb2 = bouwNieuwsbriefMail({ ...basis, merk: 'nextgensolutions' }, { appLink: 'https://app/x', afmeldLink: 'https://app/af' })
assert.ok(nb2.html.includes('#3b82f6') && nb2.html.includes('klant bent bij NextGenSolutions'))
assert.ok(!nb2.html.includes('/merk/logo-mail.png'))

// Validatie bewaart het merk (onbekend = NextGenMedia).
const v1 = valideerNieuwsbrief({ titel: 'Een titel', categorie: 'projecten', blokken: [], merk: 'nextgensolutions' })
assert.ok(v1.ok && v1.waarde.merk === 'nextgensolutions')
const v2 = valideerNieuwsbrief({ titel: 'Een titel', categorie: 'projecten', blokken: [], merk: 'hack' })
assert.ok(v2.ok && v2.waarde.merk === 'nextgenmedia')

console.log('merk-mail: ok')
