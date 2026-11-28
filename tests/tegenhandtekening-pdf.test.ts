// Tegenhandtekening op het PDF: kopie, zelfde pagina's, origineel onaangeroerd.
// Uitvoeren: npx tsx tests/tegenhandtekening-pdf.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { createHash } from 'crypto'
import { PDFDocument } from 'pdf-lib'
import { stempelTegenhandtekening } from '../lib/contracten/tegenhandtekening-pdf'

;(async () => {
  const doc = await PDFDocument.create()
  doc.addPage([595.28, 841.89]); doc.addPage([595.28, 841.89])
  const bron = await doc.save()
  const hashVoor = createHash('sha256').update(bron).digest('hex')
  const png = readFileSync('public/logo-pdf.png')

  const { bytes, zone } = await stempelTegenhandtekening(bron, png, { page: 7, x: 55, y: 80, w: 200, h: 60 }, '9 november 2026, 14:32')
  assert.deepEqual(zone, { page: 2, x: 55, y: 80, w: 200, h: 60 }, 'pagina begrensd tot het aantal pagina\'s')
  assert.equal(createHash('sha256').update(bron).digest('hex'), hashVoor, 'het bestand van de klant verandert niet')
  const terug = await PDFDocument.load(bytes)
  assert.equal(terug.getPageCount(), 2, 'geen pagina erbij of eraf')
  assert.ok(bytes.length > bron.length, 'de handtekening staat erin')

  // Tekens buiten de standaardfont (emoji) breken het stempelen niet.
  const r2 = await stempelTegenhandtekening(bron, png, { page: 1 }, '9 novembre 2026 🙂')
  assert.equal((await PDFDocument.load(r2.bytes)).getPageCount(), 2)
  console.log('tegenhandtekening-pdf: alle tests geslaagd')
})().catch((e) => { console.error(e); process.exit(1) })
