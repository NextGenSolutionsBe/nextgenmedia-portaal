import { readFile } from 'fs/promises'
import path from 'path'
import { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, moveTo, appendBezierCurve, closePath, clip, endPath, type PDFFont, type PDFPage, type PDFImage, type RGB } from 'pdf-lib'
import { veilig } from '@/lib/shoot-document-model'
import { MERK_STIJL, type MailMerk } from '@/lib/merk-mail'
import {
  berekenPrijs, ficheWeergave, ficheHeeftInhoud, datumLang, euro, getekendOp,
  type OfferteInhoud,
} from '@/lib/offerte-fiche'
import { offerteVoorwaarden } from '@/lib/offerte-voorwaarden'
import type { OfferteBedrijf, OfferteContact } from '@/lib/offerte-afzender'

/**
 * De offerte als pdf: één duidelijk document met onze gegevens, die van de
 * klant, per dienst wat er inbegrepen is en wat niet, de investering met btw,
 * het akkoord (met de handtekening van de klant, datum en uur) en achteraan
 * klein en grijs de algemene voorwaarden. Standaardfont (Helvetica), dus elke
 * tekst gaat eerst door `veilig()`.
 */

export type OffertePdfInvoer = {
  merk: MailMerk
  bedrijf: OfferteBedrijf
  contact: OfferteContact
  /** Profielfoto van de contactpersoon (jpg of png uit Personeel). */
  foto?: Uint8Array | null
  betalingstermijn: number
  klant: { naam: string; contact?: string | null; email?: string | null; telefoon?: string | null; adres?: string | null; btw?: string | null }
  inhoud: OfferteInhoud
  nummer: string
  /** Getekend door de klant (handtekening als png). */
  handtekening?: { png: Uint8Array; naam: string; op: string } | null
  /** Online geaccepteerd zonder handtekening. */
  akkoord?: { naam: string; op: string } | null
  /** Voorbeeld uit het formulier: klein label bovenaan. */
  voorbeeld?: boolean
}

const A4 = { w: 595.28, h: 841.89 }
const M = 50
const ONDER = 64
const ZWART = rgb(0.07, 0.07, 0.08)
const DONKER = rgb(0.2, 0.21, 0.24)
const GRIJS = rgb(0.45, 0.47, 0.52)
const LICHTGRIJS = rgb(0.62, 0.64, 0.68)
const LIJN = rgb(0.87, 0.88, 0.9)
const VOORWAARDEN = rgb(0.5, 0.52, 0.56)
const VLAK = rgb(0.965, 0.968, 0.975)
const GROEN = rgb(0.09, 0.45, 0.25)

function hex(h: string): RGB {
  const n = parseInt(h.replace('#', ''), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

/** Regelafbreking op breedte; te lange woorden worden hard afgebroken. */
function wikkel(font: PDFFont, tekst: string, grootte: number, breedte: number): string[] {
  const regels: string[] = []
  for (const alinea of String(tekst ?? '').split(/\r?\n/)) {
    const woorden = veilig(alinea).split(/\s+/).filter(Boolean)
    let huidig = ''
    for (const woord of woorden) {
      const probeer = huidig ? `${huidig} ${woord}` : woord
      if (font.widthOfTextAtSize(probeer, grootte) <= breedte) { huidig = probeer; continue }
      if (huidig) regels.push(huidig)
      let rest = woord
      while (font.widthOfTextAtSize(rest, grootte) > breedte && rest.length > 1) {
        let n = rest.length
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), grootte) > breedte) n--
        regels.push(rest.slice(0, n)); rest = rest.slice(n)
      }
      huidig = rest
    }
    regels.push(huidig)
  }
  // Lege regels achteraan weg, lege tussenin blijven (alinea's).
  while (regels.length && !regels[regels.length - 1]) regels.pop()
  return regels
}

async function logo(pdf: PDFDocument): Promise<PDFImage | null> {
  try { return await pdf.embedPng(new Uint8Array(await readFile(path.join(process.cwd(), 'public', 'logo-pdf.png')))) } catch { return null }
}

