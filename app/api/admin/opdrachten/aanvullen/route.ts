import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { normaliseerDiensten, isBron, projectVerantwoordelijke } from '@/lib/opdrachten-kanban'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * POST { items: [{ id, diensten?, verantwoordelijke?, bron? }] } — kaarten in één keer aanvullen
 * (dienst en verantwoordelijke), na nakijken in het venster "Kaarten aanvullen". Enkel wat
 * meegestuurd wordt verandert; status en koppelingen blijven ongemoeid.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    const items = Array.isArray(b.items) ? b.items.slice(0, 300) : []
    if (!items.length) return NextResponse.json({ error: 'Niets om te bewaren.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const nu = new Date().toISOString()
    let gelukt = 0
    const fouten: string[] = []
    for (const it of items as Record<string, unknown>[]) {
      const id = String(it.id ?? '')
      if (!/^[0-9a-f-]{36}$/i.test(id)) continue
      const patch: Record<string, unknown> = { updated_at: nu }
      if ('diensten' in it) patch.diensten = normaliseerDiensten(it.diensten)
      if ('bron' in it) { if (it.bron && !isBron(it.bron)) continue; patch.bron = it.bron || null }
      if ('verantwoordelijke' in it) { const v = projectVerantwoordelijke(it.verantwoordelijke); if (!v) continue; patch.verantwoordelijke = v }
      if (Object.keys(patch).length === 1) continue
      const { error } = await admin.from('opdrachten').update(patch).eq('id', id)
      if (error) fouten.push(error.message); else gelukt++
    }
    if (!gelukt && fouten.length) throw new Error(fouten[0])
    const meta = requestMeta(req)
    await logAudit({
      action: 'opdracht.aanvullen', entityType: 'opdracht', entityId: null,
      summary: `${gelukt} opdracht${gelukt === 1 ? '' : 'en'} aangevuld (dienst/verantwoordelijke)`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true, gelukt, mislukt: fouten.length })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
