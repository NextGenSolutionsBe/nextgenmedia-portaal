import 'server-only'
import { inflateRawSync } from 'zlib'

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
