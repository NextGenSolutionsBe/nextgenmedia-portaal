import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { listBrands, metricoolConfigured } from '@/lib/metricool'
import { ALLE_NETWERKEN } from '@/lib/metricool-inbox-parse'
import { communityRechten } from '@/lib/community/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const UUID = /^[0-9a-f-]{36}$/i
const netwerkenVan = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(String).filter((n) => (ALLE_NETWERKEN as readonly string[]).includes(n)))] : [])

/**
 * Kanalen = Metricool-merken van een klant (meerdere per klant mogelijk).
 *  GET ?merken=1 → de merken uit Metricool (listBrands) om uit te kiezen.
 *  POST          → kanaal toevoegen. PATCH → naam, netwerken, merk of (de)activeren.
 * Geen DELETE: een kanaal verwijderen zou zijn berichten wissen. Uitzetten volstaat.
 * clients.metricool_blog_id (geplande posts) blijft ongemoeid.
 */
export async function GET(req: NextRequest) {
  try {
    const r = await communityRechten()
    if (!r.instellingen) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (req.nextUrl.searchParams.get('merken') !== '1') return NextResponse.json({ error: 'Onbekende vraag' }, { status: 400 })
    if (!metricoolConfigured()) return NextResponse.json({ error: 'Metricool is niet ingesteld.' }, { status: 503 })
    return NextResponse.json({ merken: await listBrands() })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const r = await communityRechten()
    if (!r.instellingen || !r.persoon) return NextResponse.json({ error: 'Je mag geen kanalen beheren.' }, { status: 403 })
    const body = await req.json().catch(() => ({}))
    const clientId = String(body.clientId ?? '')
    const blogId = String(body.metricool_blog_id ?? '').trim()
    const naam = String(body.naam ?? '').trim().slice(0, 200)
    if (!UUID.test(clientId) || !/^\d+$/.test(blogId) || !naam) return NextResponse.json({ error: 'Kies een merk en geef een naam.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('community_kanalen')
      .insert({ client_id: clientId, metricool_blog_id: blogId, naam, netwerken: netwerkenVan(body.netwerken), actief: true }).select('*').single()
    if (error) {
      if (/duplicate|unique|23505/i.test(error.message)) return NextResponse.json({ error: 'Dit merk is al gekoppeld aan deze klant.' }, { status: 409 })
      throw new Error(error.message)
    }
    const { ip, userAgent } = requestMeta(req)
    await logAudit({ action: 'community.kanaal.toevoegen', entityType: 'client', entityId: clientId, summary: `Kanaal ${naam} (Metricool ${blogId})`, actorUserId: r.persoon.userId, actorEmail: r.persoon.email, actorRole: r.persoon.isAdmin ? 'admin' : r.persoon.rol, metadata: { kanaal_id: data.id, netwerken: data.netwerken }, ip, userAgent })
    return NextResponse.json({ kanaal: data })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const r = await communityRechten()
    if (!r.instellingen || !r.persoon) return NextResponse.json({ error: 'Je mag geen kanalen beheren.' }, { status: 403 })
    const body = await req.json().catch(() => ({}))
    const id = String(body.id ?? '')
    if (!UUID.test(id)) return NextResponse.json({ error: 'id ontbreekt' }, { status: 400 })
    const wijz: Record<string, unknown> = {}
    if ('naam' in body) { const n = String(body.naam ?? '').trim().slice(0, 200); if (!n) return NextResponse.json({ error: 'Naam is verplicht.' }, { status: 400 }); wijz.naam = n }
    if ('netwerken' in body) wijz.netwerken = netwerkenVan(body.netwerken)
    if ('actief' in body) wijz.actief = body.actief === true
    if ('metricool_blog_id' in body) { const b = String(body.metricool_blog_id ?? '').trim(); if (!/^\d+$/.test(b)) return NextResponse.json({ error: 'Ongeldig merk.' }, { status: 400 }); wijz.metricool_blog_id = b }
    if (!Object.keys(wijz).length) return NextResponse.json({ error: 'Niets te wijzigen' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('community_kanalen').update(wijz).eq('id', id).select('*').single()
    if (error) {
      if (/duplicate|unique|23505/i.test(error.message)) return NextResponse.json({ error: 'Dit merk is al gekoppeld aan deze klant.' }, { status: 409 })
      throw new Error(error.message)
    }
    const { ip, userAgent } = requestMeta(req)
    await logAudit({ action: 'community.kanaal.wijzigen', entityType: 'client', entityId: data.client_id, summary: `Kanaal ${data.naam}: ${Object.keys(wijz).join(', ')}`, actorUserId: r.persoon.userId, actorEmail: r.persoon.email, actorRole: r.persoon.isAdmin ? 'admin' : r.persoon.rol, metadata: { kanaal_id: id, ...wijz }, ip, userAgent })
    return NextResponse.json({ kanaal: data })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
