import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import {
  SCOPE, VERVERS_GELDIG_SEC,
  gelijk, hash, oauthFout, pkceKlopt, tokensUitgeven,
} from '@/lib/mcp/oauth'

export const dynamic = 'force-dynamic'

/**
 * Het token-eindpunt.
 *
 * Twee soorten aanvragen:
 *  · authorization_code — de code die net op het toestemmingsscherm is
 *    uitgegeven, inwisselen voor tokens;
 *  · refresh_token — een verlopen toegangstoken vernieuwen.
 *
 * LET OP: dit eindpunt spreekt formuliergegevens, geen JSON. Dat staat zo in
 * RFC 6749 en clients houden zich daaraan. Zou je hier alleen JSON accepteren,
 * dan faalt de koppeling met een lege foutmelding.
 *
 * VERVERSINGSTOKENS ROULEREN. Elk gebruik levert een nieuw paar op en trekt het
 * oude in. Wordt een token twee keer gebruikt, dan is er iets mis — dan is het
 * onderschept of gekopieerd — en trekken we alles van die verbinding in.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } })
}

const antwoord = (body: Record<string, unknown>) =>
  NextResponse.json(body, { headers: { ...CORS, 'Cache-Control': 'no-store', Pragma: 'no-cache' } })

/** Zowel formuliergegevens als JSON aannemen. Het protocol schrijft het eerste
 *  voor, maar sommige clients sturen toch JSON; weigeren zou alleen maar een
 *  onbegrijpelijke fout opleveren. */
async function leesBody(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get('content-type') ?? ''
  if (type.includes('application/json')) {
    const j = await req.json().catch(() => ({}))
    return Object.fromEntries(Object.entries(j as object).map(([k, v]) => [k, String(v ?? '')]))
  }
  const f = await req.formData().catch(() => null)
  if (!f) return {}
  const uit: Record<string, string> = {}
  for (const [k, v] of f.entries()) uit[k] = String(v)
  return uit
}

export async function POST(req: Request) {
  const b = await leesBody(req)
  const db = createAdminSupabaseClient()

  // ── Code inwisselen ──────────────────────────────────────────────────────
  if (b.grant_type === 'authorization_code') {
    const { code, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri } = b
    if (!code || !verifier || !clientId) {
      return oauthFout('invalid_request', 'code, code_verifier en client_id zijn verplicht.')
    }

    const { data: rij, error } = await db
      .from('mcp_oauth_codes')
      .select('client_id, user_id, redirect_uri, code_challenge, scope, expires_at, used_at')
      .eq('code_hash', hash(code))
      .maybeSingle()

    if (error && /mcp_oauth_codes|does not exist|schema cache/i.test(error.message)) {
      return oauthFout('server_error', 'De OAuth-tabellen bestaan nog niet. Draai de migratie in Supabase.', 500)
    }
    if (!rij) return oauthFout('invalid_grant', 'Deze code is onbekend.')

    // Hergebruik is geen vergissing maar een signaal. De code is al ingewisseld,
    // dus als hij nóg eens langskomt heeft iemand anders hem ook gezien: alles
    // van deze verbinding gaat eruit.
    if (rij.used_at) {
      await db.from('mcp_oauth_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('client_id', rij.client_id).eq('user_id', rij.user_id).is('revoked_at', null)
      return oauthFout('invalid_grant', 'Deze code is al gebruikt.')
    }

    if (new Date(rij.expires_at).getTime() <= Date.now()) {
      return oauthFout('invalid_grant', 'Deze code is verlopen. Begin de koppeling opnieuw.')
    }
    if (!gelijk(rij.client_id, clientId)) {
      return oauthFout('invalid_grant', 'Deze code hoort bij een andere toepassing.')
    }
    // redirect_uri moet gelijk zijn aan die bij de autorisatie — anders kan een
    // onderschepte code alsnog ergens anders ingewisseld worden.
    if (redirectUri && !gelijk(rij.redirect_uri, redirectUri)) {
      return oauthFout('invalid_grant', 'Het terugkeeradres komt niet overeen.')
    }
    if (!pkceKlopt(verifier, rij.code_challenge)) {
      return oauthFout('invalid_grant', 'De PKCE-controle is mislukt.')
    }

    // Pas afvinken als alles klopt, en alleen als hij nog niet afgevinkt was.
    // Die tweede voorwaarde is de rem op twee gelijktijdige pogingen.
    const { data: afgevinkt } = await db
      .from('mcp_oauth_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('code_hash', hash(code)).is('used_at', null)
      .select('code_hash')
    if (!afgevinkt || afgevinkt.length === 0) {
      return oauthFout('invalid_grant', 'Deze code is al gebruikt.')
    }

    const tokens = await tokensUitgeven(db, {
      clientId: rij.client_id, userId: rij.user_id, scope: rij.scope ?? SCOPE,
    })
    return antwoord({ token_type: 'Bearer', scope: rij.scope ?? SCOPE, ...tokens })
  }

  // ── Verversen ────────────────────────────────────────────────────────────
  if (b.grant_type === 'refresh_token') {
    const { refresh_token: token, client_id: clientId } = b
    if (!token) return oauthFout('invalid_request', 'refresh_token is verplicht.')

    const { data: rij } = await db
      .from('mcp_oauth_tokens')
      .select('id, client_id, user_id, scope, revoked_at')
      .eq('refresh_token_hash', hash(token))
      .maybeSingle()

    if (!rij) return oauthFout('invalid_grant', 'Dit verversingstoken is onbekend.')

    // Al ingetrokken en tóch gebruikt: iemand heeft een oud token in handen.
    // Alles van deze verbinding gaat eruit — liever opnieuw inloggen dan een
    // meelezer laten zitten.
    if (rij.revoked_at) {
      await db.from('mcp_oauth_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('client_id', rij.client_id).eq('user_id', rij.user_id).is('revoked_at', null)
      return oauthFout('invalid_grant', 'Dit token is niet meer geldig. Koppel de connector opnieuw.')
    }

    if (clientId && !gelijk(rij.client_id, clientId)) {
      return oauthFout('invalid_grant', 'Dit token hoort bij een andere toepassing.')
    }

    const uitgifte = new Date(Date.now() - VERVERS_GELDIG_SEC * 1000).toISOString()
    const { data: nogGeldig } = await db
      .from('mcp_oauth_tokens')
      .select('id').eq('id', rij.id).gt('created_at', uitgifte).maybeSingle()
    if (!nogGeldig) {
      return oauthFout('invalid_grant', 'Deze koppeling is te lang ongebruikt. Koppel opnieuw.')
    }

    // Rouleren: het oude paar eerst intrekken, dan een nieuw paar uitgeven.
    await db.from('mcp_oauth_tokens')
      .update({ revoked_at: new Date().toISOString() }).eq('id', rij.id)

    const tokens = await tokensUitgeven(db, {
      clientId: rij.client_id, userId: rij.user_id, scope: rij.scope ?? SCOPE,
    })
    return antwoord({ token_type: 'Bearer', scope: rij.scope ?? SCOPE, ...tokens })
  }

  return oauthFout('unsupported_grant_type', `"${b.grant_type ?? ''}" wordt niet ondersteund.`)
}

export const runtime = 'nodejs'
