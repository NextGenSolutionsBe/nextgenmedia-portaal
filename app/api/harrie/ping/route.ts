import { NextRequest, NextResponse } from 'next/server'
import { herkenToken, geenToegang } from '@/lib/harrie/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/harrie/ping — verbindingstest.
 *
 * Het eerste wat Harrie doet na het invullen van de instellingen. Antwoordt
 * hij hier niet, dan weet je meteen dat het aan het adres of de token ligt en
 * hoef je niet in de sync te gaan zoeken.
 */
export async function GET(req: NextRequest) {
  if (!(await herkenToken(req))) return geenToegang()
  return NextResponse.json({
    ok: true,
    app: 'NextGenMedia Operations',
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
  })
}
