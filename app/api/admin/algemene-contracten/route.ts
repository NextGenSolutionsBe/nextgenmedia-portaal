import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { AcFout, laadOverzicht, maakContract } from '@/lib/algemene-contracten/server'

export const dynamic = 'force-dynamic'

const fout = (e: unknown) => e instanceof AcFout
  ? NextResponse.json({ error: e.message }, { status: e.status })
  : NextResponse.json({ error: safeMessage(e, 'algemene-contracten') }, { status: 500 })

/** GET — mappen en contracten (enkel zaakvoerders). */
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try { return NextResponse.json(await laadOverzicht(createAdminSupabaseClient()), { headers: { 'Cache-Control': 'no-store' } }) } catch (e) { return fout(e) }
}

/** POST { pad, bestand_naam, titel, map_id, tegenpartij, … } — een opgeladen PDF als contract bewaren. */
export async function POST(req: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const id = await maakContract(createAdminSupabaseClient(), b, { email: user.email ?? null, userId: user.id })
    return NextResponse.json({ ok: true, id })
  } catch (e) { return fout(e) }
}
