import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { bepaalBuren } from '@/lib/contract-navigatie'

export const dynamic = 'force-dynamic'

/**
 * GET ?id= — vorige/volgende contract in de standaardvolgorde van het overzicht
 * (nieuwste eerst). Enkel de terugval wanneer de detailpagina rechtstreeks
 * geopend werd (geen overzichtscontext in de sessie). Laadt alleen id's.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id') ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('contracts').select('id').order('created_at', { ascending: false }).limit(1000)
    if (error) throw new Error(error.message)
    const ids = ((data ?? []) as { id: string }[]).map((c) => c.id)
    return NextResponse.json({ ...bepaalBuren(ids, id), bron: 'standaard' })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
