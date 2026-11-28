import 'server-only'
import { PDFDocument, rgb, type PDFPage } from 'pdf-lib'
import { wikkel } from '@/lib/shoot-document'
import { veilig, asciiNaamdeel } from '@/lib/shoot-document-model'
import { monoLabel, ngmFonts, ngmLogo, NGM_PDF } from '@/lib/pdf-merk'
import { datumLang, locatieVan, shootNaam, tijdBereik, type Shoot } from './model'

/**
 * Het shootplan als A4-pdf in de huisstijl van NextGenMedia (lib/ngm-merk.ts):
 * kop in woud met het logo in zonnegeel, gegevensblok, het programma per uur
 * (met locatie en wie), de locaties, wie erbij is, shotlist en paklijst om af
 * te vinken, praktische info en de briefing. Een blok wordt nooit over twee
 * pagina's gebroken.
 */

const A4 = { w: 595.28, h: 841.89 }
const MARGE = 48
const ONDER = 60
const ZWART = NGM_PDF.woud
const GRIJS = NGM_PDF.varen
const LIJN = NGM_PDF.lijn
const LICHT = NGM_PDF.kalk
const ROOD = rgb(0.75, 0.1, 0.1)

export const shootplanBestandsnaam = (s: Pick<Shoot, 'titel' | 'klant' | 'datum'>) =>
  `Shootplan-${asciiNaamdeel(shootNaam(s), 'shoot')}${s.datum ? `-${s.datum}` : ''}.pdf`

