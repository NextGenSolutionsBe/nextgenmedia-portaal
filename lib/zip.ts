import 'server-only'
import { inflateRawSync, deflateRawSync } from 'zlib'

/**
 * Minimale ZIP-lezer, ZONDER externe bibliotheek.
 *
 * Een ZIP is een eenvoudig containerformaat en Node kan zelf uitpakken (zlib).
 * Zowel .xlsx als .docx zijn in de kern een ZIP met XML erin, en bestekken
 * komen vaak als .zip binnen — één lezer volstaat dus voor alle drie.
 *
 * Bewezen op echte Excel-bestanden; hier gedeeld in plaats van gekopieerd.
 */

// ── ZIP uitpakken ────────────────────────────────────────────────────────────

type ZipEntry = { name: string; data: Buffer }

/** Leest de bestanden uit een ZIP. Alleen 'stored' en 'deflate' komen voor. */
export function readZip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>()

  // Het einde van de centrale map ('End of Central Directory') staat achteraan,
  // met daarin waar de bestandenlijst begint.
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Dit lijkt geen geldig Excel-bestand (geen ZIP-structuur).')

  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)

    // In de lokale kop staan de échte lengtes van naam en extra-veld; die
    // kunnen afwijken van de centrale map, dus we lezen ze daar opnieuw.
    const lNameLen = buf.readUInt16LE(localOffset + 26)
    const lExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(dataStart, dataStart + compSize)

    try {
      files.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw))
    } catch { /* onleesbaar onderdeel overslaan */ }

    p += 46 + nameLen + extraLen + commentLen
  }
  return files
}

// ── ZIP inpakken ─────────────────────────────────────────────────────────────
//
// De tegenhanger van readZip, voor de Excel-export (een .xlsx is een ZIP met
// XML). Zelfde principe: geen externe bibliotheek, Node's zlib doet het werk.
// Alle onderdelen worden 'deflate' geschreven met een correcte CRC-32, een
// lokale kop per bestand en één centrale map achteraan — precies wat Excel,
// LibreOffice en Numbers verwachten.

const CRC_TABEL = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABEL[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Datum/tijd in het (oude) DOS-formaat dat ZIP gebruikt. */
function dosTijd(d: Date): { tijd: number; datum: number } {
  const tijd = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const datum = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { tijd, datum }
}

export type ZipInvoer = { name: string; data: Buffer | string }

/** Schrijft bestanden naar één ZIP-buffer. Namen zijn UTF-8 (vlag 0x0800). */
export function writeZip(entries: ZipInvoer[], nu: Date = new Date()): Buffer {
  const { tijd, datum } = dosTijd(nu)
  const lokaal: Buffer[] = []
  const centraal: Buffer[] = []
  let offset = 0

  for (const e of entries) {
    const naam = Buffer.from(e.name, 'utf8')
    const data = typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : e.data
    const gecomprimeerd = deflateRawSync(data, { level: 6 })
    const crc = crc32(data)

    const kop = Buffer.alloc(30)
    kop.writeUInt32LE(0x04034b50, 0)
    kop.writeUInt16LE(20, 4)          // versie nodig om uit te pakken
    kop.writeUInt16LE(0x0800, 6)      // UTF-8 bestandsnamen
    kop.writeUInt16LE(8, 8)           // deflate
    kop.writeUInt16LE(tijd, 10)
    kop.writeUInt16LE(datum, 12)
    kop.writeUInt32LE(crc, 14)
    kop.writeUInt32LE(gecomprimeerd.length, 18)
    kop.writeUInt32LE(data.length, 22)
    kop.writeUInt16LE(naam.length, 26)
    kop.writeUInt16LE(0, 28)
    lokaal.push(kop, naam, gecomprimeerd)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)           // gemaakt met versie
    cd.writeUInt16LE(20, 6)           // versie nodig
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt16LE(tijd, 12)
    cd.writeUInt16LE(datum, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(gecomprimeerd.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(naam.length, 28)
    cd.writeUInt16LE(0, 30)           // extra
    cd.writeUInt16LE(0, 32)           // commentaar
    cd.writeUInt16LE(0, 34)           // schijfnummer
    cd.writeUInt16LE(0, 36)           // interne attributen
    cd.writeUInt32LE(0, 38)           // externe attributen
    cd.writeUInt32LE(offset, 42)
    centraal.push(cd, naam)

    offset += kop.length + naam.length + gecomprimeerd.length
  }

  const cdBuf = Buffer.concat(centraal)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...lokaal, cdBuf, eocd])
}
