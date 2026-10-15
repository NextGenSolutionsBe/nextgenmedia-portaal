import 'server-only'
import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import path from 'path'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib'
import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import { sendEmail, baseUrl } from '@/lib/email'
import { leesInstellingen } from '@/lib/instellingen/laden'
import { logContractEvent } from '@/lib/contract-audit'
import {
  referentie, contractnummer, archiefPaden, certificaatBlokken, documentBestandsnaam, meldingTekst, tijdstipBrussel,
  legalOntvangers, meldingAlVerstuurd, INTEGRITEITSZIN, STATUS_ONDERTEKEND, TIJDZONE_LABEL,
  type Dossier, type DossierGebeurtenis, type MeldingGebeurtenis,
} from '@/lib/contract-archief-model'

/**
 * Contractarchief: bij elke definitieve ondertekening een onveranderlijke
 * kopie van het getekende contract, een ondertekeningscertificaat (met uniek
 * certificaatnummer) en een dossier.json in de privébucket `contract-archief`,
 * geregistreerd in de tabel `contract_archief` (die geen UPDATE of DELETE
 * toelaat en het verwijderen van het contract overleeft).
 *
 * Daarnaast één melding naar Legal per archiefversie, met beide PDF's in
 * bijlage. De melding is idempotent (contract_events) en kan vanuit het
 * contract opnieuw geprobeerd worden als ze mislukte.
 *
 * Alles hier is best-effort ten opzichte van de ondertekening zelf: een
 * archief- of mailfout mag een handtekening nooit laten falen.
 */

type Admin = ReturnType<typeof createAdminSupabaseClient>
export const ARCHIEF_BUCKET = 'contract-archief'
const CONTRACT_BUCKET = 'contracts'

export type ArchiefResultaat = {
  contractId: string
  archiefId: string | null
  versie: number
  bestaandAl: boolean
  certificaatNr: string | null
  paden: { contract: string; certificaat: string; dossier: string }
  dossier: Dossier
  sha256Certificaat: string
  gearchiveerdOp: string | null
}

/** Behouden voor bestaande aanroepers; de melding vermeldt facturatie niet meer. */
export type FacturatieSamenvatting = { gestart: boolean; reden?: string; aangemaakt: number; bestaand: number; gesynct: number; mislukt: number } | null

export type MeldingResultaat = { ok: boolean; naar: string[]; overgeslagen?: boolean; fout?: string }

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

// ── Dossier ──────────────────────────────────────────────────────────────────

/** Het volgende certificaatnummer uit de database; met een deterministische terugval als de functie ontbreekt. */
async function reserveerCertificaatnummer(admin: Admin, contractId: string, versie: number): Promise<string> {
  try {
    const { data, error } = await admin.rpc('volgend_certificaatnummer')
    const nr = typeof data === 'string' ? data.trim() : ''
    if (!error && nr) return nr
    if (error) console.error('[contract-archief] certificaatnummer:', error.message)
  } catch (e) { console.error('[contract-archief] certificaatnummer:', e instanceof Error ? e.message : e) }
  const jaar = new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', year: 'numeric' }).format(new Date())
  return `NGM-CERT-${jaar}-${contractId.slice(0, 8).toUpperCase()}${versie > 1 ? `-V${versie}` : ''}`
}

