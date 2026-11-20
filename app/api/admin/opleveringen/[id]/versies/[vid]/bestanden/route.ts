import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { BUCKET } from '@/lib/opleveringen-server'
import { MAX_BESTAND, bestandPad, posterPad } from '@/lib/opleveringen'

export const dynamic = 'force-dynamic'
const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v)

/**
 * POST { naam, mimetype, grootte, poster? } — een bestand aankondigen. Geeft
 * ondertekende uploadlinks terug: de browser laadt het bestand zelf (in
 * stukjes, hervatbaar) rechtstreeks in de opslag. Er gaat nooit een video door
 * deze functie.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; vid: string }> }) {
  try {
    if (!(await magIk('opleveringen', 'toevoegen'))) return NextResponse.json({ error: 'Je mag geen bestanden opladen.' }, { status: 403 })
    const { id, vid } = await params
    if (!isUuid(id) || !isUuid(vid)) return NextResponse.json({ error: 'Onbekende versie.' }, { status: 400 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const naam = String(b.naam ?? '').trim().slice(0, 200)
    const grootte = Number(b.grootte)
    if (!naam) return NextResponse.json({ error: 'Bestandsnaam ontbreekt.' }, { status: 400 })
    if (!Number.isFinite(grootte) || grootte <= 0) return NextResponse.json({ error: 'Leeg bestand.' }, { status: 400 })
    if (grootte > MAX_BESTAND) return NextResponse.json({ error: 'Dat bestand is groter dan 50 GB.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: v } = await admin.from('oplevering_versies').select('id, verwijderd_op').eq('id', vid).eq('oplevering_id', id).maybeSingle()
    if (!v) return NextResponse.json({ error: 'Versie niet gevonden.' }, { status: 404 })
    if ((v as { verwijderd_op: string | null }).verwijderd_op) return NextResponse.json({ error: 'Deze versie is verlopen. Maak een nieuwe versie.' }, { status: 400 })
    const bid = crypto.randomUUID()
    const pad = bestandPad(id, vid, bid, naam)
    const pPad = b.poster === true ? posterPad(id, vid, bid) : null
    const { count } = await admin.from('oplevering_bestanden').select('id', { count: 'exact', head: true }).eq('versie_id', vid)
    const mimetype = String(b.mimetype ?? '').slice(0, 120) || 'application/octet-stream'
    const { error } = await admin.from('oplevering_bestanden').insert({ id: bid, oplevering_id: id, versie_id: vid, pad, poster_pad: pPad, naam, mimetype, grootte: Math.round(grootte), status: 'upload', volgorde: (count ?? 0) + 1 })
    if (error) throw new Error(error.message)
    const { data: up, error: ue } = await admin.storage.from(BUCKET).createSignedUploadUrl(pad)
    if (ue || !up) { await admin.from('oplevering_bestanden').delete().eq('id', bid); throw new Error(ue?.message ?? 'Uploadlink maken mislukt') }
    let poster: { pad: string; token: string } | null = null
    if (pPad) {
      const { data: pu } = await admin.storage.from(BUCKET).createSignedUploadUrl(pPad)
      if (pu) poster = { pad: pPad, token: pu.token }
    }
    return NextResponse.json({ bestand_id: bid, bucket: BUCKET, pad, token: up.token, poster })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'oplevering.bestand.POST') }, { status: 500 }) }
}
