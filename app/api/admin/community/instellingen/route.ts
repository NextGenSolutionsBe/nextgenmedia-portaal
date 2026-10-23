import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { communityRechten, naamVan, schoneCheatSheet, schoneVoorbeelden } from '@/lib/community/server'
import { STANDAARDREGELS } from '@/lib/community/standaardregels'
import { OPEN_STATUSSEN } from '@/lib/community/model'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i

/**
 * Community management per klant: de schakelaar en de afspraken.
 *  GET ?clientId= → instellingen (of null = nog nooit ingesteld), kanalen, de
 *                   standaardregels als voorstel en het aantal open berichten.
 *  PUT            → bewaren (enkel met recht 'instellingen'). Uitzetten wist niets.
 * De standaardregels worden nooit automatisch bewaard: enkel wat iemand bewaart.
 */
export async function GET(req: NextRequest) {
  try {
    const r = await communityRechten()
    if (!r.bekijken) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const clientId = req.nextUrl.searchParams.get('clientId') ?? ''
    if (!UUID.test(clientId)) return NextResponse.json({ error: 'clientId ontbreekt' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const [{ data: inst, error }, { data: kanalen }, { count }] = await Promise.all([
      admin.from('community_instellingen').select('*').eq('client_id', clientId).maybeSingle(),
      admin.from('community_kanalen').select('id, naam, metricool_blog_id, netwerken, actief, laatst_gesynct, laatste_fout').eq('client_id', clientId).order('naam'),
      admin.from('community_berichten').select('id', { count: 'exact', head: true }).eq('client_id', clientId).in('status', OPEN_STATUSSEN),
    ])
    if (error && /does not exist|schema cache/i.test(error.message)) return NextResponse.json({ error: 'De tabellen voor community management bestaan nog niet (migratie).' }, { status: 503 })
    return NextResponse.json({ instellingen: inst ?? null, kanalen: kanalen ?? [], standaardregels: STANDAARDREGELS, open: count ?? 0, magInstellen: r.instellingen })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const r = await communityRechten()
    if (!r.instellingen || !r.persoon) return NextResponse.json({ error: 'Je mag de instellingen van community management niet wijzigen.' }, { status: 403 })
    const body = await req.json().catch(() => ({}))
    const clientId = String(body.clientId ?? '')
    if (!UUID.test(clientId)) return NextResponse.json({ error: 'clientId ontbreekt' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: klant } = await admin.from('clients').select('id, company_name').eq('id', clientId).maybeSingle()
    if (!klant) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })

    const { data: oud } = await admin.from('community_instellingen').select('*').eq('client_id', clientId).maybeSingle()
    const rij: Record<string, unknown> = { client_id: clientId, bijgewerkt_op: new Date().toISOString(), bijgewerkt_door: naamVan(r.persoon) }
    if ('actief' in body) rij.actief = body.actief === true
    if ('klant_keurt_goed' in body) rij.klant_keurt_goed = body.klant_keurt_goed !== false
    if ('tone_of_voice' in body) rij.tone_of_voice = String(body.tone_of_voice ?? '').trim().slice(0, 5000) || null
    if ('regels' in body) rij.regels = String(body.regels ?? '').trim().slice(0, 10000) || null
    if ('cheat_sheet' in body) rij.cheat_sheet = schoneCheatSheet(body.cheat_sheet)
    if ('voorbeeldantwoorden' in body) rij.voorbeeldantwoorden = schoneVoorbeelden(body.voorbeeldantwoorden)

    const { data, error } = await admin.from('community_instellingen').upsert(rij, { onConflict: 'client_id' }).select('*').single()
    if (error) throw new Error(error.message)

    const gewijzigd = Object.keys(rij).filter((k) => !['client_id', 'bijgewerkt_op', 'bijgewerkt_door'].includes(k))
    const { ip, userAgent } = requestMeta(req)
    await logAudit({
      action: 'actief' in rij && (oud?.actief ?? false) !== rij.actief ? (rij.actief ? 'community.aan' : 'community.uit') : 'community.instellingen',
      entityType: 'client', entityId: clientId,
      summary: `Community management ${klant.company_name}: ${gewijzigd.join(', ')}`,
      actorUserId: r.persoon.userId, actorEmail: r.persoon.email, actorRole: r.persoon.isAdmin ? 'admin' : r.persoon.rol,
      metadata: { gewijzigd, actief: data.actief, klant_keurt_goed: data.klant_keurt_goed }, ip, userAgent,
    })
    return NextResponse.json({ instellingen: data })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
