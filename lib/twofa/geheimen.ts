import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

/**
 * Versleuteling van TOTP-geheimen en hashing van herstelcodes (Node-only).
 *
 * TOTP-geheim: de server moet het terug kunnen lezen om codes te controleren,
 * dus geen hash maar AES-256-GCM (geauthenticeerde versleuteling) met een
 * sleutel uit de omgeving (TOTP_ENC_KEY). Die sleutel staat nooit in de
 * databank, nooit in Git en nooit in clientcode.
 *
 * Herstelcodes: eenrichtings-HMAC-SHA256 met een afgeleide sleutel (HKDF uit
 * dezelfde omgevingssleutel). De codes zelf zijn 60 bit willekeurig; samen met
 * de pogingslimiet is een trage hash (bcrypt/argon) dan niet nodig, en zonder
 * de sleutel is een gelekte hashtabel waardeloos.
 */

const VERSIE = 'v1'

/** Leest TOTP_ENC_KEY (32 bytes, base64 of hex). null = niet ingesteld/ongeldig. */
export function leesSleutel(waarde = process.env.TOTP_ENC_KEY): Buffer | null {
  const w = (waarde ?? '').trim()
  if (!w) return null
  const buf = /^[0-9a-f]{64}$/i.test(w) ? Buffer.from(w, 'hex') : Buffer.from(w, 'base64')
  return buf.length === 32 ? buf : null
}

export function versleutel(sleutel: Buffer, tekst: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', sleutel, iv)
  const ct = Buffer.concat([c.update(tekst, 'utf8'), c.final()])
  return [VERSIE, iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

/** Ontsleutelen; gooit bij een verkeerde sleutel of een gewijzigde/corrupte waarde. */
export function ontsleutel(sleutel: Buffer, waarde: string): string {
  const [v, iv, tag, ct] = waarde.split(':')
  if (v !== VERSIE || !iv || !tag || !ct) throw new Error('Onbekend formaat')
  const d = createDecipheriv('aes-256-gcm', sleutel, Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')
}

// ── Herstelcodes ─────────────────────────────────────────────────────────────

// Crockford-achtig alfabet zonder verwarrende tekens (geen I, L, O, U, 0, 1).
const ALFABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'
export const HERSTEL_AANTAL = 8
const HERSTEL_LENGTE = 12

/** 8 codes als XXXX-XXXX-XXXX, uit een cryptografisch veilige bron. */
export function genereerHerstelcodes(aantal = HERSTEL_AANTAL): string[] {
  const codes = new Set<string>()
  while (codes.size < aantal) {
    let s = ''
    for (let i = 0; i < HERSTEL_LENGTE; i++) s += ALFABET[randomInt(ALFABET.length)]
    codes.add(`${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`)
  }
  return [...codes]
}

/** Hoofdletters, zonder spaties of streepjes; null als het geen herstelcode kan zijn. */
export function normaliseerHerstelcode(invoer: string): string | null {
  const s = invoer.toUpperCase().replace(/[\s-]/g, '')
  if (s.length !== HERSTEL_LENGTE) return null
  for (const ch of s) if (!ALFABET.includes(ch)) return null
  return s
}

function herstelSleutel(sleutel: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', sleutel, Buffer.alloc(0), 'ngm-herstelcodes', 32))
}

/** HMAC-hash van een (genormaliseerde) herstelcode. */
export function hashHerstelcode(sleutel: Buffer, genormaliseerd: string): string {
  return createHmac('sha256', herstelSleutel(sleutel)).update(genormaliseerd).digest('hex')
}

export function gelijk(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
