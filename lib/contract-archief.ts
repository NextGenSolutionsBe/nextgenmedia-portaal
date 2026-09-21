import 'server-only'
import { createHash } from 'crypto'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import { sendEmail, baseUrl } from '@/lib/email'
import { leesInstellingen } from '@/lib/instellingen/laden'
import { logContractEvent } from '@/lib/contract-audit'
import {
  referentie, archiefPaden, certificaatBlokken, certificaatBestandsnaam, meldingTekst, tijdstipBrussel,
  type Dossier, type DossierGebeurtenis,
} from '@/lib/contract-archief-model'

/**
 * Contractarchief: bij elke definitieve ondertekening een onveranderlijke
 * kopie van het getekende contract, een ondertekeningscertificaat en een
 * dossier.json in de privébucket `contract-archief`, geregistreerd in de
 * tabel `contract_archief` (die geen UPDATE of DELETE toelaat).
 *
 * Daarnaast één interne melding per ondertekening, met beide PDF's in
 * bijlage — zodat de factuur voor Bram meteen kan vertrekken.
 *
 * Alles hier is best-effort ten opzichte van de ondertekening zelf: een
 * archief- of mailfout mag een handtekening nooit laten falen.
 */

type Admin = ReturnType<typeof createAdminSupabaseClient>
export const ARCHIEF_BUCKET = 'contract-archief'
const CONTRACT_BUCKET = 'contracts'

export type ArchiefResultaat = {
  contractId: string
  versie: number
  bestaandAl: boolean
  paden: { contract: string; certificaat: string; dossier: string }
  dossier: Dossier
  sha256Certificaat: string
}

export type FacturatieSamenvatting = { gestart: boolean; reden?: string; aangemaakt: number; bestaand: number; gesynct: number; mislukt: number } | null

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

