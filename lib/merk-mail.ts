/**
 * Huisstijl per merk in mails. NextGenMedia = de eigen huisstijl van NextGenMedia
 * (brandbook 27 nov 2026: woud, zonnegeel, kalk, het logo met de golvende N; zie
 * lib/ngm-merk.ts), NextGenSolutions = de eigen huisstijl van NextGenSolutions
 * (brandkit 2026: kalk, inkt en NextGen-blauw; zie lib/ngs-merk.ts).
 * Pure module: gebruikt door de mailtemplates (server) en de voorbeelden in de
 * MailComposer en de nieuwsbriefeditor (browser).
 *
 * Afzender: NextGenSolutions mailt pas vanaf info@nextgensolutions.be als dat
 * domein geverifieerd is bij Resend; tot dan valt de verzending terug op het
 * hoofdadres met de naam NextGenSolutions en info@nextgensolutions.be als
 * antwoordadres (sendEmailMetAfzenderTerugval).
 */

import { NGM, NGM_LOGO } from './ngm-merk'
import { NGS, NGS_LOGO } from './ngs-merk'

export type MailMerk = 'nextgenmedia' | 'nextgensolutions'
export const MAIL_MERKEN: MailMerk[] = ['nextgenmedia', 'nextgensolutions']

export type MerkStijl = {
  naam: string
  /** Woordmerk in twee delen: "NextGen" + "Media". */
  deel1: string
  deel2: string
  accent: string
  /** Tekstkleur op het accent (knoppen). */
  opAccent: string
  /** Kleur van het merk in de app zelf (bolletjes, streepjes, gekozen knop): NextGenMedia = woud, nooit geel. */
  kleur: string
  /** Tekstkleur op die kleur. */
  opKleur: string
  adres: string
  website: string
  /** Afzender in "Naam <adres>"-vorm. */
  van: string
  /** Woordmerk als afbeelding (absolute link, ook in mailclients); zonder = het woordmerk in tekst. */
  logo?: string
  /** Extra regel onderaan elke mail (Instellingen → Diensten → Bedrijven). */
  voettekst?: string | null
}

/** Het woordmerk NEXTGEN AGENCY voor mails (public/merk/logo-mail.png, 360 × 109). Niet meer voor NextGenMedia. */
export const AGENCY_LOGO_MAIL = 'https://app.nextgenmedia.be/merk/logo-mail.png'

export const MERK_STIJL: Record<MailMerk, MerkStijl> = {
  nextgenmedia: { naam: 'NextGenMedia', deel1: 'NextGen', deel2: 'Media', accent: NGM.zonnegeel, opAccent: NGM.woud, kleur: NGM.woud, opKleur: NGM.kalk, adres: 'info@nextgenmedia.be', website: 'nextgenmedia.be', van: 'NextGenMedia <info@nextgenmedia.be>', logo: NGM_LOGO.mail },
  nextgensolutions: { naam: 'NextGenSolutions', deel1: 'NextGen', deel2: 'Solutions', accent: NGS.blauw, opAccent: '#ffffff', kleur: NGS.blauw, opKleur: '#ffffff', adres: 'info@nextgensolutions.be', website: 'nextgensolutions.be', van: 'NextGenSolutions <info@nextgensolutions.be>', logo: NGS_LOGO.mail },
}

export function isMailMerk(v: unknown): v is MailMerk {
  return v === 'nextgenmedia' || v === 'nextgensolutions'
}

/** Merk uit een pipelinesleutel, bedrijf of vrije waarde; onbekend = NextGenMedia. */
export function mailMerkVan(v: unknown): MailMerk {
  return isMailMerk(v) ? v : 'nextgenmedia'
}

/**
 * Merkgegevens uit de databank (Instellingen → Diensten → Bedrijven, verbeterplan C18):
 * contactadres, website en voettekst in de voet van de mail. Op de server gevuld door
 * laadMerkGegevens (lib/merk-mail-server.ts) vlak voor een mail gebouwd wordt; leeg of
 * ongeldig = de vaste waarden hierboven. De afzender (Resend) verandert nooit mee.
 */
export type MerkGegevens = { adres?: string | null; website?: string | null; voettekst?: string | null }
let opMaat: Partial<Record<MailMerk, MerkGegevens>> = {}
export function zetMerkGegevens(g: Partial<Record<MailMerk, MerkGegevens>>): void { opMaat = g }
const isMailAdres = (v: unknown): v is string => typeof v === 'string' && /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(v.trim())
/** "https://www.nextgenmedia.be/" → "www.nextgenmedia.be"; enkel een gewone domeinnaam. */
export function netteWebsite(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const w = v.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return /^[a-z0-9.-]+\.[a-z]{2,}(\/[^\s<>"]*)?$/i.test(w) ? w : null
}
export function merkStijl(m: unknown): MerkStijl {
  const k = mailMerkVan(m)
  const basis = MERK_STIJL[k]
  const g = opMaat[k]
  if (!g) return basis
  return {
    ...basis,
    adres: isMailAdres(g.adres) ? g.adres.trim() : basis.adres,
    website: netteWebsite(g.website) ?? basis.website,
    voettekst: typeof g.voettekst === 'string' && g.voettekst.trim() ? g.voettekst.trim().slice(0, 300) : null,
  }
}
