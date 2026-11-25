import 'server-only'
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { merkFonts, merkLogo, MERK_ZWART } from '@/lib/pdf-merk'
import { wikkel } from '@/lib/shoot-document'
import { plaatsVan, type Item } from '@/lib/agenda/model'

/**
 * De takenlijst van één dag als pdf om af te drukken: afspraken op uur, taken
 * van die dag en wat nog open staat van vroeger, elk met een vakje om af te
 * vinken. In de huisstijl van NextGen Agency.
 */

const A4 = { w: 595.28, h: 841.89 }
const M = 46
const GRIJS = rgb(0.43, 0.43, 0.43)
const LICHT = rgb(0.88, 0.88, 0.88)
const ROOD = rgb(0.75, 0.1, 0.1)

export type PdfRegel = { item: Item; pad: string; wie: string[]; labels: string[] }

const hm = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`

export async function maakTakenlijstPdf(p: { dag: string; voor: string; afspraken: PdfRegel[]; taken: PdfRegel[]; teLaat: PdfRegel[]; klaar: PdfRegel[] }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Takenlijst ${p.dag}`)
  pdf.setProducer('NextGen Agency')
  const { font, vet, mono, eigen } = await merkFonts(pdf)
  const logo = await merkLogo(pdf)
  // Zonder eigen lettertype (Helvetica) enkel tekens die het kent; met eigen lettertype geen emoji.
  const schoon = (t: string) => (eigen ? t.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '') : t.replace(/[^\x20-\x7E\xA0-\xFF€–—‘’“”•…]/g, '')).replace(/\s+/g, ' ').trim()
  let page: PDFPage = pdf.addPage([A4.w, A4.h])
  let y = A4.h - M
  const breedte = A4.w - 2 * M
  const datumLang = new Date(`${p.dag}T12:00:00Z`).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

  const tekst = (t: string, x: number, yy: number, o: { size?: number; f?: PDFFont; kleur?: ReturnType<typeof rgb>; rechts?: boolean } = {}) => {
    const f = o.f ?? font, size = o.size ?? 10, s = schoon(t)
    page.drawText(s, { x: o.rechts ? x - f.widthOfTextAtSize(s, size) : x, y: yy, size, font: f, color: o.kleur ?? MERK_ZWART })
  }
  const kop = () => {
    if (logo) { const h = 26, w = (logo.width / logo.height) * h; page.drawImage(logo, { x: M - 2, y: y - h + 6, width: w, height: h }) }
    else tekst('NEXTGEN AGENCY', M, y - 14, { size: 13, f: vet })
    tekst('TAKENLIJST', A4.w - M, y - 8, { size: 9, f: mono, kleur: GRIJS, rechts: true })
    y -= 44
  }
  const nieuwePagina = () => { page = pdf.addPage([A4.w, A4.h]); y = A4.h - M; kop() }
  const ruimte = (h: number) => { if (y - h < M + 20) nieuwePagina() }

  kop()
  tekst(datumLang.charAt(0).toUpperCase() + datumLang.slice(1), M, y, { size: 20, f: vet })
  y -= 18
  tekst(p.voor, M, y, { size: 10, kleur: GRIJS })
  y -= 24

  const sectie = (titel: string, regels: PdfRegel[], o: { uur?: boolean; laat?: boolean; klaar?: boolean } = {}) => {
    if (!regels.length) return
    ruimte(40)
    tekst(`${titel.toUpperCase()} · ${regels.length}`, M, y, { size: 8, f: mono, kleur: GRIJS })
    y -= 6
    page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.6, color: LICHT })
    y -= 14
    for (const r of regels) {
      const i = r.item
      const links = M + (o.uur ? 62 : 18)
      const tbreed = breedte - (links - M)
      const titelRegels = wikkel(vet, schoon(i.titel), 10.5, tbreed)
      const sub = [r.pad, r.wie.length ? r.wie.join(', ') : '', r.labels.join(', '), i.locatie ?? '', o.laat && i.eind_op ? `was voor ${new Date(i.eind_op).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' })}` : ''].filter(Boolean).join('  ·  ')
      const subRegels = sub ? wikkel(font, schoon(sub), 8.5, tbreed) : []
      const h = titelRegels.length * 13 + subRegels.length * 11 + 8
      ruimte(h)
      // Vakje om af te vinken (bij afspraken het uur ervoor).
      if (o.uur) {
        const pl = plaatsVan(i)
        const tijd = pl?.soort === 'rooster' ? `${hm(pl.vanMin)}–${hm(pl.totMin)}` : 'Hele dag'
        tekst(tijd, M, y, { size: 9, f: mono })
      } else {
        page.drawRectangle({ x: M, y: y - 2, width: 10, height: 10, borderColor: o.klaar ? GRIJS : MERK_ZWART, borderWidth: 0.9, color: o.klaar ? LICHT : undefined })
        if (o.klaar) {
          page.drawLine({ start: { x: M + 2, y: y + 3 }, end: { x: M + 4.5, y: y + 0.5 }, thickness: 1.2, color: MERK_ZWART })
          page.drawLine({ start: { x: M + 4.5, y: y + 0.5 }, end: { x: M + 8.5, y: y + 6 }, thickness: 1.2, color: MERK_ZWART })
        }
      }
      let yy = y
      for (const t of titelRegels) { tekst(t, links, yy, { size: 10.5, f: vet, kleur: o.klaar ? GRIJS : o.laat ? ROOD : MERK_ZWART }); yy -= 13 }
      if (i.urgent && !o.klaar) tekst('DRINGEND', A4.w - M, y, { size: 7, f: mono, kleur: ROOD, rechts: true })
      for (const t of subRegels) { tekst(t, links, yy, { size: 8.5, kleur: GRIJS }); yy -= 11 }
      y = yy - 8
    }
    y -= 10
  }

  sectie('Afspraken', p.afspraken, { uur: true })
  sectie('Taken vandaag', p.taken)
  sectie('Nog open van eerder', p.teLaat, { laat: true })
  sectie('Al afgevinkt', p.klaar, { klaar: true })
  if (!p.afspraken.length && !p.taken.length && !p.teLaat.length && !p.klaar.length) tekst('Niets gepland voor deze dag.', M, y, { size: 11, kleur: GRIJS })

  // Voetregel op elke pagina.
  const n = pdf.getPageCount()
  pdf.getPages().forEach((pg, idx) => {
    const s = schoon(`Afgedrukt ${new Date().toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Brussels' })} · pagina ${idx + 1}/${n}`)
    pg.drawText(s, { x: M, y: 24, size: 7.5, font: mono, color: GRIJS })
  })
  return pdf.save()
}
