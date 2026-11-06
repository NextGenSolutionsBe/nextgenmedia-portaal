import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { leesAdminIdentiteit } from '@/lib/admin-identiteit'
import { kolomVan, ontbreektVoorFase } from '@/lib/opdrachten-kanban'
import { voegNotitieToe } from '@/lib/opdrachten-notities'
import { sluitContractTaak } from '@/lib/opdrachten-offertes'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST { id } — een project in gang zetten zonder contract: de bevestigde
 * offerte volstaat. De kaart gaat naar In uitvoering (dat beslist het team,
 * nooit de app) en de taak "contract opmaken of in gang zetten" wordt afgevinkt.
 */
export async function POST(req: NextRequest) {
  const ik = await requireStaff()
  if (!ik) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as { id?: unknown }
    const id = typeof b.id === 'string' && UUID.test(b.id) ? b.id : null
    if (!id) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data } = await admin.from('opdrachten').select('id, status, client_id, klant_vrij, diensten, btw_nummer').eq('id', id).maybeSingle()
    const k = data as { id: string; status: string; client_id: string | null; klant_vrij: string | null; diensten: string[] | null; btw_nummer: string | null } | null
    if (!k) return NextResponse.json({ error: 'Kaart niet gevonden.' }, { status: 404 })
    const kolom = kolomVan(k.status)
    if (kolom === 'uitvoering' || kolom === 'afgerond') return NextResponse.json({ ok: true, al: true })
    if (kolom === 'stopgezet') return NextResponse.json({ error: 'Deze kaart staat bij Verloren.' }, { status: 409 })

    let naam = k.klant_vrij, btw = k.btw_nummer
    if (k.client_id) {
      const { data: c } = await admin.from('clients').select('company_name, btw_nummer').eq('id', k.client_id).maybeSingle()
      naam = (c as { company_name?: string | null } | null)?.company_name ?? naam
      btw = (c as { btw_nummer?: string | null } | null)?.btw_nummer ?? btw
    }
    const mist = ontbreektVoorFase('uitvoering', { naam, btw, diensten: k.diensten ?? [] })
    if (mist.length) return NextResponse.json({ error: `Vul eerst aan: ${mist.join(', ')}.`, ontbreekt: mist }, { status: 400 })

    const nu = new Date().toISOString()
    const { data: gelukt, error } = await admin.from('opdrachten')
      .update({ status: 'bezig', status_bron: 'handmatig', status_gewijzigd_op: nu, updated_at: nu })
      .eq('id', id).eq('status', k.status).select('id')
    if (error) throw new Error(error.message)
    if (!(gelukt ?? []).length) return NextResponse.json({ error: 'De kaart werd intussen verplaatst. Herlaad het bord.' }, { status: 409 })

    const { data: offerte } = await admin.from('offertes').select('titel').eq('opdracht_id', id).eq('status', 'geaccepteerd').order('geaccepteerd_op', { ascending: false }).limit(1)
    const titel = ((offerte ?? []) as { titel: string }[])[0]?.titel
    const ident = await leesAdminIdentiteit().catch(() => null)
    await voegNotitieToe(admin, id, `In gang gezet${titel ? ` op basis van de bevestigde offerte "${titel}"` : ''}, zonder contract. De kaart staat nu in In uitvoering.`, 'systeem', { id: ik.id, email: ik.email ?? null, naam: ident?.naam || null })
    await sluitContractTaak(admin, id).catch(() => {})
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e, 'In gang zetten mislukt') }, { status: 500 })
  }
}
