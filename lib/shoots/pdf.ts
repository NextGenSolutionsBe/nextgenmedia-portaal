import 'server-only'
import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib'
import { leesInstellingen } from '@/lib/instellingen/laden'
import { kleurUitHex, laadLogo, wikkel } from '@/lib/shoot-document'
import { veilig, asciiNaamdeel } from '@/lib/shoot-document-model'
import { datumLang, locatieVan, shootNaam, tijdBereik, type Shoot } from './model'

/**
 * Het shootplan als A4-pdf, in dezelfde stijl als het shootdocument: kop met
 * logo, gegevensblok, het programma per uur (met locatie en wie), de
 * locaties, wie erbij is, shotlist en paklijst om af te vinken, praktische
 * info en de briefing. Een blok wordt nooit over twee pagina's gebroken.
 */

const A4 = { w: 595.28, h: 841.89 }
const MARGE = 48
const ONDER = 60
const GEEL = rgb(0.059, 0.059, 0.059) /* huisstijl NextGen Agency: zwart (vroeger geel) */
const ZWART = rgb(0.07, 0.07, 0.07)
const GRIJS = rgb(0.42, 0.45, 0.5)
const LIJN = rgb(0.85, 0.86, 0.88)
const LICHT = rgb(0.96, 0.965, 0.975)
const ROOD = rgb(0.75, 0.1, 0.1)

export const shootplanBestandsnaam = (s: Pick<Shoot, 'titel' | 'klant' | 'datum'>) =>
  `Shootplan-${asciiNaamdeel(shootNaam(s), 'shoot')}${s.datum ? `-${s.datum}` : ''}.pdf`

