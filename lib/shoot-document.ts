import 'server-only'
import { readFile } from 'fs/promises'
import path from 'path'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { leesInstellingen } from '@/lib/instellingen/laden'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import {
  splitsInRegels, veilig, datumLang, datumKort, heeftInhoud,
  type ShootDocumentItem, type ShootDocumentShoot,
} from '@/lib/shoot-document-model'

export { splitsInRegels, bestandsnaamShootDocument } from '@/lib/shoot-document-model'
export type { ShootDocumentItem, ShootDocumentShoot } from '@/lib/shoot-document-model'

/**
 * Shootdocument "Shootvoorbereiding": een print-klare A4-checklist voor op de
 * set. Per script staat elke zin op een eigen regel met een vinkvakje, gevolgd
 * door de medianotities per item. Regels worden nooit over twee pagina's
 * gebroken en een kop staat altijd bij zijn eerste regel.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

const A4 = { w: 595.28, h: 841.89 }
const MARGE = 48
const ONDER = 60              // vrije ruimte onderaan voor de voettekst
const GEEL = rgb(1, 0.973, 0.282)
const ZWART = rgb(0.07, 0.07, 0.07)
const GRIJS = rgb(0.42, 0.45, 0.5)
const LIJN = rgb(0.85, 0.86, 0.88)
const LICHT = rgb(0.96, 0.965, 0.975)

const LOGO_BUCKET = 'contracts'

export type MaakShootDocumentInvoer = {
  klantNaam: string
  projectNaam: string
  shoot?: ShootDocumentShoot | null
  items: ShootDocumentItem[]
}

/** Regelafbreking op breedte; te lange woorden (URL's) worden hard afgebroken. */
function wikkel(font: PDFFont, tekst: string, grootte: number, breedte: number): string[] {
  const regels: string[] = []
  for (const alinea of tekst.split(/\r?\n/)) {
    const woorden = alinea.split(/\s+/).filter(Boolean)
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
    if (huidig) regels.push(huidig)
  }
  return regels
}

