import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// GET — herstel-overzicht (service-role, verbergt NIETS). Toont per klant het
// aantal items + "wees-items" (zonder geldige klant-koppeling) zodat verdwenen
// content teruggevonden wordt.
export async function GET() {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()

    const [{ data: itemsRaw }, { data: clients }] = await Promise.all([
      admin.from('social_content_items')
        .select('id, client_id, title, planned_date, status, platforms, created_at')
        .order('created_at', { ascending: false })
        .limit(1000),
      admin.from('clients').select('id, company_name'),
    ])
    const items = itemsRaw ?? []
    const clientMap = new Map((clients ?? []).map((c) => [c.id, c.company_name]))

    const byClient = new Map<string, { name: string; count: number }>()
    for (const i of items) {
      if (!i.client_id || !clientMap.has(i.client_id)) continue
      const e = byClient.get(i.client_id) ?? { name: clientMap.get(i.client_id) as string, count: 0 }
      e.count++
      byClient.set(i.client_id, e)
    }

    const orphans = items
      .filter((i) => !i.client_id || !clientMap.has(i.client_id))
      .map((o) => ({ id: o.id, title: o.title, planned_date: o.planned_date, status: o.status, created_at: o.created_at, client_id: o.client_id ?? null }))

    return NextResponse.json({
      total: items.length,
      byClient: [...byClient.entries()].map(([clientId, v]) => ({ clientId, name: v.name, count: v.count })).sort((a, b) => a.name.localeCompare(b.name)),
      orphanCount: orphans.length,
      orphans,
      clients: (clients ?? []).sort((a, b) => (a.company_name ?? '').localeCompare(b.company_name ?? '')),
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST { ids: string[], clientId } — koppel wees-items (terug) aan een klant.
export async function POST(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { ids, clientId } = await req.json()
    if (!clientId || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'Kies items en een klant' }, { status: 400 })
    }
    const admin = createAdminSupabaseClient()
    const cleanIds = ids.filter((v: unknown): v is string => typeof v === 'string')
    const { error } = await admin.from('social_content_items').update({ client_id: clientId }).in('id', cleanIds)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, reassigned: cleanIds.length })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