export async function maakShootplanPdf(s: Shoot): Promise<Uint8Array> {
  const ACCENT = NGM_PDF.woud
  const TEKST = NGM_PDF.woud
  const bedrijf = 'NextGenMedia'
  const naam = veilig(shootNaam(s)) || 'Shoot'

  const pdf = await PDFDocument.create()
  pdf.setTitle(`Shootplan ${naam}`)
  pdf.setAuthor(`${bedrijf} portaal`)
  pdf.setCreator(`${bedrijf} portaal`)
  const { font, vet, nadruk, titel: titelFont, mono } = await ngmFonts(pdf)

  const breedte = A4.w - MARGE * 2
  let page: PDFPage = pdf.addPage([A4.w, A4.h])
  let y = A4.h - MARGE

  const nieuwePagina = () => {
    page = pdf.addPage([A4.w, A4.h])
    page.drawRectangle({ x: 0, y: A4.h - 8, width: A4.w, height: 8, color: ACCENT })
    y = A4.h - MARGE - 6
  }
  const ruimte = (nodig: number) => { if (y - nodig < ONDER) nieuwePagina() }
  const regels = (t: string, grootte: number, b: number, f = font) => wikkel(f, veilig(t), grootte, b)

  const kop = (titel: string, eersteBlok = 0) => {
    ruimte(40 + eersteBlok)
    y -= 10
    const t = veilig(titel)
    page.drawText(t, { x: MARGE, y: y - 12, size: 13.5, font: vet, color: TEKST })
    // De punt sluit de titel af, zoals in het logo.
    page.drawCircle({ x: MARGE + vet.widthOfTextAtSize(t, 13.5) + 4, y: y - 10.6, size: 2.2, color: NGM_PDF.zonnegeel })
    y -= 19
    page.drawRectangle({ x: MARGE, y, width: breedte, height: 0.8, color: LIJN })
    y -= 12
  }
  /** Een alinea tekst, regel per regel (mag over pagina's lopen). */
  const alinea = (t: string, grootte = 10, kleur = ZWART) => {
    for (const r of regels(t, grootte, breedte)) {
      ruimte(grootte + 5)
      page.drawText(r, { x: MARGE, y: y - grootte, size: grootte, font, color: kleur })
      y -= grootte + 4.5
    }
    y -= 4
  }
  const VAK = 10, VAK_AFSTAND = 22
  const vinkregelHoogte = (t: string) => regels(t, 10.5, breedte - VAK_AFSTAND).length * 15 + 8
  const vinkregel = (t: string) => {
    const r = regels(t, 10.5, breedte - VAK_AFSTAND)
    if (!r.length) return
    ruimte(r.length * 15 + 8)
    page.drawRectangle({ x: MARGE + 1, y: y - VAK + 1, width: VAK, height: VAK, borderColor: NGM_PDF.woud, borderWidth: 0.9 })
    r.forEach((x, i) => page.drawText(x, { x: MARGE + VAK_AFSTAND, y: y - 9 - i * 15, size: 10.5, font, color: ZWART }))
    y -= r.length * 15 + 8
  }

  // ── Kop: een vlak in woud met het logo in zonnegeel en de titel ─────────────
  const KOP = 150
  page.drawRectangle({ x: 0, y: A4.h - KOP, width: A4.w, height: KOP, color: NGM_PDF.woud })
  const logo = await ngmLogo(pdf, 'zonnegeel')
  if (logo) { const h = 20, w = (logo.width / logo.height) * h; page.drawImage(logo, { x: MARGE, y: A4.h - 30 - h, width: w, height: h }) }
  monoLabel(page, mono, 'Shootplan', A4.w - MARGE, A4.h - 44, 8, NGM_PDF.mos, true)
  let ty = A4.h - 88
  const titelRegels = regels(naam, 24, breedte - 10, titelFont).slice(0, 2)
  if (titelRegels.length > 1) ty += 14
  titelRegels.forEach((r, idx) => {
    page.drawText(r, { x: MARGE, y: ty, size: 24, font: titelFont, color: NGM_PDF.kalk })
    if (idx === titelRegels.length - 1) page.drawCircle({ x: MARGE + titelFont.widthOfTextAtSize(r, 24) + 6, y: ty + 2.6, size: 3.6, color: NGM_PDF.zonnegeel })
    ty -= 28
  })
  const onder = [s.klant, s.datum ? datumLang(s.datum) : ''].filter(Boolean).join('  ·  ')
  if (onder) page.drawText(veilig(onder), { x: MARGE, y: A4.h - KOP + 22, size: 10, font, color: NGM_PDF.mos })
  y = A4.h - KOP - 26
  if (s.status === 'geannuleerd') { page.drawText('Deze shoot is geannuleerd.', { x: MARGE, y, size: 11, font: nadruk, color: ROOD }); y -= 20 }

  // Gegevensblok
  const rijen: [string, string][] = [['Klant', s.klant || '']]
  if (s.datum) rijen.push(['Datum', datumLang(s.datum)])
  if (tijdBereik(s.start, s.einde)) rijen.push(['Uur', tijdBereik(s.start, s.einde)])
  if (s.locaties.length === 1) rijen.push(['Locatie', [s.locaties[0].naam, s.locaties[0].adres].filter((x, i, l) => x && l.indexOf(x) === i).join(', ')])
  else if (s.locaties.length > 1) rijen.push(['Locaties', s.locaties.map((l) => l.naam).join(', ')])
  const contact = s.betrokkenen.find((b) => /contact|ter plaatse|klant/i.test(b.rol) && b.telefoon)
  if (contact) rijen.push(['Contact', [contact.naam, contact.rol, contact.telefoon].filter(Boolean).join(' · ')])
  const LB = 90
  const gerenderd = rijen.filter(([, w]) => w).map(([l, w]) => [l, regels(w, 10, breedte - LB - 24)] as const)
  let blok = 10
  for (const [, r] of gerenderd) blok += Math.max(1, r.length) * 14 + 4
  page.drawRectangle({ x: MARGE, y: y - blok, width: breedte, height: blok, color: LICHT })
  page.drawRectangle({ x: MARGE, y: y - blok, width: 3, height: blok, color: NGM_PDF.zonnegeel })
  let ry = y - 8
  for (const [l, r] of gerenderd) {
    monoLabel(page, mono, l, MARGE + 14, ry - 9, 7.5, GRIJS)
    r.forEach((x, i) => page.drawText(x, { x: MARGE + 14 + LB, y: ry - 9 - i * 14, size: 10, font, color: ZWART }))
    ry -= Math.max(1, r.length) * 14 + 4
  }
  y -= blok + 6

  if (s.doel.trim()) { kop('Waarover'); alinea(s.doel) }

  // ── Programma ───────────────────────────────────────────────────────────────
  if (s.programma.length) {
    const TK = 92, rb = breedte - TK - 8
    const puntRegels = (p: Shoot['programma'][number]) => {
      const loc = p.locatie ? locatieVan(s, p.locatie) : null
      const waar = p.locatie ? `${p.locatie}${loc?.adres && loc.adres !== p.locatie ? ` · ${loc.adres}` : ''}` : ''
      return {
        wat: regels(p.wat || (p.locatie ? `Op ${p.locatie}` : '-'), 10.5, rb, nadruk),
        waar: waar ? regels(`Waar: ${waar}`, 9.5, rb) : [],
        wie: p.wie ? regels(`Wie: ${p.wie}`, 9.5, rb) : [],
      }
    }
    const hoogte = (x: ReturnType<typeof puntRegels>) => x.wat.length * 14 + (x.waar.length + x.wie.length) * 13 + 14
    const eerste = puntRegels(s.programma[0])
    kop('Programma', hoogte(eerste))
    for (const p of s.programma) {
      const x = puntRegels(p)
      const h = hoogte(x)
      ruimte(h)
      const t = tijdBereik(p.van, p.tot) || '-'
      page.drawText(veilig(t), { x: MARGE, y: y - 11, size: 10, font: mono, color: TEKST })
      let yy = y - 11
      for (const r of x.wat) { page.drawText(r, { x: MARGE + TK, y: yy, size: 10.5, font: nadruk, color: ZWART }); yy -= 14 }
      for (const r of [...x.waar, ...x.wie]) { page.drawText(r, { x: MARGE + TK, y: yy + 1, size: 9.5, font, color: GRIJS }); yy -= 13 }
      y -= h
      page.drawRectangle({ x: MARGE, y: y + 5, width: breedte, height: 0.6, color: LIJN })
    }
  }

  // ── Locaties ────────────────────────────────────────────────────────────────
  if (s.locaties.length) {
    const blokVan = (l: Shoot['locaties'][number]) => [
      ...regels(l.naam, 10.5, breedte, nadruk).map((t) => ({ t, vet: true })),
      ...(l.adres && l.adres !== l.naam ? regels(l.adres, 10, breedte) : []).map((t) => ({ t, vet: false })),
      ...(l.contact || l.telefoon ? regels(`Contact ter plaatse: ${[l.contact, l.telefoon].filter(Boolean).join(', ')}`, 10, breedte) : []).map((t) => ({ t, vet: false })),
      ...(l.notitie ? regels(l.notitie, 9.5, breedte) : []).map((t) => ({ t, vet: false })),
    ]
    kop(s.locaties.length > 1 ? 'Locaties' : 'Locatie', blokVan(s.locaties[0]).length * 14 + 10)
    for (const l of s.locaties) {
      const b = blokVan(l)
      ruimte(b.length * 14 + 10)
      for (const r of b) { page.drawText(r.t, { x: MARGE, y: y - 10, size: r.vet ? 10.5 : 10, font: r.vet ? nadruk : font, color: r.vet ? ZWART : GRIJS }); y -= 14 }
      y -= 8
    }
  }

  // ── Wie is erbij ────────────────────────────────────────────────────────────
  if (s.betrokkenen.length) {
    kop('Wie is erbij', 30)
    for (const b of s.betrokkenen) {
      const links = regels(`${b.naam || b.email}${b.rol ? `  ·  ${b.rol}` : ''}`, 10, breedte * 0.5)
      const rechts = regels([b.telefoon, b.email].filter(Boolean).join('  ·  '), 9.5, breedte * 0.48)
      const h = Math.max(links.length, rechts.length, 1) * 13 + 7
      ruimte(h)
      links.forEach((t, i) => page.drawText(t, { x: MARGE, y: y - 10 - i * 13, size: 10, font: i === 0 ? nadruk : font, color: ZWART }))
      rechts.forEach((t, i) => page.drawText(t, { x: MARGE + breedte * 0.52, y: y - 10 - i * 13, size: 9.5, font, color: GRIJS }))
      y -= h
    }
  }

  if (s.shotlist.length) { kop('Shotlist', vinkregelHoogte(s.shotlist[0])); for (const r of s.shotlist) vinkregel(r) }
  if (s.paklijst.length) { kop('Mee te nemen', vinkregelHoogte(s.paklijst[0])); for (const r of s.paklijst) vinkregel(r) }
  if (s.praktisch.trim()) { kop('Praktisch'); alinea(s.praktisch) }
  if (s.briefing.trim()) { kop('Briefing'); alinea(s.briefing, 9.5, GRIJS) }

  // ── Voettekst ───────────────────────────────────────────────────────────────
  const paginas = pdf.getPages()
  const bijgewerkt = s.updated_at ? new Date(s.updated_at).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
  const links = `${bedrijf}  ·  Shootplan${bijgewerkt ? `  ·  bijgewerkt ${bijgewerkt}` : ''}`
  paginas.forEach((p, i) => {
    p.drawRectangle({ x: MARGE, y: 40, width: breedte, height: 0.8, color: LIJN })
    monoLabel(p, mono, links, MARGE, 27, 7, GRIJS)
    monoLabel(p, mono, `${i + 1} / ${paginas.length}`, A4.w - MARGE, 27, 7, GRIJS, true)
  })
  return pdf.save()
}

