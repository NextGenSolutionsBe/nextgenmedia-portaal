import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { projectNaam } from '@/lib/opdrachten-kanban'

export const dynamic = 'force-dynamic'

/**
 * De projecten (kaarten op Projecten) van één klant, om een aankoop of kost
 * aan een project te hangen (verbeterplan fase 7, punt 80). Enkel id en naam.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('client_id') ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ projecten: [] })
    const admin = createAdminSupabaseClient()
    const [{ data }, { data: k }] = await Promise.all([
      admin.from('opdrachten').select('id, titel, diensten, status, created_at').eq('client_id', id).order('created_at', { ascending: false }).limit(50),
      admin.from('clients').select('company_name').eq('id', id).maybeSingle(),
    ])
    const projecten = ((data ?? []) as { id: string; titel: string | null; diensten: string[] | null; status: string | null }[])
      .map((p) => ({ id: p.id, naam: projectNaam(k?.company_name ?? null, p.diensten, p.titel), status: p.status }))
    return NextResponse.json({ projecten })
  } catch (e) { return NextResponse.json({ error: safeMessage(e) }, { status: 400 }) }
}
