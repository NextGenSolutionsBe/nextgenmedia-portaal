import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { hash } from '@/lib/mcp/oauth'

export const dynamic = 'force-dynamic'

/**
 * Token intrekken (RFC 7009).
 *
 * Antwoordt ALTIJD met 200, ook als het token onbekend is. Dat is geen
 * slordigheid maar staat zo in de RFC: een ander antwoord zou verklappen welke
 * tokens bestaan, en voor wie intrekt maakt het niets uit — het resultaat is in
 * beide gevallen dat het token niet meer werkt.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } })
}

export async function POST(req: Request) {
  const goed = new NextResponse(null, { status: 200, headers: { ...CORS, 'Cache-Control': 'no-store' } })

  let token = ''
  try {
    const type = req.headers.get('content-type') ?? ''
    if (type.includes('application/json')) {
      token = String(((await req.json()) as { token?: unknown })?.token ?? '')
    } else {
      token = String((await req.formData()).get('token') ?? '')
    }
  } catch {
    return goed
  }
  if (!token) return goed

  try {
    const db = createAdminSupabaseClient()
    const nu = new Date().toISOString()
    // We weten niet of dit een toegangs- of verversingstoken is, dus proberen
    // we beide. Het hele paar gaat eruit: een verversingstoken intrekken en het
    // bijbehorende toegangstoken laten leven zou de intrekking zinloos maken.
    await db.from('mcp_oauth_tokens').update({ revoked_at: nu })
      .eq('access_token_hash', hash(token)).is('revoked_at', null)
    await db.from('mcp_oauth_tokens').update({ revoked_at: nu })
      .eq('refresh_token_hash', hash(token)).is('revoked_at', null)
  } catch {
    // Ook bij een storing niets verklappen.
  }

  return goed
}
