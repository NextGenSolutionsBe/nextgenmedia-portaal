// Klantuploads: welk bestandstype nemen we aan, ook als de browser het type niet meegeeft.
//   npx tsx tests/klantuploads-types.test.ts
import assert from 'node:assert/strict'
import { typeVanBestand, mimeToegestaan, bouwPad, weergaveVan, formaatVan, ACCEPT } from '../lib/client-uploads'

let n = 0
const test = (naam: string, f: () => void) => { f(); n++; console.log(`  ✓ ${naam}`) }
console.log('\nKlantuploads: bestandstypes\n')

test('1. Pdf, png, Word en zip met het type van de browser', () => {
  assert.equal(typeVanBestand('offerte.pdf', 'application/pdf'), 'application/pdf')
  assert.equal(typeVanBestand('logo.png', 'image/png'), 'image/png')
  assert.equal(typeVanBestand('tekst.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assert.equal(typeVanBestand('fotos.zip', 'application/x-zip-compressed'), 'application/zip')
  assert.equal(typeVanBestand('foto.JPG', 'image/jpg'), 'image/jpeg')
})

test('2. Zonder type (of octet-stream): de extensie beslist', () => {
  assert.equal(typeVanBestand('logo.ai', ''), 'application/illustrator')
  assert.equal(typeVanBestand('logo.ai', 'application/pdf'), 'application/illustrator')
  assert.equal(typeVanBestand('flyer.psd', 'application/octet-stream'), 'image/vnd.adobe.photoshop')
  assert.equal(typeVanBestand('logo.eps', ''), 'application/postscript')
  assert.equal(typeVanBestand('IMG_0001.HEIC', ''), 'image/heic')
  assert.equal(typeVanBestand('brochure.indd', ''), 'application/x-indesign')
  assert.equal(typeVanBestand('logo.svg', 'image/svg+xml'), 'image/svg+xml')
})

test('3. Niet toegelaten: programma\'s en webpagina\'s', () => {
  assert.equal(typeVanBestand('setup.exe', 'application/x-msdownload'), null)
  assert.equal(typeVanBestand('pagina.html', 'text/html'), null)
  assert.equal(typeVanBestand('script.js', 'text/javascript'), null)
  assert.equal(typeVanBestand('zonder-extensie', ''), null)
  assert.equal(mimeToegestaan('text/html'), false)
})

test('4. Pad, weergave en formaat', () => {
  assert.match(bouwPad('c1', 'application/pdf', 'u1'), /^c1\/u1\.pdf$/)
  assert.match(bouwPad('c1', 'application/illustrator', 'u1'), /\.ai$/)
  assert.equal(weergaveVan('image/png'), 'foto')
  assert.equal(weergaveVan('image/heic'), 'bestand')
  assert.equal(weergaveVan('application/pdf'), 'pdf')
  assert.equal(weergaveVan('video/mp4'), 'video')
  assert.equal(formaatVan('application/vnd.openxmlformats-officedocument.presentationml.presentation'), 'PPTX')
  assert.ok(ACCEPT.includes('.pdf') && ACCEPT.includes('.ai') && ACCEPT.includes('.png'))
})

console.log(`\n${n} tests geslaagd\n`)