export async function maakShootplanPdf(s: Shoot): Promise<Uint8Array> {
  const inst = await leesInstellingen().catch(() => null)
  const doc = inst?.documenten
  const org = inst?.organisatie
  const ACCENT = kleurUitHex(doc?.primaire_kleur, GEEL)
  const TEKST = kleurUitHex(doc?.secundaire_kleur, ZWART)
  const bedrijf = veilig(org?.handelsnaam || org?.vennootschapsnaam || 'NextGenMedia') || 'NextGenMedia'
  const naam = veilig(shootNaam(s)) || 'Shoot'

  const pdf = await PDFDocument.create()
  pdf.setTitle(`Shootplan ${naam}`)
  pdf.setAuthor(`${bedrijf} portaal`)
  pdf.setCreator(`${bedrijf} portaal`)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const vet = await pdf.embedFont(StandardFonts.HelveticaBold)

  const breedte = A4.w - MARGE * 2
  let page: PDFPage = pdf.addPage([A4.w, A4.h])
  let y = A4.h - MARGE

  const nieuwePagina = () => {
    page = pdf.addPage([A4.w, A4.h])
    y = A4.h - MARGE
    page.drawRectangle({ x: MARGE, y: y - 2, width: breedte, height: 2.5, color: ACCENT })
    y -= 22
  }
  const ruimte = (nodig: number) => { if (y - nodig < ONDER) nieuwePagina() }
  const regels = (t: string, grootte: number, b: number, f = font) => wikkel(f, veilig(t), grootte, b)

  const kop = (titel: string, eersteBlok = 0) => {
    ruimte(40 + eersteBlok)
    y -= 10
    page.drawText(veilig(titel), { x: MARGE, y: y - 12, size: 13, font: vet, color: TEKST })
    y -= 18
    page.drawRectangle({ x: MARGE, y, width: breedte, height: 1.2, color: ACCENT })
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
    page.drawRectangle({ x: MARGE + 1, y: y - VAK + 1, width: VAK, height: VAK, borderColor: rgb(0.35, 0.35, 0.35), borderWidth: 0.9 })
    r.forEach((x, i) => page.drawText(x, { x: MARGE + VAK_AFSTAND, y: y - 9 - i * 15, size: 10.5, font, color: ZWART }))
    y -= r.length * 15 + 8
  }

  // ── Kop ─────────────────────────────────────────────────────────────────────
  try {
    const logoBytes = await laadLogo(doc?.logo_path)
    if (logoBytes) {
      const isJpeg = logoBytes[0] === 0xff && logoBytes[1] === 0xd8
      const logo = isJpeg ? await pdf.embedJpg(logoBytes) : await pdf.embedPng(logoBytes)
      const h = 42, w = (logo.width / logo.height) * h
      page.drawImage(logo, { x: MARGE, y: y - h, width: w, height: h })
    }
  } catch { /* zonder logo verder */ }
  page.drawText(bedrijf, { x: A4.w - MARGE - vet.widthOfTextAtSize(bedrijf, 12), y: y - 14, size: 12, font: vet, color: TEKST })
  page.drawText('Shootplan', { x: A4.w - MARGE - font.widthOfTextAtSize('Shootplan', 9), y: y - 28, size: 9, font, color: GRIJS })
  y -= 62
  page.drawRectangle({ x: MARGE, y, width: breedte, height: 4, color: ACCENT })
  y -= 34
  for (const r of regels(naam, 22, breedte, vet)) { page.drawText(r, { x: MARGE, y, size: 22, font: vet, color: TEKST }); y -= 27 }
  y -= 3
  if (s.status === 'geannuleerd') { page.drawText('Deze shoot is geannuleerd.', { x: MARGE, y, size: 11, font: vet, color: ROOD }); y -= 20 }

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
  page.drawRectangle({ x: MARGE, y: y - blok, width: 3, height: blok, color: ACCENT })
  let ry = y - 8
  for (const [l, r] of gerenderd) {
    page.drawText(l, { x: MARGE + 14, y: ry - 9, size: 9, font: vet, color: GRIJS })
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
        wat: regels(p.wat || (p.locatie ? `Op ${p.locatie}` : '-'), 10.5, rb, vet),
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
      page.drawText(veilig(t), { x: MARGE, y: y - 11, size: 10.5, font: vet, color: TEKST })
      let yy = y - 11
      for (const r of x.wat) { page.drawText(r, { x: MARGE + TK, y: yy, size: 10.5, font: vet, color: ZWART }); yy -= 14 }
      for (const r of [...x.waar, ...x.wie]) { page.drawText(r, { x: MARGE + TK, y: yy + 1, size: 9.5, font, color: GRIJS }); yy -= 13 }
      y -= h
      page.drawRectangle({ x: MARGE, y: y + 5, width: breedte, height: 0.6, color: LIJN })
    }
  }

  // ── Locaties ────────────────────────────────────────────────────────────────
  if (s.locaties.length) {
    const blokVan = (l: Shoot['locaties'][number]) => [
      ...regels(l.naam, 10.5, breedte, vet).map((t) => ({ t, vet: true })),
      ...(l.adres && l.adres !== l.naam ? regels(l.adres, 10, breedte) : []).map((t) => ({ t, vet: false })),
      ...(l.contact || l.telefoon ? regels(`Contact ter plaatse: ${[l.contact, l.telefoon].filter(Boolean).join(', ')}`, 10, breedte) : []).map((t) => ({ t, vet: false })),
      ...(l.notitie ? regels(l.notitie, 9.5, breedte) : []).map((t) => ({ t, vet: false })),
    ]
    kop(s.locaties.length > 1 ? 'Locaties' : 'Locatie', blokVan(s.locaties[0]).length * 14 + 10)
    for (const l of s.locaties) {
      const b = blokVan(l)
      ruimte(b.length * 14 + 10)
      for (const r of b) { page.drawText(r.t, { x: MARGE, y: y - 10, size: r.vet ? 10.5 : 10, font: r.vet ? vet : font, color: r.vet ? ZWART : GRIJS }); y -= 14 }
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
      links.forEach((t, i) => page.drawText(t, { x: MARGE, y: y - 10 - i * 13, size: 10, font: i === 0 ? vet : font, color: ZWART }))
      rechts.forEach((t, i) => page.drawText(t, { x: MARGE + breedte * 0.52, y: y - 10 - i * 13, size: 9.5, font, color: GRIJS }))
      y -= h
    }
  }

  if (s.shotlist.length) { kop('Shotlist', vinkregelHoogte(s.shotlist[0])); for (const r of s.shotlist) vinkregel(r) }
  if (s.paklijst.length) { kop('Mee te nemen', vinkregelHoogte(s.paklijst[0])); for (const r of s.paklijst) vinkregel(r) }
  if (s.praktisch.trim()) { kop('Praktisch'); alinea(s.praktisch) }
  if (s.briefing.trim()) { kop('Briefing'); alinea(s.briefing, 9.5, rgb(0.25, 0.25, 0.28)) }

  // ── Voettekst ───────────────────────────────────────────────────────────────
  const paginas = pdf.getPages()
  const bijgewerkt = s.updated_at ? new Date(s.updated_at).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
  const links = veilig(`${bedrijf} · Shootplan${bijgewerkt ? ` · bijgewerkt ${bijgewerkt}` : ''}`)
  paginas.forEach((p, i) => {
    const rechts = `Pagina ${i + 1} van ${paginas.length}`
    p.drawRectangle({ x: MARGE, y: 40, width: breedte, height: 0.8, color: LIJN })
    p.drawText(links, { x: MARGE, y: 27, size: 8, font, color: GRIJS })
    p.drawText(rechts, { x: A4.w - MARGE - font.widthOfTextAtSize(rechts, 8), y: 27, size: 8, font, color: GRIJS })
  })
  return pdf.save()
}

