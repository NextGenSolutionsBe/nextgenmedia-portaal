import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { leesGetal } from '@/lib/getal'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Herbruikbare artikelen (shoot, montage, extra werkuren, kilometervergoeding,
 * parking, materiaalhuur, …). Een artikel is een sjabloon: op een
 * facturatie-item blijft elke regel daarna gewoon aanpasbaar.
 *  GET · POST { naam, … } · PATCH { id, … } · DELETE ?id=
 */

const UUID = /^[0-9a-f-]{36}$/i
const tekst = (v: unknown, max: number): string | null => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null }

function velden(b: Record<string, unknown>, nieuw: boolean): { rij: Record<string, unknown>; fout?: string } {
  const rij: Record<string, unknown> = {}
  if ('naam' in b || nieuw) { const n = tekst(b.naam, 120); if (!n) return { rij, fout: 'Geef het artikel een naam.' }; rij.naam = n }
  if ('beschrijving' in b) rij.beschrijving = tekst(b.beschrijving, 1000)
  if ('eenheid' in b) rij.eenheid = tekst(b.eenheid, 20) ?? 'stuk'
  if ('prijs_excl' in b) { const p = b.prijs_excl === null || b.prijs_excl === '' ? null : leesGetal(b.prijs_excl); if (p !== null && p < 0) return { rij, fout: 'De prijs kan niet negatief zijn.' }; rij.prijs_excl = p === null ? null : Math.round(p * 10000) / 10000 }
  if ('btw_pct' in b) { const p = leesGetal(b.btw_pct); if (p === null || p < 0 || p > 100) return { rij, fout: 'Btw moet tussen 0 en 100 % liggen.' }; rij.btw_pct = p }
  if ('soort' in b) rij.soort = b.soort === 'doorgerekende_kost' ? 'doorgerekende_kost' : 'dienst'
  return { rij }
}

export async function GET() {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const { data } = await admin.from('factuur_artikelen').select('*').eq('actief', true).order('volgorde').order('naam')
    return NextResponse.json({ artikelen: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const { rij, fout } = velden(b, true)
    if (fout) return NextResponse.json({ error: fout }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: max } = await admin.from('factuur_artikelen').select('volgorde').order('volgorde', { ascending: false }).limit(1)
    rij.volgorde = ((max?.[0]?.volgorde as number | undefined) ?? 0) + 1
    const { data, error } = await admin.from('factuur_artikelen').insert(rij).select('*').single()
    if (error) throw new Error(error.message)
    const meta = requestMeta(req)
    await logAudit({ action: 'factuur_artikel.create', entityType: 'factuur_artikel', entityId: data.id, summary: `Herbruikbaar artikel "${rij.naam}" toegevoegd`, actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'staff', ip: meta.ip, userAgent: meta.userAgent })
    return NextResponse.json({ artikel: data })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const id = String(b.id ?? '')
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig artikel' }, { status: 400 })
    const { rij, fout } = velden(b, false)
    if (fout) return NextResponse.json({ error: fout }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('factuur_artikelen').update({ ...rij, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()
    if (error) throw new Error(error.message)
    const meta = requestMeta(req)
    await logAudit({ action: 'factuur_artikel.update', entityType: 'factuur_artikel', entityId: id, summary: `Herbruikbaar artikel "${data.naam}" aangepast`, actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'staff', ip: meta.ip, userAgent: meta.userAgent })
    return NextResponse.json({ artikel: data })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id') ?? ''
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig artikel' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    // Enkel het sjabloon verdwijnt; regels die er al mee gemaakt zijn, blijven ongemoeid.
    const { data: oud } = await admin.from('factuur_artikelen').select('naam').eq('id', id).maybeSingle()
    const { error } = await admin.from('factuur_artikelen').delete().eq('id', id)
    if (error) throw new Error(error.message)
    const meta = requestMeta(req)
    await logAudit({ action: 'factuur_artikel.delete', entityType: 'factuur_artikel', entityId: id, summary: `Herbruikbaar artikel "${oud?.naam ?? id}" verwijderd`, actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'staff', ip: meta.ip, userAgent: meta.userAgent })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
