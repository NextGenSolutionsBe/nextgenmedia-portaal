import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { keurAllesGoed, leesDeadlines, maandTellingen, conceptenNaarKlant } from '@/lib/content/goedkeuring-deadlines'
import { maandenTekst, valideerDeadline, isMaand, geldigeTermijn, deadlineNaDagen, vandaagBrussel, voornaam } from '@/lib/content/deadline-model'
import { revalidatePath } from 'next/cache'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const notitieVan = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 1000) || null : null)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }
/** Schrijven die ontbrekende (niet-gemigreerde) kolommen laat vallen en opnieuw probeert. */
async function veerkrachtig(admin: Admin, op: 'insert' | 'update', rij: Record<string, unknown>, id?: string): Promise<string> {
  const p = { ...rij }
  for (let i = 0; i < 10; i++) {
    const q = op === 'insert' ? admin.from('content_goedkeuring_deadlines').insert(p).select('id').single() : admin.from('content_goedkeuring_deadlines').update(p).eq('id', id)
    const { data, error } = await q
    if (!error) return op === 'insert' ? String(data.id) : String(id)
    const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
    if (col && col in p) { delete p[col]; continue }
    throw new Error(error.message)
  }
  throw new Error('Opslaan mislukt')
}

/**
 * Goedkeuringsdeadlines van de contentkalender.
 * GET ?client_id&open=1 — het overzicht. Er wordt nooit automatisch goedgekeurd.
 * GET ?client_id&voorbereiding=1 — voor "Goedkeuring aanvragen": per maand wat er
 *   klaarstaat, en of de klant een e-mailadres en voornaam heeft.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const sp = req.nextUrl.searchParams
    const clientId = sp.get('client_id')
    if (clientId && !UUID.test(clientId)) return NextResponse.json({ error: 'Ongeldige klant' }, { status: 400 })
    const deadlines = await leesDeadlines(admin, { clientId: clientId ?? undefined, alleenOpen: sp.get('open') === '1' })
    if (clientId && sp.get('voorbereiding') === '1') {
      const n = new Date()
      const maanden = Array.from({ length: 8 }, (_, i) => { const d = new Date(Date.UTC(n.getFullYear(), n.getMonth() + i - 1, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` })
      const [{ data: k }, tellingen] = await Promise.all([
        admin.from('clients').select('company_name, contact_name, email').eq('id', clientId).maybeSingle(),
        maandTellingen(admin, clientId, maanden),
      ])
      return NextResponse.json({
        deadlines, maanden: tellingen, vandaag: vandaagBrussel(),
        klant: k ? { naam: k.company_name ?? '', voornaam: voornaam(k.contact_name, k.company_name), email: k.email ?? '' } : null,
      })
    }
    return NextResponse.json({ deadlines })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * POST { client_id, maanden: ['YYYY-MM'], deadline?: 'YYYY-MM-DD', termijn_dagen?: n, notitie?, concepten_naar_klant? }
 * "Goedkeuring aanvragen": met termijn_dagen berekent de server de deadline (vandaag + n
 * dagen, Brussel). Loopt er al een open termijn voor precies dezelfde maanden, dan
 * wordt die bijgewerkt in plaats van een tweede aftelklok te maken. Er wordt hier
 * nooit gemaild: de mail kies je daarna zelf (met voorbeeld).
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const clientId = String(b.client_id ?? '')
    if (!UUID.test(clientId)) return NextResponse.json({ error: 'Kies een klant.' }, { status: 400 })
    const termijn = b.termijn_dagen !== undefined && b.termijn_dagen !== null ? geldigeTermijn(b.termijn_dagen) : null
    if (b.termijn_dagen !== undefined && b.termijn_dagen !== null && termijn === null) return NextResponse.json({ error: 'Kies een termijn van 1 tot 60 dagen.' }, { status: 400 })
    const v = valideerDeadline({ maanden: b.maanden, deadline: termijn ? deadlineNaDagen(vandaagBrussel(), termijn) : b.deadline })
    if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: klant } = await admin.from('clients').select('id').eq('id', clientId).maybeSingle()
    if (!klant) return NextResponse.json({ error: 'Klant niet gevonden.' }, { status: 404 })

    const nu = new Date().toISOString()
    // Zelfde maanden al open? Dan die termijn bijwerken (één aftelklok per aanvraag).
    const { data: open } = await admin.from('content_goedkeuring_deadlines').select('id, maanden, deadline').eq('client_id', clientId).eq('status', 'open')
    const zelfde = ((open ?? []) as { id: string; maanden: string[]; deadline: string }[]).find((d) => [...d.maanden].sort().join(',') === v.maanden.join(','))
    let id: string
    if (zelfde) {
      id = await veerkrachtig(admin, 'update', { deadline: v.deadline, termijn_dagen: termijn, aangevraagd_op: nu, updated_at: nu, ...('notitie' in b ? { notitie: notitieVan(b.notitie) } : {}) }, zelfde.id)
    } else {
      id = await veerkrachtig(admin, 'insert', { client_id: clientId, maanden: v.maanden, deadline: v.deadline, termijn_dagen: termijn, aangevraagd_op: nu, notitie: notitieVan(b.notitie), created_by: actor.email ?? null })
    }
    const naarKlant = b.concepten_naar_klant === true ? await conceptenNaarKlant(admin, clientId, v.maanden, actor.email ?? null) : 0

    const meta = requestMeta(req)
    await logAudit({ action: zelfde ? 'content.deadline_gewijzigd' : 'content.deadline_gezet', entityType: 'client', entityId: clientId, summary: `Goedkeuring aangevraagd voor ${maandenTekst(v.maanden)}: tegen ${v.deadline.split('-').reverse().join('/')}${termijn ? ` (${termijn} dagen)` : ''}${naarKlant ? ` · ${naarKlant} concept(en) naar de klant` : ''}`, actorUserId: actor.id, actorEmail: actor.email ?? null, metadata: { deadline_id: id, maanden: v.maanden, deadline: v.deadline, termijn_dagen: termijn, bijgewerkt: !!zelfde, oud: zelfde ? { deadline: zelfde.deadline } : null, concepten_naar_klant: naarKlant }, ip: meta.ip, userAgent: meta.userAgent })
    try { revalidatePath('/admin/services/social-media'); revalidatePath('/portal'); revalidatePath('/portal/social-media') } catch { }
    return NextResponse.json({ ok: true, id, deadline: v.deadline, termijn_dagen: termijn, bijgewerkt: !!zelfde, naar_klant: naarKlant })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * PATCH { id, maanden?, deadline?, notitie? } — enkel een open deadline wijzigt van datum of maanden.
 * PATCH { id, actie: 'alles_goedkeuren' } — de manuele knop: wat nog bij de klant staat → goedgekeurd.
 */
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const id = String(b.id ?? '')
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    if (b.actie === 'alles_goedkeuren') {
      const r = await keurAllesGoed(admin, id, { id: actor.id, email: actor.email ?? null })
      if (!r.ok) return NextResponse.json({ error: r.fout }, { status: 409 })
      return NextResponse.json({ ok: true, aantal: r.aantal })
    }
    const { data: oud } = await admin.from('content_goedkeuring_deadlines').select('*').eq('id', id).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ('notitie' in b) patch.notitie = notitieVan(b.notitie)
    if ('maanden' in b || 'deadline' in b) {
      if (oud.status !== 'open') return NextResponse.json({ error: 'Deze deadline is al afgerond; maak een nieuwe aan.' }, { status: 409 })
      const v = valideerDeadline({ maanden: 'maanden' in b ? b.maanden : oud.maanden, deadline: 'deadline' in b ? b.deadline : oud.deadline })
      if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })
      patch.maanden = v.maanden; patch.deadline = v.deadline
      // Een zelf gekozen datum is geen "termijn van n dagen" meer. Er wordt niets opnieuw gemaild;
      // het overzicht toont wel dat de vorige mail nog de oude datum vermeldde.
      if (v.deadline !== oud.deadline) patch.termijn_dagen = null
    }
    await veerkrachtig(admin, 'update', patch, id)
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
