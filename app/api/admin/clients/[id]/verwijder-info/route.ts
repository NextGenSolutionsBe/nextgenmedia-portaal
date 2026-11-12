import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createClient, createAdminSupabaseClient } from '@/lib/supabase/server'
import { statusInfo } from '@/lib/contract-status'

export const dynamic = 'force-dynamic'

/**
 * GET — wat er mee verdwijnt als deze klant verwijderd wordt: de contracten
 * (titel, status, getekend op) en het aantal facturen (die blijven, los van de
 * klant). Enkel admins: verwijderen is enkel voor hen.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { data: rol } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (rol?.role !== 'admin') return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const [{ data: contracten }, { count: facturen }] = await Promise.all([
      admin.from('contracts').select('id, title, status, signed_at, created_at').eq('client_id', id).order('created_at', { ascending: false }),
      admin.from('invoices').select('id', { count: 'exact', head: true }).eq('client_id', id),
    ])
    return NextResponse.json({
      contracten: (contracten ?? []).map((c) => ({ id: c.id, titel: c.title, status: statusInfo(c.status).label, getekend_op: c.signed_at ?? null })),
      facturen: facturen ?? 0,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
