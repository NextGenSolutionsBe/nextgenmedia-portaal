import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { AcFout, laadOverzicht, mapActie } from '@/lib/algemene-contracten/server'

export const dynamic = 'force-dynamic'

/** POST { actie: maak | hernoem | verwijder, id?, naam? } — mappen beheren. Verwijderen laat de contracten staan, zonder map. */
export async function POST(req: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const admin = createAdminSupabaseClient()
    await mapActie(admin, (await req.json().catch(() => ({}))) as Record<string, unknown>, user.email ?? null)
    return NextResponse.json({ ok: true, ...(await laadOverzicht(admin)) })
  } catch (e) {
    return e instanceof AcFout ? NextResponse.json({ error: e.message }, { status: e.status }) : NextResponse.json({ error: safeMessage(e, 'mappen') }, { status: 500 })
  }
}
