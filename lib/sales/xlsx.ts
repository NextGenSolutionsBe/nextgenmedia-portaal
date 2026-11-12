import 'server-only'
import { readZip } from '@/lib/zip'
import { readSharedStrings, readSheet } from '@/lib/xlsx-kern'

/**
 * Minimale .xlsx-lezer — ZONDER externe bibliotheek.
 *
 * Waarom zelf geschreven: de gangbare pakketten (xlsx, exceljs) brengen elk
 * meerdere bekende kwetsbaarheden mee. Een xlsx is in de kern een ZIP met XML,
 * en Node kan zelf uitpakken (zlib). Voor "exporteer je lijst en importeer hem"
 * is dat ruim voldoende, zonder de aanvalsoppervlakte te vergroten.
 *
 * De XML-verwerking zelf staat in lib/xlsx-kern.ts — puur en los testbaar.
 * Dat is niet vrijblijvend: precies daar zat een bug die cellen liet
 * verschuiven, en die kon alleen boven water komen met echte bestanden.
 * Dit bestand doet nog maar twee dingen: uitpakken en samenstellen.
 */

export type Sheet = { headers: string[]; rows: string[][] }

export type SheetMetVerborgen = Sheet & {
  /** Rijen die in Excel verborgen zijn (filter of handmatig). De import toont
   *  dit aantal en laat de mens beslissen — nooit stilletjes meenemen. */
  verborgen: string[][]
}

function leesWerkblad(buf: Buffer) {
  const files = readZip(buf)

  const sharedXml = files.get('xl/sharedStrings.xml')
  const shared = sharedXml ? readSharedStrings(sharedXml.toString('utf8')) : []

  // Het eerste werkblad; namen kunnen variëren, dus we zoeken breed.
  const sheetName = [...files.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d*\.xml$/.test(n))
    .sort()[0]
  if (!sheetName) throw new Error('Geen werkblad gevonden in dit Excel-bestand.')

  return readSheet(files.get(sheetName)!.toString('utf8'), shared)
}

function samenstellen(buf: Buffer) {
  const alle = leesWerkblad(buf).filter((r) => r.cellen.some((v) => v !== ''))
  if (alle.length === 0) return null

  // De koprij is de eerste gevulde rij, ook als die verborgen zou zijn —
  // zonder koppen valt er niets te importeren.
  const headers = alle[0].cellen.map((h) => h.trim())
  const naKop = alle.slice(1)
  const vul = (r: { cellen: string[] }) => headers.map((_, i) => (r.cellen[i] ?? '').trim())
  return { headers, naKop, vul }
}

/** Eerste werkblad als koppen + rijen, zichtbaar én verborgen apart. */
export function parseXlsxMetVerborgen(buf: Buffer): SheetMetVerborgen {
  const s = samenstellen(buf)
  if (!s) return { headers: [], rows: [], verborgen: [] }
  return {
    headers: s.headers,
    rows: s.naKop.filter((r) => !r.verborgen).map(s.vul),
    verborgen: s.naKop.filter((r) => r.verborgen).map(s.vul),
  }
}

/** Eerste werkblad van een .xlsx als koppen + rijen — alles, ook verborgen,
 *  in de oorspronkelijke volgorde. Voor documentinhoud (bestekken) is
 *  verbergen opmaak, geen selectie. */
export function parseXlsx(buf: Buffer): Sheet {
  const s = samenstellen(buf)
  if (!s) return { headers: [], rows: [] }
  return { headers: s.headers, rows: s.naKop.map(s.vul) }
}
