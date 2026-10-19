/**
 * "Op getekend zetten" — pure logica.
 *
 * Een contract dat buiten de app ondertekend werd (bv. per mail bevestigd)
 * zetten we handmatig op getekend, met een optionele notitie en bijlagen (bv.
 * het mailverkeer). `contracts.ondertekening_wijze = 'manueel'` onderscheidt
 * het van een handtekening via de tekenlink of een opgeladen getekende PDF.
 *
 * Zo'n contract krijgt GEEN e-handtekeningcertificaat en GEEN Legal-melding:
 * er is in de app niets ondertekend om te certificeren. Scherm, API en test
 * gebruiken deze module.
 */

import { canonicalStatus } from '@/lib/contract-status'

export const MANUEEL = 'manueel'
export const MAX_NOTITIE = 1000

/** Melding wanneer iemand een certificaat of Legal-melding vraagt voor zo'n contract. */
export const GEEN_CERTIFICAAT = 'Dit contract werd buiten de app ondertekend en heeft daarom geen ondertekeningscertificaat. Het bewijs zit in de bijlagen bij het contract.'

export function isManueelGetekend(c: { status?: string | null; ondertekening_wijze?: string | null }): boolean {
  return canonicalStatus(c.status) === 'getekend' && c.ondertekening_wijze === MANUEEL
}

/** Kan dit contract op getekend gezet worden? null = ja, anders de reden. */
export function redenNietOpGetekend(status: string | null | undefined): string | null {
  const k = canonicalStatus(status)
  if (k === 'getekend') return 'Dit contract staat al op getekend.'
  if (k === 'geannuleerd') return 'Een geannuleerd contract kan niet op getekend gezet worden.'
  if (k === 'vervangen') return 'Een vervangen contract kan niet op getekend gezet worden.'
  if (k === 'template') return 'Een template kan niet getekend worden.'
  return null
}

export function valideerOpGetekend(
  b: { datum?: unknown; notitie?: unknown },
  vandaag: string,
): { ok: true; datum: string; notitie: string | null } | { ok: false; fout: string } {
  const d = String(b.datum ?? '').trim()
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, fout: 'Ongeldige datum.' }
  const datum = d || vandaag
  if (datum > vandaag) return { ok: false, fout: 'De datum van ondertekening ligt in de toekomst.' }
  const n = String(b.notitie ?? '').trim().slice(0, MAX_NOTITIE)
  return { ok: true, datum, notitie: n || null }
}

/** signed_at voor de gekozen dag: vandaag = nu, een eerdere dag = 12u UTC (zo verschuift de datum nooit). */
export function signedAtVoor(datum: string, vandaag: string, nu: Date = new Date()): string {
  return datum === vandaag ? nu.toISOString() : `${datum}T12:00:00.000Z`
}

/** Vandaag in België als YYYY-MM-DD (rond middernacht verschilt dat van UTC). */
export function vandaagBrussel(nu: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(nu)
}

/** Status na "ongedaan maken": die van vóór het op getekend zetten, anders verzonden/klaar voor verzenden. */
export function statusNaOngedaan(vorige: string | null | undefined, sentAt: string | null | undefined): string {
  if (vorige && redenNietOpGetekend(vorige) === null) return vorige
  return sentAt ? 'sent' : 'draft'
}
