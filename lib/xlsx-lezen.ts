// Het eerste werkblad van een .xlsx lezen, in de browser, zonder extra
// bibliotheek. Een xlsx is een zip met xml; de browser pakt de zip uit
// (DecompressionStream) en leest de xml (DOMParser). Geeft een tabel van
// teksten terug (eerste rij = de koppen). Enkel voor imports, nooit op de server.

type Item = { naam: string; methode: number; grootte: number; offset: number }

function zipInhoud(buf: ArrayBuffer): Item[] {
  const d = new DataView(buf)
  // Einde van de centrale map zoeken (vanaf achteraan).
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) if (d.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('Dit is geen geldig Excel-bestand (.xlsx).')
  const aantal = d.getUint16(eocd + 10, true)
  let p = d.getUint32(eocd + 16, true)
  const uit: Item[] = []
  const dec = new TextDecoder()
  for (let n = 0; n < aantal; n++) {
    if (d.getUint32(p, true) !== 0x02014b50) break
    const methode = d.getUint16(p + 10, true)
    const grootte = d.getUint32(p + 20, true)
    const lNaam = d.getUint16(p + 28, true), lExtra = d.getUint16(p + 30, true), lComm = d.getUint16(p + 32, true)
    const lokaal = d.getUint32(p + 42, true)
    const naam = dec.decode(new Uint8Array(buf, p + 46, lNaam))
    // Data begint na de lokale kop (30 bytes + naam + extra van de lokale kop).
    const lN = d.getUint16(lokaal + 26, true), lE = d.getUint16(lokaal + 28, true)
    uit.push({ naam, methode, grootte, offset: lokaal + 30 + lN + lE })
    p += 46 + lNaam + lExtra + lComm
  }
  return uit
}

async function lees(buf: ArrayBuffer, i: Item): Promise<string> {
  const ruw = new Uint8Array(buf, i.offset, i.grootte)
  if (i.methode === 0) return new TextDecoder().decode(ruw)
  if (i.methode !== 8) throw new Error('Dit Excel-bestand gebruikt een compressie die we niet kunnen lezen. Bewaar het als .csv.')
  if (typeof DecompressionStream === 'undefined') throw new Error('Deze browser kan geen Excel lezen. Bewaar het bestand als .csv of gebruik een recente browser.')
  const stream = new Blob([ruw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).text()
}

const kolomNr = (ref: string) => { let n = 0; for (const c of ref.replace(/\d+$/, '')) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1 }

export async function leesXlsx(bestand: File): Promise<string[][]> {
  const buf = await bestand.arrayBuffer()
  const items = zipInhoud(buf)
  const vind = (n: string) => items.find((i) => i.naam === n)
  const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml')

  // Gedeelde teksten (de meeste cellen met tekst verwijzen hiernaar).
  const gedeeld: string[] = []
  const ss = vind('xl/sharedStrings.xml')
  if (ss) for (const si of Array.from(xml(await lees(buf, ss)).getElementsByTagName('si'))) gedeeld.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''))

  // Het eerste werkblad volgens de werkmap (anders sheet1.xml).
  let pad = 'xl/worksheets/sheet1.xml'
  const wb = vind('xl/workbook.xml'), rels = vind('xl/_rels/workbook.xml.rels')
  if (wb && rels) {
    const eerste = xml(await lees(buf, wb)).getElementsByTagName('sheet')[0]
    const rid = eerste?.getAttribute('r:id') ?? eerste?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    const doel = Array.from(xml(await lees(buf, rels)).getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target')
    if (doel) pad = doel.startsWith('/') ? doel.slice(1) : `xl/${doel.replace(/^\.\//, '')}`
  }
  const blad = vind(pad) ?? items.find((i) => /^xl\/worksheets\/sheet\d+\.xml$/.test(i.naam))
  if (!blad) throw new Error('Geen werkblad gevonden in dit Excel-bestand.')

  const tabel: string[][] = []
  for (const row of Array.from(xml(await lees(buf, blad)).getElementsByTagName('row'))) {
    const rij: string[] = []
    for (const c of Array.from(row.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r') ?? ''
      const idx = ref ? kolomNr(ref) : rij.length
      const t = c.getAttribute('t')
      let w = ''
      if (t === 's') w = gedeeld[Number(c.getElementsByTagName('v')[0]?.textContent ?? -1)] ?? ''
      else if (t === 'inlineStr') w = Array.from(c.getElementsByTagName('t')).map((x) => x.textContent ?? '').join('')
      else w = c.getElementsByTagName('v')[0]?.textContent ?? ''
      while (rij.length < idx) rij.push('')
      rij[idx] = w
    }
    if (rij.some((v) => v.trim() !== '')) tabel.push(rij)
  }
  return tabel
}
