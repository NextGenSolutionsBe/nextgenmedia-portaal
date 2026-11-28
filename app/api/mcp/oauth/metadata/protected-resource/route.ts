import { NextResponse } from 'next/server'
import { basisUrl, RESOURCE_PAD, SCOPE } from '@/lib/mcp/oauth'

export const dynamic = 'force-dynamic'

/**
 * Metadata van de beschermde bron (RFC 9728).
 *
 * Bereikbaar als /.well-known/oauth-protected-resource, met of zonder pad
 * erachter — clients proberen beide. De omleiding staat in next.config.mjs.
 *
 * `resource` MOET exact het adres zijn dat de gebruiker in Claude invult,
 * inclusief pad. Wijkt het af, dan weigert de client met een melding over een
 * niet-overeenkomende bron.
 */
export function GET(req: Request) {
  const basis = basisUrl(req)

  return NextResponse.json(
    {
      resource: `${basis}${RESOURCE_PAD}`,
      authorization_servers: [basis],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ['header'],
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    },
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
