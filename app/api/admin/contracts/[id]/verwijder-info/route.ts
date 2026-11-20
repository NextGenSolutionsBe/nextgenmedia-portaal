import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/** Aantal rijen dat naar dit contract verwijst; 0 als de tabel of kolom (nog) niet bestaat. */
async function tel(admin: ReturnType<typeof createAdminSupabaseClient>, tabel: string, contractId: string): Promise<number> {
  try {
    const { count, error } = await admin.from(tabel).select('id', { count: 'exact', head: true }).eq('contract_id', contractId)
    return error ? 0 : (count ?? 0)
  } catch { return 0 }
}

/**
 * GET — wat er gebeurt als dit contract verwijderd wordt: titel, klant en het
 * aantal gekoppelde facturen (die blijven bestaan als losse facturen).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: c } = await admin.from('contracts').select('id, title, status, client_id').eq('id', id).maybeSingle()
    if (!c) return NextResponse.json({ error: 'Contract niet gevonden' }, { status: 404 })
    const [klant, facturen, recurring, opdrachten, vesting, archief] = await Promise.all([
      c.client_id ? admin.from('clients').select('company_name').eq('id', c.client_id).maybeSingle().then((r) => r.data?.company_name ?? null) : Promise.resolve(null),
      tel(admin, 'invoices', id),
      tel(admin, 'recurring_invoices', id),
      tel(admin, 'opdrachten', id),
      tel(admin, 'vesting_contracten', id),
      tel(admin, 'contract_archief', id),
    ])
    return NextResponse.json({ titel: c.title, klant, status: c.status, facturen, recurring, opdrachten, vesting, archief })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
