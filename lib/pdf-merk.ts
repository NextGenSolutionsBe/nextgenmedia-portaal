// Huisstijl NextGen Agency in pdf's: Archivo (tekst, titels in Archivo Bold) en
// JetBrains Mono (labels), het woordmerk en zwart als accent. Server-only.
//
// De lettertypes staan in lib/fonts (SIL Open Font License 1.1). Lukt het
// inladen niet, dan vallen we terug op Helvetica en Courier: een pdf mag
// nooit mislukken door een lettertype.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { StandardFonts, rgb, type PDFDocument, type PDFFont, type PDFImage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

/** Zwart uit de brand guideline (#0F0F0F). */
export const MERK_ZWART = rgb(15 / 255, 15 / 255, 15 / 255)

export type MerkFonts = { font: PDFFont; vet: PDFFont; mono: PDFFont; eigen: boolean }

const lees = (naam: string) => readFile(path.join(process.cwd(), 'lib', 'fonts', naam))

export async function merkFonts(pdf: PDFDocument): Promise<MerkFonts> {
  try {
    const [r, b, m] = await Promise.all([lees('Archivo-Regular.ttf'), lees('Archivo-Bold.ttf'), lees('JetBrainsMono-Medium.ttf')])
    pdf.registerFontkit(fontkit)
    const [font, vet, mono] = await Promise.all([
      pdf.embedFont(new Uint8Array(r), { subset: true }),
      pdf.embedFont(new Uint8Array(b), { subset: true }),
      pdf.embedFont(new Uint8Array(m), { subset: true }),
    ])
    return { font, vet, mono, eigen: true }
  } catch {
    const [font, vet, mono] = await Promise.all([
      pdf.embedFont(StandardFonts.Helvetica), pdf.embedFont(StandardFonts.HelveticaBold), pdf.embedFont(StandardFonts.Courier),
    ])
    return { font, vet, mono, eigen: false }
  }
}

/** Het woordmerk NEXTGEN AGENCY (zwart, transparant): public/logo-pdf.png. */
export async function merkLogo(pdf: PDFDocument): Promise<PDFImage | null> {
  try { return await pdf.embedPng(new Uint8Array(await readFile(path.join(process.cwd(), 'public', 'logo-pdf.png')))) } catch { return null }
}
