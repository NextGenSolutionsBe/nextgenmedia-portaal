import 'server-only'
import { readFile } from 'fs/promises'
import path from 'path'
import { createHash, randomUUID } from 'crypto'
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import { founderName } from '@/lib/founders'
import { leesInstellingen } from '@/lib/instellingen/laden'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { BEVESTIGD } from './status'

/**
 * Bewijsdocument "Bevestiging aankoopaanvraag": één PDF per bevestigde
 * versie, opgeslagen in de private bucket en enkel via de beveiligde route
 * te downloaden. Opnieuw downloaden geeft altijd hetzelfde bestand; een
 * nieuwe versie van de aanvraag krijgt een nieuw document en het vorige
 * wordt 'vervangen' (nooit gewist).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any; storage: any }

export const BUCKET = 'contracts'
const GEEL = rgb(1, 0.973, 0.282)
const ZWART = rgb(0.07, 0.07, 0.07)
const GRIJS = rgb(0.42, 0.45, 0.5)
const LICHT = rgb(0.95, 0.96, 0.97)

export type Certificaat = {
  id: string; purchase_id: string; version: number; certificate_no: string; storage_path: string; file_name: string
  status: 'actueel' | 'vervangen'; sha256: string | null; confirmed_at: string; confirmed_by_email: string | null; generated_at: string
}

export type AankoopVolledig = {
  id: string; reference: string | null; version: number; title: string | null; description: string | null
  amount_excl: number | string; vat_pct: number | string; supplier: string | null; category: string | null
  requester_email: string | null; entry_date: string; status: string; needs_approval: boolean
  confirmed_at: string | null; confirmed_by_email: string | null; created_at: string
}
type Goedkeuring = { approver_email: string; decision: string; comment: string | null; decided_at: string }

/** Volgend nummer per soort en jaar via de databankfunctie (race-vrij). */
export async function volgendNummer(admin: Admin, soort: 'aanvraag' | 'bewijs', jaar: number): Promise<string> {
  const { data, error } = await admin.rpc('volgend_purchase_nummer', { p_soort: soort, p_jaar: jaar })
  if (error) throw new Error(error.message)
  const n = Number(data)
  return `${soort === 'aanvraag' ? 'AA' : 'BEV'}-${jaar}-${String(n).padStart(3, '0')}`
}

/** Zorgt dat een aanvraag een aanvraagnummer heeft (oude rijen, of net aangemaakt). */
export async function zorgReferentie(admin: Admin, purchaseId: string): Promise<string> {
  const { data: p } = await admin.from('purchases').select('reference, created_at').eq('id', purchaseId).maybeSingle()
  if (p?.reference) return String(p.reference)
  const jaar = new Date(p?.created_at ?? Date.now()).getFullYear()
  const ref = await volgendNummer(admin, 'aanvraag', jaar)
  await admin.from('purchases').update({ reference: ref }).eq('id', purchaseId)
  return ref
}

// ── Opmaak ───────────────────────────────────────────────────────────────────

