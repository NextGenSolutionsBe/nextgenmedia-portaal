import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { logContractEvent } from '@/lib/contract-audit'
import { logAudit, requestMeta } from '@/lib/audit'
import { looptijdVan, valideerWijziging, LOOPTIJD_INFO } from '@/lib/contracten/looptijd'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * PATCH { looptijd_status, stop_datum?, stop_reden? } — de looptijdstatus van
 * één contract aanpassen (lopend / afgerond / stopgezet / verlopen).
 *
 * Raakt de ondertekeningsstatus, documenten en certificaten niet aan. Elke
 * wijziging komt in de tijdlijn van het contract met oude en nieuwe status,
 * tijdstip en wie het deed.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const actor = await magIk('contracts', 'aanpassen')
    if (!actor) return NextResponse.json({ error: 'Je hebt geen recht om contracten aan te passen.' }, { status: 403 })

    const v = valideerWijziging(await req.json().catch(() => ({})))
    if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: c, error: leesFout } = await admin.from('contracts').select('id, title, looptijd_status, stop_datum, stop_reden').eq('id', id).maybeSingle()
    if (leesFout) {
      if (/looptijd_status/.test(leesFout.message)) return NextResponse.json({ error: 'De databank is nog niet bijgewerkt (looptijdstatus ontbreekt). Draai de migratie.' }, { status: 409 })
      throw new Error(leesFout.message)
    }
    if (!c) return NextResponse.json({ error: 'Contract niet gevonden' }, { status: 404 })

    const oud = looptijdVan(c.looptijd_status as string | null)
    const nu = new Date().toISOString()
    const update: Record<string, unknown> = { looptijd_status: v.status, looptijd_gewijzigd_op: nu }
    // Stopdatum en reden horen enkel bij "stopgezet"; bij een andere status blijven ze
    // bewaard in de geschiedenis (contract_events), niet op het contract.
    update.stop_datum = v.status === 'stopgezet' ? v.stopDatum : null
    update.stop_reden = v.status === 'stopgezet' ? v.stopReden : null

    const { error } = await admin.from('contracts').update(update).eq('id', id)
    if (error) throw new Error(error.message)

    const wie = actor.email ?? null
    const meta = { oud, nieuw: v.status, stop_datum: update.stop_datum ?? null, stop_reden: update.stop_reden ?? null, door: wie }
    await logContractEvent(admin, id, 'looptijd_gewijzigd', { actor: wie, meta })
    const rm = requestMeta(req)
    await logAudit({
      action: 'contract.looptijd_gewijzigd', entityType: 'contract', entityId: id,
      summary: `${c.title}: ${LOOPTIJD_INFO[oud].label} → ${LOOPTIJD_INFO[v.status].label}${v.stopReden ? ` (${v.stopReden})` : ''}`,
      actorUserId: actor.userId, actorEmail: wie, actorRole: 'staff', metadata: meta, ip: rm.ip, userAgent: rm.userAgent,
    })

    return NextResponse.json({ ok: true, looptijd_status: v.status, stop_datum: update.stop_datum, stop_reden: update.stop_reden, oud, gewijzigd_op: nu })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
