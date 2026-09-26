// Tests voor de ZIP-bundeling van klantuploads (pure logica).
// Uitvoeren: npx tsx tests/klantuploads-zip.test.ts
import assert from 'node:assert/strict'
import { maakZipSchrijver, crc32Bytes, zipPad, zipSegment, uniekeNaam, verdeelInDelen, zipBestandsnaam } from '../lib/zip-browser'

let n = 0
const test = async (naam: string, f: () => void | Promise<void>) => { await f(); n++; console.log(`  ✓ ${naam}`) }

/** Minimale ZIP-lezer voor de test: leest de centrale map en de (stored) inhoud. */
function leesZip(buf: Uint8Array): { naam: string; data: Uint8Array; crc: number }[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  assert.ok(eocd >= 0, 'geen einde-van-centrale-map')
  const aantal = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const uit: { naam: string; data: Uint8Array; crc: number }[] = []
  for (let i = 0; i < aantal; i++) {
    assert.equal(v.getUint32(p, true), 0x02014b50, 'centrale kop')
    assert.equal(v.getUint16(p + 10, true), 0, 'stored')
    const crc = v.getUint32(p + 16, true), grootte = v.getUint32(p + 20, true), naamLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comm = v.getUint16(p + 32, true), lokaal = v.getUint32(p + 42, true)
    const naam = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + naamLen))
    assert.equal(v.getUint32(lokaal, true), 0x04034b50, 'lokale kop')
    const lNaam = v.getUint16(lokaal + 26, true), lExtra = v.getUint16(lokaal + 28, true)
    const start = lokaal + 30 + lNaam + lExtra
    uit.push({ naam, data: buf.subarray(start, start + grootte), crc })
    p += 46 + naamLen + extra + comm
  }
  return uit
}

const samen = (delen: Uint8Array[]) => { const t = new Uint8Array(delen.reduce((s, d) => s + d.length, 0)); let o = 0; for (const d of delen) { t.set(d, o); o += d.length } return t }

;(async () => {
  console.log('Klantuploads — ZIP-bundeling')

  await test('1. CRC-32 klopt met de referentiewaarde', () => {
    assert.equal(crc32Bytes(new TextEncoder().encode('hello')).toString(16), '3610a686')
    assert.equal(crc32Bytes(new Uint8Array(0)), 0)
  })

  await test('2. Drie bestanden (ook met accenten) komen ongeschonden terug uit de ZIP', async () => {
    const delen: Uint8Array[] = []
    const zip = maakZipSchrijver((d) => { delen.push(d) }, new Date(2026, 8, 16, 10, 30))
    const a = new TextEncoder().encode('foto één'), b = new Uint8Array([0, 1, 2, 255, 254]), c = new Uint8Array(0)
    await zip.voegToe('Klant/Gevel/foto één.jpg', a)
    await zip.voegToe('Klant/Losse bestanden/video.mp4', b)
    await zip.voegToe('Klant/leeg.txt', c)
    await zip.sluit()
    const buf = samen(delen)
    assert.equal(zip.grootte, buf.length)
    assert.equal(zip.aantal, 3)
    const uit = leesZip(buf)
    assert.deepEqual(uit.map((x) => x.naam), ['Klant/Gevel/foto één.jpg', 'Klant/Losse bestanden/video.mp4', 'Klant/leeg.txt'])
    assert.deepEqual([...uit[0].data], [...a]); assert.deepEqual([...uit[1].data], [...b]); assert.equal(uit[2].data.length, 0)
    assert.equal(uit[0].crc, crc32Bytes(a)); assert.equal(uit[1].crc, crc32Bytes(b))
  })

  await test('3. Na sluiten kan er niets meer bij; lege naam wordt geweigerd', async () => {
    const zip = maakZipSchrijver(() => {})
    await assert.rejects(() => zip.voegToe('', new Uint8Array(1)), /Ongeldige bestandsnaam/)
    await zip.sluit()
    await assert.rejects(() => zip.voegToe('x', new Uint8Array(1)), /al afgesloten/)
  })

  await test('4. Padsegmenten: schuine strepen, stuurtekens en ".." kunnen geen mappen maken', () => {
    assert.equal(zipSegment('Bakkerij A/B'), 'Bakkerij A-B')
    assert.equal(zipSegment('..'), 'onbekend')
    assert.equal(zipSegment('naammetstuur'), 'naammetstuur')
    assert.equal(zipPad(['Klant', 'Map'], '../geheim.jpg'), 'Klant/Map/..-geheim.jpg')
    assert.equal(zipPad([null, ''], null), 'onbekend/onbekend/bestand')
  })

  await test('5. Dubbele bestandsnamen worden genummerd (hoofdletterongevoelig)', () => {
    const g = new Set<string>()
    assert.equal(uniekeNaam(g, 'K/M/foto.jpg'), 'K/M/foto.jpg')
    assert.equal(uniekeNaam(g, 'K/M/Foto.JPG'), 'K/M/Foto (2).JPG')
    assert.equal(uniekeNaam(g, 'K/M/foto.jpg'), 'K/M/foto (3).jpg')
    assert.equal(uniekeNaam(g, 'K/M/zonder-extensie'), 'K/M/zonder-extensie')
    assert.equal(uniekeNaam(g, 'K/M/zonder-extensie'), 'K/M/zonder-extensie (2)')
  })

  await test('6. Grote selecties worden in delen onder de ZIP-grens verdeeld, volgorde behouden', () => {
    const items = [{ id: 1, grootte: 600 }, { id: 2, grootte: 600 }, { id: 3, grootte: 2000 }, { id: 4, grootte: null }, { id: 5, grootte: 100 }]
    const delen = verdeelInDelen(items, 1500)
    assert.deepEqual(delen.map((d) => d.map((x) => x.id)), [[1], [2], [3], [4, 5]])
    assert.deepEqual(verdeelInDelen(items, 10_000, 2).map((d) => d.length), [2, 2, 1])
    assert.deepEqual(verdeelInDelen([], 10), [])
  })

  await test('7. Bestandsnaam van de download: datum, en deelnummer enkel bij meerdere delen', () => {
    const d = new Date(2026, 8, 16)
    assert.equal(zipBestandsnaam('klantuploads', 1, 1, d), 'klantuploads-2026-09-16.zip')
    assert.equal(zipBestandsnaam('klantuploads Bakkerij A/B', 2, 3, d), 'klantuploads-Bakkerij-A-B-2026-09-16-deel-2-van-3.zip')
  })

  console.log(`\n${n} tests geslaagd`)
})().catch((e) => { console.error(e); process.exit(1) })
