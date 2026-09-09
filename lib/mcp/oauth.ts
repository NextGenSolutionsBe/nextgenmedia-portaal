import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * OAuth 2.1 voor de MCP-connector.
 *
 * WAAROM. De connector stond eerst achter een sleutel in het adres. Dat is een
 * gedeeld geheim: wie de URL heeft, heeft toegang — en dus mocht er niets
 * geschreven worden. Met OAuth keurt een ingelogde beheerder elke verbinding
 * apart goed, is de URL op zichzelf waardeloos, en kan een verbinding weer
 * ingetrokken worden zonder iedereen buiten te sluiten.
 *
 * OPZET. Claude is een *publieke* client: er zit geen geheim in, dus een
 * client_secret zou niets beveiligen. De beveiliging komt van twee kanten:
 *  · PKCE (verplicht, alleen S256) — een onderschepte code is onbruikbaar
 *    zonder de verifier, die alleen de echte client heeft;
 *  · de redirect-URI moet exact overeenkomen met wat er geregistreerd is.
 *
 * TOKENS staan NOOIT als leesbare tekst in de database, alleen als SHA-256.
 * Lekt die tabel, dan kan niemand er iets mee. Daarom kunnen we een token ook
 * nooit terugtonen — kwijt is kwijt, en dat is de bedoeling.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>

/** Kort genoeg om schade te beperken, lang genoeg om niet te irriteren. */
export const TOKEN_GELDIG_SEC = 60 * 60
/** Verversingstoken. Rouleert bij elk gebruik, dus dit is de maximale stilte. */
export const VERVERS_GELDIG_SEC = 60 * 60 * 24 * 30
/** Een autorisatiecode leeft alleen tussen toestemming en inwisseling. */
export const CODE_GELDIG_SEC = 60

export const SCOPE = 'mcp'

/** Het adres van de MCP-connector zelf. Moet exact overeenkomen met wat de
 *  gebruiker in Claude invult, anders weigert de client de metadata. */
export const RESOURCE_PAD = '/api/mcp'

export const geheim = () => randomBytes(32).toString('base64url')
export const hash = (waarde: string) => createHash('sha256').update(waarde).digest('hex')

/** Vergelijk tijdconstant, op bytelengte — zie lib/mcp/auth.ts voor het waarom. */
export function gelijk(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/**
 * De basis-URL van deze installatie.
 *
 * Bewust afgeleid uit het binnenkomende verzoek en niet alleen uit een
 * omgevingsvariabele: staat die verkeerd, dan wijst de metadata naar een ander
 * domein en faalt de koppeling met een onbegrijpelijke melding. De env-waarde
 * blijft wel voorrang houden, want achter een proxy is de Host-header niet
 * altijd te vertrouwen.
 */
export function basisUrl(req: Request): string {
  const uitEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  if (uitEnv) return uitEnv
  const url = new URL(req.url)
  const host = req.headers.get('x-forwarded-host') ?? url.host
  const protocol = req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')
  return `${protocol}://${host}`
}

/** PKCE. Alleen S256 — "plain" biedt geen enkele bescherming en staat daarom
 *  ook niet in onze metadata. */
export function pkceKlopt(verifier: string, uitdaging: string): boolean {
  if (!verifier || verifier.length < 43 || verifier.length > 128) return false
  const berekend = createHash('sha256').update(verifier).digest('base64url')
  return gelijk(berekend, uitdaging)
}

/**
 * Mag er naar deze redirect-URI teruggestuurd worden?
 *
 * Dit is de belangrijkste controle van het hele bestand. Zou hier een
 * gedeeltelijke match volstaan, dan kan iemand met een eigen adres de
 * autorisatiecode van een beheerder onderscheppen. Dus: exact, of niets.
 */
export function redirectToegestaan(gevraagd: string, geregistreerd: string[]): boolean {
  return geregistreerd.some((r) => gelijk(r, gevraagd))
}

/**
 * Is dit een redirect-URI die we überhaupt willen accepteren bij registratie?
 * HTTPS, of loopback voor lokale clients (Claude Code registreert een poort op
 * 127.0.0.1). Alles daarbuiten weigeren we.
 */
export function redirectVeilig(uri: string): boolean {
  let u: URL
  try { u = new URL(uri) } catch { return false }
  if (u.hash) return false
  if (u.protocol === 'https:') return true
  if (u.protocol === 'http:') return u.hostname === '127.0.0.1' || u.hostname === '[::1]' || u.hostname === 'localhost'
  return false
}

export type Toegang = { userId: string; clientId: string; scope: string }

/**
 * Een bearer-token omzetten naar een gebruiker, of null.
 *
 * Null betekent altijd hetzelfde antwoord naar buiten (401 met verwijzing naar
 * de metadata); we vertellen nooit óf het token bestond, verlopen was of
 * ingetrokken. Dat verschil is voor een aanvaller waardevol en voor een
 * legitieme client irrelevant — die moet in alle drie de gevallen opnieuw
 * inloggen.
 */
export async function tokenNaarToegang(db: Db, token: string): Promise<Toegang | null> {
  if (!token) return null
  const { data } = await db
    .from('mcp_oauth_tokens')
    .select('user_id, client_id, scope, expires_at, revoked_at')
    .eq('access_token_hash', hash(token))
    .maybeSingle()

  if (!data) return null
  if (data.revoked_at) return null
  if (new Date(data.expires_at).getTime() <= Date.now()) return null

  // Bijhouden wanneer een verbinding voor het laatst iets deed, zodat een
  // vergeten koppeling zichtbaar is in plaats van stilletjes te blijven bestaan.
  void db.from('mcp_oauth_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('access_token_hash', hash(token))
    .then(() => undefined, () => undefined)

  return { userId: data.user_id, clientId: data.client_id, scope: data.scope ?? SCOPE }
}

/** Het `Authorization: Bearer …`-token uit een verzoek halen. */
export function bearerUit(req: Request): string {
  const kop = req.headers.get('authorization') ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(kop.trim())
  return m ? m[1].trim() : ''
}

/**
 * Nieuw tokenpaar uitgeven en opslaan.
 * Geeft de leesbare tokens terug — dat is het enige moment waarop ze bestaan.
 */
export async function tokensUitgeven(
  db: Db,
  opts: { clientId: string; userId: string; scope?: string },
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const access = geheim()
  const refresh = geheim()

  const { error } = await db.from('mcp_oauth_tokens').insert({
    access_token_hash: hash(access),
    refresh_token_hash: hash(refresh),
    client_id: opts.clientId,
    user_id: opts.userId,
    scope: opts.scope ?? SCOPE,
    expires_at: new Date(Date.now() + TOKEN_GELDIG_SEC * 1000).toISOString(),
  })
  if (error) throw new Error(error.message)

  return { access_token: access, refresh_token: refresh, expires_in: TOKEN_GELDIG_SEC }
}

/**
 * Fouten volgens RFC 6749. De precieze codes doen ertoe: clients kijken naar
 * `error`, niet naar onze beschrijving. Geef je iets anders terug, dan blijft
 * een client eindeloos hetzelfde verlopen token proberen in plaats van opnieuw
 * in te loggen.
 */
export function oauthFout(code: string, beschrijving: string, status = 400) {
  return new Response(JSON.stringify({ error: code, error_description: beschrijving }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
