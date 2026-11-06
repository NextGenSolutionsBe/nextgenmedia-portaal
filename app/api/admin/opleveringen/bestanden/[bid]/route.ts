import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { BUCKET, tekenBestand, wisBestanden } from '@/lib/opleveringen-server'

export const dynamic = 'force-dynamic'
const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v)

type Rij = { id: string; pad: string; poster_pad: string | null; naam: string; status: string }

async function bestaat(admin: ReturnType<typeof createAdminSupabaseClient>, pad: string): Promise<{ ok: boolean; grootte: number }> {
  const map = pad.slice(0, pad.lastIndexOf('/')), naam = pad.slice(pad.lastIndexOf('/') + 1)
  const { data } = await admin.storage.from(BUCKET).list(map, { search: naam, limit: 10 })
  const obj = ((data ?? []) as { name: string; metadata?: { size?: number } }[]).find((o) => o.name === naam)
  return { ok: !!obj, grootte: Number(obj?.metadata?.size ?? 0) }
}

/** GET ?download=1 — ondertekende link voor het team (bekijken of downloaden). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ bid: string }> }) {
  try {
    if (!(await magIk('opleveringen', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang.' }, { status: 403 })
    const { bid } = await params
    if (!isUuid(bid)) return NextResponse.json({ error: 'Onbekend bestand.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data } = await admin.from('oplevering_bestanden').select('id, pad, naam, status').eq('id', bid).maybeSingle()
    if (!data) return NextResponse.json({ error: 'Bestand niet gevonden.' }, { status: 404 })
    return NextResponse.json({ url: await tekenBestand(admin, data as Rij, req.nextUrl.searchParams.get('download') === '1') })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'oplevering.bestand.GET') }, { status: 500 }) }
}

/** PATCH { klaar: true, duur?, breedte?, hoogte?, poster_ok? } — na de upload: nakijken dat het bestand er echt staat. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ bid: string }> }) {
  try {
    if (!(await magIk('opleveringen', 'toevoegen'))) return NextResponse.json({ error: 'Geen toegang.' }, { status: 403 })
    const { bid } = await params
    if (!isUuid(bid)) return NextResponse.json({ error: 'Onbekend bestand.' }, { status: 400 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const admin = createAdminSupabaseClient()
    const { data } = await admin.from('oplevering_bestanden').select('id, pad, poster_pad, naam, status, oplevering_id').eq('id', bid).maybeSingle()
    if (!data) return NextResponse.json({ error: 'Bestand niet gevonden.' }, { status: 404 })
    const r = data as Rij & { oplevering_id: string }
    // Upload mislukt of gestopt: de aangekondigde rij (en wat er al stond) weer weg.
    if (b.afgebroken === true) {
      if (r.status === 'klaar') return NextResponse.json({ error: 'Dit bestand is al volledig opgeladen.' }, { status: 400 })
      await wisBestanden(admin, { id: bid })
      await admin.from('oplevering_bestanden').delete().eq('id', bid)
      return NextResponse.json({ ok: true })
    }
    const echt = await bestaat(admin, r.pad)
    if (!echt.ok) return NextResponse.json({ error: 'Het bestand is niet (volledig) aangekomen. Probeer opnieuw.' }, { status: 400 })
    const getal = (v: unknown, max: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n < max ? n : null }
    const patch: Record<string, unknown> = { status: 'klaar', duur: getal(b.duur, 360000), breedte: getal(b.breedte, 20000), hoogte: getal(b.hoogte, 20000) }
    if (echt.grootte) patch.grootte = echt.grootte
    if (r.poster_pad && b.poster_ok !== true) patch.poster_pad = null
    const { error } = await admin.from('oplevering_bestanden').update(patch).eq('id', bid)
    if (error) throw new Error(error.message)
    await admin.from('opleveringen').update({ updated_at: new Date().toISOString() }).eq('id', r.oplevering_id)
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'oplevering.bestand.PATCH') }, { status: 500 }) }
}

/** DELETE — bestand (en miniatuur) weg uit de opslag en uit de versie. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ bid: string }> }) {
  try {
    if (!(await magIk('opleveringen', 'verwijderen'))) return NextResponse.json({ error: 'Je mag dit niet verwijderen.' }, { status: 403 })
    const { bid } = await params
    if (!isUuid(bid)) return NextResponse.json({ error: 'Onbekend bestand.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    await wisBestanden(admin, { id: bid })
    const { error } = await admin.from('oplevering_bestanden').delete().eq('id', bid)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'oplevering.bestand.DELETE') }, { status: 500 }) }
}
