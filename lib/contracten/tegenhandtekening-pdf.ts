import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { DATUM_HOOGTE, controleerZone, type OnsZone } from './tegenhandtekening'

/** Onleesbare tekens (buiten WinAnsi) vervangen, anders weigert de standaardfont. */
const veilig = (s: string) => s.replace(/[^\x20-\x7E -ÿ]/g, '?')

/**
 * Onze handtekening op een kopie van het PDF zetten, als één blok: bovenaan
 * de getekende handtekening, eronder de datum en het uur van tekenen. Zelfde
 * rekenwijze als die van de klant: x/y in % vanaf linksboven, breedte en
 * hoogte in punten. Geeft de nieuwe bytes en de werkelijk gebruikte zone terug.
 */
export async function stempelTegenhandtekening(bron: Uint8Array, png: Uint8Array, zoneIn: unknown, datum: string): Promise<{ bytes: Uint8Array; zone: OnsZone }> {
  const pdf = await PDFDocument.load(bron, { ignoreEncryption: true })
  const paginas = pdf.getPages()
  const zone = controleerZone(zoneIn, paginas.length)
  const pagina = paginas[zone.page - 1]
  const { width: W, height: H } = pagina.getSize()
  const x = (zone.x / 100) * W
  const onder = H - (zone.y / 100) * H - zone.h // onderrand van het blok (PDF-oorsprong linksonder)

  // Handtekening: in het bovenste deel, verhouding behouden, gecentreerd, net boven de datum.
  const beeld = await pdf.embedPng(png)
  const ruimte = Math.max(10, zone.h - DATUM_HOOGTE)
  const schaal = Math.min(zone.w / beeld.width, ruimte / beeld.height)
  const bw = beeld.width * schaal, bh = beeld.height * schaal
  pagina.drawImage(beeld, { x: x + (zone.w - bw) / 2, y: onder + DATUM_HOOGTE, width: bw, height: bh })

  // Datum en uur, gecentreerd onderaan in hetzelfde blok.
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const tekst = veilig(datum)
  let grootte = 8
  while (grootte > 5 && font.widthOfTextAtSize(tekst, grootte) > zone.w) grootte -= 0.5
  const tw = font.widthOfTextAtSize(tekst, grootte)
  pagina.drawText(tekst, { x: x + Math.max(0, (zone.w - tw) / 2), y: onder + 2, size: grootte, font, color: rgb(0.2, 0.2, 0.2) })
  return { bytes: await pdf.save(), zone }
}
