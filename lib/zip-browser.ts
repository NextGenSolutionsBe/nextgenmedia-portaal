/**
 * ZIP schrijven in de browser, zonder bibliotheek.
 *
 * Voor "alle klantuploads in één keer downloaden". De server zou dat ook
 * kunnen, maar op Vercel (Hobby) is een functie na 60 seconden en 4,5 MB
 * antwoord klaar — en klantmateriaal bestaat uit foto's en video's van
 * honderden MB. De browser haalt de bestanden dus zelf op (getekende links)
 * en pakt ze in: geen servergrens, en wie wacht ziet de voortgang.
 *
 * Opslag zonder compressie ('stored'): foto's en video's zijn al gecomprimeerd,
 * dus deflate zou enkel tijd kosten. Geen zip64 — daarom verdeelt
 * verdeelInDelen() een grote selectie vooraf in delen onder de 4 GB-grens.
 *
 * Puur (geen DOM, geen Node-Buffer), zodat dezelfde code ook in de tests draait.
 */

const CRC_TABEL = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32Bytes(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABEL[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Datum/tijd in het (oude) DOS-formaat dat ZIP gebruikt. */
function dosTijd(d: Date): { tijd: number; datum: number } {
  const tijd = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const datum = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { tijd, datum }
}

const enc = new TextEncoder()

/** Klassiek ZIP: alle offsets in 32 bits. Ruim eronder blijven. */
export const ZIP_MAX_BYTES = 3.5 * 1024 * 1024 * 1024
export const ZIP_MAX_BESTANDEN = 65000

export type ZipUit = (deel: Uint8Array) => Promise<void> | void

export type ZipSchrijver = {
  /** Geschreven bytes tot nu toe. */
  readonly grootte: number
  readonly aantal: number
  voegToe(naam: string, data: Uint8Array): Promise<void>
  sluit(): Promise<void>
}

/**
 * Streamende ZIP-schrijver: elk stuk gaat meteen naar `uit` (een bestand op
 * schijf of een lijst van delen), zodat er nooit meer dan één bestand tegelijk
 * in het geheugen staat.
 */
export function maakZipSchrijver(uit: ZipUit, nu: Date = new Date()): ZipSchrijver {
  const { tijd, datum } = dosTijd(nu)
  const centraal: Uint8Array[] = []
  let offset = 0
  let aantal = 0
  let gesloten = false

  return {
    get grootte() { return offset },
    get aantal() { return aantal },

    async voegToe(naam, data) {
      if (gesloten) throw new Error('De ZIP is al afgesloten.')
      const n = enc.encode(naam)
      if (n.length === 0 || n.length > 65535) throw new Error('Ongeldige bestandsnaam voor de ZIP.')
      if (aantal >= ZIP_MAX_BESTANDEN) throw new Error('Te veel bestanden voor één ZIP. Verdeel de selectie in delen.')
      if (offset + 30 + n.length + data.length + centraal.length * 100 + 46 + n.length + 22 > 0xffffffff) {
        throw new Error('Deze ZIP zou groter worden dan 4 GB. Verdeel de selectie in delen.')
      }
      const crc = crc32Bytes(data)

      const kop = new Uint8Array(30)
      const k = new DataView(kop.buffer)
      k.setUint32(0, 0x04034b50, true)
      k.setUint16(4, 20, true)          // versie nodig om uit te pakken
      k.setUint16(6, 0x0800, true)      // UTF-8 bestandsnamen
      k.setUint16(8, 0, true)           // stored
      k.setUint16(10, tijd, true)
      k.setUint16(12, datum, true)
      k.setUint32(14, crc, true)
      k.setUint32(18, data.length, true)
      k.setUint32(22, data.length, true)
      k.setUint16(26, n.length, true)
      k.setUint16(28, 0, true)
      await uit(kop); await uit(n); await uit(data)

      const cd = new Uint8Array(46 + n.length)
      const c = new DataView(cd.buffer)
      c.setUint32(0, 0x02014b50, true)
      c.setUint16(4, 20, true)          // gemaakt met versie
      c.setUint16(6, 20, true)          // versie nodig
      c.setUint16(8, 0x0800, true)
      c.setUint16(10, 0, true)          // stored
      c.setUint16(12, tijd, true)
      c.setUint16(14, datum, true)
      c.setUint32(16, crc, true)
      c.setUint32(20, data.length, true)
      c.setUint32(24, data.length, true)
      c.setUint16(28, n.length, true)
      // 30 extra, 32 commentaar, 34 schijf, 36 interne en 38 externe attributen: 0
      c.setUint32(42, offset, true)
      cd.set(n, 46)
      centraal.push(cd)

      offset += 30 + n.length + data.length
      aantal++
    },

    async sluit() {
      if (gesloten) return
      gesloten = true
      const begin = offset
      let lengte = 0
      for (const cd of centraal) { await uit(cd); lengte += cd.length }
      const e = new Uint8Array(22)
      const v = new DataView(e.buffer)
      v.setUint32(0, 0x06054b50, true)
      v.setUint16(4, 0, true)
      v.setUint16(6, 0, true)
      v.setUint16(8, aantal, true)
      v.setUint16(10, aantal, true)
      v.setUint32(12, lengte, true)
      v.setUint32(16, begin, true)
      v.setUint16(20, 0, true)
      await uit(e)
      offset = begin + lengte + 22
    },
  }
}

/**
 * Eén padsegment veilig maken voor in een ZIP: schuine strepen worden
 * streepjes (anders leest een klantnaam als een map), stuurtekens gaan eruit,
 * en "." of ".." kan geen naam zijn.
 */
export function zipSegment(s: unknown, terugval = 'onbekend'): string {
  const t = String(s ?? '')
    .replace(/[\\/]/g, '-')
    .split('')
    .filter((teken) => { const c = teken.charCodeAt(0); return c >= 32 && c !== 127 })
    .join('')
    .trim()
    .replace(/^\.+$/, '')
  return (t || terugval).slice(0, 120)
}

/** Pad in de ZIP: "Klant/Map/bestand.jpg". */
export function zipPad(mappen: unknown[], bestandsnaam: unknown): string {
  return [...mappen.map((m) => zipSegment(m)), zipSegment(bestandsnaam, 'bestand')].join('/')
}

/** Dubbele namen uniek maken: foto.jpg, foto (2).jpg, foto (3).jpg. Hoofdletterongevoelig (Windows). */
export function uniekeNaam(gebruikt: Set<string>, pad: string): string {
  const sleutel = (p: string) => p.toLowerCase()
  if (!gebruikt.has(sleutel(pad))) { gebruikt.add(sleutel(pad)); return pad }
  const m = pad.match(/^(.*?)(\.[^./]+)?$/)
  const basis = m?.[1] ?? pad, ext = m?.[2] ?? ''
  for (let i = 2; ; i++) {
    const kandidaat = `${basis} (${i})${ext}`
    if (!gebruikt.has(sleutel(kandidaat))) { gebruikt.add(sleutel(kandidaat)); return kandidaat }
  }
}

/** Verdeelt bestanden (volgorde behouden) in delen die elk onder de ZIP-grens blijven. */
export function verdeelInDelen<T extends { grootte: number | null }>(items: T[], maxBytes = ZIP_MAX_BYTES, maxAantal = ZIP_MAX_BESTANDEN): T[][] {
  const delen: T[][] = []
  let huidig: T[] = []
  let som = 0
  for (const it of items) {
    const g = Math.max(0, Number(it.grootte) || 0) + 300   // kopjes en centrale map erbij
    if (huidig.length > 0 && (som + g > maxBytes || huidig.length >= maxAantal)) { delen.push(huidig); huidig = []; som = 0 }
    huidig.push(it)
    som += g
  }
  if (huidig.length > 0) delen.push(huidig)
  return delen
}

/** "klantuploads-2026-09-16.zip", of bij meerdere delen "…-deel-2-van-3.zip". */
export function zipBestandsnaam(basis: string, deel: number, totaal: number, datum: Date): string {
  const d = `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, '0')}-${String(datum.getDate()).padStart(2, '0')}`
  const naam = zipSegment(basis, 'download').replace(/\s+/g, '-')
  return totaal > 1 ? `${naam}-${d}-deel-${deel}-van-${totaal}.zip` : `${naam}-${d}.zip`
}
