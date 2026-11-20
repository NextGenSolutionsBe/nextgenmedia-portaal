// De tekst uit een Word-document (.docx) halen, in de browser, zonder extra
// bibliotheek. Een docx is een zip met xml (word/document.xml); elke alinea
// wordt een regel. Opmaak, foto's en kop- of voetteksten vallen weg.

import { zipInhoud, type ZipItem } from '@/lib/xlsx-lezen'

async function lees(buf: ArrayBuffer, i: ZipItem): Promise<string> {
  const ruw = new Uint8Array(buf, i.offset, i.grootte)
  if (i.methode === 0) return new TextDecoder().decode(ruw)
  if (i.methode !== 8 || typeof DecompressionStream === 'undefined') throw new Error('Dit Word-document kan de browser niet lezen. Bewaar het als pdf.')
  return new Response(new Blob([ruw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
}

/** Tekst uit de xml van word/document.xml (los, zodat het getest kan worden). */
export function tekstUitDocumentXml(xml: string): string {
  const alineas = xml.split(/<\/w:p>/)
  const uit: string[] = []
  for (const a of alineas) {
    const t = a
      // Tab en regeleinde als eigen stukje tekst, zodat ze tussen de woorden blijven staan.
      .replace(/<w:tab\/>/g, '\u0000\t\u0000')
      .replace(/<w:br[^>]*\/>/g, '\u0000\n\u0000')
      .replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, '\u0000$1\u0000')
      .split('\u0000')
      .filter((_, i) => i % 2 === 1)
      .join('')
    uit.push(t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'))
  }
  return uit.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export async function leesDocx(bestand: File): Promise<string> {
  const buf = await bestand.arrayBuffer()
  const doc = zipInhoud(buf, 'Word-document (.docx)').find((i) => i.naam === 'word/document.xml')
  if (!doc) throw new Error('Dit is geen geldig Word-document (.docx).')
  return tekstUitDocumentXml(await lees(buf, doc))
}
