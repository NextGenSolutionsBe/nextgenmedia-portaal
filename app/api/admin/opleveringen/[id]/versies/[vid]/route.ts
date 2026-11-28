import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { wisBestanden } from '@/lib/opleveringen-server'
import { nieuweVervaldatum } from '@/lib/opleveringen'

export const dynamic = 'force-dynamic'
const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v)

/**
 * PATCH { bericht?, is_finaal?, publiceer?, verleng? }
 * Publiceren deelt de versie met de klant: vanaf dan 3 dagen beschikbaar.
 * Verlengen zet de termijn opnieuw op 3 dagen vanaf nu (zolang de bestanden er nog zijn).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; vid: string }> }) {
  try {
    const persoon = await magIk('opleveringen', 'aanpassen')
    if (!persoon) return NextResponse.json({ error: 'Je mag dit niet aanpassen.' }, { status: 403 })
    const { id, vid } = await params
    if (!isUuid(id) || !isUuid(vid)) return NextResponse.json({ error: 'Onbekende versie.' }, { status: 400 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const admin = createAdminSupabaseClient()
    const { data: v } = await admin.from('oplevering_versies').select('id, gepubliceerd_op, verwijderd_op').eq('id', vid).eq('oplevering_id', id).maybeSingle()
    if (!v) return NextResponse.json({ error: 'Versie niet gevonden.' }, { status: 404 })
    const versie = v as { gepubliceerd_op: string | null; verwijderd_op: string | null }
    const patch: Record<string, unknown> = {}
    if ('bericht' in b) patch.bericht = String(b.bericht ?? '').trim().slice(0, 4000) || null
    if ('is_finaal' in b) patch.is_finaal = b.is_finaal === true
    if (b.publiceer === true) {
      if (versie.gepubliceerd_op) return NextResponse.json({ error: 'Deze versie is al gedeeld.' }, { status: 400 })
      const { data: bs } = await admin.from('oplevering_bestanden').select('status').eq('versie_id', vid)
      const lijst = (bs ?? []) as { status: string }[]
      if (!lijst.some((x) => x.status === 'klaar')) return NextResponse.json({ error: 'Laad eerst minstens één bestand op.' }, { status: 400 })
      if (lijst.some((x) => x.status !== 'klaar')) return NextResponse.json({ error: 'Er wordt nog een bestand opgeladen. Wacht tot alles klaar is.' }, { status: 400 })
      Object.assign(patch, { gepubliceerd_op: new Date().toISOString(), gepubliceerd_door: persoon.naam || persoon.email || null, verloopt_op: nieuweVervaldatum() })
    }
    if (b.verleng === true) {
      if (!versie.gepubliceerd_op) return NextResponse.json({ error: 'Deel de versie eerst.' }, { status: 400 })
      if (versie.verwijderd_op) return NextResponse.json({ error: 'De bestanden zijn al weggehaald. Laad ze opnieuw op in een nieuwe versie.' }, { status: 400 })
      patch.verloopt_op = nieuweVervaldatum()
    }
    if (!Object.keys(patch).length) return NextResponse.json({ ok: true })
    const { error } = await admin.from('oplevering_versies').update(patch).eq('id', vid)
    if (error) throw new Error(error.message)
    await admin.from('opleveringen').update({ updated_at: new Date().toISOString() }).eq('id', id)
    return NextResponse.json({ ok: true, verloopt_op: patch.verloopt_op ?? null })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'oplevering.versie.PATCH') }, { status: 500 }) }
}

/** DELETE — een concept-versie (nog niet gedeeld) met haar bestanden weghalen. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; vid: string }> }) {
  try {
    if (!(await magIk('opleveringen', 'verwijderen'))) return NextResponse.json({ error: 'Je mag dit niet verwijderen.' }, { status: 403 })
    const { id, vid } = await params
    if (!isUuid(id) || !isUuid(vid)) return NextResponse.json({ error: 'Onbekende versie.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: v } = await admin.from('oplevering_versies').select('gepubliceerd_op').eq('id', vid).eq('oplevering_id', id).maybeSingle()
    if (!v) return NextResponse.json({ error: 'Versie niet gevonden.' }, { status: 404 })
    if ((v as { gepubliceerd_op: string | null }).gepubliceerd_op) return NextResponse.json({ error: 'Een gedeelde versie blijft in de geschiedenis staan.' }, { status: 400 })
    await wisBestanden(admin, { versie_id: vid })
    const { error } = await admin.from('oplevering_versies').delete().eq('id', vid)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'oplevering.versie.DELETE') }, { status: 500 }) }
}
