import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { controleerZone } from '@/lib/contracten/tegenhandtekening'
import type { Zone } from './model'

/** Onleesbare tekens (buiten WinAnsi) vervangen, anders weigert de standaardfont. */
const veilig = (s: string) => s.replace(/[^\x20-\x7E -ÿ]/g, '?')

/** Hoogte (punten) per regel onder de handtekening. */
export const REGEL_HOOGTE = 10

/** Aantal pagina's, of een fout als het geen leesbare PDF is. */
export async function pdfInfo(bytes: Uint8Array): Promise<{ paginas: number }> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  return { paginas: pdf.getPageCount() }
}

/**
 * Een handtekening op een kopie van de PDF zetten, als één blok: bovenaan de
 * getekende handtekening, eronder de regels (naam, datum en uur). x/y in %
 * vanaf linksboven, breedte en hoogte in punten, zoals bij het tegentekenen.
 */
export async function stempelBlok(bron: Uint8Array, png: Uint8Array, zoneIn: unknown, regels: string[]): Promise<{ bytes: Uint8Array; zone: Zone }> {
  const pdf = await PDFDocument.load(bron, { ignoreEncryption: true })
  const paginas = pdf.getPages()
  const zone = controleerZone(zoneIn, paginas.length)
  const pagina = paginas[zone.page - 1]
  const { width: W, height: H } = pagina.getSize()
  const x = (zone.x / 100) * W
  const onder = H - (zone.y / 100) * H - zone.h
  const tekstHoogte = regels.length * REGEL_HOOGTE

  const beeld = await pdf.embedPng(png)
  const ruimte = Math.max(10, zone.h - tekstHoogte)
  const schaal = Math.min(zone.w / beeld.width, ruimte / beeld.height)
  const bw = beeld.width * schaal, bh = beeld.height * schaal
  pagina.drawImage(beeld, { x: x + (zone.w - bw) / 2, y: onder + tekstHoogte, width: bw, height: bh })

  const font = await pdf.embedFont(StandardFonts.Helvetica)
  regels.forEach((r, i) => {
    const t = veilig(r)
    let grootte = 8
    while (grootte > 5 && font.widthOfTextAtSize(t, grootte) > zone.w) grootte -= 0.5
    const tw = font.widthOfTextAtSize(t, grootte)
    const y = onder + 2 + (regels.length - 1 - i) * REGEL_HOOGTE
    pagina.drawText(t, { x: x + Math.max(0, (zone.w - tw) / 2), y, size: grootte, font, color: rgb(0.2, 0.2, 0.2) })
  })
  return { bytes: await pdf.save(), zone }
}
