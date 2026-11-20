import 'server-only'
import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import path from 'path'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib'
import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email'
import { legalOntvangers } from '@/lib/contract-archief-model'
import { veilig } from '@/lib/shoot-document-model'
import { VESTING_BUCKET, bewijsLink } from '@/lib/vesting-bewijs-server'
import {
  VENNOTEN, certificaatMail, certificaatRegels, certificaatTitel,
  type Akkoord, type CertificaatGegevens, type CertificaatHandtekening, type Onderwerp, type Vennoot,
} from '@/lib/vesting-akkoord'
import type { VestingData } from '@/lib/vesting-data-server'

type Admin = ReturnType<typeof createAdminSupabaseClient>

/**
 * Het vestingcertificaat: zodra Marco, Bram en Chiara alle drie tekenden voor
 * een versie van een kaart (contract, inkomst of kost), maakt de app één kort
 * pdf-certificaat met de cijfers en de drie handtekeningen, bewaart het in de
 * privébucket `vesting` en mailt het één keer naar legal@ als archief buiten
 * de app. Een nieuwe versie die alle drie tekenen, krijgt een nieuw certificaat.
 */

export type CertificaatRij = {
  id: string; nummer: string; onderwerp: Onderwerp; onderwerp_id: string; inhoud_tekst: string; inhoud: Akkoord
  aandeel: number | null; stand: { marco: number; bram: number; chiara: number } | null; volledig_op: string
  pdf_pad: string | null; pdf_sha256: string | null; mail_naar: string[] | null
  mail_status: 'wacht' | 'verstuurd' | 'mislukt'; mail_fout: string | null; mail_op: string | null
}

const sha256 = (x: string | Uint8Array) => createHash('sha256').update(x).digest('hex')

type Getekend = CertificaatHandtekening & { handtekening: string }

async function handtekeningenVoor(admin: Admin, onderwerp: Onderwerp, id: string, tekst: string): Promise<Getekend[]> {
  const { data } = await admin.from('vesting_handtekeningen')
    .select('vennoot, naam, email, getekend_op, handtekening')
    .eq('onderwerp', onderwerp).eq('onderwerp_id', id).eq('inhoud_tekst', tekst).order('getekend_op')
  const uit: Getekend[] = []
  for (const h of (data ?? []) as Getekend[]) if (!uit.some((x) => x.vennoot === h.vennoot)) uit.push(h)
  return VENNOTEN.map((v) => uit.find((h) => h.vennoot === v)).filter((h): h is Getekend => !!h)
}

/** Bestaat het certificaat voor de laatste volledig getekende versie? Zo niet: maken, bewaren en (één keer) mailen. */
export async function zorgVoorCertificaat(admin: Admin, data: VestingData, onderwerp: Onderwerp, id: string, opties: { mail?: boolean } = {}): Promise<CertificaatRij | null> {
  const info = onderwerp === 'contract' ? data.akkoordContract.get(id) : data.akkoordRegistratie.get(id)
  const laatste = info?.stand.laatsteVolledig
  if (!info || !laatste) return null
  const tekst = laatste.tekst
  const zoek = async () => ((await admin.from('vesting_certificaten').select('*')
    .eq('onderwerp', onderwerp).eq('onderwerp_id', id).eq('inhoud_tekst', tekst).maybeSingle()).data as CertificaatRij | null)

  let rij = await zoek()
  if (!rij) {
    const huidig = tekst === info.tekst
    const inhoud = JSON.parse(tekst) as Akkoord
    const vingerafdruk = sha256(tekst)
    const contract = onderwerp === 'contract' ? data.v.contracten.find((c) => c.id === id) : undefined
    const nieuw = {
      nummer: `VC-${vingerafdruk.slice(0, 10).toUpperCase()}`, onderwerp, onderwerp_id: id, inhoud_tekst: tekst, inhoud,
      aandeel: huidig && contract && contract.erkenning !== 'uitgesloten' && !contract.wachtOpKlant ? contract.ruweVesting : null,
      stand: huidig ? { marco: data.v.marcoVoorlopig, bram: data.v.bram, chiara: data.v.chiara } : null,
      volledig_op: laatste.op,
    }
    const { error } = await admin.from('vesting_certificaten').insert(nieuw)
    if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message)
    rij = await zoek()
    if (!rij) return null
  }

  if (!rij.pdf_pad) {
    const getekend = await handtekeningenVoor(admin, onderwerp, id, tekst)
    const pdf = await maakVestingCertificaatPdf(gegevens(rij, getekend), getekend, data.vennoten)
    const pad = `certificaten/${rij.nummer}.pdf`
    const { error } = await admin.storage.from(VESTING_BUCKET).upload(pad, pdf, { contentType: 'application/pdf', upsert: true })
    if (error) throw new Error(`Certificaat bewaren mislukt: ${error.message}`)
    await admin.from('vesting_certificaten').update({ pdf_pad: pad, pdf_sha256: sha256(pdf) }).eq('id', rij.id)
    rij = { ...rij, pdf_pad: pad, pdf_sha256: sha256(pdf) }
  }

  if (opties.mail && rij.mail_status !== 'verstuurd') rij = await mailCertificaat(admin, rij, data.vennoten)
  return rij
}