function kleurUitHex(hex: string | undefined, terugval: ReturnType<typeof rgb>) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')
  if (!m) return terugval
  const n = parseInt(m[1], 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

async function laadLogo(logoPath: string | undefined): Promise<Uint8Array | null> {
  if (logoPath) {
    try {
      const { data } = await createAdminSupabaseClient().storage.from(LOGO_BUCKET).download(logoPath)
      if (data) return new Uint8Array(await data.arrayBuffer())
    } catch { /* val terug op het standaardlogo */ }
  }
  try {
    return new Uint8Array(await readFile(path.join(process.cwd(), 'public', 'logo-pdf.png')).catch(() => readFile(path.join(process.cwd(), 'public', 'logo.png'))))
  } catch { return null }
}

export async function maakShootDocument(invoer: MaakShootDocumentInvoer): Promise<Uint8Array> {
  const inst = await leesInstellingen().catch(() => null)
  const doc = inst?.documenten
  const org = inst?.organisatie
  const ACCENT = kleurUitHex(doc?.primaire_kleur, GEEL)
  const TEKST = kleurUitHex(doc?.secundaire_kleur, ZWART)
  const bedrijfsnaam = veilig(org?.handelsnaam || org?.vennootschapsnaam || 'NextGen Media') || 'NextGen Media'

  const klantNaam = veilig(invoer.klantNaam) || 'Klant'
  const projectNaam = veilig(invoer.projectNaam) || 'Social media'
  const shoot = invoer.shoot ?? null

  const pdf = await PDFDocument.create()
  pdf.setTitle(`Shootvoorbereiding ${klantNaam}`)
  pdf.setSubject(projectNaam)
  pdf.setAuthor(`${bedrijfsnaam} portaal`)
  pdf.setCreator(`${bedrijfsnaam} portaal`)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const vet = await pdf.embedFont(StandardFonts.HelveticaBold)

  const breedte = A4.w - MARGE * 2
  let page: PDFPage = pdf.addPage([A4.w, A4.h])
  let y = A4.h - MARGE

  // ── Paginabeheer ────────────────────────────────────────────────────────────
  const nieuwePagina = () => {
    page = pdf.addPage([A4.w, A4.h])
    y = A4.h - MARGE
    page.drawRectangle({ x: MARGE, y: y - 2, width: breedte, height: 2.5, color: ACCENT })
    y -= 22
  }
  /** Zorgt dat `nodig` punten aaneengesloten beschikbaar zijn (anders nieuwe pagina). */
  const ruimte = (nodig: number) => { if (y - nodig < ONDER) nieuwePagina() }

  // ── Bouwstenen ──────────────────────────────────────────────────────────────
  const REGEL = 10.5, INTERLINIE = 15, VAK = 10, VAK_AFSTAND = 22
  const tekstBreedte = breedte - VAK_AFSTAND

  const vinkregelHoogte = (regels: string[]) => regels.length * INTERLINIE + 9

  /** Eén afvinkbare regel: vierkant vakje + (gewikkelde) tekst. Nooit over twee pagina's. */
  const vinkregel = (tekst: string) => {
    const schoon = veilig(tekst)
    if (!schoon) return
    const regels = wikkel(font, schoon, REGEL, tekstBreedte)
    ruimte(vinkregelHoogte(regels))
    page.drawRectangle({ x: MARGE + 1, y: y - VAK + 1, width: VAK, height: VAK, borderColor: rgb(0.35, 0.35, 0.35), borderWidth: 0.9 })
    regels.forEach((r, i) => page.drawText(r, { x: MARGE + VAK_AFSTAND, y: y - REGEL + 1.5 - i * INTERLINIE, size: REGEL, font, color: ZWART }))
    y -= vinkregelHoogte(regels)
  }

  /** Hoogte van een sectiekop (met optionele subregel) — nodig om weeskoppen te vermijden. */
  const kopHoogte = (sub?: string) => 14 + 8 + 10 + (sub ? 17 : 0) + 8
  const kop = (titel: string, sub?: string, eersteRegel?: string) => {
    // Kop + eerste regel moeten samen passen, anders staat de kop alleen onderaan.
    const eerste = eersteRegel ? vinkregelHoogte(wikkel(font, veilig(eersteRegel), REGEL, tekstBreedte)) : 0
    ruimte(kopHoogte(sub) + eerste)
    y -= 8
    const t = wikkel(vet, veilig(titel), 13, breedte)
    t.forEach((r, i) => page.drawText(r, { x: MARGE, y: y - 12 - i * 16, size: 13, font: vet, color: TEKST }))
    y -= 12 + (t.length - 1) * 16 + 6
    page.drawRectangle({ x: MARGE, y, width: breedte, height: 1.2, color: ACCENT })
    y -= 10
    if (sub) {
      page.drawText(veilig(sub), { x: MARGE, y: y - 7, size: 9, font, color: GRIJS })
      y -= 17
    }
    y -= 2
  }
  const subkop = (titel: string, eersteRegel?: string) => {
    const eerste = eersteRegel ? vinkregelHoogte(wikkel(font, veilig(eersteRegel), REGEL, tekstBreedte)) : 0
    ruimte(24 + eerste)
    y -= 6
    page.drawText(veilig(titel), { x: MARGE, y: y - 10, size: 10.5, font: vet, color: TEKST })
    y -= 20
  }

  // ── Kop van pagina 1 ────────────────────────────────────────────────────────
  try {
    const logoBytes = await laadLogo(doc?.logo_path)
    if (logoBytes) {
      const isJpeg = logoBytes[0] === 0xff && logoBytes[1] === 0xd8
      const logo = isJpeg ? await pdf.embedJpg(logoBytes) : await pdf.embedPng(logoBytes)
      const h = 42, w = (logo.width / logo.height) * h
      page.drawImage(logo, { x: MARGE, y: y - h, width: w, height: h })
    }
  } catch { /* zonder logo verder */ }
  page.drawText(bedrijfsnaam, { x: A4.w - MARGE - vet.widthOfTextAtSize(bedrijfsnaam, 12), y: y - 14, size: 12, font: vet, color: TEKST })
  page.drawText('Shootvoorbereiding', { x: A4.w - MARGE - font.widthOfTextAtSize('Shootvoorbereiding', 9), y: y - 28, size: 9, font, color: GRIJS })
  y -= 62
  page.drawRectangle({ x: MARGE, y, width: breedte, height: 4, color: ACCENT })
  y -= 34

  page.drawText('Shootvoorbereiding', { x: MARGE, y, size: 22, font: vet, color: TEKST })
  y -= 30

  // Gegevensblok: klant, project, shootdatum, tijdstip, locatie.
  const rijen: [string, string][] = [
    ['Klant', klantNaam],
    ['Project', projectNaam],
  ]
  if (shoot) {
    rijen.push(['Shootdatum', datumLang(shoot.datum)])
    const tijd = [shoot.start, shoot.einde].filter(Boolean).join(' – ')
    if (tijd) rijen.push(['Tijdstip', tijd])
    if (shoot.locatie?.trim()) rijen.push(['Locatie', shoot.locatie.trim()])
  }
  const labelBreedte = 110
  let blokHoogte = 10
  const gerenderd = rijen.map(([l, w]) => [l, wikkel(font, veilig(w), 10, breedte - labelBreedte - 24)] as const)
  for (const [, r] of gerenderd) blokHoogte += Math.max(1, r.length) * 14 + 4
  page.drawRectangle({ x: MARGE, y: y - blokHoogte, width: breedte, height: blokHoogte, color: LICHT })
  page.drawRectangle({ x: MARGE, y: y - blokHoogte, width: 3, height: blokHoogte, color: ACCENT })
  let ry = y - 8
  for (const [label, regels] of gerenderd) {
    page.drawText(label, { x: MARGE + 14, y: ry - 9, size: 9, font: vet, color: GRIJS })
    regels.forEach((r, i) => page.drawText(r, { x: MARGE + 14 + labelBreedte, y: ry - 9 - i * 14, size: 10, font, color: ZWART }))
    ry -= Math.max(1, regels.length) * 14 + 4
  }
  y -= blokHoogte + 8

  // ── Algemene voorbereiding (shootbriefing) ──────────────────────────────────
  const briefingRegels = splitsInRegels(shoot?.briefing)
  if (briefingRegels.length > 0) {
    kop('Algemene voorbereiding', undefined, briefingRegels[0])
    for (const r of briefingRegels) vinkregel(r)
  }

  // ── Scripts ─────────────────────────────────────────────────────────────────
  const metaVan = (it: ShootDocumentItem) => {
    const kanalen = (Array.isArray(it.platforms) && it.platforms.length > 0 ? it.platforms : it.platform ? [it.platform] : [])
      .map((k) => k.charAt(0).toUpperCase() + k.slice(1))
    return [datumKort(it.planned_date), it.content_type, kanalen.join(', ')].filter(Boolean).join(' · ')
  }
  let n = 0
  for (const it of invoer.items) {
    const regels = splitsInRegels(it.script)
    if (regels.length === 0) continue
    n++
    kop(`Script ${n} – ${(it.title || 'Zonder titel').trim()}`, metaVan(it) || undefined, regels[0])
    for (const r of regels) vinkregel(r)
  }

  // ── Medianotities ───────────────────────────────────────────────────────────
  const metNotities = invoer.items
    .map((it) => ({ it, regels: splitsInRegels(it.media_notes) }))
    .filter((x) => x.regels.length > 0)
  if (metNotities.length > 0) {
    kop('Medianotities', undefined, undefined)
    for (const { it, regels } of metNotities) {
      subkop((it.title || 'Zonder titel').trim(), regels[0])
      for (const r of regels) vinkregel(r)
    }
  }

  // ── Voettekst op elke pagina (na afloop: dan kennen we het totaal) ──────────
  const paginas = pdf.getPages()
  const links = veilig(`${bedrijfsnaam} · Shootvoorbereiding`)
  paginas.forEach((p, i) => {
    const rechts = `Pagina ${i + 1} van ${paginas.length}`
    p.drawRectangle({ x: MARGE, y: 40, width: breedte, height: 0.8, color: LIJN })
    p.drawText(links, { x: MARGE, y: 27, size: 8, font, color: GRIJS })
    p.drawText(rechts, { x: A4.w - MARGE - font.widthOfTextAtSize(rechts, 8), y: 27, size: 8, font, color: GRIJS })
  })

  return pdf.save()
}

// ── Gegevens laden ────────────────────────────────────────────────────────────

export type ShootDocumentData =
  | { leeg: true; reden: 'geen_klant' | 'geen_shoot' | 'geen_inhoud' }
  | { leeg: false; klantNaam: string; projectNaam: string; shoot: ShootDocumentShoot | null; shootId: string | null; items: ShootDocumentItem[]; datum: string }

type ShootRij = { id: string; shoot_date: string | null; start_time: string | null; end_time: string | null; location: string | null; briefing: string | null }

const vandaagBrussel = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const plusDagen = (iso: string, dagen: number) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dagen)
  return d.toISOString().slice(0, 10)
}

