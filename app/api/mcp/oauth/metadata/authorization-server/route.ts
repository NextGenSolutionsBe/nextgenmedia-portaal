import { NextResponse } from 'next/server'
import { basisUrl, SCOPE } from '@/lib/mcp/oauth'

export const dynamic = 'force-dynamic'

/** Deze documenten worden vanuit de browser van een ander domein opgehaald.
 *  Zonder CORS ziet Claude alleen een netwerkfout. Ze bevatten uitsluitend
 *  openbare adressen, dus dat is hier ongevaarlijk. */
const KOPPEN = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=300',
}

/**
 * Metadata van de autorisatieserver (RFC 8414).
 *
 * Bereikbaar als /.well-known/oauth-authorization-server — die omleiding staat
 * in next.config.mjs. Een map die met een punt begint werkt niet betrouwbaar in
 * de router van Next, vandaar de omweg.
 *
 * Dit document vertelt Claude waar hij moet aankloppen. Klopt er één adres
 * niet, dan strandt de koppeling met "kon niet registreren" zonder verdere
 * uitleg — dus alles wordt hier afgeleid van dezelfde basis-URL.
 */
export function GET(req: Request) {
  const basis = basisUrl(req)

  return NextResponse.json(
    {
      issuer: basis,
      authorization_endpoint: `${basis}/api/mcp/oauth/authorize`,
      token_endpoint: `${basis}/api/mcp/oauth/token`,
      registration_endpoint: `${basis}/api/mcp/oauth/register`,
      revocation_endpoint: `${basis}/api/mcp/oauth/revoke`,
      scopes_supported: [SCOPE],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      // Alleen S256. "plain" biedt geen bescherming; door het hier weg te laten
      // zal een client het ook niet proberen.
      code_challenge_methods_supported: ['S256'],
      // Claude is een publieke client: er valt geen geheim in te bewaren, dus
      // een client_secret zou schijnveiligheid zijn.
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
    },
    { headers: KOPPEN },
  )
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
      'Access-Control-Max-Age': '86400',
    },
  })
}
