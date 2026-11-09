import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { controleerZone, type OnsZone } from './tegenhandtekening'

/** Onleesbare tekens (buiten WinAnsi) vervangen, anders weigert de standaardfont. */
const veilig = (s: string) => s.replace(/[^\x20-\x7E -ÿ]/g, '?')

/**
 * Onze handtekening op een kopie van het PDF zetten. Zelfde rekenwijze als die
 * van de klant: x/y in % vanaf linksboven, breedte en hoogte in punten. De
 * tekening houdt haar verhouding binnen het vak; eronder één grijze regel.
 * Geeft de nieuwe bytes en de werkelijk gebruikte zone terug.
 */
export async function stempelTegenhandtekening(bron: Uint8Array, png: Uint8Array, zoneIn: unknown, regel: string): Promise<{ bytes: Uint8Array; zone: OnsZone }> {
  const pdf = await PDFDocument.load(bron, { ignoreEncryption: true })
  const paginas = pdf.getPages()
  const zone = controleerZone(zoneIn, paginas.length)
  const pagina = paginas[zone.page - 1]
  const { width: W, height: H } = pagina.getSize()
  const x = (zone.x / 100) * W
  const y = H - (zone.y / 100) * H - zone.h
  const beeld = await pdf.embedPng(png)
  const schaal = Math.min(zone.w / beeld.width, zone.h / beeld.height)
  const bw = beeld.width * schaal, bh = beeld.height * schaal
  pagina.drawImage(beeld, { x: x + (zone.w - bw) / 2, y: y + (zone.h - bh) / 2, width: bw, height: bh })
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  pagina.drawText(veilig(regel), { x, y: y - 12, size: 7, font, color: rgb(0.4, 0.4, 0.4), maxWidth: Math.max(zone.w + 100, 180) })
  return { bytes: await pdf.save(), zone }
}