function gegevens(rij: CertificaatRij, getekend: CertificaatHandtekening[]): CertificaatGegevens {
  return {
    nummer: rij.nummer, inhoud: rij.inhoud, inhoud_sha256: sha256(rij.inhoud_tekst),
    handtekeningen: getekend.map(({ vennoot, naam, email, getekend_op }) => ({ vennoot, naam, email, getekend_op })),
    aandeel: rij.aandeel === null || rij.aandeel === undefined ? null : Number(rij.aandeel),
    stand: rij.stand, volledig_op: rij.volledig_op,
  }
}

/** De archiefmail naar legal@ (één keer per certificaat; Resend ontdubbelt ook op de sleutel). */
export async function mailCertificaat(admin: Admin, rij: CertificaatRij, vennoten: VestingData['vennoten']): Promise<CertificaatRij> {
  const namen = Object.fromEntries(VENNOTEN.map((v) => [v, vennoten[v].naam])) as Record<Vennoot, string>
  const getekend = await handtekeningenVoor(admin, rij.onderwerp, rij.onderwerp_id, rij.inhoud_tekst)
  const { onderwerp, tekst } = certificaatMail(gegevens(rij, getekend), namen)
  const naar = legalOntvangers({ CONTRACT_LEGAL_EMAIL: process.env.CONTRACT_LEGAL_EMAIL })
  const attachments: ({ filename: string; content: string; contentType?: string } | { filename: string; path: string })[] = []
  if (rij.pdf_pad) {
    const { data } = await admin.storage.from(VESTING_BUCKET).download(rij.pdf_pad)
    if (data) attachments.push({ filename: `vestingcertificaat-${rij.nummer}.pdf`, content: Buffer.from(await data.arrayBuffer()).toString('base64'), contentType: 'application/pdf' })
  }
  // Het bewijsstuk (contract, factuur) mee, zodat het archief volledig is.
  const bewijzen: { naam: string; pad: string }[] = []
  if (rij.onderwerp === 'contract') {
    const { data } = await admin.from('vesting_kosten').select('bewijs_pad, bewijs_naam').eq('vesting_contract_id', rij.onderwerp_id).not('bewijs_pad', 'is', null)
    for (const k of (data ?? []) as { bewijs_pad: string; bewijs_naam: string | null }[]) bewijzen.push({ naam: k.bewijs_naam ?? 'document', pad: k.bewijs_pad })
  } else {
    const { data } = await admin.from('vesting_registraties').select('bewijs_pad, bewijs_naam').eq('id', rij.onderwerp_id).maybeSingle()
    const b = data as { bewijs_pad: string | null; bewijs_naam: string | null } | null
    if (b?.bewijs_pad) bewijzen.push({ naam: b.bewijs_naam ?? 'document', pad: b.bewijs_pad })
  }
  for (const b of bewijzen.slice(0, 5)) {
    const url = await bewijsLink(admin, b.pad, 7 * 24 * 3600)
    if (url) attachments.push({ filename: b.naam, path: url })
  }
  const res = await sendEmail({ to: naar, subject: onderwerp, text: tekst, attachments, idempotencyKey: `vesting-certificaat-${rij.nummer}` })
  const nu = new Date().toISOString()
  const wijziging = res.ok
    ? { mail_status: 'verstuurd' as const, mail_fout: null, mail_op: nu, mail_naar: naar }
    : { mail_status: 'mislukt' as const, mail_fout: res.error ?? 'Versturen mislukt', mail_op: nu, mail_naar: naar }
  await admin.from('vesting_certificaten').update(wijziging).eq('id', rij.id)
  try {
    await admin.from('email_messages').insert({
      to_email: naar.join(', '), subject: onderwerp, body: tekst, kind: 'vesting_certificaat', audience: 'admin', trigger_type: 'event',
      item_count: 1, related_id: rij.onderwerp_id, status: res.ok ? 'sent' : 'error', error: res.ok ? null : (res.error ?? null), provider_id: res.ok ? res.id ?? null : null,
    })
  } catch { /* logboek is een extra */ }
  return { ...rij, ...wijziging }
}

