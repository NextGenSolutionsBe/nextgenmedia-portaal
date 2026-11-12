import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

async function requireAdminUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' || (await isActiveStaff(user.id)) ? user : null
}

type Inv = { id: string; description: string | null; invoice_month: string; amount_excl: number; amount_incl: number; status: string; contract_id: string | null; client_id: string | null }

// GET — gekoppelde facturen + kandidaten om te koppelen (zelfde klant, nog niet gekoppeld).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireAdminUser())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const { data: contract } = await admin.from('contracts').select('id, client_id').eq('id', id).maybeSingle()
    if (!contract) return NextResponse.json({ error: 'Contract niet gevonden' }, { status: 404 })

    // select('*') zodat contract_id ontbreken (pre-migratie) nooit breekt.
    const { data: all } = await admin.from('invoices').select('*').order('invoice_month', { ascending: false }).limit(2000)
    const rows = (all ?? []) as Inv[]
    const linked = rows.filter((r) => r.contract_id === id)
    // Kandidaten: niet gekoppeld + (zelfde klant als contract, of contract zonder klant → enkel losse facturen).
    const candidates = rows.filter((r) => !r.contract_id && (
      contract.client_id ? r.client_id === contract.client_id : !r.client_id
    )).slice(0, 50)

    return NextResponse.json({ linked, candidates })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST { invoice_id } — bestaande factuur koppelen (geen cross-client).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireAdminUser())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const { invoice_id } = await req.json()
    if (!invoice_id) return NextResponse.json({ error: 'invoice_id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()

    const { data: contract } = await admin.from('contracts').select('id, client_id').eq('id', id).maybeSingle()
    if (!contract) return NextResponse.json({ error: 'Contract niet gevonden' }, { status: 404 })
    const { data: inv } = await admin.from('invoices').select('id, client_id, contract_id').eq('id', invoice_id).maybeSingle()
    if (!inv) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
    // Geen cross-client koppeling.
    if (contract.client_id && inv.client_id && inv.client_id !== contract.client_id) {
      return NextResponse.json({ error: 'Deze factuur hoort bij een andere klant.' }, { status: 400 })
    }
    if (inv.contract_id && inv.contract_id !== id) {
      return NextResponse.json({ error: 'Deze factuur is al aan een ander contract gekoppeld.' }, { status: 400 })
    }

    const { error } = await admin.from('invoices').update({ contract_id: id }).eq('id', invoice_id)
    if (error) throw new Error(error.message)
    try { revalidatePath(`/admin/contracts/${id}`); revalidatePath('/admin/invoices') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?invoice_id= — factuur ontkoppelen.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireAdminUser())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const invoiceId = req.nextUrl.searchParams.get('invoice_id')
    if (!invoiceId) return NextResponse.json({ error: 'invoice_id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('invoices').update({ contract_id: null }).eq('id', invoiceId).eq('contract_id', id)
    if (error) throw new Error(error.message)
    try { revalidatePath(`/admin/contracts/${id}`); revalidatePath('/admin/invoices') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
