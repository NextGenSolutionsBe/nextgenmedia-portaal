import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission } from '@/lib/portal-auth'
import { safeMessage } from '@/lib/api-error'
import { expertsVoor, AanvraagFout } from '@/lib/aanvragen/server'
import { moduleVoor, soortUit } from '@/lib/aanvragen/portaal'

export const dynamic = 'force-dynamic'

/** "Kies jouw expert": enkel teamleden die als expert aan staan en passen bij de gekozen dienst. */
export async function GET(req: NextRequest) {
  const soort = soortUit(req.nextUrl.searchParams.get('soort'))
  if (!soort) return NextResponse.json({ error: 'Onbekend soort aanvraag' }, { status: 400 })
  const g = await requirePortalPermission(moduleVoor(soort), 'aanvragen')
  if (!g.ok) return g.response
  try {
    return NextResponse.json({ experts: await expertsVoor(createAdminSupabaseClient(), soort, String(req.nextUrl.searchParams.get('type') ?? '')) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    if (e instanceof AanvraagFout) return NextResponse.json({ error: e.publiek }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e, 'portal-aanvragen.experts') }, { status: 500 })
  }
}
