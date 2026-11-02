/**
 * Huisstijl per merk in mails. NextGenMedia = geel, NextGenSolutions = blauw.
 * Pure module: gebruikt door de mailtemplates (server) en de voorbeelden in de
 * MailComposer en de nieuwsbriefeditor (browser).
 *
 * Afzender: NextGenSolutions mailt pas vanaf info@nextgensolutions.be als dat
 * domein geverifieerd is bij Resend; tot dan valt de verzending terug op het
 * hoofdadres met de naam NextGenSolutions en info@nextgensolutions.be als
 * antwoordadres (sendEmailMetAfzenderTerugval).
 */

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
  adres: string
  website: string
  /** Afzender in "Naam <adres>"-vorm. */
  van: string
}

export const MERK_STIJL: Record<MailMerk, MerkStijl> = {
  nextgenmedia: { naam: 'NextGenMedia', deel1: 'NextGen', deel2: 'Media', accent: '#fff848', opAccent: '#111111', adres: 'info@nextgenmedia.be', website: 'nextgenmedia.be', van: 'NextGenMedia <info@nextgenmedia.be>' },
  nextgensolutions: { naam: 'NextGenSolutions', deel1: 'NextGen', deel2: 'Solutions', accent: '#3b82f6', opAccent: '#ffffff', adres: 'info@nextgensolutions.be', website: 'nextgensolutions.be', van: 'NextGenSolutions <info@nextgensolutions.be>' },
}

export function isMailMerk(v: unknown): v is MailMerk {
  return v === 'nextgenmedia' || v === 'nextgensolutions'
}

/** Merk uit een pipelinesleutel, bedrijf of vrije waarde; onbekend = NextGenMedia. */
export function mailMerkVan(v: unknown): MailMerk {
  return isMailMerk(v) ? v : 'nextgenmedia'
}

export function merkStijl(m: unknown): MerkStijl {
  return MERK_STIJL[mailMerkVan(m)]
}
