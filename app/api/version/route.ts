import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Publiek, niet-gevoelig: toont welke commit er LIVE draait, zodat we kunnen
// verifiëren of de nieuwste code echt gedeployed is (Vercel vult deze env-vars in).
export function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? ''
  return NextResponse.json({
    commit: sha ? sha.slice(0, 7) : 'onbekend (geen Vercel-build-info)',
    env: process.env.VERCEL_ENV ?? 'onbekend',
    now: new Date().toISOString(),
  })
}
