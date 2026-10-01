import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { leesDeadlines, verwerkVerstreken } from '@/lib/content/goedkeuring-deadlines'
import { maandenTekst, valideerDeadline, isMaand } from '@/lib/content/deadline-model'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const notitieVan = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 1000) || null : null)

/**
 * Goedkeuringsdeadlines van de contentkalender.
 * GET ?client_id&open=1 — het overzicht (verstreken deadlines worden eerst verwerkt).
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const sp = req.nextUrl.searchParams
    const clientId = sp.get('client_id')
    if (clientId && !UUID.test(clientId)) return NextResponse.json({ error: 'Ongeldige klant' }, { status: 400 })
    await verwerkVerstreken(admin, clientId ?? undefined)
    const deadlines = await leesDeadlines(admin, { clientId: clientId ?? undefined, alleenOpen: sp.get('open') === '1' })
    return NextResponse.json({ deadlines })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** POST { client_id, maanden: ['YYYY-MM'], deadline: 'YYYY-MM-DD', notitie? } */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const clientId = String(b.client_id ?? '')
    if (!UUID.test(clientId)) return NextResponse.json({ error: 'Kies een klant.' }, { status: 400 })
    const v = valideerDeadline(b)
    if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('content_goedkeuring_deadlines')
      .insert({ client_id: clientId, maanden: v.maanden, deadline: v.deadline, notitie: notitieVan(b.notitie), created_by: actor.email ?? null })
      .select('id').single()
    if (error) throw new Error(error.message)
    const meta = requestMeta(req)
    await logAudit({ action: 'content.deadline_gezet', entityType: 'client', entityId: clientId, summary: `Goedkeuringsdeadline ${v.deadline.split('-').reverse().join('/')} voor ${maandenTekst(v.maanden)}`, actorUserId: actor.id, actorEmail: actor.email ?? null, metadata: { deadline_id: data.id, maanden: v.maanden, deadline: v.deadline }, ip: meta.ip, userAgent: meta.userAgent })
    return NextResponse.json({ ok: true, id: data.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** PATCH { id, maanden?, deadline?, notitie? } — enkel een open deadline wijzigt van datum of maanden. */
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const id = String(b.id ?? '')
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: oud } = await admin.from('content_goedkeuring_deadlines').select('*').eq('id', id).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ('notitie' in b) patch.notitie = notitieVan(b.notitie)
    if ('maanden' in b || 'deadline' in b) {
      if (oud.status !== 'open') return NextResponse.json({ error: 'Deze deadline is al verstreken en verwerkt; maak een nieuwe aan.' }, { status: 409 })
      const v = valideerDeadline({ maanden: 'maanden' in b ? b.maanden : oud.maanden, deadline: 'deadline' in b ? b.deadline : oud.deadline })
      if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })
      patch.maanden = v.maanden; patch.deadline = v.deadline
    }
    const { error } = await admin.from('content_goedkeuring_deadlines').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
    const meta = requestMeta(req)
    await logAudit({ action: 'content.deadline_gewijzigd', entityType: 'client', entityId: oud.client_id, summary: `Goedkeuringsdeadline aangepast${patch.deadline ? ` → ${String(patch.deadline).split('-').reverse().join('/')}` : ''}`, actorUserId: actor.id, actorEmail: actor.email ?? null, metadata: { deadline_id: id, oud: { maanden: oud.maanden, deadline: oud.deadline }, nieuw: patch }, ip: meta.ip, userAgent: meta.userAgent })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** DELETE ?id — een deadline schrappen (al goedgekeurde content blijft goedgekeurd). */
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id') ?? ''
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: oud } = await admin.from('content_goedkeuring_deadlines').select('client_id, maanden, deadline').eq('id', id).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })
    const { error } = await admin.from('content_goedkeuring_deadlines').delete().eq('id', id)
    if (error) throw new Error(error.message)
    const meta = requestMeta(req)
    await logAudit({ action: 'content.deadline_verwijderd', entityType: 'client', entityId: oud.client_id, summary: `Goedkeuringsdeadline ${String(oud.deadline).split('-').reverse().join('/')} (${maandenTekst((oud.maanden as string[]).filter(isMaand))}) verwijderd`, actorUserId: actor.id, actorEmail: actor.email ?? null, metadata: { deadline_id: id, ...oud }, ip: meta.ip, userAgent: meta.userAgent })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
