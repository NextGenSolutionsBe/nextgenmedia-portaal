// Tweestapsverificatie voor INTERNE accounts (admin + werknemers).
// Klanten en partners loggen gewoon met e-mail + wachtwoord in.
//
// Edge-veilig: gebruikt uitsluitend Web Crypto (crypto.subtle), zodat dit zowel
// in de middleware (Edge runtime) als in API-routes (Node) werkt. Geen imports
// uit node:crypto.

export const TWO_FA_COOKIE = 'ngm_2fa'
export const CODE_TTL_MS = 10 * 60 * 1000          // code 10 minuten geldig
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000  // verificatie 12 uur geldig
export const MAX_ATTEMPTS = 5                       // pogingen per code
export const RESEND_COOLDOWN_MS = 60 * 1000         // minimaal 60s tussen codes

const encoder = new TextEncoder()

/** Geheim voor de handtekening. Valt terug op de service-role key (server-only,
 *  al beschikbaar in middleware) zodat dit werkt zonder extra env-variabele. */
function secret(): string {
  return process.env.AUTH_2FA_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
}

function toB64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64Url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/')
  const padded = pad + '='.repeat((4 - (pad.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return toB64Url(new Uint8Array(sig))
}

/** SHA-256 hex — codes worden NOOIT in leesbare vorm bewaard. */
export async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${secret()}:${code}`))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Tijdconstante vergelijking — voorkomt dat responstijd de code verraadt. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** 6-cijferige code uit een cryptografisch veilige bron (geen Math.random). */
export function generateCode(): string {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return String(buf[0] % 1_000_000).padStart(6, '0')
}

/** Ondertekend bewijs dat DEZE gebruiker de code heeft ingevoerd. */
export async function createToken(userId: string, now = Date.now()): Promise<string> {
  const payload = toB64Url(encoder.encode(JSON.stringify({ u: userId, e: now + SESSION_TTL_MS })))
  return `${payload}.${await hmac(payload)}`
}

/** Geldig, niet vervallen én van deze gebruiker? */
export async function verifyToken(token: string | undefined, userId: string, now = Date.now()): Promise<boolean> {
  if (!token || !secret()) return false
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return false
  if (!safeEqual(sig, await hmac(payload))) return false
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64Url(payload))) as { u?: string; e?: number }
    if (!data.u || typeof data.e !== 'number') return false
    if (data.e < now) return false
    return safeEqual(data.u, userId)
  } catch {
    return false
  }
}

/**
 * Moet dit account de toegestuurde code invullen?
 *
 * Standaard JA. Enkel een uitdrukkelijke rij in login_settings met
 * two_factor_required = false zet dat uit. Elke andere uitkomst — geen rij,
 * tabel bestaat nog niet, database onbereikbaar — houdt de code verplicht.
 * De veilige kant is hier de standaard, niet de uitzondering.
 *
 * `db` is een Supabase-client; die wordt meegegeven omdat deze functie zowel in
 * de Edge-middleware als in gewone routes gebruikt wordt.
 */
export async function twoFactorRequired(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: { from: (t: string) => any },
  userId: string,
): Promise<boolean> {
  try {
    const { data, error } = await db
      .from('login_settings').select('two_factor_required').eq('auth_user_id', userId).maybeSingle()
    if (error) return true
    return (data as { two_factor_required?: boolean } | null)?.two_factor_required !== false
  } catch {
    return true
  }
}
