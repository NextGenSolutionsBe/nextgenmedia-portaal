import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { formulierGuard, migratieAntwoord, isUuid } from '@/lib/formulieren/server'

export const dynamic = 'force-dynamic'

/**
 * De laatste inzendingen van één klant (voor de kaart in de klant-hub).
 * GET ?klant=<client_id>. Enkel samenvattende velden — geen antwoorden.
 */
export async function GET(req: NextRequest) {
  try {
    const g = await formulierGuard('bekijken')
    if (!g.ok) return g.response
    const klant = req.nextUrl.searchParams.get('klant')
    if (!isUuid(klant)) return NextResponse.json({ error: 'Klant ontbreekt' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('formulier_inzendingen')
      .select('id, formulier_id, naam, email, status, created_at')
      .eq('client_id', klant).order('created_at', { ascending: false }).limit(10)
    if (error) return migratieAntwoord(error.message) ?? NextResponse.json({ error: safeMessage(error, 'formulier-klant') }, { status: 500 })
    const ids = [...new Set((data ?? []).map((r) => r.formulier_id as string))]
    const { data: f } = ids.length ? await admin.from('formulieren').select('id, titel').in('id', ids) : { data: [] }
    const titel = new Map(((f ?? []) as { id: string; titel: string }[]).map((x) => [x.id, x.titel]))
    const { count: openLinks } = await admin.from('formulier_links').select('id', { count: 'exact', head: true }).eq('client_id', klant).is('ingetrokken_op', null)
    return NextResponse.json({
      inzendingen: (data ?? []).map((r) => ({ ...r, formulier_titel: titel.get(r.formulier_id as string) ?? 'Formulier' })),
      open_links: openLinks ?? 0,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'formulier-klant') }, { status: 400 })
  }
}
