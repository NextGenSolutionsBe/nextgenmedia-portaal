// Contractvelden exact op de lijnen, vakjes en kaders van de pdf.
//   npx tsx tests/contract-velden-uitlijnen.test.ts
import assert from 'node:assert/strict'
import Module from 'module'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const M = Module as unknown as { _load: (req: string, parent: unknown, isMain: boolean) => unknown }
const oud = M._load
M._load = function (req: string, parent: unknown, isMain: boolean) { if (req === 'server-only') return {}; return oud.call(this, req, parent, isMain) }
/* eslint-disable @typescript-eslint/no-require-imports */
const { vormenVanPdf, lijnAnalyseUit } = require('../lib/contracten/velden-uitlijnen-server') as typeof import('../lib/contracten/velden-uitlijnen-server')
const { past, woorden } = require('../lib/contracten/velden-uitlijnen') as typeof import('../lib/contracten/velden-uitlijnen')
/* eslint-enable @typescript-eslint/no-require-imports */

let n = 0
const test = async (naam: string, f: () => void | Promise<void>) => { await f(); n++; console.log(`  ✓ ${naam}`) }

/** Pagina 2 zoals de aanvaardingspagina van een contract: twee kolommen (wij en de klant). */
async function contractPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  pdf.addPage([595, 842])
  const p = pdf.addPage([595, 842])
  const t = (s: string, x: number, yTop: number, size = 8) => p.drawText(s, { x, y: 842 - yTop - size, size, font, color: rgb(0.05, 0.17, 0.12) })
  const lijn = (x1: number, x2: number, yTop: number) => p.drawLine({ start: { x: x1, y: 842 - yTop }, end: { x: x2, y: 842 - yTop }, thickness: 0.6, color: rgb(0.8, 0.8, 0.8) })
  const kader = (x: number, yTop: number, w: number, h: number, vul = false) => p.drawRectangle({ x, y: 842 - yTop - h, width: w, height: h, ...(vul ? { color: rgb(0.96, 0.95, 0.92) } : { borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.8 }) })
  // aanvaarding met twee vakjes
  kader(60, 300, 8, 8); t('Ik ga akkoord met de algemene voorwaarden van NextGen Agency BV.', 74, 300)
  kader(60, 318, 8, 8); t('Ik bevestig dat ik de privacyverklaring van NextGen Agency BV heb ontvangen en gelezen.', 74, 318)
  // twee kaarten
  kader(50, 360, 240, 290); kader(305, 360, 240, 290)
  t('VOOR NEXTGEN AGENCY BV', 62, 372); t('VOOR DE KLANT', 317, 372)
  t('Naam', 62, 420); t('Bram Reinquin', 140, 418, 8); lijn(138, 280, 430)
  t('Datum', 62, 450); t('27 november 2026', 140, 448, 8); lijn(138, 280, 460)
  t('Btw-nummer', 317, 420); lijn(390, 535, 430)
  t('E-mail', 317, 450); lijn(390, 535, 460)
  t('Naam', 317, 480); lijn(390, 535, 490)
  t('Datum', 317, 510); lijn(390, 535, 520)
  t('Handtekening', 62, 480); kader(62, 495, 216, 140, true)
  t('Handtekening', 317, 540); kader(317, 555, 216, 85, true)
  return pdf.save()
}

const pct = (pt: number, tot: number) => (pt / tot) * 100

/** Zoals een contract uit Word: de invullijnen zijn getypte streepjes en puntjes. */
async function wordPdf(): Promise<{ bytes: Uint8Array; x: Record<string, number> }> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const p = pdf.addPage([595, 842])
  const t = (s: string, yTop: number) => p.drawText(s, { x: 72, y: 842 - yTop, size: 10, font })
  t('Naam: ______________________________', 200)
  t('E-mail: .........................................', 230)
  t('Gewone zin zonder invullijn.', 260)
  // waar de streepjes en puntjes echt beginnen, om de schatting na te kijken
  return { bytes: await pdf.save(), x: { naam: 72 + font.widthOfTextAtSize('Naam: ', 10), email: 72 + font.widthOfTextAtSize('E-mail: ', 10) } }
}

