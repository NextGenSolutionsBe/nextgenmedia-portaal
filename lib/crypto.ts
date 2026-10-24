import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'

// AES-256-GCM versleuteling voor gevoelige secrets (bv. Framer API key).
// Sleutel uit env BLOG_ENC_KEY. Zonder env wordt NIET versleuteld (prefix
// 'plain:') zodat de app blijft werken vóór configuratie — met een duidelijke
// markering. Configureer BLOG_ENC_KEY in productie voor echte encryptie at rest.

function key(): Buffer | null {
  const raw = process.env.BLOG_ENC_KEY
  if (!raw) return null
  // Sleutel normaliseren naar 32 bytes via SHA-256 (accepteert elke lengte).
  return createHash('sha256').update(raw).digest()
}

/** Versleutelt een geheim. Geeft 'enc:<iv>:<tag>:<data>' of 'plain:<data>'. */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return ''
  const k = key()
  if (!k) return `plain:${plaintext}`
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', k, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `enc:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

/** Ontsleutelt een waarde uit encryptSecret. Leeg → ''. */
export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return ''
  if (stored.startsWith('plain:')) return stored.slice(6)
  if (!stored.startsWith('enc:')) return stored // legacy/onbekend → ongewijzigd
  const k = key()
  if (!k) return ''
  try {
    const [, ivB64, tagB64, dataB64] = stored.split(':')
    const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return ''
  }
}

/** Is deze opslagwaarde echt versleuteld (niet plain)? */
export function isEncrypted(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith('enc:')
}