/** Alles wat over dit contract bekend is, in één dossier. */
async function laadDossier(admin: Admin, contractId: string, bron: string, versie: number, sha256Contract: string, certificaatNr: string): Promise<Dossier> {
  const { data: c } = await admin.from('contracts').select('*').eq('id', contractId).maybeSingle()
  if (!c) throw new Error('Contract niet gevonden.')
  const [{ data: klant }, { data: sig }, { data: events }, instellingen] = await Promise.all([
    c.client_id ? admin.from('clients').select('company_name, contact_name').eq('id', c.client_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from('contract_signatures').select('*').eq('contract_id', contractId).order('signed_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('contract_events').select('event_type, created_at, actor, ip_address, user_agent').eq('contract_id', contractId).order('created_at', { ascending: true }).limit(200),
    leesInstellingen().catch(() => null),
  ])
  const org = instellingen?.organisatie
  const bedrijfsnaam = String(org?.handelsnaam || org?.vennootschapsnaam || 'NextGenMedia').trim() || 'NextGenMedia'
  const k = klant as { company_name?: string | null; contact_name?: string | null } | null
  return {
    contractId,
    referentie: referentie(contractId),
    certificaatNr,
    titel: String(c.title ?? 'Contract'),
    contractType: (c.contract_type as string | null) ?? null,
    klantNaam: k?.company_name ?? null,
    contactNaam: k?.contact_name?.trim() ? String(k.contact_name).trim() : null,
    bedrijfsnaam,
    signerName: (sig?.signer_name as string | null) ?? (c.signer_name as string | null) ?? null,
    signerEmail: (sig?.signer_email as string | null) ?? (c.signer_email as string | null) ?? null,
    signedAt: (sig?.signed_at as string | null) ?? (c.signed_at as string | null) ?? null,
    sentAt: (c.sent_at as string | null) ?? null,
    ipAdres: (sig?.ip_address as string | null) ?? null,
    userAgent: (sig?.user_agent as string | null) ?? null,
    startDatum: (c.start_date as string | null) ?? null,
    eindDatum: (c.end_date as string | null) ?? null,
    verwachtAantal: c.expected_invoice_count === null || c.expected_invoice_count === undefined ? null : Number(c.expected_invoice_count),
    verwachtBedragExcl: c.expected_invoice_amount_excl === null || c.expected_invoice_amount_excl === undefined ? null : Number(c.expected_invoice_amount_excl),
    frequentie: (c.invoice_frequency as string | null) ?? null,
    gebeurtenissen: ((events ?? []) as DossierGebeurtenis[]),
    sha256Contract,
    bron,
    versie,
    gearchiveerdOp: new Date().toISOString(),
    app: `NextGenMedia Portal · ${baseUrl()}`,
  }
}

// ── Certificaat-PDF ──────────────────────────────────────────────────────────

const A4 = { w: 595.28, h: 841.89 }
const MARGE = 48
const VOET_HOOGTE = 46

function wikkel(tekst: string, font: PDFFont, grootte: number, breedte: number): string[] {
  const regels: string[] = []
  for (const alinea of tekst.split('\n')) {
    let huidig = ''
    for (const woord of alinea.split(/\s+/)) {
      const kandidaat = huidig ? `${huidig} ${woord}` : woord
      if (font.widthOfTextAtSize(kandidaat, grootte) <= breedte) { huidig = kandidaat; continue }
      if (huidig) regels.push(huidig)
      // Een woord dat op zichzelf te lang is (een hash, een URL): hard afbreken.
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
  return regels
}

/** Onleesbare tekens (buiten WinAnsi) vervangen, anders weigert de standaardfont. */
const veilig = (s: string) => s.replace(/[^\x20-\x7E -ÿ€]/g, '?').replace(/€/g, 'EUR ')

function hexKleur(hex: string | null | undefined, terugval: [number, number, number]): [number, number, number] {
  const m = String(hex ?? '').trim().match(/^#?([0-9a-f]{6})$/i)
  if (!m) return terugval
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** Het logo: eigen upload uit Instellingen → Documenten, anders het standaardlogo. */
async function laadLogo(admin: Admin | null, logoPath: string | null | undefined): Promise<Uint8Array | null> {
  if (admin && logoPath) {
    try {
      const { data } = await admin.storage.from(CONTRACT_BUCKET).download(logoPath)
      if (data) return new Uint8Array(await data.arrayBuffer())
    } catch { /* standaard hieronder */ }
  }
  try { return new Uint8Array(await readFile(path.join(process.cwd(), 'public', 'logo-pdf.png'))) } catch { /* volgende */ }
  try { return new Uint8Array(await readFile(path.join(process.cwd(), 'public', 'logo.png'))) } catch { return null }
}

export type CertificaatHuisstijl = { logo?: Uint8Array | null; accent?: string | null; tekstkleur?: string | null; voettekst?: string | null }

/**
 * Het ondertekeningscertificaat als A4-PDF in de huisstijl: logo, accentkleur,
 * certificaatnummer, alle blokken uit certificaatBlokken(), integriteitszin,
 * voettekst met paginanummers op elke pagina.
 */
export async function maakCertificaatPdf(d: Dossier, stijl: CertificaatHuisstijl = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Ondertekeningscertificaat ${d.certificaatNr ?? d.referentie}`)
  pdf.setAuthor(d.bedrijfsnaam ?? 'NextGenMedia')
  pdf.setCreator('NextGenMedia Portal')
  pdf.setSubject(`${d.titel} — ${STATUS_ONDERTEKEND}`)
  pdf.setKeywords([d.referentie, d.certificaatNr ?? '', 'ondertekeningscertificaat'].filter(Boolean))
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const vet = await pdf.embedFont(StandardFonts.HelveticaBold)
  const mono = await pdf.embedFont(StandardFonts.Courier)

  const ACCENT = rgb(...hexKleur(stijl.accent, [1, 0.973, 0.282]))     // #fff848
  const TEKST = rgb(...hexKleur(stijl.tekstkleur, [0.07, 0.07, 0.07]))
  const GRIJS = rgb(0.42, 0.42, 0.42)
  const LICHT = rgb(0.86, 0.86, 0.86)
  const GROEN = rgb(0.13, 0.55, 0.3)

  let logo: PDFImage | null = null
  if (stijl.logo && stijl.logo.length > 4) {
    try {
      const isJpeg = stijl.logo[0] === 0xff && stijl.logo[1] === 0xd8
      logo = isJpeg ? await pdf.embedJpg(stijl.logo) : await pdf.embedPng(stijl.logo)
    } catch { logo = null }
  }

  const breedte = A4.w - 2 * MARGE
  let page: PDFPage = pdf.addPage([A4.w, A4.h])
  let y = A4.h - MARGE

  const kop = (eerste: boolean) => {
    // Accentbalk bovenaan + logo/naam; op vervolgpagina's compacter.
    page.drawRectangle({ x: 0, y: A4.h - 6, width: A4.w, height: 6, color: ACCENT })
    const top = A4.h - MARGE + 10
    if (logo) {
      const h = eerste ? 34 : 22, w = (logo.width / logo.height) * h
      page.drawImage(logo, { x: MARGE, y: top - h, width: w, height: h })
    } else {
      page.drawText(veilig(d.bedrijfsnaam ?? 'NextGenMedia'), { x: MARGE, y: top - 16, size: eerste ? 16 : 12, font: vet, color: TEKST })
    }
    const rechts = veilig(d.certificaatNr ?? d.referentie)
    page.drawText(rechts, { x: A4.w - MARGE - vet.widthOfTextAtSize(rechts, 10), y: top - 12, size: 10, font: vet, color: TEKST })
    const sub = 'Ondertekeningscertificaat'
    page.drawText(sub, { x: A4.w - MARGE - font.widthOfTextAtSize(sub, 8.5), y: top - 25, size: 8.5, font, color: GRIJS })
    y = top - (eerste ? 52 : 40)
    page.drawLine({ start: { x: MARGE, y }, end: { x: A4.w - MARGE, y }, thickness: 0.8, color: LICHT })
    y -= eerste ? 28 : 20
  }

  const nieuwePagina = () => { page = pdf.addPage([A4.w, A4.h]); kop(false) }
  const ruimte = (nodig: number) => { if (y - nodig < MARGE + VOET_HOOGTE) nieuwePagina() }
  const tekst = (s: string, opties: { x?: number; grootte?: number; font?: PDFFont; kleur?: ReturnType<typeof rgb>; maxBreedte?: number; regelafstand?: number } = {}) => {
    const f = opties.font ?? font, g = opties.grootte ?? 10, extra = opties.regelafstand ?? 4
    const regels = wikkel(veilig(s), f, g, opties.maxBreedte ?? breedte - ((opties.x ?? MARGE) - MARGE))
    for (const r of regels) {
      ruimte(g + extra)
      page.drawText(r, { x: opties.x ?? MARGE, y, size: g, font: f, color: opties.kleur ?? TEKST })
      y -= g + extra
    }
  }

  kop(true)

  // Titel + statuspil
  page.drawText('Ondertekeningscertificaat', { x: MARGE, y, size: 22, font: vet, color: TEKST })
  y -= 30
  tekst(d.titel, { grootte: 13, font: vet })
  y -= 2
  {
    const pil = veilig(STATUS_ONDERTEKEND.toUpperCase())
    const pw = vet.widthOfTextAtSize(pil, 8) + 18
    page.drawRectangle({ x: MARGE, y: y - 6, width: pw, height: 18, color: rgb(0.9, 0.97, 0.92), borderColor: GROEN, borderWidth: 0.6 })
    page.drawText(pil, { x: MARGE + 9, y: y - 1, size: 8, font: vet, color: GROEN })
    const nr = veilig(`Certificaatnummer ${d.certificaatNr ?? '—'}`)
    page.drawText(nr, { x: MARGE + pw + 12, y: y - 1, size: 9, font, color: GRIJS })
    y -= 30
  }

  // Kernfeiten in een kader (wie/wat/wanneer in één oogopslag)
  {
    const feiten: [string, string][] = [
      ['Klant', d.klantNaam ?? '—'],
      ['Bedrijf', d.bedrijfsnaam ?? '—'],
      ['Contractnummer', contractnummer(d.contractId)],
      ['Ondertekenaar', `${d.signerName ?? '—'}${d.signerEmail ? ` · ${d.signerEmail}` : ''}`],
      ['Ondertekend op', `${tijdstipBrussel(d.signedAt)} · ${TIJDZONE_LABEL}`],
    ]
    const labelB = 110, regelH = 15, pad = 12
    const hoogte = feiten.length * regelH + pad * 2 - 3
    ruimte(hoogte + 10)
    page.drawRectangle({ x: MARGE, y: y - hoogte + 10, width: breedte, height: hoogte, color: rgb(0.985, 0.985, 0.985), borderColor: LICHT, borderWidth: 0.6 })
    page.drawRectangle({ x: MARGE, y: y - hoogte + 10, width: 4, height: hoogte, color: ACCENT })
    let fy = y - pad + 2
    for (const [l, w] of feiten) {
      page.drawText(veilig(l), { x: MARGE + 14, y: fy, size: 8.5, font: vet, color: GRIJS })
      const regels = wikkel(veilig(w), font, 9.5, breedte - labelB - 28)
      page.drawText(regels[0] ?? '', { x: MARGE + 14 + labelB, y: fy, size: 9.5, font, color: TEKST })
      fy -= regelH
    }
    y -= hoogte + 6
  }

  tekst('Dit certificaat bevestigt de digitale ondertekening van bovenstaand contract en legt vast wie tekende, wanneer, op welke manier en met welke documentvingerafdruk. Het hoort bij de getekende PDF met dezelfde SHA-256.', { grootte: 9, kleur: GRIJS })
  y -= 8

  for (const blok of certificaatBlokken(d)) {
    if (blok.regels.length === 0) continue
    ruimte(44)
    y -= 6
    page.drawText(veilig(blok.kop.toUpperCase()), { x: MARGE, y, size: 8.5, font: vet, color: GRIJS })
    y -= 6
    page.drawLine({ start: { x: MARGE, y }, end: { x: A4.w - MARGE, y }, thickness: 0.6, color: LICHT })
    y -= 13
    const labelBreedte = blok.kop === 'Tijdlijn' ? 132 : 160
    for (const [label, waarde] of blok.regels) {
      const isHash = /SHA-256/.test(label)
      const f = isHash ? mono : font
      const g = isHash ? 8.5 : 10
      const regels = wikkel(veilig(waarde), f, g, breedte - labelBreedte)
      ruimte((g + 4) * regels.length + 2)
      page.drawText(veilig(label), { x: MARGE, y, size: 9, font: vet, color: rgb(0.3, 0.3, 0.3) })
      for (const r of regels) {
        page.drawText(r, { x: MARGE + labelBreedte, y, size: g, font: f, color: label === 'Status' ? GROEN : TEKST })
        y -= g + 4
      }
      y -= 2
    }
    if (blok.kop === 'Integriteit') {
      y -= 2
      tekst(INTEGRITEITSZIN, { grootte: 9, kleur: GRIJS })
      y -= 4
    }
  }

  // Voet op elke pagina: certificaatnummer, referentie, paginanummer, optionele voettekst.
  const paginas = pdf.getPages()
  paginas.forEach((p, i) => {
    p.drawLine({ start: { x: MARGE, y: 40 }, end: { x: A4.w - MARGE, y: 40 }, thickness: 0.5, color: LICHT })
    const links = veilig(`${d.certificaatNr ?? d.referentie} · ${d.referentie} · gegenereerd ${tijdstipBrussel(d.gearchiveerdOp)}`)
    p.drawText(links, { x: MARGE, y: 28, size: 7.5, font, color: GRIJS })
    const rechts = `Pagina ${i + 1} van ${paginas.length}`
    p.drawText(rechts, { x: A4.w - MARGE - font.widthOfTextAtSize(rechts, 7.5), y: 28, size: 7.5, font, color: GRIJS })
    const voet = veilig(String(stijl.voettekst ?? '').trim() || `${d.bedrijfsnaam ?? 'NextGenMedia'} · ${d.app}`)
    p.drawText(voet.slice(0, 140), { x: MARGE, y: 17, size: 7, font, color: GRIJS })
  })
  return pdf.save()
}

// ── Archiveren ───────────────────────────────────────────────────────────────

type ArchiefRij = {
  id: string; versie: number; certificaat_nr: string | null; sha256_contract: string; sha256_certificaat: string
  pad_contract: string; pad_certificaat: string; pad_dossier: string; dossier: Dossier; gearchiveerd_op: string | null
}

/** De nieuwste archiefrij van een contract (of null). Veerkrachtig vóór de certificaat_nr-migratie. */
export async function laatsteArchief(admin: Admin, contractId: string): Promise<ArchiefRij | null> {
  const kolommen = 'id, versie, certificaat_nr, sha256_contract, sha256_certificaat, pad_contract, pad_certificaat, pad_dossier, dossier, gearchiveerd_op'
  let { data, error } = await admin.from('contract_archief').select(kolommen).eq('contract_id', contractId).order('versie', { ascending: false }).limit(1).maybeSingle()
  if (error && /certificaat_nr/.test(error.message)) {
    ({ data, error } = await admin.from('contract_archief').select(kolommen.replace('certificaat_nr, ', '')).eq('contract_id', contractId).order('versie', { ascending: false }).limit(1).maybeSingle())
  }
  if (error || !data) return null
  const r = data as Partial<ArchiefRij> & { dossier?: Dossier }
  const dossier = (r.dossier ?? {}) as Dossier
  return {
    id: String(r.id), versie: Number(r.versie ?? 1), certificaat_nr: r.certificaat_nr ?? dossier.certificaatNr ?? null,
    sha256_contract: String(r.sha256_contract ?? ''), sha256_certificaat: String(r.sha256_certificaat ?? ''),
    pad_contract: String(r.pad_contract ?? ''), pad_certificaat: String(r.pad_certificaat ?? ''), pad_dossier: String(r.pad_dossier ?? ''),
    dossier, gearchiveerd_op: r.gearchiveerd_op ?? null,
  }
}

const naarResultaat = (contractId: string, r: ArchiefRij, bestaandAl: boolean): ArchiefResultaat => ({
  contractId, archiefId: r.id, versie: r.versie, bestaandAl, certificaatNr: r.certificaat_nr,
  paden: { contract: r.pad_contract, certificaat: r.pad_certificaat, dossier: r.pad_dossier },
  dossier: r.dossier, sha256Certificaat: r.sha256_certificaat, gearchiveerdOp: r.gearchiveerd_op,
})

/**
 * Archiveert de huidige getekende versie. Idempotent: is exact dit PDF (zelfde
 * SHA-256) al gearchiveerd, dan komt er geen nieuwe versie én geen nieuw
 * certificaat bij. Eén ondertekening = maximaal één certificaat; enkel
 * wanneer de bytes van het getekende PDF veranderen, volgt een nieuwe versie.
 */
export async function archiveerContract(admin: Admin, contractId: string, bron: string, door?: string | null): Promise<ArchiefResultaat> {
  const { data: c } = await admin.from('contracts').select('id, title, status, signed_pdf_path, pdf_path').eq('id', contractId).maybeSingle()
  if (!c) throw new Error('Contract niet gevonden.')
  const pad = (c.signed_pdf_path as string | null) ?? (c.pdf_path as string | null)
  if (!pad) throw new Error('Dit contract heeft geen PDF om te archiveren.')

  const { data: bestand, error: dlFout } = await admin.storage.from(CONTRACT_BUCKET).download(pad)
  if (dlFout || !bestand) throw new Error(`Getekende PDF niet gevonden in de opslag: ${dlFout?.message ?? pad}`)
  const contractBytes = new Uint8Array(await bestand.arrayBuffer())
  const hashContract = sha256(contractBytes)

  const bestaande = await laatsteArchief(admin, contractId)
  if (bestaande && bestaande.sha256_contract === hashContract) return naarResultaat(contractId, bestaande, true)

  const versie = bestaande ? bestaande.versie + 1 : 1
  // Certificaatnummer reserveren VÓÓR het certificaat gemaakt wordt: het staat erop.
  const certificaatNr = await reserveerCertificaatnummer(admin, contractId, versie)
  const dossier = await laadDossier(admin, contractId, bron, versie, hashContract, certificaatNr)

  const instellingen = await leesInstellingen().catch(() => null)
  const doc = instellingen?.documenten
  const logo = await laadLogo(admin, doc?.logo_path)
  const certificaat = await maakCertificaatPdf(dossier, { logo, accent: doc?.primaire_kleur, tekstkleur: doc?.secundaire_kleur, voettekst: doc?.voettekst })
  const hashCert = sha256(certificaat)
  const paden = archiefPaden(contractId, versie)

  // De bucket bestaat normaal al (migratie); zo niet, maken we hem privé aan.
  try { await admin.storage.createBucket(ARCHIEF_BUCKET, { public: false }) } catch { /* bestaat al */ }
  const up = async (p: string, data: Uint8Array | string, type: string) => {
    const { error } = await admin.storage.from(ARCHIEF_BUCKET).upload(p, typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data), { contentType: type, upsert: false })
    if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`Archief-upload mislukt (${p}): ${error.message}`)
  }
  await up(paden.contract, contractBytes, 'application/pdf')
  await up(paden.certificaat, certificaat, 'application/pdf')
  await up(paden.dossier, JSON.stringify({ ...dossier, sha256Certificaat: hashCert }, null, 2), 'application/json')

  const rij: Record<string, unknown> = {
    contract_id: contractId, versie, bron, certificaat_nr: certificaatNr,
    titel: dossier.titel, klant_naam: dossier.klantNaam, signer_name: dossier.signerName, signer_email: dossier.signerEmail, signed_at: dossier.signedAt,
    sha256_contract: hashContract, sha256_certificaat: hashCert,
    pad_contract: paden.contract, pad_certificaat: paden.certificaat, pad_dossier: paden.dossier,
    dossier, gearchiveerd_door: door ?? null,
  }
  // Veerkrachtig: certificaat_nr-kolom kan ontbreken vóór migratie (het nummer staat dan nog in het dossier).
  let ingevoegd: { id: string; gearchiveerd_op: string | null } | null = null
  for (let i = 0; i < 2; i++) {
    const { data, error } = await admin.from('contract_archief').insert(rij).select('id, gearchiveerd_op').single()
    if (!error) { ingevoegd = data as { id: string; gearchiveerd_op: string | null }; break }
    const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
    if (col && col in rij && col !== 'contract_id') { delete rij[col]; continue }
    throw new Error(`Archiefregister schrijven mislukt: ${error.message}`)
  }
  await logContractEvent(admin, contractId, 'gearchiveerd', { actor: door ?? null, meta: { versie, sha256: hashContract, bron, certificaat_nr: certificaatNr, archief_id: ingevoegd?.id ?? null } })

  return {
    contractId, archiefId: ingevoegd?.id ?? null, versie, bestaandAl: false, certificaatNr, paden, dossier,
    sha256Certificaat: hashCert, gearchiveerdOp: ingevoegd?.gearchiveerd_op ?? dossier.gearchiveerdOp,
  }
}

// ── Documenten ophalen ───────────────────────────────────────────────────────

export type ArchiefDocument = { bytes: Uint8Array; bestandsnaam: string; archief: ArchiefResultaat }

async function downloadArchief(admin: Admin, pad: string, wat: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(ARCHIEF_BUCKET).download(pad)
  if (error || !data) throw new Error(`${wat} niet gevonden in het archief: ${error?.message ?? pad}`)
  return new Uint8Array(await data.arrayBuffer())
}

/** Het certificaat als bytes: uit het archief, of vers gemaakt wanneer er nog geen archief is. */
export async function haalCertificaat(admin: Admin, contractId: string): Promise<ArchiefDocument> {
  const r = await archiveerContract(admin, contractId, 'handmatig')
  const bytes = await downloadArchief(admin, r.paden.certificaat, 'Certificaat')
  return { bytes, bestandsnaam: documentBestandsnaam('certificaat', r.dossier.klantNaam, r.dossier.titel, r.dossier.signedAt), archief: r }
}

/** Het getekende contract zoals gearchiveerd (byte-identiek aan de ondertekende PDF). */
export async function haalGetekendContract(admin: Admin, contractId: string): Promise<ArchiefDocument> {
  const r = await archiveerContract(admin, contractId, 'handmatig')
  const bytes = await downloadArchief(admin, r.paden.contract, 'Getekend contract')
  return { bytes, bestandsnaam: documentBestandsnaam('getekend_contract', r.dossier.klantNaam, r.dossier.titel, r.dossier.signedAt), archief: r }
}

/** Beide documenten in één keer (één archiefronde, twee downloads parallel). */
export async function haalBeideDocumenten(admin: Admin, contractId: string): Promise<{ contract: ArchiefDocument; certificaat: ArchiefDocument; archief: ArchiefResultaat }> {
  const r = await archiveerContract(admin, contractId, 'handmatig')
  const [contractBytes, certBytes] = await Promise.all([
    downloadArchief(admin, r.paden.contract, 'Getekend contract'),
    downloadArchief(admin, r.paden.certificaat, 'Certificaat'),
  ])
  const d = r.dossier
  return {
    archief: r,
    contract: { bytes: contractBytes, bestandsnaam: documentBestandsnaam('getekend_contract', d.klantNaam, d.titel, d.signedAt), archief: r },
    certificaat: { bytes: certBytes, bestandsnaam: documentBestandsnaam('certificaat', d.klantNaam, d.titel, d.signedAt), archief: r },
  }
}

/** Contract- en certificaatpagina's samen in één PDF (om af te drukken): contract eerst, dan het certificaat. */
export async function combineerPdfs(contract: Uint8Array, certificaat: Uint8Array, titel: string): Promise<Uint8Array> {
  const uit = await PDFDocument.create()
  uit.setTitle(titel)
  uit.setCreator('NextGenMedia Portal')
  for (const bron of [contract, certificaat]) {
    const doc = await PDFDocument.load(bron, { ignoreEncryption: true })
    const paginas = await uit.copyPages(doc, doc.getPageIndices())
    for (const p of paginas) uit.addPage(p)
  }
  return uit.save()
}

// ── Melding naar Legal ───────────────────────────────────────────────────────

/** De meldingsgebeurtenissen van een contract (voor de idempotentiecontrole). */
async function meldingGebeurtenissen(admin: Admin, contractId: string): Promise<MeldingGebeurtenis[]> {
  const { data } = await admin.from('contract_events').select('event_type, created_at, meta').eq('contract_id', contractId).in('event_type', ['melding_verstuurd', 'melding_mislukt']).order('created_at', { ascending: false }).limit(50)
  return ((data ?? []) as MeldingGebeurtenis[])
}

/**
 * Eén melding naar Legal per archiefversie, met beide PDF's in bijlage.
 * Idempotent: bestaat er al een 'melding_verstuurd' voor deze versie, dan
 * wordt er niets verstuurd. Mislukt het versturen, dan komt er een
 * 'melding_mislukt' en kan de mens het vanuit het contract opnieuw proberen.
 */
export async function meldOndertekening(admin: Admin, r: ArchiefResultaat, opties: { forceer?: boolean; actor?: string | null } = {}): Promise<MeldingResultaat> {
  const naar = legalOntvangers({ CONTRACT_LEGAL_EMAIL: process.env.CONTRACT_LEGAL_EMAIL })
  if (!opties.forceer) {
    const events = await meldingGebeurtenissen(admin, r.contractId)
    if (meldingAlVerstuurd(events, { versie: r.versie, archiefId: r.archiefId })) return { ok: true, naar, overgeslagen: true }
  }
  const { data: c } = await admin.from('contracts').select('access_token').eq('id', r.contractId).maybeSingle()
  const { onderwerp, tekst } = meldingTekst(r.dossier, {
    adminUrl: `${baseUrl()}/admin/contracts/${r.contractId}`,
    ontvangstUrl: c?.access_token ? `${baseUrl()}/sign/${c.access_token}/receipt` : null,
  })
  // Bijlagen via getekende links: Resend haalt ze zelf op. Zeven dagen geldig.
  const link = async (p: string) => (await admin.storage.from(ARCHIEF_BUCKET).createSignedUrl(p, 7 * 24 * 3600)).data?.signedUrl ?? null
  const [contractUrl, certUrl] = await Promise.all([link(r.paden.contract), link(r.paden.certificaat)])
  const d = r.dossier
  const attachments = [
    ...(contractUrl ? [{ filename: documentBestandsnaam('getekend_contract', d.klantNaam, d.titel, d.signedAt), path: contractUrl }] : []),
    ...(certUrl ? [{ filename: documentBestandsnaam('certificaat', d.klantNaam, d.titel, d.signedAt), path: certUrl }] : []),
  ]
  const res = await sendEmail({ to: naar, subject: onderwerp, text: tekst, attachments })
  await logContractEvent(admin, r.contractId, res.ok ? 'melding_verstuurd' : 'melding_mislukt', {
    actor: opties.actor ?? null,
    meta: { naar, archief_id: r.archiefId, versie: r.versie, certificaat_nr: r.certificaatNr, bijlagen: attachments.length, fout: res.ok ? null : res.error },
  })
  return res.ok ? { ok: true, naar } : { ok: false, naar, fout: res.error }
}

/**
 * De melding voor de nieuwste archiefversie (opnieuw) versturen — vanuit de
 * knop op het contract. Slaat over als ze al verstuurd is.
 */
export async function hermeldOndertekening(admin: Admin, contractId: string, actor?: string | null): Promise<MeldingResultaat & { archief: ArchiefResultaat }> {
  const archief = await archiveerContract(admin, contractId, 'handmatig', actor)
  const melding = await meldOndertekening(admin, archief, { actor })
  return { ...melding, archief }
}

/**
 * Na een definitieve ondertekening: archiveren én melden. Best-effort; fouten
 * worden gelogd en teruggegeven, nooit gegooid. De facturatieparameter blijft
 * bestaan voor aanroepers, maar speelt geen rol meer in de melding.
 */
export async function naOndertekening(admin: Admin, contractId: string, bron: 'tekenlink' | 'upload_getekend', _facturatie?: FacturatieSamenvatting, door?: string | null): Promise<{ archief?: ArchiefResultaat; melding?: MeldingResultaat; fout?: string }> {
  try {
    const archief = await archiveerContract(admin, contractId, bron, door)
    const melding = await meldOndertekening(admin, archief, { actor: door ?? null })
    return { archief, melding }
  } catch (e) {
    const fout = e instanceof Error ? e.message : String(e)
    console.error('[contract-archief]', fout)
    return { fout }
  }
}
