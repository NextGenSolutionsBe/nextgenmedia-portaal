import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' || (await isActiveStaff(user.id)) ? user : null
}

const VALID_FREQ = ['monthly', 'quarterly', 'semi-annual', 'annual']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

/** Valideert dat client_id naar een bestaande klant verwijst. Geeft de naam terug. */
async function validateClient(admin: Admin, clientId: unknown): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const id = typeof clientId === 'string' ? clientId.trim() : ''
  if (!id) return { ok: false, error: 'Selecteer een klant voor deze prognose.' }
  const { data } = await admin.from('clients').select('id, company_name').eq('id', id).maybeSingle()
  if (!data) return { ok: false, error: 'Selecteer een geldige klant voor deze prognose.' }
  return { ok: true, id: data.id as string, name: (data.company_name as string) ?? '' }
}

/** Veerkrachtige update: laat een ontbrekende (niet-gemigreerde) kolom vallen en probeer opnieuw. */
async function safeUpdate(admin: Admin, table: string, patch: Record<string, unknown>, id: string): Promise<void> {
  const p: Record<string, unknown> = { ...patch }
  for (let i = 0; i < 6; i++) {
    const { error } = await admin.from(table).update(p).eq('id', id)
    if (!error) return
    const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
    if (col && col in p) { delete p[col]; continue }
    throw new Error(error.message)
  }
}

export async function GET() {
  try {
    // SECURITY: revenue is admin-only sensitive data
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const admin = createAdminSupabaseClient()
    const [{ data, error }, { data: clients }] = await Promise.all([
      admin.from('revenue_entries').select('*').order('created_at', { ascending: false }),
      admin.from('clients').select('id, company_name'),
    ])
    if (error) throw error
    // Klantnaam joinen voor de UI (client_id blijft de bron van waarheid).
    const nameById = new Map((clients ?? []).map((c: { id: string; company_name: string }) => [c.id, c.company_name]))
    const entries = (data ?? []).map((e: Record<string, unknown>) => ({ ...e, company_name: e.client_id ? (nameById.get(e.client_id as string) ?? null) : null }))
    return NextResponse.json({ entries })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const body = await req.json()
    const {
      title, client_id, service_slug, type, billing_frequency,
      amount_per_month, start_month, end_month, months_count,
      amount, transaction_month, notes,
    } = body

    if (!type) return NextResponse.json({ error: 'type is verplicht' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    // Klantkoppeling is VERPLICHT voor een prognose — valideer tegen bestaande klanten.
    const cli = await validateClient(admin, client_id)
    if (!cli.ok) return NextResponse.json({ error: cli.error }, { status: 400 })
    console.log(`[revenue.create] ontvangen client_id=${String(client_id)} → opgeslagen=${cli.id} (${cli.name})`)

    if (type === 'recurring' && (!amount_per_month || !start_month)) {
      return NextResponse.json({ error: 'Bedrag en startmaand zijn verplicht' }, { status: 400 })
    }
    if (type === 'one_time' && (!amount || !transaction_month)) {
      return NextResponse.json({ error: 'Bedrag en transactiemaand zijn verplicht' }, { status: 400 })
    }

    const freq = VALID_FREQ.includes(billing_frequency) ? billing_frequency : 'monthly'

    let resolvedEndMonth: string | null = end_month ?? null
    if (type === 'recurring' && !resolvedEndMonth && months_count) {
      const start = new Date(start_month)
      start.setMonth(start.getMonth() + Number(months_count) - 1)
      resolvedEndMonth = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`
    }

    const row: Record<string, unknown> = {
      title: title || null,
      client_id: cli.id,            // gevalideerde client_id (nooit naam/leeg/undefined)
      service_slug: service_slug || null,
      type,
      billing_frequency: freq,
      amount_per_month: type === 'recurring' ? Number(amount_per_month) : null,
      start_month: type === 'recurring' ? start_month : null,
      end_month: resolvedEndMonth,
      amount: type === 'one_time' ? Number(amount) : null,
      transaction_month: type === 'one_time' ? transaction_month : null,
      notes: notes || null,
    }

    // Insert met kolom-fallback (oudere schema's zonder title/billing_frequency).
    const p: Record<string, unknown> = { ...row }
    for (let i = 0; i < 6; i++) {
      const { data, error } = await admin.from('revenue_entries').insert(p).select('*').single()
      if (!error) { console.log(`[revenue.create] opgeslagen entry ${data.id} met client_id=${data.client_id}`); return NextResponse.json({ entry: data }) }
      const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1] || (error.code === '42703' ? (error.message?.includes('title') ? 'title' : error.message?.includes('billing_frequency') ? 'billing_frequency' : null) : null)
      if (col && col in p) { delete p[col]; continue }
      throw new Error(error.message)
    }
    throw new Error('Opslaan mislukt')
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH { id, ...velden } — prognose bewerken (incl. klantkoppeling)
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    if (!b.id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()

    const patch: Record<string, unknown> = {}
    // Klant wijzigen → altijd valideren; nooit leeg/naam opslaan.
    if (b.client_id !== undefined) {
      const cli = await validateClient(admin, b.client_id)
      if (!cli.ok) return NextResponse.json({ error: cli.error }, { status: 400 })
      patch.client_id = cli.id
      console.log(`[revenue.update] entry=${b.id} ontvangen client_id=${String(b.client_id)} → opgeslagen=${cli.id} (${cli.name})`)
    }
    if (b.title !== undefined) patch.title = b.title || null
    if (b.service_slug !== undefined) patch.service_slug = b.service_slug || null
    if (b.notes !== undefined) patch.notes = b.notes || null
    if (b.billing_frequency !== undefined) patch.billing_frequency = VALID_FREQ.includes(b.billing_frequency) ? b.billing_frequency : 'monthly'
    if (b.amount_per_month !== undefined) patch.amount_per_month = b.amount_per_month === null ? null : Number(b.amount_per_month)
    if (b.start_month !== undefined) patch.start_month = b.start_month || null
    if (b.end_month !== undefined) patch.end_month = b.end_month || null
    if (b.amount !== undefined) patch.amount = b.amount === null ? null : Number(b.amount)
    if (b.transaction_month !== undefined) patch.transaction_month = b.transaction_month || null

    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Geen wijzigingen' }, { status: 400 })
    await safeUpdate(admin, 'revenue_entries', patch, b.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('revenue_entries').delete().eq('id', id)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
