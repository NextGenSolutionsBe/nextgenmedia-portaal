import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { controleerBewijsInvoer, controleerKostLijn, kostSoortLabel, somKosten } from '@/lib/vesting-akkoord'
import { BewijsFout, bewijsKolommen, verwerkBewijs } from '@/lib/vesting-bewijs-server'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Admin = ReturnType<typeof createAdminSupabaseClient>

/**
 * Directe kosten van een vestingcontract (hosting, onderaanneming,
 * advertentiebudget …). Ze gaan van de contractwaarde af voor Marco's deel
 * berekend wordt. De som staat ook in `vesting_contracten.uitgesloten_kosten`,
 * zodat de bestaande berekening en export ongewijzigd werken.
 */
async function zetSom(admin: Admin, contractId: string) {
  const { data } = await admin.from('vesting_kosten').select('bedrag').eq('vesting_contract_id', contractId)
  const som = somKosten(((data ?? []) as { bedrag: unknown }[]).map((r) => ({ bedrag: Number(r.bedrag) || 0 })))
  await admin.from('vesting_contracten').update({ uitgesloten_kosten: som, updated_at: new Date().toISOString() }).eq('id', contractId)
  return som
}

export async function POST(req: NextRequest) {
  const actor = await requireAdmin()
  if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const contractId = typeof b.vesting_contract_id === 'string' && UUID.test(b.vesting_contract_id) ? b.vesting_contract_id : null
    if (!contractId) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })
    const c = controleerKostLijn(b)
    if ('fout' in c) return NextResponse.json({ error: c.fout }, { status: 400 })
    const invoer = controleerBewijsInvoer(b.bewijs)
    if (!invoer) return NextResponse.json({ error: 'Laad het document van de kost op (factuur, contract …).' }, { status: 400 })
    if (!c.lijn.verantwoording) return NextResponse.json({ error: 'Geef een verantwoording: waarom gaat dit eraf?' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: contract } = await admin.from('vesting_contracten').select('id, klant, nr').eq('id', contractId).maybeSingle()
    if (!contract) return NextResponse.json({ error: 'Contract niet gevonden.' }, { status: 404 })
    const bewijs = await verwerkBewijs(admin, invoer)
    const { data: rij, error } = await admin.from('vesting_kosten').insert({ vesting_contract_id: contractId, ...c.lijn, ...bewijsKolommen(bewijs), created_by_email: actor.email ?? null }).select('id').single()
    if (error) throw new Error(error.message)
    const som = await zetSom(admin, contractId)
    const meta = requestMeta(req)
    await logAudit({
      action: 'vesting.kost_toegevoegd', entityType: 'vesting_contract', entityId: contractId,
      summary: `Vesting ${(contract as { nr: string }).nr}: kost ${kostSoortLabel(c.lijn.soort)} €${c.lijn.bedrag} (totaal €${som})`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent,
    })
    revalidatePath('/admin/vesting')
    return NextResponse.json({ ok: true, id: (rij as { id: string }).id, som })
  } catch (e) {
    if (e instanceof BewijsFout) return NextResponse.json({ error: e.message }, { status: 400 })
    return NextResponse.json({ error: safeMessage(e, 'Bewaren mislukt') }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const actor = await requireAdmin()
  if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const id = req.nextUrl.searchParams.get('id') ?? ''
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: lijn } = await admin.from('vesting_kosten').select('id, vesting_contract_id, soort, bedrag').eq('id', id).maybeSingle()
    if (!lijn) return NextResponse.json({ error: 'Niet gevonden.' }, { status: 404 })
    const l = lijn as { vesting_contract_id: string; soort: string; bedrag: number }
    const { error } = await admin.from('vesting_kosten').delete().eq('id', id)
    if (error) throw new Error(error.message)
    const som = await zetSom(admin, l.vesting_contract_id)
    const meta = requestMeta(req)
    await logAudit({
      action: 'vesting.kost_verwijderd', entityType: 'vesting_contract', entityId: l.vesting_contract_id,
      summary: `Vesting: kost ${kostSoortLabel(l.soort)} €${l.bedrag} verwijderd (totaal €${som})`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent,
    })
    revalidatePath('/admin/vesting')
    return NextResponse.json({ ok: true, som })
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e, 'Verwijderen mislukt') }, { status: 500 })
  }
}

/** PATCH { id, soort?, omschrijving?, bedrag?, verantwoording? } — een kost achteraf aanpassen (iedereen tekent daarna opnieuw). */
export async function PATCH(req: NextRequest) {
  const actor = await requireAdmin()
  if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const id = typeof b.id === 'string' && UUID.test(b.id) ? b.id : null
    if (!id) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: oud } = await admin.from('vesting_kosten').select('*').eq('id', id).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Niet gevonden.' }, { status: 404 })
    const o = oud as { vesting_contract_id: string; soort: string; omschrijving: string | null; bedrag: number; verantwoording: string | null }
    const c = controleerKostLijn({
      soort: b.soort ?? o.soort, omschrijving: b.omschrijving ?? o.omschrijving ?? '', bedrag: b.bedrag ?? o.bedrag,
      verantwoording: b.verantwoording ?? o.verantwoording ?? '',
    })
    if ('fout' in c) return NextResponse.json({ error: c.fout }, { status: 400 })
    let extra: Record<string, unknown> = {}
    if (b.bewijs !== undefined) {
      const invoer = controleerBewijsInvoer(b.bewijs)
      if (!invoer) return NextResponse.json({ error: 'Ongeldig document.' }, { status: 400 })
      extra = bewijsKolommen(await verwerkBewijs(admin, invoer))
    }
    const { error } = await admin.from('vesting_kosten').update({ ...c.lijn, ...extra, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw new Error(error.message)
    const som = await zetSom(admin, o.vesting_contract_id)
    const meta = requestMeta(req)
    await logAudit({
      action: 'vesting.kost_aangepast', entityType: 'vesting_contract', entityId: o.vesting_contract_id,
      summary: `Vesting: kost ${kostSoortLabel(c.lijn.soort)} €${o.bedrag} → €${c.lijn.bedrag} (totaal €${som})`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent,
    })
    revalidatePath('/admin/vesting')
    return NextResponse.json({ ok: true, som })
  } catch (e) {
    if (e instanceof BewijsFout) return NextResponse.json({ error: e.message }, { status: 400 })
    return NextResponse.json({ error: safeMessage(e, 'Bewaren mislukt') }, { status: 500 })
  }
}
