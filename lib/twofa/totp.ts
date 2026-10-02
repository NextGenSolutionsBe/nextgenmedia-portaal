import { Secret, TOTP } from 'otpauth'

/**
 * Standaard TOTP (RFC 6238) via de onderhouden bibliotheek `otpauth` — geen
 * eigen cryptografie. Werkt met Google Authenticator, Microsoft Authenticator,
 * 1Password en elke andere standaard authenticator-app.
 *
 *  · 6 cijfers, periode 30 s, SHA-1 (de standaard die alle apps ondersteunen)
 *  · venster ±1 stap (30 s klokverschil) — het minimum dat in de praktijk nodig is
 *  · replay: controleerTotp geeft het TIJDSTAP-nummer terug; de aanroeper aanvaardt
 *    enkel een stap die groter is dan de laatst gebruikte (zie kern.ts).
 */

export const TOTP_ISSUER = 'NextGen'
export const TOTP_CIJFERS = 6
export const TOTP_PERIODE = 30
export const TOTP_VENSTER = 1

/** Nieuw geheim: 20 cryptografisch willekeurige bytes (160 bit), als base32. */
export function nieuwGeheim(): string {
  return new Secret({ size: 20 }).base32
}

function totp(geheim: string, label = ''): TOTP {
  return new TOTP({
    issuer: TOTP_ISSUER,
    label,
    algorithm: 'SHA1',
    digits: TOTP_CIJFERS,
    period: TOTP_PERIODE,
    secret: Secret.fromBase32(geheim),
  })
}

/** otpauth://totp/NextGen:<account>?secret=…&issuer=NextGen&… */
export function otpauthUri(geheim: string, account: string): string {
  return totp(geheim, account).toString()
}

/** Het geheim leesbaar in groepjes van 4 (voor handmatig invoeren). */
export function formatteerGeheim(geheim: string): string {
  return geheim.replace(/=+$/, '').match(/.{1,4}/g)?.join(' ') ?? geheim
}

/** De huidige tijdstap (voor tests en replaybescherming). */
export function tijdstap(nuMs: number): number {
  return Math.floor(nuMs / 1000 / TOTP_PERIODE)
}

/**
 * Klopt deze code op dit moment? Geeft het tijdstap-nummer waarvoor de code
 * geldig is, of null. Enkel exact 6 cijfers worden bekeken.
 */
export function controleerTotp(geheim: string, code: string, nuMs: number): number | null {
  if (!/^\d{6}$/.test(code)) return null
  let delta: number | null
  try {
    delta = totp(geheim).validate({ token: code, timestamp: nuMs, window: TOTP_VENSTER })
  } catch {
    return null
  }
  return delta === null ? null : tijdstap(nuMs) + delta
}

/** Code voor een tijdstip — enkel voor tests. */
export function codeVoor(geheim: string, nuMs: number): string {
  return totp(geheim).generate({ timestamp: nuMs })
}
