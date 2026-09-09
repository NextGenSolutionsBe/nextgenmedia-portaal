import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { geheim, oauthFout, redirectVeilig, SCOPE } from '@/lib/mcp/oauth'

export const dynamic = 'force-dynamic'

/**
 * Dynamische clientregistratie (RFC 7591).
 *
 * WAAROM DIT OPEN STAAT. Registreren geeft op zichzelf géén toegang: het levert
 * alleen een client_id op waarmee je een gebruiker om toestemming mág vragen.
 * Zonder een ingelogde beheerder die op "Toestaan" klikt, kom je nergens. Zou
 * dit dicht staan, dan zou elke nieuwe verbinding handwerk vereisen — en dat is
 * precies wat dit protocol wil vermijden.
 *
 * Wat we wél hard maken is de redirect-URI: alleen HTTPS of loopback, en later
 * bij het autoriseren moet hij exact overeenkomen. Dat is de plek waar een
 * fout écht pijn doet.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } })
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return oauthFout('invalid_client_metadata', 'De aanvraag was geen leesbare JSON.')
  }

  const gevraagd = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : []
  if (gevraagd.length === 0) {
    return oauthFout('invalid_redirect_uri', 'Geef minstens één redirect_uri op.')
  }
  // Meer dan een handvol adressen wijst op rommel, niet op een echte client.
  if (gevraagd.length > 10) {
    return oauthFout('invalid_redirect_uri', 'Te veel redirect-adressen.')
  }

  const slecht = gevraagd.find((u) => !redirectVeilig(u))
  if (slecht) {
    return oauthFout(
      'invalid_redirect_uri',
      `"${slecht}" is niet toegestaan. Alleen https, of http op 127.0.0.1 voor lokale clients.`,
    )
  }

  const clientId = `mcp_${geheim()}`
  const naam = String(body.client_name ?? 'Onbekende client').slice(0, 200)

  const db = createAdminSupabaseClient()
  const { error } = await db.from('mcp_oauth_clients').insert({
    client_id: clientId,
    client_name: naam,
    redirect_uris: gevraagd,
  })
  if (error) {
    // Bestaat de tabel nog niet, zeg dat dan met zoveel woorden. Een kale
    // 500 stuurt je hier het verkeerde konijnenhol in.
    const hint = /mcp_oauth_clients|does not exist|schema cache/i.test(error.message)
      ? 'De OAuth-tabellen bestaan nog niet. Draai supabase/migrations/99999999_SYNC_ALL.sql.'
      : error.message
    return oauthFout('server_error', hint, 500)
  }

  return NextResponse.json(
    {
      client_id: clientId,
      client_name: naam,
      redirect_uris: gevraagd,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      // Publieke client: geen geheim, dus ook geen client_secret in het antwoord.
      token_endpoint_auth_method: 'none',
      scope: SCOPE,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    { status: 201, headers: { ...CORS, 'Cache-Control': 'no-store' } },
  )
}
