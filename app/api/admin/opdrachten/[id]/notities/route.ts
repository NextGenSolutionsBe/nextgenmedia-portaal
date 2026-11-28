import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { leesAdminIdentiteit } from '@/lib/admin-identiteit'
import { notitiesVan, voegNotitieToe } from '@/lib/opdrachten-notities'

export const dynamic = 'force-dynamic'

const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v)

// GET — de tijdlijn van één kaart: notities van het team en systeemregels.
export async function GET(_req: NextRequest, { params: p }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const params = await p
    if (!isUuid(params.id)) return NextResponse.json({ error: 'Onbekende opdracht' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    return NextResponse.json({ notities: await notitiesVan(admin, params.id) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST { tekst } — interne notitie toevoegen. Nooit zichtbaar voor de klant.
export async function POST(req: NextRequest, { params: p }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const params = await p
    if (!isUuid(params.id)) return NextResponse.json({ error: 'Onbekende opdracht' }, { status: 400 })
    const b = await req.json().catch(() => ({}))
    const tekst = String(b.tekst ?? '').trim()
    if (!tekst) return NextResponse.json({ error: 'Schrijf eerst iets.' }, { status: 400 })
    if (tekst.length > 4000) return NextResponse.json({ error: 'Die notitie is te lang (max. 4000 tekens).' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: o } = await admin.from('opdrachten').select('id').eq('id', params.id).maybeSingle()
    if (!o) return NextResponse.json({ error: 'Die opdracht bestaat niet (meer).' }, { status: 404 })
    const ident = await leesAdminIdentiteit().catch(() => null)
    const n = await voegNotitieToe(admin, params.id, tekst, 'notitie', { id: actor.id, email: actor.email ?? null, naam: ident?.naam || null })
    if (!n) return NextResponse.json({ error: 'Bewaren lukte niet. Probeer opnieuw.' }, { status: 503 })
    await admin.from('opdrachten').update({ updated_at: new Date().toISOString() }).eq('id', params.id)
    return NextResponse.json({ notitie: n })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?notitie= — je eigen notitie weghalen. Systeemregels blijven staan.
export async function DELETE(req: NextRequest, { params: p }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const params = await p
    const nid = req.nextUrl.searchParams.get('notitie') ?? ''
    if (!isUuid(params.id) || !isUuid(nid)) return NextResponse.json({ error: 'Onbekende notitie' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: n } = await admin.from('opdracht_notities').select('id, soort, auteur_user_id').eq('id', nid).eq('opdracht_id', params.id).maybeSingle()
    if (!n) return NextResponse.json({ error: 'Die notitie bestaat niet (meer).' }, { status: 404 })
    const r = n as { soort: string; auteur_user_id: string | null }
    if (r.soort !== 'notitie') return NextResponse.json({ error: 'Systeemregels blijven staan.' }, { status: 400 })
    if (r.auteur_user_id !== actor.id) return NextResponse.json({ error: 'Je kan enkel je eigen notities verwijderen.' }, { status: 403 })
    const { error } = await admin.from('opdracht_notities').delete().eq('id', nid)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