// ── De pdf ───────────────────────────────────────────────────────────────────

const A4 = { w: 595.28, h: 841.89 }
const M = 48

function wikkel(tekst: string, font: PDFFont, grootte: number, breedte: number): string[] {
  const regels: string[] = []
  for (const alinea of tekst.split('\n')) {
    let huidig = ''
    for (const woord of alinea.split(/\s+/)) {
      const k = huidig ? `${huidig} ${woord}` : woord
      if (font.widthOfTextAtSize(k, grootte) <= breedte) { huidig = k; continue }
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
  return regels
}

const tijdstip = (iso: string) => new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))

export async function maakVestingCertificaatPdf(g: CertificaatGegevens, getekend: Getekend[], vennoten: VestingData['vennoten']): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Vestingcertificaat ${g.nummer}`)
  pdf.setAuthor('NextGenMedia')
  pdf.setCreator('NextGenMedia Portal')
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const vet = await pdf.embedFont(StandardFonts.HelveticaBold)
  const mono = await pdf.embedFont(StandardFonts.Courier)
  const TEKST = rgb(0.07, 0.07, 0.07), GRIJS = rgb(0.42, 0.42, 0.42), LICHT = rgb(0.86, 0.86, 0.86), GEEL = rgb(1, 0.973, 0.282)
  const page = pdf.addPage([A4.w, A4.h])
  const breedte = A4.w - 2 * M
  let y = A4.h - M

  page.drawRectangle({ x: 0, y: A4.h - 6, width: A4.w, height: 6, color: GEEL })
  let logo: PDFImage | null = null
  try { logo = await pdf.embedPng(new Uint8Array(await readFile(path.join(process.cwd(), 'public', 'logo-pdf.png')))) } catch { logo = null }
  if (logo) { const h = 30, w = (logo.width / logo.height) * h; page.drawImage(logo, { x: M, y: y - h + 6, width: w, height: h }) }
  else page.drawText('NextGenMedia', { x: M, y: y - 12, size: 14, font: vet, color: TEKST })
  page.drawText(g.nummer, { x: A4.w - M - vet.widthOfTextAtSize(g.nummer, 10), y: y - 6, size: 10, font: vet, color: TEKST })
  const sub = 'Vestingcertificaat'
  page.drawText(sub, { x: A4.w - M - font.widthOfTextAtSize(sub, 8.5), y: y - 19, size: 8.5, font, color: GRIJS })
  y -= 44
  page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.8, color: LICHT })
  y -= 34

  page.drawText('Vestingcertificaat', { x: M, y, size: 20, font: vet, color: TEKST })
  y -= 24
  for (const r of wikkel(veilig(certificaatTitel(g.inhoud)), vet, 12, breedte)) { page.drawText(r, { x: M, y, size: 12, font: vet, color: TEKST }); y -= 16 }
  y -= 2
  for (const r of wikkel(veilig(`Marco, Bram en Chiara gingen akkoord met onderstaande cijfers voor de vesting van Marco. Elk tekende in de app met het eigen account. Alle drie getekend op ${tijdstip(g.volledig_op)}.`), font, 9.5, breedte)) {
    page.drawText(r, { x: M, y, size: 9.5, font, color: GRIJS }); y -= 13
  }
  y -= 12

  const label = 130
  for (const [l, w] of certificaatRegels(g)) {
    const isSha = /SHA-256/.test(w)
    const regels = wikkel(veilig(w), isSha ? mono : font, isSha ? 8 : 10, breedte - label)
    page.drawText(veilig(l), { x: M, y, size: 9, font: vet, color: rgb(0.3, 0.3, 0.3) })
    for (const r of regels) { page.drawText(r, { x: M + label, y, size: isSha ? 8 : 10, font: isSha ? mono : font, color: TEKST }); y -= isSha ? 11 : 14 }
    y -= 3
  }
  if (g.stand) {
    const p = (f: number) => `${Math.round(f * 100)}%`
    page.drawText('Stand van de aandelen', { x: M, y, size: 9, font: vet, color: rgb(0.3, 0.3, 0.3) })
    page.drawText(veilig(`Marco ${p(g.stand.marco)} · Bram ${p(g.stand.bram)} · Chiara ${p(g.stand.chiara)}`), { x: M + label, y, size: 10, font, color: TEKST })
    y -= 17
  }

  y -= 14
  page.drawText('HANDTEKENINGEN', { x: M, y, size: 8.5, font: vet, color: GRIJS })
  y -= 6
  page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.6, color: LICHT })
  y -= 12
  const kolom = (breedte - 2 * 12) / 3
  const hoogte = 112
  for (let i = 0; i < VENNOTEN.length; i++) {
    const v = VENNOTEN[i]
    const h = getekend.find((x) => x.vennoot === v)
    const x = M + i * (kolom + 12)
    page.drawRectangle({ x, y: y - hoogte, width: kolom, height: hoogte, borderColor: LICHT, borderWidth: 0.6 })
    if (h?.handtekening) {
      try {
        const img = await pdf.embedPng(Buffer.from(h.handtekening.split(',')[1] ?? '', 'base64'))
        const maxB = kolom - 16, maxH = 48
        const s = Math.min(maxB / img.width, maxH / img.height)
        page.drawImage(img, { x: x + (kolom - img.width * s) / 2, y: y - 8 - maxH + (maxH - img.height * s) / 2, width: img.width * s, height: img.height * s })
      } catch { /* zonder afbeelding */ }
    }
    page.drawLine({ start: { x: x + 8, y: y - 62 }, end: { x: x + kolom - 8, y: y - 62 }, thickness: 0.5, color: LICHT })
    page.drawText(veilig(vennoten[v].naam), { x: x + 8, y: y - 76, size: 9.5, font: vet, color: TEKST })
    if (h) {
      for (const [j, r] of [h.email ?? '', tijdstip(h.getekend_op)].entries()) page.drawText(veilig(r).slice(0, 40), { x: x + 8, y: y - 90 - j * 11, size: 8, font, color: GRIJS })
    } else page.drawText('niet getekend', { x: x + 8, y: y - 90, size: 8, font, color: GRIJS })
  }
  y -= hoogte + 22

  page.drawText('Vingerafdruk van de getekende cijfers (SHA-256)', { x: M, y, size: 8, font: vet, color: GRIJS })
  y -= 11
  for (const r of wikkel(g.inhoud_sha256, mono, 8, breedte)) { page.drawText(r, { x: M, y, size: 8, font: mono, color: TEKST }); y -= 10 }

  page.drawLine({ start: { x: M, y: 40 }, end: { x: A4.w - M, y: 40 }, thickness: 0.5, color: LICHT })
  page.drawText(veilig(`${g.nummer} · NextGenMedia Portal · gemaakt ${tijdstip(new Date().toISOString())}`), { x: M, y: 28, size: 7.5, font, color: GRIJS })
  return pdf.save()
}

/** Het bewaarde certificaat als bytes, om te downloaden. */
export async function certificaatBytes(admin: Admin, rij: Pick<CertificaatRij, 'pdf_pad'>): Promise<Uint8Array | null> {
  if (!rij.pdf_pad) return null
  const { data } = await admin.storage.from(VESTING_BUCKET).download(rij.pdf_pad)
  return data ? new Uint8Array(await data.arrayBuffer()) : null
}