export async function maakOffertePdf(inv: OffertePdfInvoer): Promise<Uint8Array> {
  const stijl = MERK_STIJL[inv.merk]
  const ACCENT = hex(stijl.accent)
  const OP_ACCENT = hex(stijl.opAccent)
  const i = inv.inhoud
  const a = i.algemeen
  const prijs = berekenPrijs(i.prijs, i.extra)
  const titel = veilig(String(a.projectnaam ?? '')) || 'Offerte'

  const pdf = await PDFDocument.create()
  pdf.setTitle(`Offerte ${inv.nummer} – ${titel}`)
  pdf.setSubject(`Offerte voor ${veilig(inv.klant.naam)}`)
  pdf.setAuthor(stijl.naam)
  pdf.setCreator(`${stijl.naam} portaal`)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const vet = await pdf.embedFont(StandardFonts.HelveticaBold)
  const breedte = A4.w - M * 2

  let page: PDFPage = pdf.addPage([A4.w, A4.h])
  let y = A4.h - M

  const tekst = (s: string, x: number, yy: number, o: { size?: number; f?: PDFFont; kleur?: RGB; rechts?: boolean } = {}) => {
    const size = o.size ?? 10, f = o.f ?? font, t = veilig(s)
    const xx = o.rechts ? x - f.widthOfTextAtSize(t, size) : x
    page.drawText(t, { x: xx, y: yy, size, font: f, color: o.kleur ?? ZWART })
  }
  const nieuwePagina = () => {
    page = pdf.addPage([A4.w, A4.h])
    page.drawRectangle({ x: 0, y: A4.h - 5, width: A4.w, height: 5, color: ACCENT })
    y = A4.h - M + 8
  }
  const ruimte = (nodig: number) => { if (y - nodig < ONDER) nieuwePagina() }
  /** Alinea's met afbreking; breekt per regel over pagina's. */
  const alinea = (s: string, x: number, w: number, o: { size?: number; f?: PDFFont; kleur?: RGB; interlinie?: number } = {}) => {
    const size = o.size ?? 10, il = o.interlinie ?? size * 1.45
    for (const r of wikkel(o.f ?? font, s, size, w)) {
      ruimte(il)
      if (r) tekst(r, x, y - size, { size, f: o.f, kleur: o.kleur })
      y -= il
    }
  }
  const kop = (nummer: string | null, t: string) => {
    ruimte(70)
    y -= 14
    if (nummer) {
      const bw = vet.widthOfTextAtSize(nummer, 9) + 12
      page.drawRectangle({ x: M, y: y - 15, width: bw, height: 17, color: ACCENT })
      tekst(nummer, M + 6, y - 10.5, { size: 9, f: vet, kleur: OP_ACCENT })
      tekst(t, M + bw + 10, y - 12, { size: 14, f: vet })
    } else tekst(t, M, y - 12, { size: 14, f: vet })
    y -= 26
    page.drawRectangle({ x: M, y, width: breedte, height: 0.8, color: LIJN })
    y -= 14
  }

  // ── Kop ─────────────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: A4.h - 6, width: A4.w, height: 6, color: ACCENT })
  y = A4.h - 40
  let woordX = M
  if (inv.merk === 'nextgenmedia') {
    const l = await logo(pdf)
    if (l) { const h = 36, w = (l.width / l.height) * h; page.drawImage(l, { x: M - 4, y: y - h + 6, width: w, height: h }); woordX = M + w + 2 }
  }
  tekst(stijl.deel1, woordX, y - 18, { size: 17, f: vet })
  const d1 = vet.widthOfTextAtSize(stijl.deel1, 17)
  tekst(stijl.deel2, woordX + d1, y - 18, { size: 17, f: font })
  page.drawRectangle({ x: woordX + d1, y: y - 23, width: font.widthOfTextAtSize(stijl.deel2, 17), height: 2.5, color: ACCENT })
  tekst('OFFERTE', A4.w - M, y - 14, { size: 20, f: vet, rechts: true })
  tekst(inv.nummer, A4.w - M, y - 28, { size: 10, kleur: GRIJS, rechts: true })
  if (inv.voorbeeld) tekst('Voorbeeld, nog niet verstuurd', A4.w - M, y - 41, { size: 8, kleur: rgb(0.75, 0.42, 0.05), rechts: true })
  y -= 64

  // ── Dienstverlener · klant ──────────────────────────────────────────────────
  const kol = (breedte - 24) / 2
  const blok = (x: number, label: string, regels: (string | null | undefined)[]): number => {
    let yy = y
    tekst(label, x, yy - 8, { size: 7.5, f: vet, kleur: GRIJS })
    yy -= 20
    regels.filter((r): r is string => !!r && !!veilig(r)).forEach((r, idx) => {
      for (const w of wikkel(idx === 0 ? vet : font, r, idx === 0 ? 10 : 9, kol)) {
        tekst(w, x, yy, { size: idx === 0 ? 10 : 9, f: idx === 0 ? vet : font, kleur: idx === 0 ? ZWART : DONKER })
        yy -= idx === 0 ? 14 : 12.5
      }
    })
    return yy
  }
  const b = inv.bedrijf
  const y1 = blok(M, 'DIENSTVERLENER', [b.vennootschap, `Handelsnaam ${b.naam === 'NextGenSolutions' ? 'NextGenSolutions' : b.handelsnaam}`, `Ondernemingsnummer ${b.ondernemingsnummer}`, b.adres, `Vertegenwoordigd door ${b.vertegenwoordiger}`, b.email])
  const k = inv.klant
  const contactNaam = String(a.contactpersoon ?? '') || k.contact
  const y3 = blok(M + kol + 24, 'KLANT', [k.naam, contactNaam, String(a.email ?? '') || k.email, String(a.telefoon ?? '') || k.telefoon, k.adres, k.btw ? `Btw ${k.btw}` : null])
  y = Math.min(y1, y3) - 10

  // ── Kerngegevens ────────────────────────────────────────────────────────────
  const meta: [string, string][] = [
    ['OFFERTENUMMER', inv.nummer],
    ['DATUM', a.datum ? datumLang(String(a.datum)) : '–'],
    ['GELDIG TOT', a.geldig_tot ? datumLang(String(a.geldig_tot)) : '–'],
    ['LOOPTIJD', String(a.looptijd ?? '') || (prijs.maanden > 1 ? `${prijs.maanden} maanden` : '–')],
  ]
  page.drawRectangle({ x: M, y: y - 44, width: breedte, height: 44, color: VLAK })
  const cel = breedte / meta.length
  meta.forEach(([l, w], idx) => {
    const x = M + 14 + idx * cel
    tekst(l, x, y - 16, { size: 7, f: vet, kleur: GRIJS })
    const v = wikkel(vet, w, 10, cel - 20)[0] ?? ''
    tekst(v, x, y - 32, { size: 10, f: vet })
  })
  y -= 70

  // ── Titel, doel, planning ───────────────────────────────────────────────────
  for (const r of wikkel(vet, titel, 22, breedte)) { ruimte(28); tekst(r, M, y - 20, { size: 22, f: vet }); y -= 28 }
  page.drawRectangle({ x: M, y: y - 2, width: 44, height: 3.5, color: ACCENT })
  y -= 18
  if (a.doel) { alinea(String(a.doel), M, breedte, { size: 10.5, kleur: DONKER }); y -= 4 }
  const planning: [string, string][] = ([
    ['Gewenste start', String(a.startdatum ?? '')],
    ['Looptijd of einddatum', String(a.looptijd ?? '')],
    ['Feedback en goedkeuring', String(a.feedback_contact ?? '')],
  ] as [string, string][]).filter(([, w]) => w)
  if (planning.length) {
    ruimte(34); y -= 4
    const pw = breedte / planning.length
    planning.forEach(([l, w], idx) => {
      tekst(l, M + idx * pw, y - 8, { size: 8, kleur: GRIJS })
      tekst(wikkel(vet, w, 9.5, pw - 10)[0] ?? '', M + idx * pw, y - 21, { size: 9.5, f: vet })
    })
    y -= 32
  }

  // ── In het kort (totaal) ────────────────────────────────────────────────────
  if (prijs.excl > 0) {
    ruimte(72); y -= 8
    page.drawRectangle({ x: M, y: y - 58, width: breedte, height: 58, color: ACCENT })
    tekst('TOTALE INVESTERING', M + 18, y - 20, { size: 7.5, f: vet, kleur: OP_ACCENT })
    tekst(euro(prijs.excl), M + 18, y - 44, { size: 22, f: vet, kleur: OP_ACCENT })
    tekst('excl. btw', M + 24 + vet.widthOfTextAtSize(veilig(euro(prijs.excl)), 22), y - 44, { size: 9, kleur: OP_ACCENT })
    const rechts: string[] = []
    if (prijs.maandelijks) rechts.push(`${euro(prijs.maandelijks)} per maand${prijs.maanden > 1 ? ` · ${prijs.maanden} maanden` : ''}`)
    const setup = prijs.lijnen.find((l) => l.omschrijving.startsWith('Eenmalige'))
    if (setup) rechts.push(`Eenmalige opstart ${euro(setup.bedrag)}`)
    rechts.push(`${euro(prijs.incl)} incl. ${String(prijs.btwPct).replace('.', ',')}% btw`)
    rechts.slice(0, 3).forEach((r, idx) => tekst(r, A4.w - M - 18, y - 20 - idx * 13, { size: 9, f: idx === 0 ? vet : font, kleur: OP_ACCENT, rechts: true }))
    y -= 72
  }

  // ── Diensten ────────────────────────────────────────────────────────────────
  const check = (x: number, yy: number) => page.drawSvgPath('M0 4 L3.2 7 L9 0.5', { x, y: yy + 8, borderColor: GROEN, borderWidth: 1.5 })
  const streep = (x: number, yy: number) => page.drawRectangle({ x, y: yy + 3.5, width: 7, height: 1.3, color: LICHTGRIJS })
  let nr = 0
  for (const key of i.diensten) {
    const f = ficheWeergave(key, i.fiches[key] ?? {})
    nr++
    kop(String(nr).padStart(2, '0'), f.titel)
    if (!ficheHeeftInhoud(f)) { alinea('Details volgen in overleg.', M, breedte, { size: 9.5, kleur: GRIJS }); continue }
    // Kerngegevens in twee kolommen.
    if (f.feiten.length) {
      const kw = (breedte - 20) / 2
      for (let r = 0; r < f.feiten.length; r += 2) {
        const paar = f.feiten.slice(r, r + 2).map(([l, w]) => ({ l: wikkel(font, l, 8, kw), w: wikkel(vet, w, 10, kw) }))
        const h = Math.max(...paar.map((p) => p.l.length * 10 + p.w.length * 13)) + 10
        ruimte(h)
        paar.forEach((p, idx) => {
          const x = M + idx * (kw + 20)
          let yy = y
          p.l.forEach((t) => { tekst(t, x, yy - 8, { size: 8, kleur: GRIJS }); yy -= 10 })
          p.w.forEach((t) => { tekst(t, x, yy - 11, { size: 10, f: vet }); yy -= 13 })
        })
        y -= h
      }
    }
    const lijst = (titelL: string, items: string[], soort: 'ja' | 'nee') => {
      if (!items.length) return
      ruimte(34); y -= 4
      tekst(titelL, M, y - 9, { size: 8.5, f: vet, kleur: soort === 'ja' ? GROEN : GRIJS })
      y -= 18
      for (const it of items) {
        const regels = wikkel(font, it, 9.5, breedte - 18)
        ruimte(regels.length * 13 + 3)
        if (soort === 'ja') check(M + 1, y - 10); else streep(M + 1, y - 10)
        regels.forEach((r, idx) => tekst(r, M + 16, y - 9.5 - idx * 13, { size: 9.5, kleur: soort === 'ja' ? ZWART : GRIJS }))
        y -= regels.length * 13 + 3
      }
    }
    lijst('INBEGREPEN', f.inbegrepen, 'ja')
    lijst('NIET INBEGREPEN', f.niet, 'nee')
    for (const [l, w] of f.blokken) {
      ruimte(36); y -= 6
      tekst(l, M, y - 9, { size: 8.5, f: vet, kleur: GRIJS })
      y -= 16
      alinea(w, M, breedte, { size: 9.5, kleur: DONKER })
    }
  }

  // ── Investering ─────────────────────────────────────────────────────────────
  kop(null, 'Investering')
  const bedragX = A4.w - M
  if (!prijs.lijnen.length) alinea('De prijs bespreken we graag samen.', M, breedte, { size: 9.5, kleur: GRIJS })
  for (const l of prijs.lijnen) {
    const om = wikkel(font, l.omschrijving, 10, breedte - 140)
    const h = om.length * 13 + (l.detail ? 12 : 0) + 10
    ruimte(h)
    om.forEach((r, idx) => tekst(r, M, y - 11 - idx * 13, { size: 10 }))
    if (l.detail) tekst(l.detail, M, y - 11 - om.length * 13, { size: 8.5, kleur: GRIJS })
    tekst(euro(l.bedrag), bedragX, y - 11, { size: 10, rechts: true })
    y -= h
    page.drawRectangle({ x: M, y: y + 3, width: breedte, height: 0.5, color: LIJN })
  }
  if (prijs.lijnen.length) {
    ruimte(70)
    y -= 6
    tekst('Totaal excl. btw', bedragX - 120, y - 10, { size: 10, rechts: true, kleur: DONKER })
    tekst(euro(prijs.excl), bedragX, y - 10, { size: 10, f: vet, rechts: true })
    y -= 16
    tekst(`Btw ${String(prijs.btwPct).replace('.', ',')}%`, bedragX - 120, y - 10, { size: 10, rechts: true, kleur: DONKER })
    tekst(euro(prijs.btw), bedragX, y - 10, { size: 10, rechts: true })
    y -= 20
    page.drawRectangle({ x: bedragX - 230, y: y - 24, width: 230, height: 26, color: ACCENT })
    tekst('Totaal incl. btw', bedragX - 120, y - 16, { size: 11, f: vet, rechts: true, kleur: OP_ACCENT })
    tekst(euro(prijs.incl), bedragX - 10, y - 16, { size: 11, f: vet, rechts: true, kleur: OP_ACCENT })
    y -= 38
  }
  const noten: string[] = []
  if (prijs.budgetApart) noten.push(`Advertentiebudget: ${euro(prijs.budgetApart)}. Dit betaal je rechtstreeks aan het platform; het zit niet in het totaal.`)
  if (i.prijs.betaling) noten.push(`Betaling: ${String(i.prijs.betaling)}`)
  noten.push(`Alle bedragen zijn exclusief btw, tenzij anders vermeld. Facturen zijn betaalbaar binnen ${inv.betalingstermijn} dagen na factuurdatum.`)
  for (const n of noten) { alinea(n, M, breedte, { size: 8.5, kleur: GRIJS, interlinie: 12 }); y -= 3 }

  // ── Jouw contactpersoon (met foto) ──────────────────────────────────────────
  {
    const c = inv.contact
    const h = 92
    ruimte(h + 30)
    y -= 14
    page.drawRectangle({ x: M, y: y - h, width: breedte, height: h, color: VLAK })
    page.drawRectangle({ x: M, y: y - h, width: 4, height: h, color: ACCENT })
    const r = 30, cx = M + 24 + r, cy = y - h / 2
    let foto: PDFImage | null = null
    if (inv.foto) {
      try { foto = inv.foto[0] === 0xff && inv.foto[1] === 0xd8 ? await pdf.embedJpg(inv.foto) : await pdf.embedPng(inv.foto) } catch { foto = null }
    }
    if (foto) {
      // Ronde foto: knippen op een cirkel, beeld vult de cirkel (cover).
      const kk = 0.5523
      page.pushOperators(
        pushGraphicsState(), moveTo(cx + r, cy),
        appendBezierCurve(cx + r, cy + kk * r, cx + kk * r, cy + r, cx, cy + r),
        appendBezierCurve(cx - kk * r, cy + r, cx - r, cy + kk * r, cx - r, cy),
        appendBezierCurve(cx - r, cy - kk * r, cx - kk * r, cy - r, cx, cy - r),
        appendBezierCurve(cx + kk * r, cy - r, cx + r, cy - kk * r, cx + r, cy),
        closePath(), clip(), endPath(),
      )
      const s = Math.max((2 * r) / foto.width, (2 * r) / foto.height)
      page.drawImage(foto, { x: cx - (foto.width * s) / 2, y: cy - (foto.height * s) / 2, width: foto.width * s, height: foto.height * s })
      page.pushOperators(popGraphicsState())
      page.drawEllipse({ x: cx, y: cy, xScale: r, yScale: r, borderColor: ACCENT, borderWidth: 2 })
    } else {
      page.drawEllipse({ x: cx, y: cy, xScale: r, yScale: r, color: ACCENT })
      const ini = c.naam.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase()
      tekst(ini, cx - vet.widthOfTextAtSize(ini, 16) / 2, cy - 6, { size: 16, f: vet, kleur: OP_ACCENT })
    }
    const tx = cx + r + 20
    tekst('JOUW CONTACTPERSOON', tx, y - 20, { size: 7.5, f: vet, kleur: GRIJS })
    tekst(c.naam, tx, y - 38, { size: 14, f: vet })
    tekst(c.functie, tx, y - 52, { size: 9.5, kleur: DONKER })
    const lijnen = [c.telefoon ? `Tel. ${c.telefoon}` : null, c.email].filter(Boolean).join('   ·   ')
    tekst(lijnen, tx, y - 70, { size: 10, f: vet, kleur: ZWART })
    tekst('Vragen over deze offerte? Bel of mail gerust.', A4.w - M - 14, y - 20, { size: 8, kleur: GRIJS, rechts: true })
    y -= h + 6
  }

  // ── Akkoord ─────────────────────────────────────────────────────────────────
  ruimte(190)
  kop(null, 'Akkoord')
  const bw = (breedte - 16) / 2, bh = 128
  const vak = (x: number, label: string) => {
    page.drawRectangle({ x, y: y - bh, width: bw, height: bh, borderColor: LIJN, borderWidth: 1, color: rgb(1, 1, 1) })
    tekst(label, x + 12, y - 16, { size: 7.5, f: vet, kleur: GRIJS })
  }
  vak(M, 'VOOR AKKOORD, DE KLANT')
  vak(M + bw + 16, `VOOR ${veilig(b.vennootschap).toUpperCase()}`)
  const kx = M + 12
  if (inv.handtekening) {
    try {
      const img = await pdf.embedPng(inv.handtekening.png)
      const maxW = bw - 24, maxH = 58
      const s = Math.min(maxW / img.width, maxH / img.height)
      page.drawImage(img, { x: kx, y: y - 26 - img.height * s, width: img.width * s, height: img.height * s })
    } catch { /* zonder beeld verder */ }
    tekst(inv.handtekening.naam, kx, y - bh + 26, { size: 9.5, f: vet })
    tekst(`Getekend op ${getekendOp(inv.handtekening.op)}`, kx, y - bh + 13, { size: 8.5, kleur: GRIJS })
  } else if (inv.akkoord) {
    tekst('Online geaccepteerd', kx, y - 44, { size: 11, f: vet, kleur: GROEN })
    tekst(inv.akkoord.naam, kx, y - bh + 26, { size: 9.5, f: vet })
    tekst(`Op ${getekendOp(inv.akkoord.op)}`, kx, y - bh + 13, { size: 8.5, kleur: GRIJS })
  } else {
    for (const [idx, l] of ['Naam', 'Datum', 'Handtekening'].entries()) {
      const ly = y - 44 - idx * 28
      tekst(l, kx, ly + 3, { size: 8, kleur: GRIJS })
      page.drawRectangle({ x: kx + 62, y: ly, width: bw - 86, height: 0.6, color: LIJN })
    }
  }
  const nx = M + bw + 28
  tekst(inv.contact.naam, nx, y - bh + 26, { size: 9.5, f: vet })
  tekst(inv.contact.functie, nx, y - bh + 13, { size: 8.5, kleur: GRIJS })
  y -= bh + 12
  alinea(`Akkoord geven kan ook online via de knop in de mail. Door te aanvaarden ga je akkoord met de algemene voorwaarden hieronder (ook op ${'nextgenmedia.be/algemene-voorwaarden'}) en met onze privacyverklaring.`, M, breedte, { size: 8, kleur: GRIJS, interlinie: 11 })

  // ── Algemene voorwaarden: klein en grijs, in twee kolommen ──────────────────
  const art = offerteVoorwaarden({ vennootschap: b.vennootschap, adres: b.adres, ondernemingsnummer: b.ondernemingsnummer, betalingstermijn: inv.betalingstermijn })
  const VS = 6.2, VI = 8.1, GAP = 18, kw2 = (breedte - GAP) / 2
  if (y - ONDER < 240) nieuwePagina(); else y -= 18
  tekst('ALGEMENE VOORWAARDEN', M, y - 8, { size: 7.5, f: vet, kleur: GRIJS })
  y -= 18
  // Eerst alle regels, dan per pagina verdelen; de laatste pagina krijgt twee even lange kolommen.
  type Regel = { t: string; f: PDFFont; h: number }
  const regels: Regel[] = []
  for (const ar of art) {
    for (const t of wikkel(vet, ar.titel, VS, kw2)) regels.push({ t, f: vet, h: VI })
    for (const al of ar.alineas) { for (const t of wikkel(font, al, VS, kw2)) regels.push({ t, f: font, h: VI }); regels.push({ t: '', f: font, h: 1.5 }) }
    regels.push({ t: '', f: font, h: 2.5 })
  }
  let r = 0
  while (r < regels.length) {
    const ruimteKol = y - ONDER
    const rest = regels.slice(r).reduce((s2, x) => s2 + x.h, 0)
    const doel = rest <= ruimteKol * 2 ? rest / 2 : ruimteKol
    for (let kolom = 0; kolom < 2 && r < regels.length; kolom++) {
      let yy = y, gebruikt = 0
      while (r < regels.length) {
        const x = regels[r]
        if (gebruikt + x.h > ruimteKol) break
        if (kolom === 0 && gebruikt >= doel && x.t) break
        if (x.t) page.drawText(veilig(x.t), { x: M + kolom * (kw2 + GAP), y: yy - VS, size: VS, font: x.f, color: VOORWAARDEN })
        yy -= x.h; gebruikt += x.h; r++
      }
    }
    if (r < regels.length) nieuwePagina()
  }

  // ── Voettekst op elke pagina ────────────────────────────────────────────────
  const paginas = pdf.getPages()
  const voet = veilig([b.vennootschap, `Handelsnaam ${b.naam === 'NextGenSolutions' ? 'NextGenSolutions' : b.handelsnaam}`, `Btw ${b.btw}`, b.website].join('  ·  '))
  paginas.forEach((p, idx) => {
    p.drawRectangle({ x: M, y: 40, width: breedte, height: 0.6, color: LIJN })
    p.drawText(voet, { x: M, y: 27, size: 7.5, font, color: GRIJS })
    const r = veilig(`Offerte ${inv.nummer}  ·  ${idx + 1}/${paginas.length}`)
    p.drawText(r, { x: A4.w - M - font.widthOfTextAtSize(r, 7.5), y: 27, size: 7.5, font, color: GRIJS })
  })

  return pdf.save()
}

