import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { createAdminSupabaseClient } from '@/lib/supabase/server'

/**
 * De sleutelbos van de Harrie-koppeling.
 *
 * We bewaren enkel de HASH van een token, net als bij een wachtwoord. Wie de
 * databank kan lezen, kan er dus niet mee binnen. Het token zelf zie je exact
 * één keer: op het scherm waar je het aanmaakt.
 *
 * Een hash zonder salt is hier het juiste gereedschap: het token is 32 bytes
 * uit een cryptografisch veilige bron, dus er valt niets te raden of te
 * herleiden uit een regenboogtabel. En omdat de hash deterministisch is, kunnen
 * we bij elk verzoek in één indexlezing opzoeken wie er belt.
 */

const PREFIX = 'ngm_harrie_'

/** Een nieuw token. Enkel hier bestaat het in leesbare vorm. */
export function maakToken(): { token: string; hash: string; prefix: string } {
  const token = PREFIX + randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token), prefix: token.slice(0, PREFIX.length + 6) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex')
}

export type HarrieToken = { id: string; naam: string }

/**
 * Wie belt hier? Leest de Authorization-header en zoekt het token op.
 *
 * Geeft null bij alles wat niet klopt — ontbrekend, verkeerd formaat,
 * onbekend of ingetrokken. De route maakt daar één 401 van, zonder te
 * verklappen wélke van die gevallen het was.
 */
export async function herkenToken(req: Request): Promise<HarrieToken | null> {
  const kop = req.headers.get('authorization') ?? ''
  const m = kop.match(/^Bearer\s+(.+)$/i)
  if (!m) return null
  const token = m[1].trim()
  if (!token) return null

  const admin = createAdminSupabaseClient()
  const { data } = await admin.from('harrie_tokens')
    .select('id, naam, ingetrokken_op')
    .eq('token_hash', hashToken(token))
    .maybeSingle()
  const rij = data as { id: string; naam: string; ingetrokken_op: string | null } | null
  if (!rij || rij.ingetrokken_op) return null

  /**
   * Bijhouden dát en wanneer het token gebruikt is — zo zie je in het scherm of
   * de koppeling nog leeft, en hoeveel Harrie ophaalt.
   *
   * Bewust via een databankfunctie: die telt in één statement op (`+ 1`) zodat
   * twee gelijktijdige verzoeken elkaars telling niet overschrijven. En bewust
   * zonder await: een teller mag nooit een sync vertragen of laten stranden.
   */
  void admin.rpc('harrie_token_gebruikt', { p_token_id: rij.id })
    .then(() => undefined, () => undefined)

  return { id: rij.id, naam: rij.naam }
}

/** Standaardantwoord bij een ontbrekend of ongeldig token. */
export function geenToegang(): Response {
  return new Response(
    JSON.stringify({ error: 'Ongeldige of ontbrekende token.' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  )
}
