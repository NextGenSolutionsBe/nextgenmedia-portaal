import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { leesAdminIdentiteit } from '@/lib/admin-identiteit'
import { VerantwoordelijkeFout, voorstelVerantwoordelijke, zetContractVerantwoordelijke } from '@/lib/contracten/verantwoordelijke-server'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Wie is verantwoordelijk voor een contract (= de verantwoordelijke van zijn projectkaart).
 *  GET   ?opdracht=&client=           → voorstel bij een nieuw contract
 *  PATCH { contract_id, verantwoordelijke } → zetten (ook de open tegenteken-taak in ClickUp gaat mee)
 * Elke interne gebruiker (admin of actief teamlid), zoals bij het aanmaken van contracten.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const p = req.nextUrl.searchParams
    const opdrachtId = UUID.test(p.get('opdracht') ?? '') ? p.get('opdracht') : null
    const clientId = UUID.test(p.get('client') ?? '') ? p.get('client') : null
    const admin = createAdminSupabaseClient()
    const [voorstel, kaart] = await Promise.all([
      voorstelVerantwoordelijke(admin, { opdrachtId, clientId }),
      // Bedrijf van de projectkaart als voorstel (verbeterplan fase 1).
      opdrachtId ? admin.from('opdrachten').select('bedrijf').eq('id', opdrachtId).maybeSingle().then((r: { data: { bedrijf?: string | null } | null }) => r.data, () => null) : null,
    ])
    return NextResponse.json({ voorstel, bedrijf: kaart?.bedrijf ?? null })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'contract-verantwoordelijke.GET') }, { status: 500 }) }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as { contract_id?: unknown; verantwoordelijke?: unknown }
    const contractId = typeof b.contract_id === 'string' && UUID.test(b.contract_id) ? b.contract_id : null
    if (!contractId) return NextResponse.json({ error: 'Onbekend contract' }, { status: 400 })
    const ident = await leesAdminIdentiteit().catch(() => null)
    const admin = createAdminSupabaseClient()
    const r = await zetContractVerantwoordelijke(admin, contractId, b.verantwoordelijke, ident?.naam ?? user.email ?? null)
    const meta = requestMeta(req)
    await logAudit({
      action: 'contract.verantwoordelijke', entityType: 'contract', entityId: contractId,
      summary: `Verantwoordelijke van het contract: ${r.verantwoordelijke}`,
      actorUserId: user.id, actorEmail: user.email ?? null, ip: meta.ip, userAgent: meta.userAgent,
    })
    try { revalidatePath(`/admin/contracts/${contractId}`); revalidatePath('/admin/contracts') } catch { /* buiten een request */ }
    return NextResponse.json(r)
  } catch (e) {
    if (e instanceof VerantwoordelijkeFout) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e, 'contract-verantwoordelijke.PATCH') }, { status: 500 })
  }
}
