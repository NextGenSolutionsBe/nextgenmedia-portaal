import assert from 'node:assert/strict'
import { buildEmailHtml, buildEmailText } from '../lib/email-html'
import { mailMerkVan, merkStijl, MERK_STIJL } from '../lib/merk-mail'
import { bouwNieuwsbriefMail } from '../lib/nieuwsbrief-mail'
import { valideerNieuwsbrief } from '../lib/nieuwsbrieven'

// Standaard = NextGenMedia.
const ngm = buildEmailHtml({ bodyText: 'Hallo', ctaText: 'Open', ctaLink: 'https://app.nextgenmedia.be' })
// Huisstijl NextGenMedia (27 nov 2026): logo in zonnegeel op woud, knop in zonnegeel, de baseline. Geen oud geel, geen woordmerk van NextGen Agency.
assert.ok(ngm.includes('/merk/ngm/logo-mail.png') && ngm.includes('#0C2B1E') && ngm.includes('#FDDB57'))
assert.ok(!ngm.includes('#fff848') && !ngm.includes('/merk/logo-mail.png'))
assert.ok(ngm.includes('info@nextgenmedia.be') && ngm.includes('From concept to impact.'))
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
assert.ok(nb1.html.includes('/merk/ngm/logo-mail.png') && nb1.html.includes('#0C2B1E') && nb1.html.includes('klant bent bij NextGenMedia'))
const nb2 = bouwNieuwsbriefMail({ ...basis, merk: 'nextgensolutions' }, { appLink: 'https://app/x', afmeldLink: 'https://app/af' })
assert.ok(nb2.html.includes('#3b82f6') && nb2.html.includes('klant bent bij NextGenSolutions'))
assert.ok(!nb2.html.includes('/merk/logo-mail.png') && !nb2.html.includes('/merk/ngm/'))

// Validatie bewaart het merk (onbekend = NextGenMedia).
const v1 = valideerNieuwsbrief({ titel: 'Een titel', categorie: 'projecten', blokken: [], merk: 'nextgensolutions' })
assert.ok(v1.ok && v1.waarde.merk === 'nextgensolutions')
const v2 = valideerNieuwsbrief({ titel: 'Een titel', categorie: 'projecten', blokken: [], merk: 'hack' })
assert.ok(v2.ok && v2.waarde.merk === 'nextgenmedia')

console.log('merk-mail: ok')