/** Alles wat over dit contract bekend is, in één dossier. */
async function laadDossier(admin: Admin, contractId: string, bron: string, versie: number, sha256Contract: string): Promise<Dossier> {
  const { data: c } = await admin.from('contracts').select('*').eq('id', contractId).maybeSingle()
  if (!c) throw new Error('Contract niet gevonden.')
  const [{ data: klant }, { data: sig }, { data: events }] = await Promise.all([
    c.client_id ? admin.from('clients').select('company_name').eq('id', c.client_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from('contract_signatures').select('*').eq('contract_id', contractId).order('signed_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('contract_events').select('event_type, created_at, actor, ip_address, user_agent').eq('contract_id', contractId).order('created_at', { ascending: true }).limit(200),
  ])
  return {
    contractId,
    referentie: referentie(contractId),
    titel: String(c.title ?? 'Contract'),
    contractType: (c.contract_type as string | null) ?? null,
    klantNaam: (klant as { company_name?: string | null } | null)?.company_name ?? null,
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
const veilig = (s: string) => s.replace(/[^\x20-\x7E -ÿ€]/g, '?').replace(/€/g, 'EUR ')

export async function maakCertificaatPdf(d: Dossier): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Ondertekeningscertificaat ${d.referentie}`)
  pdf.setAuthor('NextGenMedia Portal')
  pdf.setSubject(d.titel)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const vet = await pdf.embedFont(StandardFonts.HelveticaBold)
  const mono = await pdf.embedFont(StandardFonts.Courier)

  let page: PDFPage = pdf.addPage([A4.w, A4.h])
  let y = A4.h - MARGE
  const breedte = A4.w - 2 * MARGE

  const nieuwePagina = () => { page = pdf.addPage([A4.w, A4.h]); y = A4.h - MARGE }
  const ruimte = (nodig: number) => { if (y - nodig < MARGE + 30) nieuwePagina() }
  const tekst = (s: string, opties: { x?: number; grootte?: number; font?: PDFFont; kleur?: [number, number, number]; maxBreedte?: number } = {}) => {
    const f = opties.font ?? font, g = opties.grootte ?? 10
    const regels = wikkel(veilig(s), f, g, opties.maxBreedte ?? breedte - ((opties.x ?? MARGE) - MARGE))
    for (const r of regels) {
      ruimte(g + 4)
      page.drawText(r, { x: opties.x ?? MARGE, y, size: g, font: f, color: rgb(...(opties.kleur ?? [0.07, 0.07, 0.07])) })
      y -= g + 4
    }
  }

  // Kop
  page.drawRectangle({ x: 0, y: A4.h - 90, width: A4.w, height: 90, color: rgb(1, 0.973, 0.282) })   // #fff848
  page.drawText('NextGenMedia', { x: MARGE, y: A4.h - 42, size: 16, font: vet, color: rgb(0, 0, 0) })
  page.drawText('Ondertekeningscertificaat', { x: MARGE, y: A4.h - 64, size: 11, font, color: rgb(0.2, 0.2, 0.2) })
  page.drawText(d.referentie, { x: A4.w - MARGE - vet.widthOfTextAtSize(d.referentie, 11), y: A4.h - 42, size: 11, font: vet, color: rgb(0, 0, 0) })
  y = A4.h - 120

  tekst(d.titel, { grootte: 16, font: vet })
  y -= 4
  tekst('Dit certificaat bevestigt de digitale ondertekening van bovenstaand contract en legt vast wie tekende, wanneer, van waar en met welke documentvingerafdruk. Het hoort bij de getekende PDF met dezelfde SHA-256.', { grootte: 9.5, kleur: [0.35, 0.35, 0.35] })
  y -= 10

  for (const blok of certificaatBlokken(d)) {
    ruimte(40)
    y -= 6
    page.drawText(veilig(blok.kop.toUpperCase()), { x: MARGE, y, size: 8.5, font: vet, color: rgb(0.45, 0.45, 0.45) })
    y -= 6
    page.drawLine({ start: { x: MARGE, y }, end: { x: A4.w - MARGE, y }, thickness: 0.6, color: rgb(0.85, 0.85, 0.85) })
    y -= 12
    const labelBreedte = blok.kop === 'Tijdlijn' ? 132 : 150
    for (const [label, waarde] of blok.regels) {
      const isHash = /SHA-256/.test(label)
      const f = isHash ? mono : font
      const g = isHash ? 8.5 : 10
      const regels = wikkel(veilig(waarde), f, g, breedte - labelBreedte)
      ruimte((g + 4) * regels.length + 2)
      page.drawText(veilig(label), { x: MARGE, y, size: 9, font: vet, color: rgb(0.3, 0.3, 0.3) })
      for (const r of regels) {
        page.drawText(r, { x: MARGE + labelBreedte, y, size: g, font: f, color: rgb(0.07, 0.07, 0.07) })
        y -= g + 4
      }
      y -= 2
    }
  }

  // Voet op elke pagina
  const paginas = pdf.getPages()
  paginas.forEach((p, i) => {
    const voet = `${d.referentie} · gearchiveerd ${tijdstipBrussel(d.gearchiveerdOp)} · pagina ${i + 1} van ${paginas.length}`
    p.drawText(veilig(voet), { x: MARGE, y: 24, size: 7.5, font, color: rgb(0.55, 0.55, 0.55) })
  })
  return pdf.save()
}

// ── Archiveren ───────────────────────────────────────────────────────────────

/**
 * Archiveert de huidige getekende versie. Idempotent: is exact dit PDF (zelfde
 * SHA-256) al gearchiveerd, dan komt er geen nieuwe versie bij.
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

  const { data: bestaande } = await admin.from('contract_archief')
    .select('versie, sha256_contract, sha256_certificaat, pad_contract, pad_certificaat, pad_dossier, dossier')
    .eq('contract_id', contractId).order('versie', { ascending: false }).limit(1).maybeSingle()
  if (bestaande && bestaande.sha256_contract === hashContract) {
    return {
      contractId, versie: Number(bestaande.versie), bestaandAl: true,
      paden: { contract: bestaande.pad_contract, certificaat: bestaande.pad_certificaat, dossier: bestaande.pad_dossier },
      dossier: bestaande.dossier as Dossier, sha256Certificaat: bestaande.sha256_certificaat,
    }
  }

  const versie = bestaande ? Number(bestaande.versie) + 1 : 1
  const dossier = await laadDossier(admin, contractId, bron, versie, hashContract)
  const certificaat = await maakCertificaatPdf(dossier)
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

  const { error: insFout } = await admin.from('contract_archief').insert({
    contract_id: contractId, versie, bron,
    titel: dossier.titel, klant_naam: dossier.klantNaam, signer_name: dossier.signerName, signer_email: dossier.signerEmail, signed_at: dossier.signedAt,
    sha256_contract: hashContract, sha256_certificaat: hashCert,
    pad_contract: paden.contract, pad_certificaat: paden.certificaat, pad_dossier: paden.dossier,
    dossier, gearchiveerd_door: door ?? null,
  })
  if (insFout) throw new Error(`Archiefregister schrijven mislukt: ${insFout.message}`)
  await logContractEvent(admin, contractId, 'gearchiveerd', { actor: door ?? null, meta: { versie, sha256: hashContract, bron } })

  return { contractId, versie, bestaandAl: false, paden, dossier, sha256Certificaat: hashCert }
}

/** Het certificaat als bytes: uit het archief, of vers gemaakt wanneer er nog geen archief is. */
export async function haalCertificaat(admin: Admin, contractId: string): Promise<{ bytes: Uint8Array; bestandsnaam: string }> {
  const r = await archiveerContract(admin, contractId, 'handmatig')
  const { data, error } = await admin.storage.from(ARCHIEF_BUCKET).download(r.paden.certificaat)
  if (error || !data) throw new Error(`Certificaat niet gevonden: ${error?.message ?? r.paden.certificaat}`)
  return { bytes: new Uint8Array(await data.arrayBuffer()), bestandsnaam: certificaatBestandsnaam(r.dossier.titel, contractId) }
}

// ── Interne melding ──────────────────────────────────────────────────────────

function facturatieZin(f: FacturatieSamenvatting): string | null {
  if (!f) return null
  if (!f.gestart) return f.reden ? `niet gestart — ${f.reden}` : 'niet gestart'
  const delen = [`${f.aangemaakt} facturatieopdracht(en) aangemaakt`]
  if (f.bestaand) delen.push(`${f.bestaand} bestond(en) al`)
  if (f.gesynct) delen.push(`${f.gesynct} in ClickUp gezet`)
  if (f.mislukt) delen.push(`${f.mislukt} niet in ClickUp (opnieuw synchroniseren vanuit het contract)`)
  return delen.join(', ')
}

/** Naar wie de melding gaat: het e-mailadres uit Instellingen → Bedrijfsgegevens, plus CONTRACT_NOTIFY_EMAIL (komma-gescheiden) als dat bestaat. */
async function ontvangers(): Promise<string[]> {
  const uit = new Set<string>()
  try { const inst = await leesInstellingen(); const e = String(inst.organisatie?.email ?? '').trim(); if (e) uit.add(e) } catch { /* standaard hieronder */ }
  for (const e of String(process.env.CONTRACT_NOTIFY_EMAIL ?? '').split(',')) { const t = e.trim(); if (t) uit.add(t) }
  if (uit.size === 0) uit.add('info@nextgenmedia.be')
  return [...uit]
}

export async function meldOndertekening(admin: Admin, r: ArchiefResultaat, facturatie: FacturatieSamenvatting): Promise<{ ok: boolean; naar: string[]; fout?: string }> {
  const naar = await ontvangers()
  const { data: c } = await admin.from('contracts').select('access_token').eq('id', r.contractId).maybeSingle()
  const { onderwerp, tekst } = meldingTekst(r.dossier, {
    adminUrl: `${baseUrl()}/admin/contracts/${r.contractId}`,
    ontvangstUrl: c?.access_token ? `${baseUrl()}/sign/${c.access_token}/receipt` : null,
    facturatie: facturatieZin(facturatie),
  })
  // Bijlagen via getekende links: Resend haalt ze zelf op. Zeven dagen geldig.
  const link = async (p: string) => (await admin.storage.from(ARCHIEF_BUCKET).createSignedUrl(p, 7 * 24 * 3600)).data?.signedUrl ?? null
  const [contractUrl, certUrl] = await Promise.all([link(r.paden.contract), link(r.paden.certificaat)])
  const attachments = [
    ...(contractUrl ? [{ filename: `contract-getekend-${r.dossier.referentie.toLowerCase()}.pdf`, path: contractUrl }] : []),
    ...(certUrl ? [{ filename: certificaatBestandsnaam(r.dossier.titel, r.contractId), path: certUrl }] : []),
  ]
  const res = await sendEmail({ to: naar, subject: onderwerp, text: tekst, attachments })
  await logContractEvent(admin, r.contractId, res.ok ? 'melding_verstuurd' : 'melding_mislukt', { meta: { naar, fout: res.ok ? null : res.error } })
  return res.ok ? { ok: true, naar } : { ok: false, naar, fout: res.error }
}

/**
 * Na een definitieve ondertekening: archiveren én melden. Best-effort; fouten
 * worden gelogd en teruggegeven, nooit gegooid.
 */
export async function naOndertekening(admin: Admin, contractId: string, bron: 'tekenlink' | 'upload_getekend', facturatie: FacturatieSamenvatting, door?: string | null): Promise<{ archief?: ArchiefResultaat; melding?: { ok: boolean; naar: string[]; fout?: string }; fout?: string }> {
  try {
    const archief = await archiveerContract(admin, contractId, bron, door)
    const melding = await meldOndertekening(admin, archief, facturatie)
    return { archief, melding }
  } catch (e) {
    const fout = e instanceof Error ? e.message : String(e)
    console.error('[contract-archief]', fout)
    return { fout }
  }
}
