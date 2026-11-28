import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { leesMapNaam } from '@/lib/client-uploads'
import { leesAdminIdentiteit } from '@/lib/admin-identiteit'

export const dynamic = 'force-dynamic'

/**
 * Submappen in de map van een klant, aangemaakt door het team (zoals de klant
 * dat zelf kan in de klantapp). Een map is enkel een naam: verwijderen zet de
 * bestanden terug bij de losse bestanden (ON DELETE SET NULL), er verdwijnt
 * nooit een bestand. Toegang: module Klantuploads (middleware) + teamlid.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as { client_id?: unknown; naam?: unknown; beschrijving?: unknown }
    const clientId = typeof b.client_id === 'string' && UUID.test(b.client_id) ? b.client_id : null
    if (!clientId) return NextResponse.json({ error: 'Kies een klant.' }, { status: 400 })
    const naam = leesMapNaam(b.naam)
    if ('fout' in naam) return NextResponse.json({ error: naam.fout }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: k } = await admin.from('clients').select('id, company_name').eq('id', clientId).maybeSingle()
    if (!k) return NextResponse.json({ error: 'Die klant bestaat niet.' }, { status: 404 })
    const ident = await leesAdminIdentiteit().catch(() => null)
    const { data, error } = await admin.from('client_upload_folders').insert({
      client_id: clientId, naam: naam.naam,
      beschrijving: String(b.beschrijving ?? '').trim().slice(0, 2000) || null,
      door_naam: ident?.naam ? `${ident.naam} (NextGenMedia)` : 'NextGenMedia', door_email: user.email ?? null, auth_user_id: user.id,
    }).select('id, naam').single()
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return NextResponse.json({ error: `Er is al een map "${naam.naam}" bij deze klant.` }, { status: 409 })
      throw new Error(error.message)
    }
    const meta = requestMeta(req)
    await logAudit({ action: 'uploads.map_aangemaakt', entityType: 'client_upload_folder', entityId: (data as { id: string }).id, summary: `Map "${naam.naam}" aangemaakt bij ${(k as { company_name: string }).company_name}`, actorUserId: user.id, actorEmail: user.email ?? null, ip: meta.ip, userAgent: meta.userAgent })
    return NextResponse.json({ map: data })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'Map aanmaken mislukt') }, { status: 500 }) }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id') ?? ''
    if (!UUID.test(id)) return NextResponse.json({ error: 'Map niet gevonden.' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    const { data: m } = await admin.from('client_upload_folders').select('id, naam, client_id').eq('id', id).maybeSingle()
    if (!m) return NextResponse.json({ error: 'Map niet gevonden.' }, { status: 404 })
    const { error } = await admin.from('client_upload_folders').delete().eq('id', id)
    if (error) throw new Error(error.message)
    const meta = requestMeta(req)
    await logAudit({ action: 'uploads.map_verwijderd', entityType: 'client_upload_folder', entityId: id, summary: `Map "${(m as { naam: string }).naam}" verwijderd (bestanden naar de losse bestanden)`, actorUserId: user.id, actorEmail: user.email ?? null, ip: meta.ip, userAgent: meta.userAgent })
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'Map verwijderen mislukt') }, { status: 500 }) }
}
