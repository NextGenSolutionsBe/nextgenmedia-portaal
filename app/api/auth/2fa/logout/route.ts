import { NextResponse } from 'next/server'
import { TWO_FA_COOKIE } from '@/lib/two-factor'

export const dynamic = 'force-dynamic'

// POST — verificatie-cookie wissen bij uitloggen. Zonder dit zou opnieuw
// inloggen met alleen een wachtwoord de codestap overslaan zolang het cookie
// geldig is. Het cookie is httpOnly en kan dus niet vanuit de browser gewist worden.
export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(TWO_FA_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
