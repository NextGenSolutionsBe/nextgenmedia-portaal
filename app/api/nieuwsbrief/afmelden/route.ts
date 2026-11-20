import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { afmeldTokenKlopt } from '@/lib/nieuwsbrieven-server'

export const dynamic = 'force-dynamic'

/** Afmelden voor de nieuwsbrief vanuit de link in de mail. Enkel met een geldige, ondertekende link. */
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'onbekend'
  const rl = await rateLimit(`nieuwsbrief-afmelden:${ip}`, { limit: 20, windowSec: 3600 })
  if (!rl.allowed) return NextResponse.json({ error: 'Even te veel pogingen. Probeer het later opnieuw.' }, { status: 429 })
  const b = await req.json().catch(() => ({})) as { e?: string; t?: string }
  const email = String(b.e ?? '').trim().toLowerCase()
  if (!afmeldTokenKlopt(email, String(b.t ?? ''))) return NextResponse.json({ error: 'Deze afmeldlink is niet (meer) geldig.' }, { status: 400 })
  const { error } = await createAdminSupabaseClient().from('nieuwsbrief_afmeldingen').upsert({ email, afgemeld_op: new Date().toISOString() }, { onConflict: 'email' })
  if (error) return NextResponse.json({ error: 'Afmelden mislukt. Probeer het later opnieuw.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