const euro = (v: number) => `€ ${v.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const datumNl = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Brussels' }) : '—')
const tijdNl = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }) : '—')

/** Tekst afbreken op breedte (pdf-lib heeft geen eigen regelafbreking). */
function wrap(font: PDFFont, tekst: string, size: number, breedte: number): string[] {
  const regels: string[] = []
  for (const alinea of (tekst || '').split(/\r?\n/)) {
    const woorden = alinea.split(/\s+/).filter(Boolean)
    let regel = ''
    for (const w of woorden) {
      const probeer = regel ? `${regel} ${w}` : w
      if (font.widthOfTextAtSize(probeer, size) <= breedte) regel = probeer
      else { if (regel) regels.push(regel); regel = w }
    }
    regels.push(regel)
  }
  return regels.length ? regels : ['']
}

/** Tekens buiten WinAnsi (bv. emoji) vervangen, anders weigert de standaardfont. */
const veilig = (s: string) => s.replace(/[^\x20-\x7E -ÿ€–—‘’“”…]/g, '?')

export async function maakBewijsPdf(p: AankoopVolledig, goedkeuringen: Goedkeuring[], certificateNo: string, certificateId: string): Promise<Uint8Array> {
  // Huisstijl uit Instellingen → Documenten en branding. Enkel documenten die
  // vanaf nu gemaakt worden volgen de nieuwe instellingen; bestaande PDF's
  // blijven zoals ze zijn. Zonder instellingen gelden de vaste standaarden.
  const inst = await leesInstellingen().catch(() => null)
  const doc = inst?.documenten
  const org = inst?.organisatie
  const kleur = (hex: string | undefined, terugval: ReturnType<typeof rgb>) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')
    if (!m) return terugval
    const n = parseInt(m[1], 16)
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
  }
  const ACCENT = kleur(doc?.primaire_kleur, GEEL)
  const TEKST = kleur(doc?.secundaire_kleur, ZWART)
  const bedrijfsnaam = veilig(org?.handelsnaam || org?.vennootschapsnaam || 'NextGenMedia')

  const pdf = await PDFDocument.create()
  pdf.setTitle(`Bevestiging aankoopaanvraag ${p.reference ?? ''}`)
  pdf.setAuthor(`${bedrijfsnaam} portaal`)
  pdf.setCreator(`${bedrijfsnaam} portaal`)
  const page = pdf.addPage([595.28, 841.89])   // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const vet = await pdf.embedFont(StandardFonts.HelveticaBold)
  const marge = 48
  const breedte = page.getWidth() - marge * 2
  let y = page.getHeight() - marge

  // Logo + naam
  try {
    // Eigen logo uit de instellingen (private bucket); anders de kleine
    // standaardvariant (het volledige logo is 1,3 MB), anders het origineel.
    let logoBytes: Uint8Array | null = null
    if (doc?.logo_path) {
      try {
        const { data } = await createAdminSupabaseClient().storage.from(BUCKET).download(doc.logo_path)
        if (data) logoBytes = new Uint8Array(await data.arrayBuffer())
      } catch { logoBytes = null }
    }
    if (!logoBytes) logoBytes = new Uint8Array(await readFile(path.join(process.cwd(), 'public', 'logo-pdf.png')).catch(() => readFile(path.join(process.cwd(), 'public', 'logo.png'))))
    const isJpeg = logoBytes[0] === 0xff && logoBytes[1] === 0xd8
    const logo = isJpeg ? await pdf.embedJpg(logoBytes) : await pdf.embedPng(logoBytes)
    const h = 42, w = (logo.width / logo.height) * h
    page.drawImage(logo, { x: marge, y: y - h, width: w, height: h })
  } catch { /* zonder logo verder */ }
  page.drawText(bedrijfsnaam, { x: page.getWidth() - marge - vet.widthOfTextAtSize(bedrijfsnaam, 12), y: y - 14, size: 12, font: vet, color: TEKST })
  page.drawText('Intern bewijsdocument', { x: page.getWidth() - marge - font.widthOfTextAtSize('Intern bewijsdocument', 9), y: y - 28, size: 9, font, color: GRIJS })
  y -= 62
  page.drawRectangle({ x: marge, y, width: breedte, height: 4, color: ACCENT })
  y -= 30

  page.drawText('Bevestiging aankoopaanvraag', { x: marge, y, size: 20, font: vet, color: TEKST })
  y -= 18
  page.drawText(veilig(`Aanvraag ${p.reference ?? p.id} · versie ${p.version} · certificaat ${certificateNo}`), { x: marge, y, size: 10, font, color: GRIJS })
  y -= 26

  const excl = Number(p.amount_excl), btwPct = Number(p.vat_pct)
  const btw = Math.round(excl * btwPct) / 100
  const incl = Math.round((excl + btw) * 100) / 100
  const bevestigers = goedkeuringen.filter((g) => g.decision === 'approved')
  const bevestigdDoor = p.needs_approval
    ? (bevestigers.length ? bevestigers.map((g) => `${founderName(g.approver_email)} (${tijdNl(g.decided_at)})`).join(', ') : founderName(p.confirmed_by_email))
    : `${founderName(p.confirmed_by_email ?? p.requester_email)} — onder de drempel, geen goedkeuring vereist`
  const opmerkingen = goedkeuringen.filter((g) => g.comment).map((g) => `${founderName(g.approver_email)}: ${g.comment}`).join(' · ')

  const rijen: [string, string][] = [
    ['Aanvraagnummer', p.reference ?? '—'],
    ['Certificaatnummer', certificateNo],
    ['Versie', String(p.version)],
    ['Ingediend op', datumNl(p.entry_date)],
    ['Bevestigd op', tijdNl(p.confirmed_at)],
    ['Aanvrager', `${founderName(p.requester_email)}${p.requester_email ? ` (${p.requester_email})` : ''}`],
    ['Bedrijf / afdeling', `${bedrijfsnaam}${p.category ? ` · ${p.category}` : ''}`],
    ['Leverancier', p.supplier ?? '—'],
    ['Omschrijving', `${p.title ?? ''}${p.description ? `\n${p.description}` : ''}`],
    ['Bedrag exclusief btw', euro(excl)],
    [`Btw-bedrag (${btwPct.toLocaleString('nl-BE')} %)`, euro(btw)],
    ['Bedrag inclusief btw', euro(incl)],
    ['Status', 'Bevestigd'],
    ['Bevestigd door', bevestigdDoor],
    ['Opmerkingen', opmerkingen || '—'],
    ['Interne referentie', `${p.id} / ${certificateId}`],
  ]

  const labelBreedte = 150
  const waardeBreedte = breedte - labelBreedte - 12
  let even = false
  for (const [label, waarde] of rijen) {
    const regels = wrap(font, veilig(waarde), 10, waardeBreedte)
    const hoogte = Math.max(20, regels.length * 13 + 7)
    if (even) page.drawRectangle({ x: marge, y: y - hoogte + 5, width: breedte, height: hoogte, color: LICHT })
    page.drawText(label, { x: marge + 6, y: y - 9, size: 9, font: vet, color: GRIJS })
    regels.forEach((r, i) => page.drawText(r, { x: marge + labelBreedte + 6, y: y - 9 - i * 13, size: 10, font, color: ZWART }))
    y -= hoogte
    even = !even
  }

  // Voettekst
  const voet = veilig(`${(doc?.voettekst || 'Dit document werd automatisch gegenereerd door het NextGenMedia-portaal.').trim()} Gegenereerd op ${tijdNl(new Date().toISOString())}. Het is een interne bevestiging van een aankoopaanvraag en geen factuur of betalingsbewijs.${doc?.contactregel ? ` ${doc.contactregel}` : ''}`)
  const vr = wrap(font, voet, 8, breedte)
  let vy = marge + 6 + (vr.length - 1) * 10
  page.drawRectangle({ x: marge, y: vy + 14, width: breedte, height: 1, color: ACCENT })
  for (const r of vr) { page.drawText(r, { x: marge, y: vy, size: 8, font, color: GRIJS }); vy -= 10 }

  return pdf.save()
}

/** Het actuele certificaat van een aanvraag (of van een gevraagde versie). */
export async function vindCertificaat(admin: Admin, purchaseId: string, version?: number | null): Promise<Certificaat | null> {
  let q = admin.from('purchase_certificates').select('*').eq('purchase_id', purchaseId)
  q = version ? q.eq('version', version) : q.eq('status', 'actueel')
  const { data } = await q.order('version', { ascending: false }).limit(1).maybeSingle()
  return (data as Certificaat | null) ?? null
}

/**
 * Bevestigt een aanvraag: zet confirmed_at/by (eenmalig per versie) en maakt
 * het bewijsdocument voor deze versie — precies één keer. Bestaat het al,
 * dan komt hetzelfde document terug. Geen bevestigde status → null.
 */
export async function bevestigAankoop(admin: Admin, purchaseId: string, actorEmail: string | null): Promise<Certificaat | null> {
  const { data: p0 } = await admin.from('purchases').select('*').eq('id', purchaseId).maybeSingle()
  const p = p0 as (AankoopVolledig & { deleted_at?: string | null }) | null
  if (!p || !BEVESTIGD.includes(p.status)) return null

  const bestaand = await vindCertificaat(admin, purchaseId, p.version)
  if (bestaand) return bestaand

  if (!p.reference) p.reference = await zorgReferentie(admin, purchaseId)
  const nu = new Date().toISOString()
  if (!p.confirmed_at) {
    p.confirmed_at = nu; p.confirmed_by_email = actorEmail
    await admin.from('purchases').update({ confirmed_at: nu, confirmed_by_email: actorEmail }).eq('id', purchaseId)
  }
  const { data: goedkeuringen } = await admin.from('purchase_approvals').select('approver_email, decision, comment, decided_at').eq('purchase_id', purchaseId).order('decided_at')

  const certificateNo = await volgendNummer(admin, 'bewijs', new Date(p.confirmed_at!).getFullYear())
  const certificateId = randomUUID()
  const bytes = await maakBewijsPdf(p, (goedkeuringen ?? []) as Goedkeuring[], certificateNo, certificateId)
  const sha = createHash('sha256').update(bytes).digest('hex')
  const dag = p.confirmed_at!.slice(0, 10)
  const fileName = `Aankoopbevestiging_${p.reference}_${dag}${p.version > 1 ? `_v${p.version}` : ''}.pdf`
  const storagePath = `purchases/bewijs/${purchaseId}/${certificateNo}.pdf`
  const { error: upErr } = await admin.storage.from(BUCKET).upload(storagePath, Buffer.from(bytes), { contentType: 'application/pdf', upsert: false })
  if (upErr) throw new Error(`Bewijsdocument opslaan mislukt: ${upErr.message}`)

  // Eerdere versies worden 'vervangen'; het nieuwe document is het actuele.
  await admin.from('purchase_certificates').update({ status: 'vervangen' }).eq('purchase_id', purchaseId).eq('status', 'actueel')
  const { data: cert, error } = await admin.from('purchase_certificates').insert({
    id: certificateId, purchase_id: purchaseId, version: p.version, certificate_no: certificateNo, storage_path: storagePath, file_name: fileName,
    status: 'actueel', sha256: sha, confirmed_at: p.confirmed_at, confirmed_by_email: p.confirmed_by_email ?? actorEmail,
  }).select('*').single()
  if (error) {
    // Gelijktijdige poging won: gebruik dat document.
    const race = await vindCertificaat(admin, purchaseId, p.version)
    if (race) return race
    throw new Error(error.message)
  }
  return cert as Certificaat
}

/** De bytes van een opgeslagen certificaat. */
export async function leesCertificaat(admin: Admin, c: Certificaat): Promise<Buffer> {
  const { data, error } = await admin.storage.from(BUCKET).download(c.storage_path)
  if (error || !data) throw new Error('Bewijsdocument niet gevonden in de opslag.')
  return Buffer.from(await data.arrayBuffer())
}
