// Huisstijl NextGen Agency in pdf's: Archivo (tekst, titels in Archivo Bold) en
// JetBrains Mono (labels), het woordmerk en zwart als accent. Server-only.
//
// De lettertypes staan in lib/fonts (SIL Open Font License 1.1). Lukt het
// inladen niet, dan vallen we terug op Helvetica en Courier: een pdf mag
// nooit mislukken door een lettertype.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { StandardFonts, rgb, type PDFDocument, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib'
import { veilig } from '@/lib/shoot-document-model'
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

// ── Huisstijl NextGenMedia in pdf's ─────────────────────────────────────────
// Bricolage Grotesque (titels), DM Sans (tekst) en DM Mono (labels), woud en
// zonnegeel. Zie lib/ngm-merk.ts. Lukt een lettertype niet, dan Helvetica.

const hex = (h: string) => { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255) }
export const NGM_PDF = {
  woud: hex('#0C2B1E'), zonnegeel: hex('#FDDB57'), kalk: hex('#FAF7EE'), mos: hex('#A9BFA9'), varen: hex('#4F6B5A'), lijn: hex('#E6E0D0'),
}

/** font = DM Sans Regular, nadruk = DM Sans SemiBold, vet = Bricolage Grotesque Bold, titel = Bricolage Grotesque ExtraBold, mono = DM Mono. */
export type NgmFonts = MerkFonts & { nadruk: PDFFont; titel: PDFFont }

export async function ngmFonts(pdf: PDFDocument): Promise<NgmFonts> {
  try {
    const [r, sb, b, xb, m] = await Promise.all([
      lees('DMSans-Regular.ttf'), lees('DMSans-SemiBold.ttf'), lees('BricolageGrotesque-Bold.ttf'), lees('BricolageGrotesque-ExtraBold.ttf'), lees('DMMono-Regular.ttf'),
    ])
    pdf.registerFontkit(fontkit)
    const [font, nadruk, vet, titel, mono] = await Promise.all([r, sb, b, xb, m].map((x) => pdf.embedFont(new Uint8Array(x), { subset: true })))
    return { font, nadruk, vet, titel, mono, eigen: true }
  } catch {
    const [font, vet, mono] = await Promise.all([
      pdf.embedFont(StandardFonts.Helvetica), pdf.embedFont(StandardFonts.HelveticaBold), pdf.embedFont(StandardFonts.Courier),
    ])
    return { font, nadruk: vet, vet, titel: vet, mono, eigen: false }
  }
}

/** Het logo van NextGenMedia: woud (op wit of kalk) of zonnegeel (op woud). public/merk/ngm/. */
export async function ngmLogo(pdf: PDFDocument, kleur: 'woud' | 'zonnegeel' | 'kalk' = 'woud'): Promise<PDFImage | null> {
  const naam = kleur === 'woud' ? 'logo-pdf.png' : `logo-${kleur}.png`
  try { return await pdf.embedPng(new Uint8Array(await readFile(path.join(process.cwd(), 'public', 'merk', 'ngm', naam)))) } catch { return null }
}

/** De ruwe bytes van het NextGenMedia-logo (woud), voor wie zelf insluit (certificaat). */
export async function ngmLogoBytes(): Promise<Uint8Array | null> {
  try { return new Uint8Array(await readFile(path.join(process.cwd(), 'public', 'merk', 'ngm', 'logo-pdf.png'))) } catch { return null }
}

/** Een label in DM Mono, in kapitalen en met wat letterafstand (zoals in het brandbook). */
export function monoLabel(page: PDFPage, mono: PDFFont, tekst: string, x: number, y: number, size: number, kleur: RGB, rechts = false): number {
  const t = veilig(tekst).toUpperCase()
  const extra = size * 0.12
  const w = Array.from(t).reduce((n, c) => n + mono.widthOfTextAtSize(c, size) + extra, 0) - extra
  let xx = rechts ? x - w : x
  for (const c of Array.from(t)) { page.drawText(c, { x: xx, y, size, font: mono, color: kleur }); xx += mono.widthOfTextAtSize(c, size) + extra }
  return w
}
