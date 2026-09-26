import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisFinancieel, laadTarieven, audit } from '@/lib/personeel/server'
import { magIk } from '@/lib/instellingen/laden'
import { controleerTarief, planTariefwijziging, normaliseerTarief, isKostSoort, type KostLijn } from '@/lib/personeel/kost'
import { tekst, dagOf, getal, isUuid } from '@/lib/personeel/invoer'

export const dynamic = 'force-dynamic'

/**
 * POST — een nieuwe tariefversie. Bestaande versies worden NOOIT herschreven:
 * de lopende versie wordt afgesloten op de dag vóór de nieuwe start. Zo blijven
 * eerdere kostenberekeningen exact wat ze waren.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisFinancieel(); if (!g.ok) return g.response
    if (!(await magIk('personeel', 'aanpassen'))) return NextResponse.json({ error: 'Je mag tarieven niet aanpassen.' }, { status: 403 })
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const lijnen: KostLijn[] = (Array.isArray(b.lijnen) ? (b.lijnen as Record<string, unknown>[]) : []).slice(0, 40)
      .filter((l) => isKostSoort(l.soort) && tekst(l.label, 120))
      .map((l, i) => ({ id: tekst(l.id, 40) ?? `l${Date.now()}${i}`, label: tekst(l.label, 120)!, soort: l.soort as KostLijn['soort'], waarde: getal(l.waarde) ?? 0, datum: dagOf(l.datum) }))
    const kandidaat = {
      geldig_vanaf: dagOf(b.geldig_vanaf) ?? '', basis_label: tekst(b.basis_label, 80) ?? 'Brutouurloon', basis_uur: getal(b.basis_uur) ?? 0,
      lijnen, btw_pct: getal(b.btw_pct) ?? 0, uren_per_dag: getal(b.uren_per_dag) ?? 8, uren_per_maand: getal(b.uren_per_maand) ?? 160,
    }
    const fout = controleerTarief(kandidaat)
    if (fout) return NextResponse.json({ error: fout }, { status: 400 })
    const bestaand = await laadTarieven(g.admin, id)
    const plan = planTariefwijziging(bestaand, kandidaat.geldig_vanaf)
    if (!plan.ok) return NextResponse.json({ error: plan.fout }, { status: 409 })
    for (const a of plan.afsluiten) await g.admin.from('personeel_tarieven').update({ geldig_tot: a.geldig_tot }).eq('id', a.id)
    const { data, error } = await g.admin.from('personeel_tarieven').insert({ personeel_id: id, ...kandidaat, opmerking: tekst(b.opmerking, 500), created_by: g.persoon.email }).select('*').single()
    if (error) throw new Error(error.message)
    await audit(g.admin, { personeel_id: id, entiteit: 'tarief', entiteit_id: data.id, actie: 'tarief_toegevoegd', oud: plan.afsluiten.length ? { afgesloten: plan.afsluiten } : null, nieuw: normaliseerTarief(data), actor_email: g.persoon.email, actor_id: g.persoon.userId })
    return NextResponse.json({ ok: true, id: data.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * DELETE ?tarief=<id> — enkel de meest recente versie, en enkel als er nog
 * geen goedgekeurde uren mee berekend zijn (een vergissing rechtzetten). De
 * vorige versie loopt dan weer door.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const tid = req.nextUrl.searchParams.get('tarief')
    if (!isUuid(id) || !isUuid(tid)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisFinancieel(); if (!g.ok) return g.response
    if (!(await magIk('personeel', 'verwijderen'))) return NextResponse.json({ error: 'Je mag tarieven niet verwijderen.' }, { status: 403 })
    const bestaand = await laadTarieven(g.admin, id)
    const laatste = bestaand[bestaand.length - 1]
    if (!laatste || laatste.id !== tid) return NextResponse.json({ error: 'Enkel de meest recente tariefversie kan verwijderd worden.' }, { status: 409 })
    const { count } = await g.admin.from('personeel_sessies').select('id', { count: 'exact', head: true }).eq('tarief_id', tid)
    if ((count ?? 0) > 0) return NextResponse.json({ error: 'Met dit tarief zijn al goedgekeurde uren berekend. Voeg een nieuwe versie toe in plaats van te verwijderen.' }, { status: 409 })
    await g.admin.from('personeel_tarieven').delete().eq('id', tid)
    const vorige = bestaand[bestaand.length - 2]
    if (vorige) await g.admin.from('personeel_tarieven').update({ geldig_tot: null }).eq('id', vorige.id)
    await audit(g.admin, { personeel_id: id, entiteit: 'tarief', entiteit_id: tid, actie: 'tarief_verwijderd', oud: laatste, actor_email: g.persoon.email, actor_id: g.persoon.userId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