/**
 * Laadt klant, shoot en content-items voor het shootdocument.
 *  - `shootId` opgegeven: die shoot (moet van deze klant zijn), anders de
 *    eerstvolgende shoot vanaf vandaag.
 *  - Met shootdatum: items vanaf die datum tot de volgende shoot (of +60 dagen).
 *  - Zonder shoot(datum): alle nog niet gepubliceerde items.
 * De aanroeper bepaalt `clientId` (admin: URL na requireStaff; portaal: altijd
 * de geresolveerde sessie) — hier wordt dat niet meer betwist.
 */
export async function laadShootDocumentData(admin: Admin, clientId: string, shootId?: string | null): Promise<ShootDocumentData> {
  const { data: klant } = await admin.from('clients').select('id, company_name').eq('id', clientId).maybeSingle()
  if (!klant) return { leeg: true, reden: 'geen_klant' }

  let shootRij: ShootRij | null = null
  if (shootId) {
    const { data } = await admin.from('shoot_briefings').select('id, shoot_date, start_time, end_time, location, briefing')
      .eq('id', shootId).eq('client_id', clientId).maybeSingle()
    if (!data) return { leeg: true, reden: 'geen_shoot' }
    shootRij = data as ShootRij
  } else {
    const { data } = await admin.from('shoot_briefings').select('id, shoot_date, start_time, end_time, location, briefing')
      .eq('client_id', clientId).gte('shoot_date', vandaagBrussel())
      .order('shoot_date', { ascending: true }).limit(1).maybeSingle()
    shootRij = (data as ShootRij | null) ?? null
  }

  let q = admin.from('social_content_items')
    .select('id, title, script, media_notes, planned_date, content_type, platforms, platform, status')
    .eq('client_id', clientId)
  if (shootRij?.shoot_date) {
    const { data: volgende } = await admin.from('shoot_briefings').select('shoot_date')
      .eq('client_id', clientId).neq('id', shootRij.id).gt('shoot_date', shootRij.shoot_date)
      .order('shoot_date', { ascending: true }).limit(1).maybeSingle()
    q = q.gte('planned_date', shootRij.shoot_date)
    const volgendeDatum = (volgende as { shoot_date: string } | null)?.shoot_date ?? null
    q = volgendeDatum ? q.lt('planned_date', volgendeDatum) : q.lte('planned_date', plusDagen(shootRij.shoot_date, 60))
  } else {
    q = q.neq('status', 'published')
  }
  const { data: itemRijen } = await q.order('planned_date', { ascending: true }).order('created_at', { ascending: true })
  const items = ((itemRijen ?? []) as ShootDocumentItem[])
  if (!heeftInhoud(items)) return { leeg: true, reden: 'geen_inhoud' }

  // Projectnaam: het actieve social-mediacontract van de klant, anders 'Social media'.
  let projectNaam = 'Social media'
  try {
    const { data: contracten } = await admin.from('contracts').select('title, contract_type, status')
      .eq('client_id', clientId).in('status', ['signed', 'active']).order('created_at', { ascending: false }).limit(20)
    const sm = ((contracten ?? []) as { title: string | null; contract_type: string | null }[])
      .find((c) => /social/i.test(`${c.contract_type ?? ''} ${c.title ?? ''}`))
    if (sm?.title?.trim()) projectNaam = sm.title.trim()
  } catch { /* zonder contractnaam verder */ }

  const shoot: ShootDocumentShoot | null = shootRij
    ? { datum: shootRij.shoot_date, start: shootRij.start_time, einde: shootRij.end_time, locatie: shootRij.location, briefing: shootRij.briefing }
    : null

  return {
    leeg: false,
    klantNaam: String(klant.company_name ?? 'Klant'),
    projectNaam,
    shoot,
    shootId: shootRij?.id ?? null,
    items,
    datum: shootRij?.shoot_date ?? vandaagBrussel(),
  }
}

/** HTTP-headers voor het downloaden van de PDF (ASCII-naam + RFC 5987 filename*). */
export function downloadHeaders(bestandsnaam: string, lengte: number): Record<string, string> {
  const ascii = bestandsnaam.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(bestandsnaam)}`,
    'Content-Length': String(lengte),
    'Cache-Control': 'private, no-store',
  }
}

export const LEEG_MELDING = 'Er zijn nog geen scripts of medianotities beschikbaar voor dit shootdocument.'