async function main() {
  console.log('\nContractvelden uitlijnen\n')
  const bytes = await contractPdf()

  await test('woorden en passen: label tegen de tekst op de pdf', () => {
    assert.deepEqual(woorden('Naam (klant)'), ['naam'])
    assert.deepEqual(woorden('Btw-nummer'), ['btw', 'nummer'])
    assert.equal(past('Akkoord algemene voorwaarden', 'Ik ga akkoord met de algemene voorwaarden van NextGen Agency BV.'), 1)
    assert.equal(past('E-mail', 'Datum'), 0)
  })

  await test('vormen uit de pdf: lijnen, vakjes, kaders en tekst', async () => {
    const [p] = await vormenVanPdf(bytes, [2])
    assert.equal(p.nr, 2)
    assert.equal(p.lijnen.length, 6)
    assert.equal(p.vakjes.length, 2)
    assert.ok(p.kaders.length >= 4)
    assert.ok(p.teksten.some((x) => x.str === 'Btw-nummer'))
    const btw = p.lijnen.find((l) => Math.abs(l.y - 430) < 1 && l.x > 380)!
    assert.ok(Math.abs(btw.x - 390) < 1 && Math.abs(btw.w - 145) < 1.5)
  })

  await test('scheve velden van de AI komen recht op hun lijn, vakje en kader', async () => {
    const W = 595, H = 842
    // Zoals op de screenshot: telkens een regel te hoog en wat naar links.
    const fields = [
      { label: 'Btw-nummer', type: 'text', page_number: 2, x: pct(318, W), y: pct(398, H), width: 200, height: 14, required: true },
      { label: 'E-mail', type: 'email', page_number: 2, x: pct(318, W), y: pct(426, H), width: 200, height: 14, required: true },
      { label: 'Naam (klant)', type: 'text', page_number: 2, x: pct(318, W), y: pct(456, H), width: 200, height: 14, required: true },
      { label: 'Datum (klant)', type: 'date', page_number: 2, x: pct(318, W), y: pct(486, H), width: 200, height: 14, required: true },
      { label: 'Akkoord algemene voorwaarden', type: 'checkbox', page_number: 2, x: pct(55, W), y: pct(312, H), width: 20, height: 12, required: true },
      { label: 'Bevestiging privacyverklaring', type: 'checkbox', page_number: 2, x: pct(55, W), y: pct(330, H), width: 20, height: 12, required: true },
    ]
    const r = await lijnAnalyseUit(bytes, { fields, signature: { page: 2, x: pct(300, W), y: pct(560, H), width: 200, height: 60 } })
    assert.equal(r.uitgelijnd, true)
    const op = (label: string) => r.fields.find((f) => f.label === label)!
    // Elk tekstveld: links op het begin van zijn lijn, onderkant net op de lijn.
    for (const [label, lijnY] of [['Btw-nummer', 430], ['E-mail', 460], ['Naam (klant)', 490], ['Datum (klant)', 520]] as const) {
      const f = op(label)
      assert.ok(Math.abs((f.x / 100) * W - 392) < 1, `${label} x`)
      const onder = (f.y / 100) * H + f.height
      assert.ok(onder <= lijnY && onder >= lijnY - 2, `${label}: onderkant ${onder} hoort net boven ${lijnY}`)
      assert.ok(Math.abs(f.width - 141) <= 2, `${label} breedte`)
    }
    // Vinkjes precies op de vakjes, elk op zijn eigen zin.
    assert.ok(Math.abs((op('Akkoord algemene voorwaarden').y / 100) * H - 300) < 1)
    assert.ok(Math.abs((op('Bevestiging privacyverklaring').y / 100) * H - 318) < 1)
    assert.equal(op('Akkoord algemene voorwaarden').width, 8)
    // Handtekening van de klant in haar kader, die van ons in het kader ernaast.
    const s = r.signature!
    assert.ok((s.x / 100) * W >= 317 && (s.x / 100) * W + s.width <= 533, 'klant in haar kader')
    assert.ok((s.y / 100) * H >= 555 && (s.y / 100) * H + s.height <= 640)
    const ons = r.ons!
    assert.ok((ons.x / 100) * W >= 62 && (ons.x / 100) * W + ons.width <= 278, 'wij in ons kader')
  })

  await test('getypte invullijnen (Word): ______ en ...... worden een lijn met hun label', async () => {
    const { bytes: w, x } = await wordPdf()
    const [p] = await vormenVanPdf(w, [1])
    assert.equal(p.lijnen.length, 2)
    assert.ok(p.teksten.some((t) => t.str === 'Naam:'), 'label los van de streepjes')
    assert.ok(p.teksten.some((t) => t.str === 'Gewone zin zonder invullijn.'))
    const W = 595, H = 842
    const fields = [
      { label: 'Naam', type: 'text', page_number: 1, x: pct(60, W), y: pct(170, H), width: 150, height: 14 },
      { label: 'E-mail', type: 'email', page_number: 1, x: pct(60, W), y: pct(205, H), width: 150, height: 14 },
    ]
    const r = await lijnAnalyseUit(w, { fields, signature: null })
    for (const [label, sleutel, basis] of [['Naam', 'naam', 200], ['E-mail', 'email', 230]] as const) {
      const f = r.fields.find((v) => v.label === label)!
      const links = (f.x / 100) * W
      assert.ok(Math.abs(links - x[sleutel]) < 10, `${label}: begint op ${links}, de lijn op ${x[sleutel]}`)
      const onder = (f.y / 100) * H + f.height
      assert.ok(onder <= basis + 2 && onder >= basis - 2, `${label}: onderkant ${onder} op de basislijn ${basis}`)
    }
  })

  await test('niets in de buurt of een vreemde pdf: de plek van de AI blijft', async () => {
    const ver = [{ label: 'Iban', type: 'text', page_number: 1, x: 10, y: 10, width: 120, height: 14 }]
    const r = await lijnAnalyseUit(bytes, { fields: ver, signature: null })
    assert.equal(r.fields[0].x, 10)
    const kapot = await lijnAnalyseUit(new Uint8Array([1, 2, 3]), { fields: ver, signature: null })
    assert.equal(kapot.uitgelijnd, false)
    assert.equal(kapot.fields[0].y, 10)
  })

  console.log(`\n${n} tests geslaagd\n`)
}
main().catch((e) => { console.error(e); process.exit(1) })
