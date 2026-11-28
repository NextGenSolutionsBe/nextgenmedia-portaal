import { NextResponse } from 'next/server'
import { requirePortalPermission } from '@/lib/portal-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { laadOpleveringen } from '@/lib/opleveringen-server'
import { voorKlant } from '@/lib/opleveringen-portaal'

export const dynamic = 'force-dynamic'

/** GET — de opleveringen van de eigen klant (enkel gedeelde versies). */
export async function GET() {
  const g = await requirePortalPermission('opleveringen', 'view')
  if (!g.ok) return g.response
  try {
    const lijst = await laadOpleveringen(createAdminSupabaseClient(), { klant: g.session.clientId })
    return NextResponse.json({ opleveringen: lijst.filter((o) => o.versies.length).map((o) => voorKlant(o)) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'portal.opleveringen.GET') }, { status: 500 }) }
}
