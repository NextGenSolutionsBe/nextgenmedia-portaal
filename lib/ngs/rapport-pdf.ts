import 'server-only'
import { PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib'
import { ngsFonts, ngsLogo, monoLabel, NGS_PDF } from '@/lib/pdf-merk'
import { wikkel } from '@/lib/shoot-document'
import { veilig } from '@/lib/shoot-document-model'
import { maatLabel } from '@/lib/werking/instellingen'
import type { KlantWorkflow } from './audit'

/**
 * Het auditrapport als pdf, in de huisstijl van NextGenSolutions (kalk, inkt,
 * NextGen-blauw). Per workflow: de oplossing, de maat, de vaste prijs, de
 * bespaarde uren per week en de terugverdientijd. Nooit de formule, de
 * uurwaarde of de uurprijs: enkel wat in KlantWorkflow staat.
 */
const A4 = { w: 595.28, h: 841.89 }
const M = 48
const eur = (n: number) => `€ ${n.toLocaleString('nl-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

export async function maakRapportPdf(o: { klant: string; datum: string; workflows: KlantWorkflow[]; handelsnaam: string; nazorgWeken?: number | null }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Auditrapport ${o.klant}`)
  pdf.setProducer('NextGen Agency')
  const f = await ngsFonts(pdf)
  const logo = await ngsLogo(pdf, 'kleur')
  let page: PDFPage = pdf.addPage([A4.w, A4.h])
  let y = A4.h

  const kop = () => {
    page.drawRectangle({ x: 0, y: A4.h - 92, width: A4.w, height: 92, color: NGS_PDF.kalk })
    page.drawRectangle({ x: 0, y: A4.h - 92, width: A4.w, height: 2, color: NGS_PDF.blauw })
    if (logo) { const s = 34 / logo.height; page.drawImage(logo, { x: M, y: A4.h - 62, width: logo.width * s, height: 34 }) }
    monoLabel(page, f.mono, 'Auditrapport', A4.w - M, A4.h - 50, 11, NGS_PDF.blauw, true)
    y = A4.h - 128
  }
  const nieuwePagina = () => { page = pdf.addPage([A4.w, A4.h]); kop() }
  const ruimte = (h: number) => { if (y - h < 64) nieuwePagina() }
  const tekst = (t: string, font: PDFFont, size: number, kleur = NGS_PDF.inkt, x = M, breedte = A4.w - 2 * M, lijn = 1.35) => {
    for (const r of wikkel(font, veilig(t), size, breedte)) { ruimte(size * lijn); page.drawText(r, { x, y, size, font, color: kleur }); y -= size * lijn }
  }

  kop()
  tekst(o.klant, f.titel, 22)
  y -= 4
  tekst(`Opgesteld op ${o.datum} door ${o.handelsnaam}.`, f.font, 10, NGS_PDF.tekst)
  y -= 14

  // Overzicht.
  const totaal = o.workflows.reduce((s, w) => s + (w.prijs ?? 0), 0)
  const uren = o.workflows.reduce((s, w) => s + (w.uren_per_week ?? 0), 0)
  ruimte(70)
  page.drawRectangle({ x: M, y: y - 52, width: A4.w - 2 * M, height: 60, color: NGS_PDF.ijs })
  monoLabel(page, f.mono, 'Samen', M + 14, y - 10, 9, NGS_PDF.blauw)
  page.drawText(veilig(`${o.workflows.length} ${o.workflows.length === 1 ? 'workflow' : 'workflows'} · ${eur(totaal)} excl. btw${uren ? ` · ${uren.toLocaleString('nl-BE')} uur per week bespaard` : ''}`), { x: M + 14, y: y - 34, size: 12, font: f.nadruk, color: NGS_PDF.inkt })
  y -= 80

  o.workflows.forEach((w, i) => {
    ruimte(120)
    monoLabel(page, f.mono, `Workflow ${i + 1}`, M, y, 9, NGS_PDF.blauw)
    y -= 16
    tekst(w.naam, f.vet, 14)
    y -= 2
    const feiten = [
      w.andere_waarde ? 'Project zonder tijdswinst' : w.maat ? `Maat: ${maatLabel(w.maat)}` : null,
      w.prijs ? `Vaste prijs: ${eur(w.prijs)} excl. btw` : null,
      w.uren_per_week ? `Bespaard: ${w.uren_per_week.toLocaleString('nl-BE')} uur per week` : null,
      w.terugverdientijd_maanden ? `Terugverdiend in ongeveer ${w.terugverdientijd_maanden.toLocaleString('nl-BE')} maanden` : null,
    ].filter(Boolean).join('  ·  ')
    tekst(feiten, f.nadruk, 10, NGS_PDF.tekstSterk)
    y -= 4
    if (w.oplossing) tekst(w.oplossing, f.font, 10.5, NGS_PDF.inkt)
    y -= 12
    ruimte(10)
    page.drawRectangle({ x: M, y, width: A4.w - 2 * M, height: 0.7, color: NGS_PDF.lijn })
    y -= 18
  })

  ruimte(60)
  tekst(`Elke oplossing heeft een interface of minstens een logboek, zodat je altijd ziet wat er gebeurde. Na de bouw volgt een oplevering met video en ${o.nazorgWeken ? `${o.nazorgWeken} ${o.nazorgWeken === 1 ? 'week' : 'weken'} nazorg` : 'nazorg'}.`, f.font, 9.5, NGS_PDF.tekst)

  // Voet op elke pagina.
  const n = pdf.getPageCount()
  pdf.getPages().forEach((p, i) => {
    p.drawText(veilig(`${o.handelsnaam} · pagina ${i + 1} van ${n}`), { x: M, y: 30, size: 8, font: f.font, color: NGS_PDF.steen })
  })
  return pdf.save()
}
