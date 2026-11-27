import 'server-only'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { lijnVeldenUit, lijnZoneUit, onsZoneUit, splitsInvulTekst, type PaginaVormen, type Tekst, type VeldIn, type Vorm, type ZoneIn } from './velden-uitlijnen'

/**
 * De vormen van een pdf uitlezen met pdf.js (legacy-build, werkt in Node): per
 * pagina de horizontale lijnen, kleine vierkantjes (vinkvakjes), kaders en de
 * tekst met hun plaats. Daarmee zet velden-uitlijnen.ts de velden van de AI recht.
 * Lukt het niet (beveiligde of vreemde pdf), dan blijven de plekken van de AI.
 */

type M = [number, number, number, number, number, number]
const EEN: M = [1, 0, 0, 1, 0, 0]
/** Eerst m1, dan m2 (zoals `cm` in een pdf: nieuwe matrix × huidige). */
const maal = (m1: M, m2: M): M => [
  m1[0] * m2[0] + m1[1] * m2[2], m1[0] * m2[1] + m1[1] * m2[3],
  m1[2] * m2[0] + m1[3] * m2[2], m1[2] * m2[1] + m1[3] * m2[3],
  m1[4] * m2[0] + m1[5] * m2[2] + m2[4], m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
]
const punt = (m: M, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsBelofte: Promise<any> | null = null
function laadPdfjs() {
  if (!pdfjsBelofte) {
    pdfjsBelofte = import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
      // In Node draait pdf.js zonder echte worker; de "nepworker" laadt dit bestand.
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs')).href
      }
      return pdfjs
    }).catch((e) => { pdfjsBelofte = null; throw e })
  }
  return pdfjsBelofte
}

/** De vormen van de gevraagde pagina's (1-geïndexeerd). */
export async function vormenVanPdf(bytes: Uint8Array, paginas: number[]): Promise<PaginaVormen[]> {
  const pdfjs = await laadPdfjs()
  const taak = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 })
  const doc = await taak.promise
  const O = pdfjs.OPS
  const uit: PaginaVormen[] = []
  try {
    for (const nr of Array.from(new Set(paginas)).filter((n) => n >= 1 && n <= doc.numPages).sort((a, b) => a - b)) {
      const page = await doc.getPage(nr)
      if ((page.rotate ?? 0) % 360 !== 0) continue // gedraaide pagina's laten we zoals de AI ze zag
      const [vx0, vy0, vx1, vy1] = page.view as number[]
      const W = vx1 - vx0, H = vy1 - vy0
      // pdf-coördinaten (linksonder) → punten vanaf linksboven
      const naarBoven = (x0: number, y0: number, x1: number, y1: number): Vorm => ({ x: x0 - vx0, y: H - (y1 - vy0), w: x1 - x0, h: y1 - y0 })

      const lijnen: Vorm[] = [], vakjes: Vorm[] = [], kaders: Vorm[] = []
      const ops = await page.getOperatorList()
      let ctm: M = EEN
      const stapel: M[] = []
      for (let i = 0; i < ops.fnArray.length; i++) {
        const f = ops.fnArray[i], a = ops.argsArray[i]
        if (f === O.save) stapel.push(ctm)
        else if (f === O.restore) ctm = stapel.pop() ?? ctm
        else if (f === O.transform) ctm = maal(a as M, ctm)
        else if (f === O.paintFormXObjectBegin) { stapel.push(ctm); const m = a?.[0] as ArrayLike<number> | null | undefined; if (m && m.length === 6) ctm = maal(Array.from(m) as M, ctm) }
        else if (f === O.paintFormXObjectEnd) ctm = stapel.pop() ?? ctm
        else if (f === O.constructPath) {
          const verf = a?.[0], mm = a?.[2]
          if (verf === O.endPath || !mm || mm.length < 4) continue // knippad, geen zichtbare vorm
          const [mx0, my0, mx1, my1] = Array.from(mm as ArrayLike<number>)
          if (![mx0, my0, mx1, my1].every(Number.isFinite)) continue
          const hoeken = [punt(ctm, mx0, my0), punt(ctm, mx1, my0), punt(ctm, mx0, my1), punt(ctm, mx1, my1)]
          const x0 = Math.min(...hoeken.map((p) => p.x)), x1 = Math.max(...hoeken.map((p) => p.x))
          const y0 = Math.min(...hoeken.map((p) => p.y)), y1 = Math.max(...hoeken.map((p) => p.y))
          const v = naarBoven(x0, y0, x1, y1)
          if (v.w >= 25 && v.h <= 2.5) lijnen.push({ ...v, y: v.y + v.h / 2, h: 0 })
          else if (v.w >= 5 && v.h >= 5 && v.w <= 20 && v.h <= 20 && Math.abs(v.w - v.h) <= 4) vakjes.push(v)
          else if (v.w >= 20 && v.h >= 14) kaders.push(v)
        }
      }

      const tc = await page.getTextContent()
      const teksten: Tekst[] = []
      for (const it of tc.items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
        const s = (it.str ?? '').trim()
        if (!s || !it.transform) continue
        const h = Math.abs(it.height || it.transform[3] || 10)
        const basis = H - (it.transform[5] - vy0)
        // "Naam: ______" als tekst: de streepjes worden een lijn, "Naam:" blijft het label.
        const d = splitsInvulTekst({ str: s, x: it.transform[4] - vx0, y: basis - h, w: it.width ?? 0, h })
        teksten.push(...d.teksten)
        lijnen.push(...d.lijnen)
      }
      uit.push({ nr, W, H, lijnen: ontdubbel(lijnen), vakjes: ontdubbel(vakjes), kaders: ontdubbel(kaders), teksten })
    }
  } finally {
    await taak.destroy().catch(() => null)
  }
  return uit
}

/** Een vorm die twee keer getekend werd (vulling + rand) telt één keer. */
function ontdubbel(l: Vorm[]): Vorm[] {
  const uit: Vorm[] = []
  for (const v of l) if (!uit.some((x) => Math.abs(x.x - v.x) < 1.5 && Math.abs(x.y - v.y) < 1.5 && Math.abs(x.w - v.w) < 2 && Math.abs(x.h - v.h) < 2)) uit.push(v)
  return uit
}

/**
 * De analyse van de AI rechtzetten op de pdf: velden op de lijnen, vakjes en kaders;
 * de handtekening van de klant in haar kader en, als er een tweede kader naast staat,
 * onze handtekening daar. Lukt het uitlezen niet, dan komt de analyse ongewijzigd terug.
 */
export async function lijnAnalyseUit<V extends VeldIn>(bytes: Uint8Array, a: { fields: V[]; signature: ZoneIn | null }): Promise<{ fields: V[]; signature: ZoneIn | null; ons: ZoneIn | null; uitgelijnd: boolean }> {
  try {
    const paginas = [...a.fields.map((f) => f.page_number), ...(a.signature ? [a.signature.page] : [])]
    if (!paginas.length) return { ...a, ons: null, uitgelijnd: false }
    const vormen = await vormenVanPdf(bytes, paginas)
    const signature = lijnZoneUit(a.signature, vormen)
    return { fields: lijnVeldenUit(a.fields, vormen), signature, ons: onsZoneUit(signature, vormen), uitgelijnd: true }
  } catch (e) {
    console.warn('[velden-uitlijnen]', e instanceof Error ? e.message : e)
    return { ...a, ons: null, uitgelijnd: false }
  }
}
