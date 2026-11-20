import { NextRequest, NextResponse } from 'next/server'
import { createClient, isActiveStaff } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { validateBtw } from '@/lib/btw'
import { zoekInBtwRegister, type BtwGegevens } from '@/lib/btw-register'

export const dynamic = 'force-dynamic'

// Gevonden nummers even onthouden (per server, 12 uur): hetzelfde nummer
// twee keer opzoeken gaat dan meteen, en VIES krijgt minder vragen.
const ONTHOUDEN_MS = 12 * 60 * 60 * 1000
const onthouden = new Map<string, { g: BtwGegevens; tot: number }>()

/**
 * GET ?nummer=BE0123456789 → naam en adres uit het Europese btw-register (VIES).
 * Voor elke interne gebruiker (publieke registergegevens); niets wordt bewaard.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
  const { data: rol } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  if (rol?.role !== 'admin' && !(await isActiveStaff(user.id))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

  const nummer = req.nextUrl.searchParams.get('nummer') ?? ''
  const v = validateBtw(nummer)
  if (!v.ok || !v.value) return NextResponse.json({ error: v.error ?? 'Vul een btw-nummer in.' }, { status: 400 })
  const al = onthouden.get(v.value)
  if (al && al.tot > Date.now()) return NextResponse.json({ gegevens: al.g }, { headers: { 'Cache-Control': 'no-store' } })

  const rl = await rateLimit(`btw-opzoeken:${user.id}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: 'Even te veel opzoekingen na elkaar. Wacht een minuutje.' }, { status: 429 })
  try {
    const g = await zoekInBtwRegister(v.value)
    if (!g.geldig) return NextResponse.json({ error: `${g.btw} staat niet als actief btw-nummer in het Europese register.`, gegevens: g }, { status: 404 })
    if (onthouden.size > 300) onthouden.clear()
    onthouden.set(v.value, { g, tot: Date.now() + ONTHOUDEN_MS })
    return NextResponse.json({ gegevens: g }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Opzoeken mislukt' }, { status: 400 })
  }
}
