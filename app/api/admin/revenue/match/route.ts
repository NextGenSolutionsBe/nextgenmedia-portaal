import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { expandRevenueForMonth, type RevenueEntry } from '@/lib/invoices'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' || (await isActiveStaff(user.id)) ? user : null
}

// GET ?client_id=&month=YYYY-MM[&exclude_invoice_id=]
// Geeft ENKEL de prognoses van die klant terug die in die maand actief zijn
// (eenmalig in die maand of recurring waarvan de maand binnen de periode valt).
// Geen globale query — altijd op client_id gefilterd. Nooit op klantnaam.
export async function GET(req: NextRequest) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const sp = req.nextUrl.searchParams
    const clientId = sp.get('client_id')
    const month = (sp.get('month') || '').slice(0, 7)
    if (!clientId) return NextResponse.json({ candidates: [], error: 'client_id vereist' }, { status: 200 })
    if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ candidates: [], error: 'month vereist' }, { status: 200 })

    const admin = createAdminSupabaseClient()
    const [{ data: entries }, { data: oneInvoices }] = await Promise.all([
      admin.from('revenue_entries').select('*').eq('client_id', clientId),
      // reeds gekoppelde prognoses (eenmalige facturen in deze maand) uitsluiten
      admin.from('invoices').select('revenue_id, status').eq('invoice_month', month).not('revenue_id', 'is', null),
    ])

    const usedExcl = req.nextUrl.searchParams.get('exclude_invoice_id') // (gereserveerd; niet nodig hier)
    void usedExcl
    const linked = new Set((oneInvoices ?? []).filter((i: { status: string }) => i.status !== 'geannuleerd').map((i: { revenue_id: string | null }) => i.revenue_id))

    const candidates = expandRevenueForMonth((entries ?? []) as RevenueEntry[], month)
      .filter((c) => !linked.has(c.revenue_id))

    return NextResponse.json({ candidates })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