/**
 * Een offerte die als pdf opgeladen werd (sjabloon of eigen pdf): na het
 * akkoord komt er één pagina achteraan met wie aanvaardde, wanneer, de twee
 * vinkjes en (als de klant tekende) de handtekening. Het origineel blijft ongewijzigd.
 */
export async function voegAkkoordPaginaToe(bron: Uint8Array, a: {
  merk: MailMerk; titel: string; klant: string | null; naam: string; op: string
  handtekening?: Uint8Array | null; voorwaardenUrl: string
}): Promise<Uint8Array> {
  const stijl = MERK_STIJL[a.merk]
  const ACCENT = hex(stijl.accent)
  const pdf = await PDFDocument.load(bron, { ignoreEncryption: true })
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const vet = await pdf.embedFont(StandardFonts.HelveticaBold)
  const p = pdf.addPage([A4.w, A4.h])
  const t = (s: string, x: number, y: number, size = 10, f: PDFFont = font, kleur: RGB = ZWART) => p.drawText(veilig(s), { x, y, size, font: f, color: kleur })
  p.drawRectangle({ x: 0, y: A4.h - 6, width: A4.w, height: 6, color: ACCENT })
  let y = A4.h - 70
  t(`${stijl.deel1}${stijl.deel2}`, M, y, 16, vet)
  y -= 50
  t('Akkoord met de offerte', M, y, 22, vet)
  y -= 30
  for (const [l, w] of [['Offerte', a.titel], ['Klant', a.klant ?? '–'], ['Aanvaard door', a.naam], ['Op', getekendOp(a.op)]] as [string, string][]) {
    t(l, M, y, 9, font, GRIJS); t(w, M + 110, y, 10.5, vet); y -= 20
  }
  y -= 10
  for (const r of [
    `Akkoord met de algemene voorwaarden (${a.voorwaardenUrl}), ook voor toekomstige samenwerkingen.`,
    'Akkoord met de privacyverklaring.',
  ]) {
    p.drawSvgPath('M0 4 L3.2 7 L9 0.5', { x: M, y: y + 8, borderColor: GROEN, borderWidth: 1.5 })
    for (const [idx, w] of wikkel(font, r, 10, A4.w - M * 2 - 18).entries()) t(w, M + 16, y - idx * 13, 10)
    y -= 26
  }
  if (a.handtekening) {
    y -= 10
    t('HANDTEKENING', M, y, 7.5, vet, GRIJS)
    try {
      const img = await pdf.embedPng(a.handtekening)
      const s = Math.min(240 / img.width, 90 / img.height)
      p.drawImage(img, { x: M, y: y - 10 - img.height * s, width: img.width * s, height: img.height * s })
      y -= 20 + img.height * s
    } catch { y -= 20 }
    t(`${a.naam} · getekend op ${getekendOp(a.op)}`, M, y, 9, font, GRIJS)
  }
  return pdf.save()
}
