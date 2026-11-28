import assert from 'node:assert/strict'
import { isAutomatischeBezoeker, toestelVan, geopendTekst } from '../lib/klant-geopend'

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
assert.equal(isAutomatischeBezoeker(iphone), false)
assert.equal(isAutomatischeBezoeker(chrome), false)
assert.equal(isAutomatischeBezoeker('WhatsApp/2.24.1 A'), true)
assert.equal(isAutomatischeBezoeker('Slackbot-LinkExpanding 1.0'), true)
assert.equal(isAutomatischeBezoeker('Mozilla/5.0 (compatible; Googlebot/2.1)'), true)
assert.equal(isAutomatischeBezoeker('Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0)'), true)
assert.equal(isAutomatischeBezoeker(''), true)
assert.equal(isAutomatischeBezoeker(null), true)

assert.equal(toestelVan(iphone), 'iPhone')
assert.equal(toestelVan(chrome), 'Windows')
assert.equal(toestelVan('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari'), 'Android-gsm')

const nu = new Date('2026-11-10T12:00:00Z')
assert.equal(geopendTekst('2026-11-06T09:30:00Z', nu), 'Door klant geopend op 6 nov')
assert.equal(geopendTekst('2025-12-24T09:30:00Z', nu), 'Door klant geopend op 24 dec 2025')
assert.equal(geopendTekst(null, nu), null)
console.log('klant-geopend: ok')
