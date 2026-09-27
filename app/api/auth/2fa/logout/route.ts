import { NextResponse } from 'next/server'
import { TWO_FA_COOKIE } from '@/lib/two-factor'
import { huidigeSessie, wisSessie } from '@/lib/twofa/server'

export const dynamic = 'force-dynamic'

// POST — bij uitloggen de 2FA-markering van DEZE sessie server-side wissen
// (twofa_sessies), vóór de browser de Supabase-sessie afmeldt. Zo werkt een
// achtergebleven token nergens meer als "tweede stap voltooid", ook niet in de
// RLS. Het oude verificatiecookie wordt mee opgeruimd.
export async function POST() {
  try {
    const sessie = await huidigeSessie()
    await wisSessie(sessie?.sessionId ?? null)
  } catch { /* uitloggen mag nooit blokkeren */ }
  const res = NextResponse.json({ ok: true })
  res.cookies.set(TWO_FA_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
