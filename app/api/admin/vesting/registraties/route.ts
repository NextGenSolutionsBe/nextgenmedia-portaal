import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { controleerRegistratie, naarRegistratie } from '@/lib/vesting-akkoord'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const eur = (n: number) => `€${n.toLocaleString('nl-BE', { maximumFractionDigits: 2 })}`

/**
 * Inkomsten (via WAM of een andere weg) en algemene kosten registreren, altijd
 * met een verantwoording. Aanpassen kan altijd (bv. een factuur die achteraf
 * lager uitviel); daarna tekenen Marco, Bram en Chiara opnieuw. Verwijderen
 * bestaat niet: schrappen telt voor €0 en ook dat wordt getekend.
 */
export async function POST(req: NextRequest) {
  const actor = await requireAdmin()
  if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const c = controleerRegistratie(b, true)
    if ('fout' in c) return NextResponse.json({ error: c.fout }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const nu = new Date().toISOString()
    const { data, error } = await admin.from('vesting_registraties')
      .insert({ ...c.rij, created_by_email: actor.email ?? null, updated_at: nu, updated_by_email: actor.email ?? null })
      .select('*').single()
    if (error) throw new Error(error.message)
    const r = naarRegistratie(data as Record<string, unknown>)
    const meta = requestMeta(req)
    await logAudit({
      action: `vesting.${r.soort}_geregistreerd`, entityType: 'vesting_registratie', entityId: r.id,
      summary: `Vesting: ${r.soort} ${r.omschrijving} ${eur(r.bedrag)} geregistreerd`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent,
      metadata: { registratie: r },
    })
    revalidatePath('/admin/vesting')
    return NextResponse.json({ ok: true, id: r.id })
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e, 'Bewaren mislukt') }, { status: 500 })
  }
}

/** PATCH { id, ...velden } of { id, actie: 'schrappen' | 'herstellen' }. */
export async function PATCH(req: NextRequest) {
  const actor = await requireAdmin()
  if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const id = typeof b.id === 'string' && UUID.test(b.id) ? b.id : null
    if (!id) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: oud } = await admin.from('vesting_registraties').select('*').eq('id', id).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Niet gevonden.' }, { status: 404 })
    const voor = naarRegistratie(oud as Record<string, unknown>)
    const nu = new Date().toISOString()

    let wijziging: Record<string, unknown>
    if (b.actie === 'schrappen') wijziging = { geschrapt_op: nu, geschrapt_door: actor.email ?? null }
    else if (b.actie === 'herstellen') wijziging = { geschrapt_op: null, geschrapt_door: null }
    else {
      const { soort: _soort, ...rest } = b
      void _soort
      const c = controleerRegistratie(rest, false)
      if ('fout' in c) return NextResponse.json({ error: c.fout }, { status: 400 })
      wijziging = c.rij
      if (!Object.keys(wijziging).length) return NextResponse.json({ ok: true })
    }
    const { data, error } = await admin.from('vesting_registraties').update({ ...wijziging, updated_at: nu, updated_by_email: actor.email ?? null }).eq('id', id).select('*').single()
    if (error) throw new Error(error.message)
    const na = naarRegistratie(data as Record<string, unknown>)
    const meta = requestMeta(req)
    const wat = b.actie === 'schrappen' ? 'geschrapt' : b.actie === 'herstellen' ? 'teruggezet' : `aangepast${voor.bedrag !== na.bedrag ? ` (${eur(voor.bedrag)} → ${eur(na.bedrag)})` : ''}`
    await logAudit({
      action: `vesting.registratie_${b.actie === 'schrappen' ? 'geschrapt' : b.actie === 'herstellen' ? 'hersteld' : 'aangepast'}`, entityType: 'vesting_registratie', entityId: id,
      summary: `Vesting: ${na.soort} ${na.omschrijving} ${wat}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent,
      metadata: { voor, na },
    })
    revalidatePath('/admin/vesting')
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e, 'Bewaren mislukt') }, { status: 500 })
  }
}
